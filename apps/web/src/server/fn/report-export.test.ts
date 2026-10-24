// SPDX-License-Identifier: AGPL-3.0-only
import type { AuthSession } from '@wf/auth/auth';
import { generateDek } from '@wf/crypto/envelope';
import type { LocalDate } from '@wf/domain/period';
import type { ReportFileMeta } from '@wf/db/report-files';
import { createReportFiles, type ReportFileMeta as StoredMeta, type ReportFileStore } from '@wf/db/report-files';
import { createPreferences, type PreferencesRepository } from '@wf/db/preferences';
import { createReports, type ReportsRepository } from '@wf/db/reports';
import { seedLedger } from '@wf/db/seed';
import { PGLITE_HOOK_TIMEOUT, startMigrated, type TestDatabase } from '@wf/db/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { NOW, fakeSession } from '../../../test/fixtures.ts';
import { call, requestContext, validatorOf } from '../../../test/server-fn.ts';
import type { Result } from '../access.ts';
import type { Services } from '../runtime.ts';
import {
  exportFileName,
  getReportAutoSend,
  listReportFiles,
  requestReportExport,
  saveReportAutoSend,
} from './report-export.ts';

const running = vi.hoisted(() => ({ services: null as Services | null }));

// vi.mock factories run before imports; they load the shared helper themselves.
vi.mock('@tanstack/react-start', async () => (await import('../../../test/server-fn.ts')).serverFnModule());
// The server functions get the PGlite-backed services this suite builds.
vi.mock('../runtime.ts', () => ({
  services: () =>
    running.services !== null ? Promise.resolve(running.services) : Promise.reject(new Error('services not started')),
}));

let test: TestDatabase;
/** The session user of {@link fakeSession}; the ledger's owner. */
const USER = fakeSession().user.id;
/** A second user who must never see the first user's reports or files. */
const OTHER = '0192a6c4-0000-7000-8000-0000000000f2';
/** The in-memory object store behind the repository, so `listReportFiles` has rows to answer with. */
const objects = new Map<string, { readonly bytes: Uint8Array; readonly mime: string }>();
const store: ReportFileStore = {
  put: (_userId, bytes, mime) => {
    const key = `u/u/${objects.size}`;
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
/** The payloads `requestReportExport` enqueued, in order. */
const enqueued: { readonly payload: Record<string, unknown>; readonly requestId: string }[] = [];
const asApp = <T>(fn: () => Promise<T>) => test.as('wf_app', fn);
/** `test.as` switches the role of the one session every connection shares, so concurrent calls would race. */
let lastAsApp: Promise<unknown> = Promise.resolve();
const queuedAsApp = <T>(fn: () => Promise<T>): Promise<T> => {
  const run = lastAsApp.then(() => asApp(fn));
  lastAsApp = run.catch(() => undefined);
  return run;
};
/** The repository methods, each serialized through the one role-switched session. */
function asAppRepo<T extends object>(methods: T): T {
  const wrapped: Record<string, unknown> = {};
  for (const [name, method] of Object.entries(methods)) {
    wrapped[name] = (...args: unknown[]) =>
      queuedAsApp(() => Promise.resolve((method as (...a: unknown[]) => unknown)(...args)));
  }
  return wrapped as T;
}
const contextOf = (session: AuthSession) => requestContext(session);
const asUser = (userId: string) => {
  const session = fakeSession();
  return requestContext({ ...session, user: { ...session.user, id: userId }, session: { ...session.session, userId } });
};

beforeAll(async () => {
  test = await startMigrated();
  for (const [id, email] of [
    [USER, 'avtara@example.test'],
    [OTHER, 'budi@example.test'],
  ] as const) {
    await test.query(`INSERT INTO users (id, name, email, role) VALUES ($1, $2, $3, 'user')`, [id, email, email]);
  }
  const dek = generateDek();
  await asApp(() => seedLedger(test.db, USER, { getDek: () => Promise.resolve(dek) }));
  const reports = (): ReportsRepository =>
    asAppRepo({
      generate: (userId, request, now) => createReports(test.db).generate(userId, request, now),
      list: (userId, options) => createReports(test.db).list(userId, options),
      get: (userId, id) => createReports(test.db).get(userId, id),
      latestFinal: (userId) => createReports(test.db).latestFinal(userId),
      pendingMonthly: (userId) => createReports(test.db).pendingMonthly(userId),
    });
  const reportFiles = () =>
    asAppRepo({
      save: (
        userId: string,
        reportId: string,
        format: StoredMeta['format'],
        options: StoredMeta['options'],
        bytes: Uint8Array,
        now: Date,
      ) => createReportFiles(test.db, store).save(userId, reportId, format, options, bytes, now),
      list: (userId: string, options?: { readonly limit?: number }) =>
        createReportFiles(test.db, store).list(userId, options),
      get: (userId: string, id: string) => createReportFiles(test.db, store).get(userId, id),
      recipient: (userId: string) => createReportFiles(test.db, store).recipient(userId),
    });
  const preferences = (): PreferencesRepository =>
    asAppRepo({
      get: (userId) => createPreferences(test.db).get(userId),
      update: (userId, patch) => createPreferences(test.db).update(userId, patch),
    });
  running.services = {
    now: () => NOW,
    reports: reports(),
    reportFiles: reportFiles(),
    preferences: preferences(),
    reportExportQueue: {
      enqueue: (payload: Record<string, unknown>, requestId: string) => {
        enqueued.push({ payload, requestId });
        return Promise.resolve();
      },
    },
  } as unknown as Services;
}, PGLITE_HOOK_TIMEOUT * 3);

afterAll(async () => {
  await test.close();
});

const REPORT_REQUEST = {
  kind: 'custom',
  from: '2026-10-01' as LocalDate,
  to: '2026-10-07' as LocalDate,
} as const;
const OPTIONS = { sections: ['summary', 'flow'], theme: 'light', paper: 'a4', maskAccountNumbers: false } as const;

/** A report of the session user's own, generated through the repository as the page would have stored it. */
async function reportOf(): Promise<string> {
  return queuedAsApp(() =>
    createReports(test.db)
      .generate(USER, REPORT_REQUEST, NOW)
      .then((view) => view.id),
  );
}

describe('exportFileName', () => {
  it('names the file after the report label, separators collapsed', () => {
    expect(exportFileName('2026-09', 'pdf')).toBe('Laporan-2026-09.pdf');
    expect(exportFileName('2026-Q3', 'xlsx')).toBe('Laporan-2026-Q3.xlsx');
    expect(exportFileName('2026-10-01/2026-10-15', 'csv')).toBe('Laporan-2026-10-01-2026-10-15.csv');
  });
});

describe('requestReportExport', () => {
  it('enqueues one export of the viewed report with the dialog options and a fresh request id', async () => {
    const reportId = await reportOf();
    expect(
      await call<Result<object>>(requestReportExport, {
        context: contextOf(fakeSession()),
        data: { reportId, format: 'pdf', options: OPTIONS },
      }),
    ).toEqual({ ok: true, value: {} });
    expect(enqueued).toHaveLength(1);
    const first = enqueued[0] as { payload: Record<string, unknown>; requestId: string };
    expect(first.payload).toEqual({ userId: USER, reportId, format: 'pdf', email: false, options: OPTIONS });
    expect(first.requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    // A second submit with new options is a new job, not a deduplicated replay of the kept one.
    await call(requestReportExport, {
      context: contextOf(fakeSession()),
      data: { reportId, format: 'csv', options: { ...OPTIONS, sections: ['largest'] } },
    });
    expect(enqueued).toHaveLength(2);
    expect(enqueued[1]?.requestId).not.toBe(first.requestId);
    expect(enqueued[1]?.payload.format).toBe('csv');
  });

  it('refuses another user’s report and an unknown one without queueing anything', async () => {
    const reportId = await reportOf();
    const before = enqueued.length;
    expect(
      await call(requestReportExport, { context: asUser(OTHER), data: { reportId, format: 'pdf', options: OPTIONS } }),
    ).toEqual({ ok: false, code: 'NOT_FOUND' });
    expect(
      await call(requestReportExport, {
        context: contextOf(fakeSession()),
        data: { reportId: '0192a6c4-0000-7000-8000-0000000000f9', format: 'pdf', options: OPTIONS },
      }),
    ).toEqual({ ok: false, code: 'NOT_FOUND' });
    expect(enqueued).toHaveLength(before);
  });

  it('refuses without a session', async () => {
    expect(
      await call(requestReportExport, {
        context: requestContext(null),
        data: { reportId: '0192a6c4-0000-7000-8000-0000000000f1', format: 'pdf', options: OPTIONS },
      }),
    ).toEqual({ ok: false, code: 'UNAUTHENTICATED' });
  });

  it('accepts only the three formats, known sections, and the appearance pairs', () => {
    const validator = validatorOf(requestReportExport);
    expect(validator.safeParse({ reportId: USER, format: 'xlsx', options: OPTIONS }).success).toBe(true);
    expect(validator.safeParse({ reportId: USER, format: 'doc', options: OPTIONS }).success).toBe(false);
    expect(validator.safeParse({ reportId: USER, format: 'pdf', options: { ...OPTIONS, sections: [] } }).success).toBe(
      false,
    );
    expect(
      validator.safeParse({ reportId: USER, format: 'pdf', options: { ...OPTIONS, sections: ['all'] } }).success,
    ).toBe(false);
    expect(validator.safeParse({ reportId: USER, format: 'pdf', options: { ...OPTIONS, theme: 'auto' } }).success).toBe(
      false,
    );
    expect(validator.safeParse({ reportId: USER, format: 'pdf', options: { ...OPTIONS, paper: 'A3' } }).success).toBe(
      false,
    );
    expect(validator.safeParse({ reportId: 'nope', format: 'pdf', options: OPTIONS }).success).toBe(false);
    expect(validator.safeParse({ reportId: USER, format: 'pdf', options: { ...OPTIONS, extra: 1 } }).success).toBe(
      false,
    );
  });
});

describe('listReportFiles', () => {
  it('answers an empty list to a user without exports', async () => {
    const otherContext: ReturnType<typeof contextOf> = asUser(OTHER);
    expect(await call<Result<ReportFileMeta[]>>(listReportFiles, { context: otherContext })).toEqual({
      ok: true,
      value: [],
    });
  });

  it('lists the user’s stored files newest first, never another user’s, and refuses without a session', async () => {
    const reportId = await reportOf();
    const repo = createReportFiles(test.db, store);
    const older = await queuedAsApp(() =>
      repo.save(USER, reportId, 'pdf', OPTIONS, new TextEncoder().encode('%PDF-1.7'), new Date(NOW.getTime() - 60_000)),
    );
    const newer = await queuedAsApp(() =>
      repo.save(USER, reportId, 'csv', OPTIONS, new TextEncoder().encode('a,b'), NOW),
    );
    const result = await call<Result<ReportFileMeta[]>>(listReportFiles, { context: contextOf(fakeSession()) });
    if (!result.ok) throw new Error(`expected ok, got ${result.code}`);
    expect(result.value.map((file) => file.id)).toEqual([newer.id, older.id]);
    expect(result.value[0]).toMatchObject({ reportId, format: 'csv', sizeBytes: 3 });
    expect(typeof result.value[0]?.fileKey).toBe('string');
    const otherContext: ReturnType<typeof contextOf> = asUser(OTHER);
    expect(await call<Result<ReportFileMeta[]>>(listReportFiles, { context: otherContext })).toEqual({
      ok: true,
      value: [],
    });
    expect(await call(listReportFiles, { context: requestContext(null) })).toEqual({
      ok: false,
      code: 'UNAUTHENTICATED',
    });
  });
});

describe('auto-send preference', () => {
  it('defaults to off and persists the toggle per user', async () => {
    expect(await call<Result<boolean>>(getReportAutoSend, { context: contextOf(fakeSession()) })).toEqual({
      ok: true,
      value: false,
    });
    expect(
      await call<Result<boolean>>(saveReportAutoSend, { context: contextOf(fakeSession()), data: { enabled: true } }),
    ).toEqual({ ok: true, value: true });
    expect(await call<Result<boolean>>(getReportAutoSend, { context: contextOf(fakeSession()) })).toEqual({
      ok: true,
      value: true,
    });
    // The other user's toggle is untouched.
    expect(await call<Result<boolean>>(getReportAutoSend, { context: asUser(OTHER) })).toEqual({
      ok: true,
      value: false,
    });
    expect(await call(getReportAutoSend, { context: requestContext(null) })).toEqual({
      ok: false,
      code: 'UNAUTHENTICATED',
    });
    const validator = validatorOf(saveReportAutoSend);
    expect(validator.safeParse({ enabled: true }).success).toBe(true);
    expect(validator.safeParse({ enabled: 'yes' }).success).toBe(false);
  });
});
