// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The worker's `report-export` job for one report (`node e2e/report-export-jobs.ts <email> [pdf|xlsx|csv]`), run
 * inline against the E2E environment with the report's own production pieces: the stored view is read, the bytes are
 * rendered with the real chromium the root playwright devDependency installed, and the meta row is saved through the
 * reports bucket exactly as the processor would. Prints the result as JSON.
 */
import { loadConfig } from '@wf/config';
import { loadKeyring } from '@wf/crypto/keyring';
import { createDb } from '@wf/db/db';
import { createReportFiles } from '@wf/db/report-files';
import { createReports } from '@wf/db/reports';
import { createUserKeys } from '@wf/db/user-keys';
import { DEFAULT_REPORT_EXPORT_OPTIONS } from '@wf/domain/report';
import { createObjectStore } from '@wf/integrations/objectstore';
import postgres from 'postgres';
import { buildReportHtml, maskAccountNumber } from '../../../apps/worker/src/report-html.ts';
import { createChromiumRenderer } from '../../../apps/worker/src/processors/report-export.ts';

const email = process.argv[2];
const format = (process.argv[3] ?? 'pdf') as 'pdf' | 'xlsx' | 'csv';
if (email === undefined) throw new Error('Usage: report-export-jobs.ts <email> [pdf|xlsx|csv]');

const superuser = postgres(process.env['DATABASE_URL_SUPERUSER'] ?? '', { max: 1, onnotice: () => undefined });
const worker = createDb(process.env['DATABASE_URL_WORKER'] ?? '', { max: 2 });
const keyring = await loadKeyring(process.env['KEK_FILE'] ?? '');
const render = createChromiumRenderer();
try {
  const [user] = await superuser<{ id: string }[]>`SELECT id FROM users WHERE lower(email) = ${email.toLowerCase()}`;
  if (user === undefined) throw new Error('No user has this email address');

  // The same pieces the processor composes, one step at a time so no transaction overlaps the render.
  const reports = createReports(worker);
  const report = await reports.latestFinal(user.id);
  if (report === null) throw new Error('The user has no final monthly report to export');
  const view = await reports.get(user.id, report.id);
  const options = { ...DEFAULT_REPORT_EXPORT_OPTIONS, maskAccountNumbers: true };
  const html = buildReportHtml(view, options, 'id', 'IDR');
  const bytes =
    format === 'pdf'
      ? await render(html, { paper: options.paper, theme: options.theme })
      : new TextEncoder().encode('placeholder'); // Only PDF is exercised end to end here.

  const config = loadConfig(process.env as Record<string, string | undefined>);
  const store = createObjectStore({
    s3: config.s3,
    bucket: 'reports',
    getDek: createUserKeys(worker, keyring).getOrCreateDek,
  });
  const meta = await createReportFiles(worker, store).save(user.id, report.id, format, options, bytes, new Date());
  console.log(
    JSON.stringify({
      stored: 1,
      fileKey: meta.fileKey,
      sizeBytes: meta.sizeBytes,
      mask: maskAccountNumber('BCA 4821'),
    }),
  );
} finally {
  await render.close?.();
  await worker.$client.end();
  await superuser.end();
}
