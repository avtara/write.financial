// SPDX-License-Identifier: AGPL-3.0-only
import type { LocalDate } from '@wf/domain/period';
import { DEFAULT_REPORT_EXPORT_OPTIONS } from '@wf/domain/report';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { insertUser, pgError, PGLITE_HOOK_TIMEOUT, startMigrated, type TestDatabase } from '../test/pglite.ts';
import { LedgerError } from './ledger-errors.ts';
import { createReports } from './reports.ts';
import { createReportFiles, type ReportFileStore } from './report-files.ts';

/** In-memory store port recording what the repository sends to object storage. */
function fakeStore() {
  const objects = new Map<string, { readonly bytes: Uint8Array; readonly mime: string }>();
  const store: ReportFileStore = {
    put: (userId, bytes, mime) => {
      const key = `u/${userId}/00000000-0000-7000-8000-00000000000${objects.size}`;
      objects.set(key, { bytes, mime });
      return Promise.resolve({ key, size: bytes.length, sha256: 'fake-sha' });
    },
    get: (_userId, key) => {
      const found = objects.get(key);
      return found === undefined ? Promise.reject(new Error(`missing object ${key}`)) : Promise.resolve(found);
    },
    delete: (_userId, key) => {
      objects.delete(key);
      return Promise.resolve();
    },
  };
  return { store, objects };
}

let test: TestDatabase;
const at = new Date('2026-10-15T10:00:00Z');
const bytes = new TextEncoder().encode('%PDF-1.7 fake');
const xlsxBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
const asApp = <T>(fn: () => Promise<T>) => test.as('wf_app', fn);

beforeAll(async () => {
  test = await startMigrated();
}, PGLITE_HOOK_TIMEOUT);
afterAll(async () => {
  await test.close();
});

it('stores the bytes in the object store and only the meta in Postgres, newest first', async () => {
  const owner = await insertUser(test, 'report-files-owner@example.test');
  const reportId = await asApp(() =>
    createReports(test.db).generate(
      owner,
      { kind: 'custom', from: '2026-10-14' as LocalDate, to: '2026-10-14' as LocalDate },
      at,
    ),
  ).then((view) => view.id);
  const { store, objects } = fakeStore();
  const files = createReportFiles(test.db, store);

  const first = await test.as('wf_worker', () =>
    files.save(owner, reportId, 'pdf', DEFAULT_REPORT_EXPORT_OPTIONS, bytes, at),
  );
  expect(first).toMatchObject({
    reportId,
    format: 'pdf',
    options: DEFAULT_REPORT_EXPORT_OPTIONS,
    sizeBytes: bytes.length,
  });
  expect(first.id).toBeDefined();
  expect(first.createdAt).toEqual(at);
  // The bytes never touch Postgres; the row keeps the key of the stored object.
  expect(objects.size).toBe(1);
  expect(objects.get(first.fileKey)).toEqual({ bytes, mime: 'application/pdf' });
  expect(JSON.stringify(await test.query(`SELECT * FROM report_files WHERE id = $1`, [first.id]))).not.toContain('PDF');

  const second = await test.as('wf_worker', () =>
    files.save(
      owner,
      reportId,
      'xlsx',
      { ...DEFAULT_REPORT_EXPORT_OPTIONS, theme: 'dark' },
      xlsxBytes,
      new Date('2026-10-15T10:01:00Z'),
    ),
  );
  expect(objects.get(second.fileKey)?.mime).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

  const listed = await asApp(() => files.list(owner));
  expect(listed.map((meta) => meta.id)).toEqual([second.id, first.id]);

  const content = await asApp(() => files.get(owner, first.id));
  expect(content).toEqual({ ...first, bytes, mime: 'application/pdf' });

  // A user's own files stay theirs; another user (or anyone) cannot read or list them.
  const stranger = await insertUser(test, 'report-files-stranger@example.test');
  await expect(asApp(() => files.get(stranger, first.id))).rejects.toMatchObject(
    new LedgerError('NOT_FOUND', 'No such report file'),
  );
  expect(await asApp(() => files.list(stranger))).toEqual([]);
});

it('rejects a file for an unknown report and cascades with it', async () => {
  const owner = await insertUser(test, 'report-files-fk@example.test');
  const { store } = fakeStore();
  const files = createReportFiles(test.db, store);
  await expect(
    test.as('wf_worker', () =>
      files.save(owner, '00000000-0000-7000-8000-000000000000', 'csv', DEFAULT_REPORT_EXPORT_OPTIONS, bytes, at),
    ),
  ).rejects.toMatchObject(pgError(/report_files_report_fk/));

  const reports = createReports(test.db);
  const reportId = await asApp(() =>
    reports.generate(owner, { kind: 'custom', from: '2026-10-14' as LocalDate, to: '2026-10-14' as LocalDate }, at),
  ).then((view) => view.id);
  const meta = await test.as('wf_worker', () =>
    files.save(owner, reportId, 'csv', DEFAULT_REPORT_EXPORT_OPTIONS, bytes, at),
  );
  await test.query(`DELETE FROM reports WHERE id = $1 AND user_id = $2`, [reportId, owner]);
  expect(await asApp(() => files.list(owner))).toEqual([]);
  expect(meta.format).toBe('csv');
});

it('resolves the export email recipient in their locale, or null when the user is gone', async () => {
  const owner = await insertUser(test, 'report-files-recipient@example.test');
  const { store } = fakeStore();
  const files = createReportFiles(test.db, store);
  expect(await asApp(() => files.recipient(owner))).toEqual({
    email: 'report-files-recipient@example.test',
    locale: 'id',
    name: 'report-files-recipient@example.test',
    currency: 'IDR',
  });
  await test.query(`UPDATE users SET nickname = 'Budi', locale = 'en' WHERE id = $1`, [owner]);
  expect(await asApp(() => files.recipient(owner))).toEqual({
    email: 'report-files-recipient@example.test',
    locale: 'en',
    name: 'Budi',
    currency: 'IDR',
  });
  const gone = '00000000-0000-7000-8000-00000000dead';
  expect(await asApp(() => files.recipient(gone))).toBeNull();
});
