// SPDX-License-Identifier: AGPL-3.0-only
import { goalSnapshot } from '@wf/domain/goals';
import type { LocalDate, YearMonth } from '@wf/domain/period';
import { describe, expect, it } from 'vitest';
import {
  DANA_DARURAT,
  DP_RUMAH,
  goalSummary,
  LIBURAN_BALI,
  OCTOBER_MOVEMENTS,
  PERPANJANG_STNK,
  plan,
  SEED_GOALS,
  SERVIS_MOTOR,
} from '../../../test/goal-fixtures.ts';
import {
  contributionCount,
  emergencyGoal,
  firstContribution,
  formatMonths,
  goalBadge,
  goalState,
  matchGoal,
  monthlySpending,
  monthSummary,
  planDays,
  sortDone,
  sortGoals,
} from './goals-model.ts';

const ym = (value: string) => value as YearMonth;
const d = (value: string) => value as LocalDate;
const OCTOBER = ym('2026-10');
const badgeOf = (goal: (typeof SEED_GOALS)[number]) => goalBadge(goal, goalSnapshot(goalState(goal)), OCTOBER);

describe('goal state', () => {
  it('measures an emergency fund in its monthly spending (Rp54.000.000 / 3)', () => {
    expect(monthlySpending(DANA_DARURAT)).toBe(18_000_000n);
    expect(monthlySpending(LIBURAN_BALI)).toBeNull();
    expect(monthlySpending({ ...DANA_DARURAT, targetMonths: null })).toBeNull();
    // Rp11.125.000 with Bibit RDPU (design 13): 21%, Nov 2027, 0,6 bulan.
    const bibit = { ...DANA_DARURAT, savedMinor: 11_125_000n };
    expect(goalState(bibit)).toEqual({
      targetMinor: 54_000_000n,
      savedMinor: 11_125_000n,
      deadline: '2027-11',
      monthlyMinor: 3_500_000n,
      nextMonth: '2026-11',
      monthlySpendingMinor: 18_000_000n,
    });
    expect(goalSnapshot(goalState(bibit))).toMatchObject({ progressBps: 2060, estimate: '2027-11', coverageBps: 6181 });
  });

  it('badges each seed goal as the design does', () => {
    expect(badgeOf({ ...DANA_DARURAT, savedMinor: 11_125_000n })).toEqual({ kind: 'on_track' });
    expect(badgeOf(DANA_DARURAT)).toEqual({ kind: 'behind' });
    expect(badgeOf(LIBURAN_BALI)).toEqual({ kind: 'on_track' });
    expect(badgeOf(SERVIS_MOTOR)).toEqual({ kind: 'soon', months: 2 });
    expect(badgeOf(PERPANJANG_STNK)).toEqual({ kind: 'almost' });
    expect(badgeOf({ ...PERPANJANG_STNK, savedMinor: 850_000n })).toEqual({ kind: 'reached' });
    expect(badgeOf({ ...SERVIS_MOTOR, deadlineMonth: OCTOBER })).toEqual({ kind: 'soon', months: 0 });
    expect(badgeOf({ ...SERVIS_MOTOR, deadlineMonth: ym('2026-09') })).toEqual({ kind: 'behind' });
    expect(badgeOf(DP_RUMAH)).toBeNull();
  });

  it('lists the days its active contributions run on', () => {
    expect(planDays(DANA_DARURAT)).toEqual([1, 14]);
    expect(
      planDays({
        plans: [
          plan({ id: 'a', monthDay: 25 }),
          plan({ id: 'b', monthDay: 25 }),
          plan({ id: 'c', monthDay: 3, active: false }),
          plan({ id: 'd', monthDay: null }),
        ],
      }),
    ).toEqual([25]);
  });
});

describe('sorting', () => {
  const names = (list: readonly { name: string }[]) => list.map((goal) => goal.name);

  it('orders by the nearest deadline (none last), progress, what is left, or name', () => {
    expect(names(sortGoals(SEED_GOALS, 'deadline', 'id'))).toEqual([
      'Servis motor',
      'Perpanjang STNK',
      'Liburan Bali',
      'Dana Darurat',
      'DP Rumah',
      'Dana Pensiun',
    ]);
    expect(names(sortGoals(SEED_GOALS, 'progress', 'id'))).toEqual([
      'Perpanjang STNK',
      'Servis motor',
      'Liburan Bali',
      'Dana Darurat',
      'DP Rumah',
      'Dana Pensiun',
    ]);
    expect(names(sortGoals(SEED_GOALS, 'remaining', 'id'))).toEqual([
      'Dana Pensiun',
      'DP Rumah',
      'Dana Darurat',
      'Liburan Bali',
      'Servis motor',
      'Perpanjang STNK',
    ]);
    expect(names(sortGoals(SEED_GOALS, 'name', 'id'))).toEqual([
      'Dana Darurat',
      'Dana Pensiun',
      'DP Rumah',
      'Liburan Bali',
      'Perpanjang STNK',
      'Servis motor',
    ]);
  });

  it('breaks ties by name and keeps equal deadlines in place', () => {
    const a = goalSummary({ id: 'a', name: 'B', targetMinor: 100n });
    const b = goalSummary({ id: 'b', name: 'A', targetMinor: 100n });
    expect(names(sortGoals([a, b], 'progress', 'en'))).toEqual(['A', 'B']);
    expect(names(sortGoals([a, b], 'remaining', 'en'))).toEqual(['A', 'B']);
    expect(names(sortGoals([a, b], 'deadline', 'en'))).toEqual(['B', 'A']);
    const noTarget = goalSummary({ id: 'c', name: 'C', targetMinor: 0n });
    expect(names(sortGoals([noTarget, a], 'progress', 'en'))).toEqual(['B', 'C']);
    expect(names(sortGoals([a, noTarget], 'progress', 'en'))).toEqual(['B', 'C']);
  });

  it('lists finished goals the latest first', () => {
    const old = goalSummary({ id: 'old', name: 'Lama', status: 'completed', completedAt: new Date('2026-09-01') });
    const used = goalSummary({ id: 'used', name: 'Terpakai', status: 'used', completedAt: new Date('2026-10-14') });
    const unknown = goalSummary({ id: 'x', name: 'X', status: 'completed' });
    expect(names(sortDone([old, unknown, used]))).toEqual(['Terpakai', 'Lama', 'X']);
  });
});

describe('the month and the KPIs', () => {
  it('sums October: Rp3.500.000 recorded of the Rp4.650.000 plan, the 25th still to come', () => {
    expect(monthSummary(SEED_GOALS, OCTOBER_MOVEMENTS, 'IDR')).toEqual({
      recordedMinor: 3_500_000n,
      plannedMinor: 4_650_000n,
      pendingDays: [25],
    });
    const review = { ...OCTOBER_MOVEMENTS[2], status: 'review' } as (typeof OCTOBER_MOVEMENTS)[number];
    const usd = goalSummary({ id: 'usd', name: 'USD', currency: 'USD', plans: [plan({ id: 'u', amountMinor: 5n })] });
    const done = { ...LIBURAN_BALI, status: 'completed' as const };
    const earlier = { ...review, key: 'earlier', date: d('2026-10-20') };
    expect(monthSummary([DANA_DARURAT, usd, done], [review, earlier, review], 'IDR')).toEqual({
      recordedMinor: 0n,
      plannedMinor: 3_500_000n,
      pendingDays: [20, 25],
    });
  });

  it('finds the active emergency fund', () => {
    expect(emergencyGoal(SEED_GOALS)).toBe(DANA_DARURAT);
    expect(emergencyGoal([{ ...DANA_DARURAT, status: 'completed' }, LIBURAN_BALI])).toBeNull();
  });

  it('formats months of spending with one decimal', () => {
    expect(formatMonths(6181, 'id')).toBe('0,6');
    expect(formatMonths(6736, 'en')).toBe('0.7');
    expect(formatMonths(30_000, 'id')).toBe('3,0');
  });
});

describe('Bayar dari tujuan', () => {
  it('matches an expense to an active goal by its tag or by its name in the description', () => {
    expect(matchGoal(SEED_GOALS, { description: '', tags: ['kendaraan', 'perpanjang-stnk'] })).toBe(PERPANJANG_STNK);
    expect(matchGoal(SEED_GOALS, { description: 'Perpanjang STNK — Samsat Jaksel', tags: [] })).toBe(PERPANJANG_STNK);
    expect(matchGoal(SEED_GOALS, { description: 'servis MOTOR bulanan', tags: [] })).toBe(SERVIS_MOTOR);
    expect(matchGoal(SEED_GOALS, { description: 'Kopi', tags: ['kopi'] })).toBeNull();
    expect(matchGoal(SEED_GOALS, { description: '', tags: [] })).toBeNull();
    expect(
      matchGoal(
        [
          { ...PERPANJANG_STNK, status: 'used' },
          { ...DP_RUMAH, tag: null },
        ],
        {
          description: 'Perpanjang STNK',
          tags: [],
        },
      ),
    ).toBeNull();
  });
});

describe('monthly contributions', () => {
  it('start next month and count to the deadline ("8× setoran (Nov 2026 – Jun 2027)")', () => {
    const start = firstContribution(d('2026-10-15'), 25);
    expect(start).toBe('2026-11-25');
    expect(firstContribution(d('2026-12-02'), 31)).toBe('2027-01-31');
    expect(firstContribution(d('2027-01-10'), 31)).toBe('2027-02-28');
    expect(contributionCount(start, ym('2027-06'))).toBe(8);
    expect(contributionCount(start, ym('2026-09'))).toBe(1);
    expect(contributionCount(start, null)).toBeNull();
  });
});
