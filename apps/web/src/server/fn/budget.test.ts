// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeSession } from '../../../test/fixtures.ts';
import { call, requestContext, validatorOf } from '../../../test/server-fn.ts';
import { getBudgetStatus, getDashboard, listPeriods } from './budget.ts';

const PERIOD_ID = '0192a6c0-0000-7000-8000-000000000001';

const fake = vi.hoisted(() => ({
  ledgerError: (code: string) => Object.assign(new Error(code), { code }),
  periods: { list: vi.fn(() => Promise.resolve({ startDay: 1 })) },
  budgets: { status: vi.fn(() => Promise.resolve({ readOnly: false })) },
  dashboard: { get: vi.fn(() => Promise.resolve({ scope: 'month' })) },
}));

// vi.mock factories run before imports; they load the shared helper themselves.
vi.mock('@tanstack/react-start', async () => (await import('../../../test/server-fn.ts')).serverFnModule());
vi.mock('../runtime.ts', () => ({
  services: () =>
    Promise.resolve({
      periods: fake.periods,
      budgets: fake.budgets,
      dashboard: fake.dashboard,
      now: () => new Date('2026-10-15T09:42:00Z'),
    }),
}));

const USER_ID = fakeSession().user.id;
const signedIn = () => requestContext(fakeSession());
const signedOut = () => requestContext(null);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('period, budget, and dashboard reads', () => {
  it('lists the session user’s periods', async () => {
    expect(await call(listPeriods, { context: signedIn(), data: undefined })).toEqual({
      ok: true,
      value: { startDay: 1 },
    });
    expect(fake.periods.list).toHaveBeenCalledWith(USER_ID);
  });

  it('reads the budget of the current or a given period', async () => {
    expect(await call(getBudgetStatus, { context: signedIn(), data: {} })).toEqual({
      ok: true,
      value: { readOnly: false },
    });
    expect(fake.budgets.status).toHaveBeenLastCalledWith(USER_ID, {});
    await call(getBudgetStatus, { context: signedIn(), data: { periodId: PERIOD_ID } });
    expect(fake.budgets.status).toHaveBeenLastCalledWith(USER_ID, { periodId: PERIOD_ID });
  });

  it('passes the dashboard request through', async () => {
    const range = { scope: 'range', from: '2026-09-14', to: '2026-10-13' } as const;
    expect(await call(getDashboard, { context: signedIn(), data: range })).toEqual({
      ok: true,
      value: { scope: 'month' },
    });
    expect(fake.dashboard.get).toHaveBeenLastCalledWith(USER_ID, range);
  });

  it('turns ledger errors into expected results', async () => {
    fake.budgets.status.mockRejectedValueOnce(fake.ledgerError('NOT_FOUND'));
    expect(await call(getBudgetStatus, { context: signedIn(), data: { periodId: PERIOD_ID } })).toEqual({
      ok: false,
      code: 'NOT_FOUND',
    });
    fake.dashboard.get.mockRejectedValueOnce(fake.ledgerError('INVALID_PERIOD'));
    expect(await call(getDashboard, { context: signedIn(), data: { scope: 'week' } })).toEqual({
      ok: false,
      code: 'INVALID_PERIOD',
    });
  });

  it('refuses signed-out requests', async () => {
    expect(await call(listPeriods, { context: signedOut(), data: undefined })).toEqual({
      ok: false,
      code: 'UNAUTHENTICATED',
    });
    expect(await call(getBudgetStatus, { context: signedOut(), data: {} })).toEqual({
      ok: false,
      code: 'UNAUTHENTICATED',
    });
    expect(await call(getDashboard, { context: signedOut(), data: { scope: 'year' } })).toEqual({
      ok: false,
      code: 'UNAUTHENTICATED',
    });
    expect(fake.periods.list).not.toHaveBeenCalled();
    expect(fake.budgets.status).not.toHaveBeenCalled();
    expect(fake.dashboard.get).not.toHaveBeenCalled();
  });

  it('validates input with Zod schemas', () => {
    const budget = validatorOf(getBudgetStatus);
    expect(budget.safeParse({ periodId: 'nope' }).success).toBe(false);
    expect(budget.safeParse({ periodId: PERIOD_ID }).success).toBe(true);
    const dashboard = validatorOf(getDashboard);
    expect(dashboard.safeParse({ scope: 'month' }).success).toBe(true);
    expect(dashboard.safeParse({ scope: 'month', periodId: PERIOD_ID }).success).toBe(true);
    expect(dashboard.safeParse({ scope: 'year', year: 2026 }).success).toBe(true);
    expect(dashboard.safeParse({ scope: 'year', year: 2026.5 }).success).toBe(false);
    expect(dashboard.safeParse({ scope: 'decade' }).success).toBe(false);
    expect(dashboard.safeParse({ scope: 'range', from: '2026-09-14', to: '2026-10-13' })).toEqual({
      success: true,
      data: { scope: 'range', from: '2026-09-14', to: '2026-10-13' },
    });
    expect(dashboard.safeParse({ scope: 'range', from: '2026-02-30', to: '2026-10-13' }).success).toBe(false);
    expect(dashboard.safeParse({ scope: 'range', from: '2026-09-14' }).success).toBe(false);
  });
});
