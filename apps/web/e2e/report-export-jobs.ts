// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The worker's `report-export` job for one report (`node e2e/report-export-jobs.ts <email> <reportId> [pdf|xlsx|csv]`),
 * run inline against the E2E environment: renders the bytes with the real chromium the root playwright
 * devDependency installed, stores them through the reports bucket, and prints the job result as JSON.
 */
import { loadKeyring } from '@wf/crypto/keyring';
import { loadConfig } from '@wf/config';
import { createDb } from '@wf/db/db';
import { createPreferences } from '@wf/db/preferences';
import { createReportFiles } from '@wf/db/report-files';
import { createReports } from '@wf/db/reports';
import { createUserKeys } from '@wf/db/user-keys';
import { createObjectStore } from '@wf/integrations/objectstore';
import { createS3Port } from '@wf/s3/s3';
import postgres from 'postgres';
import {
  createChromiumRenderer,
  createReportExportProcessor,
} from '../../../apps/worker/src/processors/report-export.ts';

const email = process.argv[2];
const format = (process.argv[3] ?? 'pdf') as 'pdf' | 'xlsx' | 'csv';
if (email === undefined) throw new Error('Usage: report-export-jobs.ts <email> [pdf|xlsx|csv]');

const superuser = postgres(process.env['DATABASE_URL_SUPERUSER'] ?? '', { max: 1, onnotice: () => undefined });
const worker = createDb(process.env['DATABASE_URL_WORKER'] ?? '', { max: 1 });
const render = createChromiumRenderer();
try {
  const [user] = await superuser<{ id: string }[]>`SELECT id FROM users WHERE lower(email) = ${email.toLowerCase()}`;
  if (user === undefined) throw new Error('No user has this email address');
  const report = await createReports(worker).latestFinal(user.id);
  if (report === null) throw new Error('The user has no final monthly report to export');
  const config = loadConfig(process.env as Record<string, string | undefined>);
  const keyring = await loadKeyring(process.env['KEK_FILE'] ?? '');
  const getDek = createUserKeys(worker, keyring).getOrCreateDek;
  const store = createObjectStore({ s3: createS3Port(config.s3), bucket: 'reports', getDek });
  const processor = createReportExportProcessor({
    db: {
      reports: createReports(worker),
      reportFiles: createReportFiles(worker, store),
      preferences: createPreferences(worker),
    },
    render,
    mailer: { send: () => Promise.resolve({ delivered: false }) },
    publicUrl: config.publicUrl,
    now: () => new Date(),
  });
  const result = await processor({
    id: `rep.${reportId}.${format}`,
    data: {
      userId: user.id,
      reportId: report.id,
      format,
      email: false,
      options: {
        sections: ['summary', 'flow', 'spending', 'largest'],
        theme: 'light',
        paper: 'a4',
        maskAccountNumbers: true,
      },
    },
    attemptsMade: 0,
  });
  console.log(JSON.stringify(result));
} finally {
  await render.close?.();
  await worker.$client.end();
  await superuser.end();
}
