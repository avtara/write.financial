// SPDX-License-Identifier: AGPL-3.0-only
import type { AuthSession } from '@wf/auth/auth';
import { generateDek } from '@wf/crypto/envelope';
import { createReports, type ReportView, type ReportsRepository } from '@wf/db/reports';
import { seedLedger } from '@wf/db/seed';
import { PGLITE_HOOK_TIMEOUT, startMigrated, type TestDatabase } from '@wf/db/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { NOW, fakeSession } from '../../../test/fixtures.ts';
import { call, requestContext, validatorOf } from '../../../test/server-fn.ts';
import type { Result } from '../access.ts';
import type { Services } from '../runtime.ts';
import * as fns from './reports.ts';
import type { ReportsHome } from './reports.ts';

const running = vi.hoisted(() => ({ services: null as Services | null }));

// vi.mock factories run before imports; they load the shared helper themselves.
vi.mock('@tanstack/react-start', async () => (await import('../../../test/server-fn.ts')).serverFnModule());
// The server functions get the PGlite-backed reports repository this suite builds.
vi.mock('../runtime.ts', () => ({
  services: () =>
    running.services !== null ? Promise.resolve(running.services) : Promise.reject(new Error('services not started')),
}));

let test: TestDatabase;
/** The session user of {@link fakeSession}; the ledger's owner. */
const USER = fakeSession().user.id;
/** A second user who must never see the first user's reports. */
const OTHER = '0192a6c4-0000-7000-8000-0000000000f2';
/** `NOW` in Asia/Jakarta (the session user's zone). */
const TODAY = '2026-10-18';
const asApp = <T>(fn: () => Promise<T>) => test.as('wf_app', fn);
/** `test.as` switches the role of the one session every connection shares, so concurrent calls would race: the
 * server functions run their reads with `Promise.all`, and each of their role-switched steps goes through this. */
let lastAsApp: Promise<unknown> = Promise.resolve();
const queuedAsApp = <T>(fn: () => Promise<T>): Promise<T> => {
  const run = lastAsApp.then(() => asApp(fn));
  lastAsApp = run.catch(() => undefined);
  return run;
};
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
  // The seed's persona: the September 2026 period is closed, so its monthly report is final.
  const dek = generateDek();
  await asApp(() => seedLedger(test.db, USER, { getDek: () => Promise.resolve(dek) }));
  const periodId = await periodOf(USER, 'closed');
  const repo = reportsAsApp(test);
  await repo.generate(USER, { kind: 'monthly', periodId }, NOW);
  running.services = { now: () => NOW, reports: repo } as unknown as Services;
}, PGLITE_HOOK_TIMEOUT * 3);

afterAll(async () => {
  await test.close();
});

/** The real reports repository, run as `wf_app` so its RLS answers as the session user would. */
function reportsAsApp(test: TestDatabase): ReportsRepository {
  const repo = createReports(test.db);
  return {
    generate: (userId, request, now) => queuedAsApp(() => repo.generate(userId, request, now)),
    list: (userId, options) => queuedAsApp(() => repo.list(userId, options)),
    get: (userId, id) => queuedAsApp(() => repo.get(userId, id)),
    latestFinal: (userId) => queuedAsApp(() => repo.latestFinal(userId)),
    pendingMonthly: (userId) => queuedAsApp(() => repo.pendingMonthly(userId)),
  };
}

describe('getReportsHome', () => {
  it('answers an empty page to a user without reports, with their local today', async () => {
    const session = fakeSession();
    // The viewer's zone may be unset; the local today falls back to Asia/Jakarta.
    const result = await call<Result<ReportsHome>>(fns.getReportsHome, {
      context: requestContext({ ...session, user: { ...session.user, id: OTHER, timezone: null } }),
    });
    expect(result).toEqual({ ok: true, value: { reports: [], latestFinal: null, today: TODAY } });
  });

  it('refuses without a session', async () => {
    expect(await call(fns.getReportsHome, { context: requestContext(null) })).toEqual({
      ok: false,
      code: 'UNAUTHENTICATED',
    });
  });

  it('lists the saved reports with the newest final one, never another user’s', async () => {
    const result = await call<Result<ReportsHome>>(fns.getReportsHome, { context: contextOf(fakeSession()) });
    if (!result.ok) throw new Error(`expected ok, got ${result.code}`);
    expect(result.value.today).toBe(TODAY);
    expect(result.value.reports).toHaveLength(1);
    expect(result.value.reports[0]).toMatchObject({ kind: 'monthly', status: 'final', label: '2026-09' });
    expect(result.value.latestFinal).toMatchObject({ kind: 'monthly', status: 'final', label: '2026-09' });
    expect(await call(fns.getReportsHome, { context: asUser(OTHER) })).toMatchObject({
      ok: true,
      value: { reports: [], latestFinal: null },
    });
  });
});

describe('viewReport', () => {
  it('builds the final report of a closed period and returns it unchanged on a second view', async () => {
    const periodId = await periodOf(USER, 'closed');
    const result = await call<Result<ReportView>>(fns.viewReport, {
      context: contextOf(fakeSession()),
      data: { kind: 'monthly', periodId },
    });
    if (!result.ok) throw new Error(`expected ok, got ${result.code}`);
    expect(result.value).toMatchObject({
      kind: 'monthly',
      status: 'final',
      label: '2026-09',
      periodId,
      range: { from: '2026-09-01', to: '2026-09-30' },
    });
    expect(result.value.totals.savedMinor).toBe(result.value.totals.incomeMinor - result.value.totals.expenseMinor);
    const again = await call<Result<ReportView>>(fns.viewReport, {
      context: contextOf(fakeSession()),
      data: { kind: 'monthly', periodId },
    });
    expect(again.ok && again.value.id).toBe(result.value.id);
    expect(again.ok && again.value.generatedAt).toEqual(result.value.generatedAt);
  });

  it('refuses another user’s period, an unknown one, an open one, and impossible ranges', async () => {
    const periodId = await periodOf(USER, 'closed');
    expect(await call(fns.viewReport, { context: asUser(OTHER), data: { kind: 'monthly', periodId } })).toEqual({
      ok: false,
      code: 'NOT_FOUND',
    });
    expect(
      await call(fns.viewReport, {
        context: contextOf(fakeSession()),
        data: { kind: 'monthly', periodId: '0192a6c4-0000-7000-8000-0000000000f9' },
      }),
    ).toEqual({ ok: false, code: 'NOT_FOUND' });
    expect(
      await call(fns.viewReport, {
        context: contextOf(fakeSession()),
        data: { kind: 'monthly', periodId: await periodOf(USER, 'open') },
      }),
    ).toEqual({ ok: false, code: 'INVALID_PERIOD' });
    expect(
      await call(fns.viewReport, {
        context: contextOf(fakeSession()),
        data: { kind: 'custom', from: '2027-01-01', to: '2027-01-31' },
      }),
    ).toEqual({ ok: false, code: 'INVALID_PERIOD' });
    expect(
      await call(fns.viewReport, {
        context: contextOf(fakeSession()),
        data: { kind: 'custom', from: '2026-10-18', to: '2026-10-01' },
      }),
    ).toEqual({ ok: false, code: 'INVALID_PERIOD' });
  });

  it('accepts only the four request kinds with well-formed fields', () => {
    const view = validatorOf(fns.viewReport);
    expect(view.safeParse({ kind: 'monthly', periodId: USER }).success).toBe(true);
    expect(view.safeParse({ kind: 'quarterly', year: 2026, quarter: 3 }).success).toBe(true);
    expect(view.safeParse({ kind: 'yearly', year: 2026 }).success).toBe(true);
    expect(view.safeParse({ kind: 'custom', from: '2026-09-01', to: '2026-09-30' }).success).toBe(true);
    expect(view.safeParse({ kind: 'monthly', periodId: 'not-a-uuid' }).success).toBe(false);
    expect(view.safeParse({ kind: 'quarterly', year: 2026, quarter: 5 }).success).toBe(false);
    expect(view.safeParse({ kind: 'quarterly', year: 1900, quarter: 1 }).success).toBe(false);
    expect(view.safeParse({ kind: 'yearly', year: 2200 }).success).toBe(false);
    expect(view.safeParse({ kind: 'custom', from: '2026-13-01', to: '2026-12-31' }).success).toBe(false);
    expect(view.safeParse({ kind: 'decade', year: 2020 }).success).toBe(false);
  });
});

/** The user's only period of `status` (the seed leaves September closed and October open). */
async function periodOf(userId: string, status: 'open' | 'closed'): Promise<string> {
  const [row] = await test.query<{ id: string }>(
    `SELECT id FROM periods WHERE user_id = $1 AND status = $2 ORDER BY start_date LIMIT 1`,
    [userId, status],
  );
  if (row === undefined) throw new Error(`the seed left no ${status} period`);
  return row.id;
}
