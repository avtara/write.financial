// SPDX-License-Identifier: AGPL-3.0-only
import type { LocalDate, YearMonth } from '@wf/domain/period';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ledgerFixture, type LedgerFixture } from '../test/ledger-fixture.ts';
import { PGLITE_HOOK_TIMEOUT, startMigrated, type TestDatabase } from '../test/pglite.ts';
import { createBudgets } from './budgets.ts';
import { createDashboard, type DashboardRepository } from './dashboard.ts';
import { createPeriods } from './periods.ts';

let test: TestDatabase;
let ledger: LedgerFixture;
let userId: string;
let dashboard: DashboardRepository;
let food: string;
let shopping: string;
let rent: string;
let salary: string;
let freelance: string;
let bankFee: string;

const asApp = <T>(fn: () => Promise<T>) => test.as('wf_app', fn);
const d = (value: string) => value as LocalDate;

beforeAll(async () => {
  test = await startMigrated();
  dashboard = createDashboard(test.db, { now: () => new Date('2026-10-15T05:00:00Z') });
}, PGLITE_HOOK_TIMEOUT);

afterAll(async () => {
  await test.close();
});

/**
 * September: salary 10.000.000, food 2.000.000, a transfer. Oktober up to Thursday 15 Okt: income 13.000.000,
 * spending 1.456.500 (food 600.000, shopping 800.000, uncategorized 50.000, a transfer fee 6.500), a transfer of
 * 2.000.000 to Jago. Budget from Oktober: food 1.000.000, shopping 500.000, rent 2.000.000.
 */
beforeEach(async () => {
  await test.query('DELETE FROM users');
  ledger = await ledgerFixture(test, 'avtara@example.test');
  userId = ledger.userId;
  food = ledger.category('system:food');
  shopping = ledger.category('system:shopping');
  rent = ledger.category('system:rent');
  salary = ledger.category('system:salary');
  freelance = ledger.category('system:freelance');
  bankFee = ledger.category('system:bank_fee');
  await ledger.entry('income', '2026-09-01', 10_000_000n, salary);
  await ledger.entry('expense', '2026-09-05', 2_000_000n, food);
  await ledger.transfer('2026-09-07', 1_000_000n);
  await ledger.entry('income', '2026-10-01', 12_000_000n, salary);
  await ledger.entry('expense', '2026-10-03', 300_000n, food);
  await ledger.entry('expense', '2026-10-04', 600_000n, shopping);
  await ledger.entry('expense', '2026-10-06', 50_000n, null);
  await ledger.transfer('2026-10-08', 2_000_000n, { minor: 6_500n, categoryId: bankFee });
  await ledger.entry('income', '2026-10-09', 1_000_000n, freelance);
  await ledger.entry('expense', '2026-10-10', 200_000n, food);
  await ledger.entry('expense', '2026-10-13', 100_000n, food);
  await ledger.entry('expense', '2026-10-14', 200_000n, shopping);
  await asApp(() =>
    createBudgets(test.db).saveVersion(userId, {
      effectiveFrom: '2026-10' as YearMonth,
      lines: [
        { categoryId: food, limitMinor: 1_000_000n },
        { categoryId: shopping, limitMinor: 500_000n },
        { categoryId: rent, limitMinor: 2_000_000n },
      ],
    }),
  );
});

describe('month', () => {
  it('the current period up to today against the same days of the previous one', async () => {
    const result = await asApp(() => dashboard.get(userId, { scope: 'month' }));
    expect(result).toMatchObject({
      scope: 'month',
      today: '2026-10-15',
      baseCurrency: 'IDR',
      period: { label: '2026-10', start: '2026-10-01', end: '2026-10-31' },
      summary: { days: 31, periodCount: 1 },
    });
    expect(result.ranges.current).toEqual({ from: '2026-10-01', to: '2026-10-15' });
    expect(result.kpis).toMatchObject({
      current: { incomeMinor: 13_000_000n, expenseMinor: 1_456_500n, savedMinor: 11_543_500n, savingRateBps: 8880 },
      previous: { incomeMinor: 10_000_000n, expenseMinor: 2_000_000n, savedMinor: 8_000_000n, savingRateBps: 8000 },
      change: { incomeBps: 3000, savingRateBps: 880 },
      savingRateTargetBps: 3000,
    });

    // Money flow: incomes, expenses with their group (uncategorized → other), transfers in by account.
    expect(result.flow.incomes).toEqual([
      { categoryId: salary, amountMinor: 12_000_000n },
      { categoryId: freelance, amountMinor: 1_000_000n },
    ]);
    expect(result.flow.expenses).toEqual([
      { categoryId: shopping, group: 'wants', amountMinor: 800_000n },
      { categoryId: food, group: 'needs', amountMinor: 600_000n },
      { categoryId: null, group: 'other', amountMinor: 50_000n },
      { categoryId: bankFee, group: 'financial', amountMinor: 6_500n },
    ]);
    expect(result.flow.transfers).toEqual([{ accountId: ledger.jago, amountMinor: 2_000_000n }]);

    // Day buckets for the 15 days so far.
    expect(result.buckets).toHaveLength(15);
    expect(result.buckets[0]).toBe('2026-10-01');
    const foodSpending = result.categories.find((row) => row.categoryId === food);
    expect(foodSpending).toMatchObject({ group: 'needs', totalMinor: 600_000n, count: 3 });
    expect(foodSpending?.series[2]).toBe(300_000n);
    expect(foodSpending?.series[9]).toBe(200_000n);
    expect(foodSpending?.series[12]).toBe(100_000n);
    expect(foodSpending?.series[0]).toBe(0n);
    expect(result.categories.find((row) => row.categoryId === null)).toMatchObject({
      group: null,
      totalMinor: 50_000n,
    });

    expect(result.trend.periods.map((period) => period.label)).toEqual([
      '2026-05',
      '2026-06',
      '2026-07',
      '2026-08',
      '2026-09',
      '2026-10',
    ]);
    expect(result.trend.periods.at(-2)).toMatchObject({ incomeMinor: 10_000_000n, savedMinor: 8_000_000n });
    expect(result.trend.averageSavedMinor).toBe((8_000_000n + 11_543_500n) / 6n);

    expect(result.calendar.days[0]).toMatchObject({ date: '2026-10-14', outMinor: 200_000n });
    expect(result.calendar.averageDailySpendMinor).toBe(1_456_500n / 15n);
    expect(result.accounts).toEqual(
      expect.arrayContaining([
        { accountId: ledger.bca, inflowMinor: 13_000_000n, outflowMinor: 3_456_500n },
        { accountId: ledger.jago, inflowMinor: 2_000_000n, outflowMinor: 0n },
      ]),
    );
    expect(result.budget).toEqual({
      lines: [
        { categoryId: food, limitMinor: 1_000_000n, spentMinor: 600_000n, usedBps: 6000, state: 'ok' },
        { categoryId: shopping, limitMinor: 500_000n, spentMinor: 800_000n, usedBps: 16_000, state: 'over' },
        { categoryId: rent, limitMinor: 2_000_000n, spentMinor: 0n, usedBps: 0, state: 'unused' },
      ],
      overCount: 1,
    });
  });

  it('an earlier period by id; no budget card without budget lines', async () => {
    await asApp(() => createPeriods(test.db, { now: () => new Date('2026-09-10T05:00:00Z') }).list(userId));
    const { periods } = await asApp(() =>
      createPeriods(test.db, { now: () => new Date('2026-10-15T05:00:00Z') }).list(userId),
    );
    const september = periods.find((period) => period.label === '2026-09');
    const result = await asApp(() => dashboard.get(userId, { scope: 'month', periodId: september?.id as string }));
    expect(result.period).toMatchObject({ label: '2026-09' });
    expect(result.ranges.current).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(result.kpis.current).toMatchObject({ incomeMinor: 10_000_000n, expenseMinor: 2_000_000n });
    expect(result.kpis.previous).toEqual({ incomeMinor: 0n, expenseMinor: 0n, savedMinor: 0n, savingRateBps: null });
    expect(result.kpis.change.savingRateBps).toBeNull();
    expect(result.flow.transfers).toEqual([{ accountId: ledger.jago, amountMinor: 1_000_000n }]);
    expect(result.budget).toBeNull();
  });

  it('refuses an unknown or another user’s period', async () => {
    const other = await ledgerFixture(test, 'other@example.test');
    const { current } = await asApp(() => createPeriods(test.db).list(other.userId));
    await expect(
      asApp(() => dashboard.get(userId, { scope: 'month', periodId: current.id as string })),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('week', () => {
  it('the week so far with weekly budget limits', async () => {
    const result = await asApp(() => dashboard.get(userId, { scope: 'week' }));
    expect(result.period).toMatchObject({ label: '2026-10' });
    expect(result.ranges.current).toEqual({ from: '2026-10-12', to: '2026-10-15' });
    expect(result.kpis.current).toMatchObject({ incomeMinor: 0n, expenseMinor: 300_000n, savingRateBps: null });
    expect(result.buckets).toEqual(['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15']);
    expect(result.budget).toEqual({
      lines: [
        { categoryId: food, limitMinor: 225_806n, spentMinor: 100_000n, usedBps: 4429, state: 'ok' },
        { categoryId: shopping, limitMinor: 112_903n, spentMinor: 200_000n, usedBps: 17_714, state: 'over' },
        { categoryId: rent, limitMinor: 451_613n, spentMinor: 0n, usedBps: 0, state: 'unused' },
      ],
      overCount: 1,
    });
  });

  it('starts on Sunday when the user prefers it', async () => {
    await test.query(`INSERT INTO user_preferences (user_id, week_start) VALUES ($1, 'sunday')`, [userId]);
    const result = await asApp(() => dashboard.get(userId, { scope: 'week' }));
    expect(result.ranges.current).toEqual({ from: '2026-10-11', to: '2026-10-15' });
  });
});

describe('year', () => {
  it('this year by month, the budget times the periods so far', async () => {
    const result = await asApp(() => dashboard.get(userId, { scope: 'year' }));
    expect(result.period).toBeNull();
    expect(result.ranges.current).toEqual({ from: '2026-01-01', to: '2026-10-15' });
    expect(result.buckets).toEqual([
      '2026-01-01',
      '2026-02-01',
      '2026-03-01',
      '2026-04-01',
      '2026-05-01',
      '2026-06-01',
      '2026-07-01',
      '2026-08-01',
      '2026-09-01',
      '2026-10-01',
    ]);
    const foodSpending = result.categories.find((row) => row.categoryId === food);
    expect(foodSpending?.series.slice(-2)).toEqual([2_000_000n, 600_000n]);
    expect(result.budget?.lines[0]).toEqual({
      categoryId: food,
      limitMinor: 10_000_000n,
      spentMinor: 2_600_000n,
      usedBps: 2600,
      state: 'ok',
    });
    // Twelve periods; November and December have not started and stay empty.
    expect(result.trend.periods.map((period) => period.label)).toEqual([
      '2026-01',
      '2026-02',
      '2026-03',
      '2026-04',
      '2026-05',
      '2026-06',
      '2026-07',
      '2026-08',
      '2026-09',
      '2026-10',
      '2026-11',
      '2026-12',
    ]);
    expect(result.trend.periods.at(-1)).toMatchObject({ start: '2026-12-01', incomeMinor: 0n, expenseMinor: 0n });
    expect(result.trend.periods.at(-3)).toMatchObject({ incomeMinor: 13_000_000n, expenseMinor: 1_456_500n });
    expect(result.trend.averageSavedMinor).toBe((8_000_000n + 11_543_500n) / 10n);
  });

  it('an explicit year', async () => {
    const result = await asApp(() => dashboard.get(userId, { scope: 'year', year: 2025 }));
    expect(result.ranges.current.from).toBe('2025-01-01');
    expect(result.kpis.current).toEqual({ incomeMinor: 0n, expenseMinor: 0n, savedMinor: 0n, savingRateBps: null });
    expect(result.categories).toEqual([]);
    expect(result.budget?.lines[0]).toMatchObject({ categoryId: food, spentMinor: 0n, state: 'unused' });
  });
});

describe('range', () => {
  it('a custom range across periods', async () => {
    const result = await asApp(() =>
      dashboard.get(userId, { scope: 'range', from: d('2026-09-14'), to: d('2026-10-13') }),
    );
    expect(result.summary).toEqual({ days: 30, periodCount: 2 });
    expect(result.period).toBeNull();
    expect(result.buckets).toHaveLength(30);
    expect(result.kpis.current).toMatchObject({ incomeMinor: 13_000_000n, expenseMinor: 1_256_500n });
  });

  it('month buckets beyond 62 days, from the first of the month', async () => {
    const result = await asApp(() =>
      dashboard.get(userId, { scope: 'range', from: d('2026-07-15'), to: d('2026-10-15') }),
    );
    expect(result.buckets).toEqual(['2026-07-01', '2026-08-01', '2026-09-01', '2026-10-01']);
    expect(result.categories.find((row) => row.categoryId === food)?.series).toEqual([0n, 0n, 2_000_000n, 600_000n]);
  });

  it('refuses a reversed range and one longer than 366 days', async () => {
    for (const [from, to] of [
      ['2026-10-02', '2026-10-01'],
      ['2025-01-01', '2026-01-02'],
    ] as const) {
      await expect(
        asApp(() => dashboard.get(userId, { scope: 'range', from: d(from), to: d(to) })),
      ).rejects.toMatchObject({ code: 'INVALID_PERIOD' });
    }
  });
});

it('uses the current time by default', async () => {
  const result = await asApp(() => createDashboard(test.db).get(userId, { scope: 'week' }));
  expect(result.ranges.current.to).toBe(result.today);
});
