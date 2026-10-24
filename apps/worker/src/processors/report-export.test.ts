// SPDX-License-Identifier: AGPL-3.0-only
import { generateDek } from '@wf/crypto/envelope';
import { DEFAULT_REPORT_EXPORT_OPTIONS } from '@wf/domain/report';
import { createPreferences } from '@wf/db/preferences';
import { createReportFiles, type ReportFileStore } from '@wf/db/report-files';
import { createReports } from '@wf/db/reports';
import { seedLedger } from '@wf/db/seed';
import type { MailMessage, Mailer } from '@wf/integrations/mailer';
import { MailNotConfiguredError } from '@wf/integrations/mailer';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  insertUser,
  PGLITE_HOOK_TIMEOUT,
  startMigrated,
  type TestDatabase,
} from '../../../../packages/db/test/pglite.ts';
import { fakeReportFileMeta, fakeReportView } from '../../test/fakes.ts';
import {
  chromiumExecutable,
  chromiumOf,
  createChromiumRenderer,
  createReportExportProcessor,
  nodeRequire,
  type ReportPdfRenderer,
} from './report-export.ts';

const PDF = new TextEncoder().encode('%PDF-1.7 fake');
const dek = generateDek();

/** Fake store port over the reports bucket, as the ObjectStore port would behave. */
function fakeStore() {
  const objects = new Map<string, { readonly bytes: Uint8Array; readonly mime: string }>();
  const store: ReportFileStore = {
    put: (userId, bytes, mime) => {
      const key = `u/${userId}/object-${objects.size}`;
      objects.set(key, { bytes, mime });
      return Promise.resolve({ key, size: bytes.length, sha256: 'fake' });
    },
    get: (_userId, key) => {
      const found = objects.get(key);
      return found === undefined ? Promise.reject(new Error(`missing ${key}`)) : Promise.resolve(found);
    },
    delete: (_userId, key) => {
      objects.delete(key);
      return Promise.resolve();
    },
  };
  return { store, objects };
}

function fakeMailer(overrides: Partial<Mailer> = {}): Mailer & { readonly sent: MailMessage[] } {
  const sent: MailMessage[] = [];
  return {
    sent,
    configured: true,
    send: (message) => {
      sent.push(message);
      return Promise.resolve();
    },
    close: () => undefined,
    ...overrides,
  };
}

function renderSpy(
  result: Uint8Array = PDF,
): ReportPdfRenderer & { readonly calls: { readonly html: string; readonly paper: string }[] } {
  const calls: { html: string; paper: string }[] = [];
  const render = (html: string, paper: 'a4' | 'letter') => {
    calls.push({ html, paper });
    return Promise.resolve(result);
  };
  return Object.assign(render, { calls });
}

let test: TestDatabase;
const at = new Date('2026-10-15T10:00:00Z');

beforeAll(async () => {
  test = await startMigrated();
}, PGLITE_HOOK_TIMEOUT);
afterAll(async () => {
  await test.close();
});

/** A user with the seeded ledger, one closed period, and its final monthly report. */
async function fixture(email: string): Promise<{
  readonly userId: string;
  readonly reportId: string;
  readonly files: ReturnType<typeof createReportFiles>;
  readonly store: ReturnType<typeof fakeStore>;
}> {
  const userId = await insertUser(test, email);
  await test.as('wf_app', () => seedLedger(test.db, userId, { getDek: () => Promise.resolve(dek) }));
  // seedLedger already closed its September period; reuse it instead of inserting a duplicate.
  const [period] = await test.query<{ id: string }>(
    `SELECT id FROM periods WHERE user_id = $1 AND status = 'closed' ORDER BY start_date DESC LIMIT 1`,
    [userId],
  );
  if (period === undefined) throw new Error('seeded closed period missing');
  const reportId = await test
    .as('wf_app', () => createReports(test.db).generate(userId, { kind: 'monthly', periodId: period.id }, at))
    .then((view) => view.id);
  const store = fakeStore();
  return { userId, reportId, files: createReportFiles(test.db, store.store), store };
}

it(
  'renders the PDF from the self-contained HTML and stores it; no email without the flow',
  async () => {
    const { userId, reportId, files, store } = await fixture('report-export-pdf@example.test');
    const render = renderSpy();
    const mailer = fakeMailer();
    const run = createReportExportProcessor({
      db: { reports: createReports(test.db), reportFiles: files, preferences: createPreferences(test.db) },
      render,
      mailer,
      publicUrl: 'https://uang.example/',
      now: () => at,
    });
    const result = await test.as('wf_worker', () =>
      run({
        id: 'export-1',
        data: {
          userId,
          reportId,
          format: 'pdf',
          email: false,
          options: { ...DEFAULT_REPORT_EXPORT_OPTIONS, maskAccountNumbers: true },
        },
        attemptsMade: 0,
      }),
    );
    expect(result).toEqual({
      format: 'pdf',
      fileKey: result.fileKey,
      sizeBytes: PDF.length,
      emailed: false,
      emailedReason: 'not_requested',
    });
    // The render got the whole document (label, page headings, the theme) and the paper of the options.
    expect(render.calls).toHaveLength(1);
    expect(render.calls[0]?.paper).toBe('a4');
    const html = render.calls[0]?.html ?? '';
    expect(html).toContain('Laporan 2026-09');
    expect(html).toContain('Ringkasan');
    expect(html).toContain('Arus rekening');
    expect(html).toContain('data-theme="light"');
    // The bytes went to the store under the row's key; Postgres keeps only the meta.
    expect(store.objects.get(result.fileKey)).toEqual({ bytes: PDF, mime: 'application/pdf' });
    expect(await test.as('wf_app', () => files.list(userId))).toMatchObject([
      { reportId, format: 'pdf', sizeBytes: PDF.length },
    ]);
    expect(mailer.sent).toEqual([]);
  },
  PGLITE_HOOK_TIMEOUT,
);

it(
  'builds XLSX and CSV without chromium and honours the sections filter',
  async () => {
    const { userId, reportId, files } = await fixture('report-export-tables@example.test');
    const render = renderSpy();
    const run = createReportExportProcessor({
      db: { reports: createReports(test.db), reportFiles: files, preferences: createPreferences(test.db) },
      render,
      mailer: fakeMailer(),
      publicUrl: 'https://uang.example/',
      now: () => at,
    });
    const options = { ...DEFAULT_REPORT_EXPORT_OPTIONS, sections: ['largest'] as const };
    const xlsx = await test.as('wf_worker', () =>
      run({ id: 'export-2', data: { userId, reportId, format: 'xlsx', email: false, options }, attemptsMade: 0 }),
    );
    expect(xlsx.format).toBe('xlsx');
    expect(render.calls).toEqual([]);
    // The saved list answers with the meta (newest first); the bytes come back through the store port.
    const metas = await test.as('wf_app', () => files.list(userId));
    const workbook = await test.as('wf_app', () => files.get(userId, metas[0]?.id ?? ''));
    expect(workbook.mime).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect([...workbook.bytes.slice(0, 2)]).toEqual([0x50, 0x4b]);

    const csv = await test.as('wf_worker', () =>
      run({ id: 'export-3', data: { userId, reportId, format: 'csv', email: false, options }, attemptsMade: 0 }),
    );
    expect(csv.format).toBe('csv');
    const newest = await test.as('wf_app', () => files.list(userId));
    const csvText = new TextDecoder().decode(
      (await test.as('wf_app', () => files.get(userId, newest[0]?.id ?? ''))).bytes,
    );
    expect(csvText).toContain('Langganan');
    expect(csvText).not.toContain('Ringkasan');
    expect(render.calls).toEqual([]);
  },
  PGLITE_HOOK_TIMEOUT,
);

it(
  'emails the PDF when the job asks for it, in the recipient locale, and reports a missing SMTP',
  async () => {
    const { userId, reportId, files } = await fixture('report-export-mail@example.test');
    const run = (mailer: Mailer) =>
      createReportExportProcessor({
        db: { reports: createReports(test.db), reportFiles: files, preferences: createPreferences(test.db) },
        render: renderSpy(),
        mailer,
        publicUrl: 'https://uang.example/',
        now: () => at,
      });
    const mailer = fakeMailer();
    const sent = await test.as('wf_worker', () =>
      run(mailer)({
        id: 'export-4',
        data: { userId, reportId, format: 'pdf', email: true, options: DEFAULT_REPORT_EXPORT_OPTIONS },
        attemptsMade: 0,
      }),
    );
    expect(sent.emailed).toBe(true);
    expect(mailer.sent).toHaveLength(1);
    const message = mailer.sent[0];
    expect(message?.to).toBe('report-export-mail@example.test');
    expect(message?.context.locale).toBe('id');
    expect(message?.template).toMatchObject({ kind: 'report_export', label: '2026-09' });
    expect(message?.attachments?.[0]).toMatchObject({
      filename: 'Laporan-2026-09.pdf',
      contentType: 'application/pdf',
    });

    const unconfigured = fakeMailer({ configured: false, send: () => Promise.reject(new Error('never configured')) });
    const quiet = await test.as('wf_worker', () =>
      run(unconfigured)({
        id: 'export-5',
        data: { userId, reportId, format: 'pdf', email: true, options: DEFAULT_REPORT_EXPORT_OPTIONS },
        attemptsMade: 0,
      }),
    );
    expect(quiet.emailed).toBe(false);
    expect(quiet.emailedReason).toBe('mail_not_configured');
    // SMTP that vanishes between the check and the send (instance settings deleted) is not an attempt either.
    const vanished = fakeMailer({ send: () => Promise.reject(new MailNotConfiguredError()) });
    const late = await test.as('wf_worker', () =>
      run(vanished)({
        id: 'export-5b',
        data: { userId, reportId, format: 'pdf', email: true, options: DEFAULT_REPORT_EXPORT_OPTIONS },
        attemptsMade: 0,
      }),
    );
    expect(late.emailed).toBe(false);
    expect(late.emailedReason).toBe('mail_not_configured');
  },
  PGLITE_HOOK_TIMEOUT,
);

it(
  'fails on an unknown report and keeps a failed SMTP attempt retryable',
  async () => {
    const { userId, reportId, files } = await fixture('report-export-errors@example.test');
    const run = (mailer: Mailer) =>
      createReportExportProcessor({
        db: { reports: createReports(test.db), reportFiles: files, preferences: createPreferences(test.db) },
        render: renderSpy(),
        mailer,
        publicUrl: 'https://uang.example/',
        now: () => at,
      });
    // Unknown report: the job rejects, so BullMQ retries, and nothing is stored.
    await expect(
      test.as('wf_worker', () =>
        run(fakeMailer())({
          id: 'export-6',
          data: {
            userId,
            reportId: '0199f5d2-7c4e-7a3b-8c1d-2e3f4a5b6fff',
            format: 'pdf',
            email: false,
            options: DEFAULT_REPORT_EXPORT_OPTIONS,
          },
          attemptsMade: 0,
        }),
      ),
    ).rejects.toMatchObject({ name: 'LedgerError' });
    // A failing SMTP send rethrows: BullMQ counts the attempt, the next try stores and mails again.
    const failing = fakeMailer({ send: () => Promise.reject(new Error('SMTP down')) });
    await expect(
      test.as('wf_worker', () =>
        run(failing)({
          id: 'export-7',
          data: { userId, reportId, format: 'pdf', email: true, options: DEFAULT_REPORT_EXPORT_OPTIONS },
          attemptsMade: 1,
        }),
      ),
    ).rejects.toThrow('SMTP down');
  },
  PGLITE_HOOK_TIMEOUT,
);

describe('chromium renderer port', () => {
  function fakeChromium() {
    const printed: { readonly format: string; readonly printBackground: boolean }[] = [];
    const launched: string[] = [];
    const chromium = {
      executablePath: () => '/fake/chromium',
      launch: ({ executablePath }: { readonly executablePath: string }) => {
        launched.push(executablePath);
        return Promise.resolve({
          newPage: () =>
            Promise.resolve({
              setContent: () => Promise.resolve(),
              pdf: (options: { readonly format: string; readonly printBackground: boolean }) => {
                printed.push(options);
                return Promise.resolve(Buffer.from('%PDF-1.7 printed'));
              },
              close: () => Promise.resolve(),
            }),
          close: () => Promise.resolve(),
        });
      },
    };
    return { chromium, printed, launched };
  }

  it('prints with the requested paper and reuses the resolved chromium', async () => {
    const { chromium, printed, launched } = fakeChromium();
    const render = createChromiumRenderer(() => ({ chromium }));
    expect(new TextDecoder().decode(await render('<html/>', 'a4'))).toContain('printed');
    expect(new TextDecoder().decode(await render('<html/>', 'letter'))).toContain('printed');
    expect(printed).toEqual([
      { format: 'A4', printBackground: true },
      { format: 'Letter', printBackground: true },
    ]);
    // The module and binary resolve once (memoized), but the browser opens and closes per PDF.
    expect(launched).toEqual(['/fake/chromium', '/fake/chromium']);
  });

  it('prefers PLAYWRIGHT_CHROMIUM_EXECUTABLE and names the fix when no browser exists', async () => {
    const { chromium, launched } = fakeChromium();
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE = '/custom/chromium';
    try {
      await expect(createChromiumRenderer(() => ({ chromium }))('<html/>', 'a4')).resolves.toBeInstanceOf(Uint8Array);
      expect(launched).toEqual(['/custom/chromium']);
    } finally {
      delete process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
    }
    const broken = {
      executablePath: () => {
        throw new Error('browser missing');
      },
    };
    expect(() => chromiumExecutable(broken as never)).toThrow('No chromium for the report PDF');
    expect(() => chromiumOf(() => undefined)).toThrow('The report PDF needs playwright-core');
    // The default loader goes through node require; resolving a builtin proves the path works.
    expect(typeof nodeRequire('node:crypto')).toBe('object');
    // The production renderer resolves its module lazily (a host without chromium starts fine).
    expect(typeof createChromiumRenderer()).toBe('function');
  });
});

describe('with fakes around the database ports', () => {
  const reports = { get: async () => Promise.resolve(fakeReportView()) } as never;
  const files = {
    save: async () => Promise.resolve(fakeReportFileMeta()),
    recipient: async () => Promise.resolve(null),
  } as never;
  const run = createReportExportProcessor({
    db: { reports, reportFiles: files, preferences: { get: async () => Promise.resolve(null) } as never },
    render: renderSpy(),
    mailer: fakeMailer(),
    publicUrl: 'https://uang.example/',
    now: () => at,
  });
  const payload = {
    userId: '0199f5d2-7c4e-7a3b-8c1d-2e3f4a5b6c90',
    reportId: '0199f5d2-7c4e-7a3b-8c1d-2e3f4a5b6c91',
  };

  it('reports a user deleted between the fetch and the email as gone', async () => {
    const result = await run({
      id: 'export-8',
      data: { ...payload, format: 'pdf', email: true, options: DEFAULT_REPORT_EXPORT_OPTIONS },
      attemptsMade: 0,
    });
    expect(result.emailed).toBe(false);
    expect(result.emailedReason).toBe('gone');
  });

  it('falls back to the Indonesian defaults for the file when the user is gone', async () => {
    const result = await run({
      id: 'export-9',
      data: { ...payload, format: 'csv', email: false, options: DEFAULT_REPORT_EXPORT_OPTIONS },
      attemptsMade: 0,
    });
    expect(result.format).toBe('csv');
  });
});
