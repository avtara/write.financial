// SPDX-License-Identifier: AGPL-3.0-only
import type { LocalDate, YearMonth } from '@wf/domain/period';
import { describe, expect, it } from 'vitest';
import { OCTOBER_ROWS, octoberInputs } from '../../../test/calendar-fixtures.ts';
import { day, scheduledItem } from '../../../test/dashboard-fixtures.ts';
import { account, categoryId } from '../../../test/ledger-fixtures.ts';
import { transactionRow } from '../../../test/transaction-fixtures.ts';
import {
  monthGrid,
  monthOf,
  monthStats,
  paydays,
  shiftMonth,
  weekOf,
  weekStats,
  weekTotal,
  yearMonths,
} from './calendar-model.ts';

const d = (value: string) => value as LocalDate;
const OCTOBER = '2026-10' as YearMonth;
const TODAY = d('2026-10-15');

describe('calendar dates', () => {
  it('finds months and Monday-first weeks', () => {
    expect(monthOf(d('2026-02-10'))).toEqual({ first: '2026-02-01', last: '2026-02-28' });
    expect(monthOf(d('2026-10-31'))).toEqual({ first: '2026-10-01', last: '2026-10-31' });
    expect(weekOf(TODAY)).toEqual({ first: '2026-10-12', last: '2026-10-18' });
    expect(shiftMonth('2026-12' as YearMonth, 1)).toBe('2027-01');
    expect(shiftMonth('2026-01' as YearMonth, -1)).toBe('2025-12');
    expect(shiftMonth(OCTOBER, 0)).toBe('2026-10');
  });
});

describe('monthGrid', () => {
  it('gives every day its split, savings, largest spend, transactions by time, and open events', () => {
    const grid = monthGrid(OCTOBER, octoberInputs());
    expect(grid).toHaveLength(5);
    const days = new Map(grid.flat().map((detail) => [detail.date, detail]));
    const payday = days.get(d('2026-10-01'));
    expect(payday).toMatchObject({ needsMinor: 4_500_000n, wantsMinor: 0n, savingsMinor: 6_000_000n, surplus: true });
    expect(payday?.largest?.id).toBe('rent');
    expect(payday?.rows.map((row) => row.id)).toEqual(['salary', 'rent', 'save', 'move']);
    expect(days.get(d('2026-10-11'))).toMatchObject({ needsMinor: 0n, wantsMinor: 2_150_000n });
    expect(days.get(d('2026-10-11'))?.largest?.id).toBe('phone');
    expect(days.get(d('2026-10-12'))?.largest).toBeNull();
    expect(days.get(TODAY)?.largest?.id).toBe('market');
    expect(days.get(d('2026-10-09'))?.scheduled.map((item) => item.name)).toEqual(['iCloud+']);
    // A confirmed bill is a transaction, not an event.
    expect(days.get(d('2026-10-03'))?.scheduled).toEqual([]);
    expect(days.get(d('2026-10-18'))?.scheduled.map((item) => item.sourceId)).toEqual(['sub-netflix']);
    expect(days.get(d('2026-10-18'))?.projected).toEqual([]);
  });

  it('counts savings into investment accounts and accounts kept out of the available balance only', () => {
    const vault = account({ id: 'acc-vault', displayName: 'Brankas', includeInAvailable: false });
    const transfer = (id: string, toAccountId: string | null) =>
      transactionRow(id, { type: 'transfer', toAccountId, amountMinor: -1_000n, amountBaseMinor: -1_000n });
    const grid = monthGrid(
      OCTOBER,
      octoberInputs({
        rows: [transfer('vault', 'acc-vault'), transfer('nowhere', 'acc-unknown'), transfer('none', null)],
        accounts: [vault],
      }),
    );
    expect(grid.flat().find((detail) => detail.date === TODAY)?.savingsMinor).toBe(1_000n);
  });

  it('totals each week: spending, net, bills still to come, projected income', () => {
    const grid = monthGrid(OCTOBER, octoberInputs());
    expect(weekTotal(grid[0] ?? [])).toEqual({
      outMinor: 4_500_000n,
      netMinor: 14_000_000n,
      scheduledMinor: 0n,
      projectedMinor: 0n,
    });
    expect(weekTotal(grid[2] ?? [])).toEqual({
      outMinor: 200_000n,
      netMinor: 6_050_000n,
      scheduledMinor: 186_000n,
      projectedMinor: 0n,
    });
    // The recurring transfer on the 25th is no bill.
    expect(weekTotal(grid[3] ?? []).scheduledMinor).toBe(86_900n);
  });
});

describe('monthStats', () => {
  it('golden-style figures: daily average, costliest non-payday, frugal days, income, bills left, weekdays', () => {
    const stats = monthStats(monthGrid(OCTOBER, octoberInputs()), TODAY);
    expect(stats).toMatchObject({
      elapsed: 15,
      spentMinor: 9_090_000n,
      incomeMinor: 24_750_000n,
      averageMinor: 606_000n,
      frugalLimitMinor: 100_000n,
      frugalDays: 10,
      scheduledLeftMinor: 272_900n,
    });
    expect(stats.costliest?.date).toBe('2026-10-11');
    expect(stats.weekdays).toEqual([625_000n, 0n, 24_000n, 1_550_666n, 470_000n, 0n, 1_100_000n]);
  });

  it('keeps a small average as the frugal limit, and has nothing for a month to come', () => {
    const small = monthStats(
      monthGrid(OCTOBER, octoberInputs({ days: [day('2026-10-01', 150_000n)], rows: [] })),
      TODAY,
    );
    expect(small.averageMinor).toBe(10_000n);
    expect(small.frugalLimitMinor).toBe(3_000n);
    expect(small.costliest?.date).toBe('2026-10-01');
    const future = monthStats(monthGrid('2026-11' as YearMonth, octoberInputs({ days: [], rows: [] })), TODAY);
    expect(future).toMatchObject({ elapsed: 0, spentMinor: 0n, averageMinor: 0n, costliest: null });
    expect(future.weekdays.every((value) => value === 0n)).toBe(true);
  });
});

describe('paydays', () => {
  it('projects the pattern month’s salaries onto the same day, clamped to the month end', () => {
    const late = transactionRow('late', {
      type: 'income',
      localDate: d('2026-10-31'),
      merchant: null,
      description: 'Bonus',
      categoryId: categoryId('system:salary'),
      amountMinor: 1_000n,
      amountBaseMinor: 1_000n,
    });
    const untitled = transactionRow('untitled', {
      type: 'income',
      localDate: d('2026-10-01'),
      categoryId: categoryId('system:salary'),
      amountBaseMinor: 5n,
    });
    const pattern = octoberInputs({ rows: [...OCTOBER_ROWS, late, untitled] });
    expect(Object.fromEntries(paydays('2026-11' as YearMonth, pattern))).toEqual({
      '2026-11-01': [
        { label: 'PT Kinarya', amountMinor: 18_500_000n },
        { label: '', amountMinor: 5n },
      ],
      '2026-11-30': [{ label: 'Bonus', amountMinor: 1_000n }],
    });
  });

  it('shows the projection on the days of a month to come and totals it', () => {
    const november = octoberInputs({
      days: [],
      rows: [],
      scheduled: [scheduledItem({ sourceId: 'sub-netflix', dueDate: d('2026-11-18') })],
    });
    const grid = monthGrid('2026-11' as YearMonth, november, octoberInputs());
    const first = grid.flat().find((detail) => detail.date === '2026-11-01');
    expect(first?.projected).toEqual([{ label: 'PT Kinarya', amountMinor: 18_500_000n }]);
    expect(weekTotal(grid[0] ?? []).projectedMinor).toBe(18_500_000n);
  });
});

describe('weekStats', () => {
  it('compares the days so far with the same days of last week, with income, bills to come and days left', () => {
    const week = weekStats(d('2026-10-12'), octoberInputs());
    expect(week.days.map((detail) => detail.date)).toEqual([
      '2026-10-12',
      '2026-10-13',
      '2026-10-14',
      '2026-10-15',
      '2026-10-16',
      '2026-10-17',
      '2026-10-18',
    ]);
    expect(week).toMatchObject({
      spentMinor: 200_000n,
      elapsed: 4,
      averageMinor: 50_000n,
      previousMinor: 1_250_000n,
      incomeMinor: 6_250_000n,
      daysLeft: 3,
    });
    expect(week.largestIncome?.id).toBe('studio');
    expect(week.scheduled.map((item) => item.sourceId)).toEqual(['sub-netflix']);
  });

  it('has no comparison before the week starts, and no income without incomes', () => {
    const week = weekStats(d('2026-10-19'), octoberInputs());
    expect(week).toMatchObject({ elapsed: 0, averageMinor: 0n, previousMinor: null, daysLeft: 7, largestIncome: null });
  });
});

describe('yearMonths', () => {
  it('totals each month with its saved share, marking the current and the coming ones', () => {
    const months = yearMonths(2026, octoberInputs().days, TODAY);
    expect(months).toHaveLength(12);
    expect(months[9]).toEqual({
      month: '2026-10',
      inMinor: 24_750_000n,
      outMinor: 9_090_000n,
      savedRatio: (24_750_000 - 9_090_000) / 24_750_000,
      future: false,
      current: true,
    });
    expect(months[0]).toMatchObject({ savedRatio: null, future: false, current: false });
    expect(months[10]).toMatchObject({ future: true, current: false });
  });
});
