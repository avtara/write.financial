// SPDX-License-Identifier: AGPL-3.0-only
/** Dashboard views for component tests (shapes from `@wf/db`): the design persona's October 2026 on day 15. */
import type { Dashboard } from '@wf/db/dashboard';
import type { ScheduledItem, SubscriptionsOverview, SubscriptionView } from '@wf/db/schedules';
import type { DayGroup } from '@wf/db/transaction-query';
import type { LocalDate, YearMonth } from '@wf/domain/period';
import { OCTOBER } from './budget-fixtures.ts';
import { categoryId } from './ledger-fixtures.ts';

const d = (value: string) => value as LocalDate;

export const FOOD_ID = categoryId('system:food');
export const RENT_ID = categoryId('system:rent');
export const SHOPPING_ID = categoryId('system:shopping');
export const SALARY_ID = categoryId('system:salary');
export const FREELANCE_ID = categoryId('system:freelance');
export const DIVIDEND_ID = categoryId('system:dividend_interest');

export function day(date: string, outMinor: bigint, inMinor = 0n, count = 1): DayGroup {
  return { date: d(date), outMinor, inMinor, count };
}

/** Oktober 2026 so far: Rp26.000.000 in, Rp16.500.000 out, saved Rp9.500.000 (36,5%). */
export function dashboard(patch: Partial<Dashboard> = {}): Dashboard {
  const trend = (['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'] as const).map((label, index) => ({
    label: label as YearMonth,
    start: d(`${label}-01`),
    end: d(`${label}-${label === '2026-06' || label === '2026-09' ? '30' : '31'}`),
    incomeMinor: index === 4 ? 25_800_000n : index === 5 ? 26_000_000n : 0n,
    expenseMinor: index === 4 ? 18_300_000n : index === 5 ? 16_500_000n : 0n,
    savedMinor: index === 4 ? 7_500_000n : index === 5 ? 9_500_000n : 0n,
  }));
  return {
    scope: 'month',
    today: d('2026-10-15'),
    baseCurrency: 'IDR',
    ranges: {
      full: { from: d('2026-10-01'), to: d('2026-10-31') },
      current: { from: d('2026-10-01'), to: d('2026-10-15') },
      previous: { from: d('2026-09-01'), to: d('2026-09-30') },
    },
    period: OCTOBER,
    summary: { days: 31, periodCount: 1 },
    kpis: {
      current: { incomeMinor: 26_000_000n, expenseMinor: 16_500_000n, savedMinor: 9_500_000n, savingRateBps: 3654 },
      previous: { incomeMinor: 25_800_000n, expenseMinor: 18_300_000n, savedMinor: 7_500_000n, savingRateBps: 2907 },
      change: { incomeBps: 78, expenseBps: -984, savedBps: 2667, savingRateBps: 747 },
      savingRateTargetBps: 3000,
    },
    flow: {
      incomes: [
        { categoryId: SALARY_ID, amountMinor: 18_500_000n },
        { categoryId: FREELANCE_ID, amountMinor: 7_290_000n },
        { categoryId: DIVIDEND_ID, amountMinor: 210_000n },
      ],
      expenses: [
        { categoryId: RENT_ID, group: 'needs', amountMinor: 4_500_000n },
        { categoryId: FOOD_ID, group: 'needs', amountMinor: 3_200_000n },
        { categoryId: SHOPPING_ID, group: 'wants', amountMinor: 2_400_000n },
        { categoryId: null, group: 'other', amountMinor: 6_400_000n },
      ],
      transfers: [{ accountId: 'acc-jago', amountMinor: 3_500_000n }],
    },
    categories: [
      { categoryId: RENT_ID, group: 'needs', totalMinor: 4_500_000n, count: 1, shareBps: 2727, series: [] },
      { categoryId: FOOD_ID, group: 'needs', totalMinor: 3_200_000n, count: 18, shareBps: 1939, series: [] },
      { categoryId: SHOPPING_ID, group: 'wants', totalMinor: 2_400_000n, count: 6, shareBps: 1455, series: [] },
      { categoryId: null, group: null, totalMinor: 6_400_000n, count: 4, shareBps: 3879, series: [] },
    ],
    buckets: [],
    trend: { periods: trend, averageSavedMinor: 2_833_333n },
    calendar: {
      days: [
        day('2026-10-14', 711_000n, 6_200_000n, 6),
        day('2026-10-11', 3_380_000n, 0n, 5),
        day('2026-10-02', 320_000n),
        day('2026-10-01', 6_500_000n, 20_150_000n, 6),
      ],
      averageDailySpendMinor: 1_100_000n,
    },
    accounts: [
      { accountId: 'acc-bca', inflowMinor: 2_000_000n, outflowMinor: 800_000n },
      { accountId: 'acc-jago', inflowMinor: 500_000n, outflowMinor: 0n },
      { accountId: 'acc-ovo', inflowMinor: 0n, outflowMinor: 400_000n },
    ],
    budget: {
      lines: [
        { categoryId: FOOD_ID, limitMinor: 3_500_000n, spentMinor: 3_200_000n, usedBps: 9143, state: 'warning' },
        { categoryId: SHOPPING_ID, limitMinor: 2_000_000n, spentMinor: 2_400_000n, usedBps: 12_000, state: 'over' },
        { categoryId: RENT_ID, limitMinor: 4_500_000n, spentMinor: 0n, usedBps: 0, state: 'unused' },
      ],
      overCount: 1,
    },
    ...patch,
  };
}

/** The week of 12–18 Okt 2026 so far (Monday to Thursday). */
export function weekDashboard(patch: Partial<Dashboard> = {}): Dashboard {
  return dashboard({
    scope: 'week',
    ranges: {
      full: { from: d('2026-10-12'), to: d('2026-10-18') },
      current: { from: d('2026-10-12'), to: d('2026-10-15') },
      previous: { from: d('2026-10-05'), to: d('2026-10-08') },
    },
    summary: { days: 7, periodCount: 1 },
    ...patch,
  });
}

/** 2026 so far, with its twelve periods. */
export function yearDashboard(patch: Partial<Dashboard> = {}): Dashboard {
  const months = Array.from({ length: 12 }, (_, index) => {
    const label = `2026-${String(index + 1).padStart(2, '0')}` as YearMonth;
    return {
      label,
      start: d(`${label}-01`),
      end: d(`${label}-28`),
      incomeMinor: index === 8 ? 25_800_000n : index === 9 ? 26_000_000n : 0n,
      expenseMinor: index === 8 ? 18_300_000n : index === 9 ? 16_500_000n : 0n,
      savedMinor: index === 8 ? 7_500_000n : index === 9 ? 9_500_000n : 0n,
    };
  });
  return dashboard({
    scope: 'year',
    period: null,
    ranges: {
      full: { from: d('2026-01-01'), to: d('2026-12-31') },
      current: { from: d('2026-01-01'), to: d('2026-10-15') },
      previous: { from: d('2025-01-01'), to: d('2025-10-15') },
    },
    summary: { days: 365, periodCount: 12 },
    trend: { periods: months, averageSavedMinor: 1_700_000n },
    ...patch,
  });
}

/** 14 Sep – 13 Okt 2026: "30 hari · melintasi 2 periode". */
export function rangeDashboard(patch: Partial<Dashboard> = {}): Dashboard {
  return dashboard({
    scope: 'range',
    period: null,
    ranges: {
      full: { from: d('2026-09-14'), to: d('2026-10-13') },
      current: { from: d('2026-09-14'), to: d('2026-10-13') },
      previous: { from: d('2026-08-15'), to: d('2026-09-13') },
    },
    summary: { days: 30, periodCount: 2 },
    ...patch,
  });
}

export function subscription(
  patch: Partial<SubscriptionView> & Pick<SubscriptionView, 'id' | 'name'>,
): SubscriptionView {
  return {
    plan: null,
    icon: null,
    logoKey: null,
    description: null,
    priceMinor: 100_000n,
    currency: 'IDR',
    cycle: 'monthly',
    nextBillingDate: d('2026-10-18'),
    payFromAccountId: 'acc-bca',
    categoryId: null,
    remindDaysBefore: 1,
    startedOn: d('2026-01-18'),
    trialEndsOn: null,
    status: 'active',
    effectiveStatus: 'active',
    pausedOn: null,
    pausedUntil: null,
    pauseRemindDays: null,
    cancelMode: null,
    endsOn: null,
    cancelledAt: null,
    usageRating: null,
    ratedAt: null,
    nextReviewOn: null,
    monthlyMinor: patch.priceMinor ?? 100_000n,
    yearlyMinor: (patch.priceMinor ?? 100_000n) * 12n,
    nextBill: null,
    priceIncrease: null,
    paidCount: 0,
    totalPaidMinor: 0n,
    createdAt: new Date('2026-01-18T00:00:00Z'),
    ...patch,
  };
}

export const NETFLIX = subscription({
  id: 'sub-netflix',
  name: 'Netflix',
  plan: 'Premium 4K',
  priceMinor: 186_000n,
  nextBillingDate: d('2026-10-18'),
});
export const SPOTIFY = subscription({
  id: 'sub-spotify',
  name: 'Spotify',
  plan: 'Family',
  priceMinor: 86_900n,
  nextBillingDate: d('2026-10-25'),
});
export const GYM = subscription({
  id: 'sub-gym',
  name: 'Fit Hub',
  priceMinor: 199_000n,
  nextBillingDate: d('2026-11-03'),
});
export const ICLOUD = subscription({
  id: 'sub-icloud',
  name: 'iCloud+',
  plan: '200 GB',
  priceMinor: 45_000n,
  nextBillingDate: d('2026-10-09'),
});
export const PAUSED = subscription({ id: 'sub-paused', name: 'Headspace', effectiveStatus: 'paused' });

export function subscriptionsOverview(patch: Partial<SubscriptionsOverview> = {}): SubscriptionsOverview {
  return {
    today: d('2026-10-15'),
    baseCurrency: 'IDR',
    subscriptions: [NETFLIX, SPOTIFY, GYM, ICLOUD, PAUSED],
    counts: { active: 4, paused: 1, cancelled: 0 },
    totals: { monthlyMinor: 516_900n, yearlyMinor: 6_202_800n, approxYearlyMinor: 6_200_000n },
    remainingThisMonth: { totalMinor: 272_900n, count: 2, firstDue: d('2026-10-18'), lastDue: d('2026-10-25') },
    monthSchedule: [
      {
        occurrenceId: 'o-gym',
        subscriptionId: 'sub-gym',
        name: 'Fit Hub',
        icon: null,
        dueDate: d('2026-10-03'),
        amountMinor: 199_000n,
        currency: 'IDR',
        status: 'paid',
      },
      {
        occurrenceId: 'o-icloud',
        subscriptionId: 'sub-icloud',
        name: 'iCloud+',
        icon: null,
        dueDate: d('2026-10-09'),
        amountMinor: 45_000n,
        currency: 'IDR',
        status: 'unconfirmed',
      },
    ],
    couldSave: [{ subscriptionId: 'sub-spotify', yearlyMinor: 1_042_800n }],
    priceIncreases: [],
    cancelledSavedMinor: 0n,
    byCategory: [],
    missingRates: [],
    history: [],
    ...patch,
  };
}

export function scheduledItem(
  patch: Partial<ScheduledItem> & Pick<ScheduledItem, 'sourceId' | 'dueDate'>,
): ScheduledItem {
  return {
    occurrenceId: null,
    sourceType: 'subscription',
    name: 'Netflix',
    icon: null,
    expectedMinor: 186_000n,
    currency: 'IDR',
    status: 'scheduled',
    transactionId: null,
    accountId: 'acc-bca',
    direction: 'out',
    ...patch,
  };
}
