// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeSession } from '../../../test/fixtures.ts';
import { call, requestContext, validatorOf } from '../../../test/server-fn.ts';
import {
  getBudgetCategory,
  getBudgetFill,
  getBudgetHistory,
  getBudgetStatus,
  getDashboard,
  getPeriodSettings,
  listPeriods,
  listPeriodSpending,
} from './budget.ts';

const PERIOD_ID = '0192a6c0-0000-7000-8000-000000000001';
const CATEGORY_ID = '0192a6c0-0000-7000-8000-000000000002';
const OCTOBER = { id: PERIOD_ID, label: '2026-10', start: '2026-10-01', end: '2026-10-31' };

const fake = vi.hoisted(() => ({
  ledgerError: (code: string) => Object.assign(new Error(code), { code }),
  periods: {
    list: vi.fn(() => Promise.resolve({ startDay: 1 })),
    get: vi.fn(() => Promise.resolve(OCTOBER)),
    covering: vi.fn((): Promise<unknown[]> => Promise.resolve([])),
    payday: vi.fn(() => Promise.resolve({ day: 1, merchant: 'PT Kinarya', count: 6 })),
  },
  budgets: {
    status: vi.fn(() => Promise.resolve({ readOnly: false })),
    history: vi.fn(() => Promise.resolve([{ effectiveFrom: '2026-09' }])),
    fillFromAverage: vi.fn(() => Promise.resolve([{ averageMinor: 1_000n }])),
  },
  transactionQuery: {
    groupByCategory: vi.fn(() =>
      Promise.resolve([
        { kind: 'income', totalMinor: 25_800_000n },
        { kind: 'expense', totalMinor: 22_660n },
      ]),
    ),
    summary: vi.fn(() => Promise.resolve({ outMinor: 0n, dailySpend: [{ date: '2026-10-01', outMinor: 0n }] })),
    list: vi.fn(() => Promise.resolve({ rows: [{ id: 'tx' }], total: 7 })),
  },
  dashboard: { get: vi.fn(() => Promise.resolve({ scope: 'month' })) },
}));

// vi.mock factories run before imports; they load the shared helper themselves.
vi.mock('@tanstack/react-start', async () => (await import('../../../test/server-fn.ts')).serverFnModule());
vi.mock('../runtime.ts', () => ({
  services: () =>
    Promise.resolve({
      periods: fake.periods,
      budgets: fake.budgets,
      transactionQuery: fake.transactionQuery,
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

  it('reads the budget history and the fill suggestions of a period', async () => {
    expect(await call(getBudgetHistory, { context: signedIn(), data: undefined })).toEqual({
      ok: true,
      value: [{ effectiveFrom: '2026-09' }],
    });
    expect(fake.budgets.history).toHaveBeenCalledWith(USER_ID);
    expect(await call(getBudgetFill, { context: signedIn(), data: { periodId: PERIOD_ID } })).toEqual({
      ok: true,
      value: [{ averageMinor: 1_000n }],
    });
    expect(fake.budgets.fillFromAverage).toHaveBeenCalledWith(USER_ID, PERIOD_ID);
  });

  it('lists the expense spending of a period by category', async () => {
    expect(await call(listPeriodSpending, { context: signedIn(), data: { periodId: PERIOD_ID } })).toEqual({
      ok: true,
      value: [{ kind: 'expense', totalMinor: 22_660n }],
    });
    expect(fake.periods.get).toHaveBeenCalledWith(USER_ID, PERIOD_ID);
    expect(fake.transactionQuery.groupByCategory).toHaveBeenCalledWith(USER_ID, {
      from: '2026-10-01',
      to: '2026-10-31',
    });
  });

  it('details a category: daily spending, the periods with data before, and the latest transactions', async () => {
    fake.periods.covering.mockResolvedValueOnce([
      { id: null, label: '2026-06', start: '2026-06-01', end: '2026-06-30' },
      { id: null, label: '2026-07', start: '2026-07-01', end: '2026-07-31' },
      { id: null, label: '2026-08', start: '2026-08-01', end: '2026-08-31' },
      { id: null, label: '2026-09', start: '2026-09-01', end: '2026-09-30' },
    ] as never);
    fake.transactionQuery.summary
      .mockResolvedValueOnce({ outMinor: 90_000n, dailySpend: [{ date: '2026-10-01', outMinor: 90_000n }] })
      .mockResolvedValueOnce({ outMinor: 0n, dailySpend: [] })
      .mockResolvedValueOnce({ outMinor: 40_000n, dailySpend: [] })
      .mockResolvedValueOnce({ outMinor: 0n, dailySpend: [] });
    const data = { periodId: PERIOD_ID, categoryId: CATEGORY_ID };
    expect(await call(getBudgetCategory, { context: signedIn(), data })).toEqual({
      ok: true,
      value: {
        daily: [{ date: '2026-10-01', outMinor: 90_000n }],
        // July has no row and no spending; August has spending, so September follows.
        months: [
          { label: '2026-08', spentMinor: 40_000n, current: false },
          { label: '2026-09', spentMinor: 0n, current: false },
          { label: '2026-10', spentMinor: 90_000n, current: true },
        ],
        transactions: [{ id: 'tx' }],
        transactionCount: 7,
      },
    });
    expect(fake.periods.covering).toHaveBeenCalledWith(USER_ID, { from: '2026-05-30', to: '2026-09-30' });
    const filter = { categoryIds: [CATEGORY_ID] };
    expect(fake.transactionQuery.summary).toHaveBeenNthCalledWith(1, USER_ID, {
      ...filter,
      from: '2026-10-01',
      to: '2026-10-31',
    });
    expect(fake.transactionQuery.summary).toHaveBeenNthCalledWith(2, USER_ID, {
      ...filter,
      from: '2026-07-01',
      to: '2026-07-31',
    });
    expect(fake.transactionQuery.summary).toHaveBeenCalledTimes(4);
    expect(fake.transactionQuery.list).toHaveBeenCalledWith(
      USER_ID,
      { ...filter, from: '2026-10-01', to: '2026-10-31' },
      { sort: 'date_desc', limit: 5 },
    );
  });

  it('keeps an earlier period that has a row even without spending', async () => {
    fake.periods.covering.mockResolvedValueOnce([
      { id: 'row', label: '2026-09', start: '2026-09-01', end: '2026-09-30' },
    ] as never);
    expect(
      await call(getBudgetCategory, { context: signedIn(), data: { periodId: PERIOD_ID, categoryId: CATEGORY_ID } }),
    ).toMatchObject({
      ok: true,
      value: {
        months: [
          { label: '2026-09', spentMinor: 0n, current: false },
          { label: '2026-10', spentMinor: 0n, current: true },
        ],
      },
    });
  });

  it('reads the period settings with the suggested payday', async () => {
    expect(await call(getPeriodSettings, { context: signedIn(), data: undefined })).toEqual({
      ok: true,
      value: { overview: { startDay: 1 }, payday: { day: 1, merchant: 'PT Kinarya', count: 6 } },
    });
    expect(fake.periods.list).toHaveBeenCalledWith(USER_ID);
    expect(fake.periods.payday).toHaveBeenCalledWith(USER_ID);
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
    fake.periods.get.mockRejectedValueOnce(fake.ledgerError('NOT_FOUND'));
    expect(await call(listPeriodSpending, { context: signedIn(), data: { periodId: PERIOD_ID } })).toEqual({
      ok: false,
      code: 'NOT_FOUND',
    });
    fake.periods.get.mockRejectedValueOnce(fake.ledgerError('NOT_FOUND'));
    expect(
      await call(getBudgetCategory, { context: signedIn(), data: { periodId: PERIOD_ID, categoryId: CATEGORY_ID } }),
    ).toEqual({ ok: false, code: 'NOT_FOUND' });
    expect(fake.transactionQuery.summary).not.toHaveBeenCalled();
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
    const period = { periodId: PERIOD_ID };
    const refusals = [
      await call(getBudgetHistory, { context: signedOut(), data: undefined }),
      await call(getBudgetFill, { context: signedOut(), data: period }),
      await call(listPeriodSpending, { context: signedOut(), data: period }),
      await call(getBudgetCategory, { context: signedOut(), data: { ...period, categoryId: CATEGORY_ID } }),
      await call(getPeriodSettings, { context: signedOut(), data: undefined }),
    ];
    expect(refusals).toEqual(Array(5).fill({ ok: false, code: 'UNAUTHENTICATED' }));
    expect(fake.periods.list).not.toHaveBeenCalled();
    expect(fake.periods.get).not.toHaveBeenCalled();
    expect(fake.periods.payday).not.toHaveBeenCalled();
    expect(fake.budgets.status).not.toHaveBeenCalled();
    expect(fake.budgets.history).not.toHaveBeenCalled();
    expect(fake.budgets.fillFromAverage).not.toHaveBeenCalled();
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
    for (const fn of [getBudgetFill, listPeriodSpending]) {
      expect(validatorOf(fn).safeParse({}).success).toBe(false);
      expect(validatorOf(fn).safeParse({ periodId: 'nope' }).success).toBe(false);
      expect(validatorOf(fn).safeParse({ periodId: PERIOD_ID }).success).toBe(true);
    }
    const detail = validatorOf(getBudgetCategory);
    expect(detail.safeParse({ periodId: PERIOD_ID }).success).toBe(false);
    expect(detail.safeParse({ periodId: PERIOD_ID, categoryId: 'nope' }).success).toBe(false);
    expect(detail.safeParse({ periodId: PERIOD_ID, categoryId: CATEGORY_ID }).success).toBe(true);
  });
});
