// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeSession } from '../../../test/fixtures.ts';
import { call, requestContext, validatorOf } from '../../../test/server-fn.ts';
import * as fns from './calendar.ts';

const fake = vi.hoisted(() => ({
  transactionQuery: { list: vi.fn(), groupByDay: vi.fn(() => Promise.resolve(['day'])) },
  schedules: { listScheduled: vi.fn(() => Promise.resolve(['event'])) },
}));

// vi.mock factories run before imports; they load the shared helper themselves.
vi.mock('@tanstack/react-start', async () => (await import('../../../test/server-fn.ts')).serverFnModule());
vi.mock('../runtime.ts', () => ({
  services: () => Promise.resolve({ ...fake, now: () => new Date('2026-10-15T09:42:00Z') }),
}));

const USER_ID = fakeSession().user.id;
const signedIn = () => requestContext(fakeSession());
const page = (ids: string[], total: number) => Promise.resolve({ rows: ids.map((id) => ({ id })), total });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('calendar server functions', () => {
  it('reads every page of a range’s transactions, its day totals and scheduled events', async () => {
    fake.transactionQuery.list
      .mockReturnValueOnce(page(['a', 'b'], 3))
      .mockReturnValueOnce(page(['c'], 3))
      .mockReturnValueOnce(page(['x'], 9));
    const data = { from: '2026-09-28', to: '2026-11-01' };
    expect(await call(fns.getCalendarRange, { context: signedIn(), data })).toEqual({
      ok: true,
      value: {
        days: ['day'],
        rows: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
        scheduled: ['event'],
        hasTransactions: true,
      },
    });
    expect(fake.transactionQuery.list).toHaveBeenNthCalledWith(1, USER_ID, data, {
      sort: 'date_asc',
      limit: 200,
      offset: 0,
    });
    expect(fake.transactionQuery.list).toHaveBeenNthCalledWith(2, USER_ID, data, {
      sort: 'date_asc',
      limit: 200,
      offset: 2,
    });
    expect(fake.transactionQuery.list).toHaveBeenNthCalledWith(3, USER_ID, {}, { limit: 1 });
    expect(fake.transactionQuery.groupByDay).toHaveBeenCalledWith(USER_ID, data);
    expect(fake.schedules.listScheduled).toHaveBeenCalledWith(USER_ID, data);
  });

  it('stops at an empty page even when the total says otherwise, and knows a ledger without transactions', async () => {
    fake.transactionQuery.list.mockReturnValueOnce(page([], 5)).mockReturnValueOnce(page([], 0));
    const result = await call<{ ok: true; value: fns.CalendarRange }>(fns.getCalendarRange, {
      context: signedIn(),
      data: { from: '2026-10-01', to: '2026-10-01' },
    });
    expect(result.value).toMatchObject({ rows: [], hasTransactions: false });
  });

  it('reads a year’s day totals', async () => {
    fake.transactionQuery.list.mockReturnValueOnce(page(['x'], 1));
    expect(await call(fns.getCalendarYear, { context: signedIn(), data: { year: 2026 } })).toEqual({
      ok: true,
      value: { days: ['day'], hasTransactions: true },
    });
    expect(fake.transactionQuery.groupByDay).toHaveBeenCalledWith(USER_ID, { from: '2026-01-01', to: '2026-12-31' });
  });

  it('refuses signed-out requests and invalid ranges', async () => {
    for (const fn of Object.values(fns).filter((value) => typeof value !== 'number')) {
      expect(await call(fn, { context: requestContext(null), data: {} })).toEqual({
        ok: false,
        code: 'UNAUTHENTICATED',
      });
    }
    expect(fake.transactionQuery.list).not.toHaveBeenCalled();
    const range = validatorOf(fns.getCalendarRange);
    expect(range.safeParse({ from: '2026-09-28', to: '2026-11-08' }).success).toBe(true);
    expect(range.safeParse({ from: '2026-09-28', to: '2026-11-09' }).success).toBe(false);
    expect(range.safeParse({ from: '2026-10-02', to: '2026-10-01' }).success).toBe(false);
    expect(validatorOf(fns.getCalendarYear).safeParse({ year: 1999 }).success).toBe(false);
    expect(fns.CALENDAR_RANGE_MAX_DAYS).toBe(42);
  });
});
