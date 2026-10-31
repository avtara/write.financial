// SPDX-License-Identifier: AGPL-3.0-only
/** Budget views for component tests (shapes from `@wf/db`): October 2026 on day 15, like the design persona. */
import type { BudgetLineView, BudgetStatus } from '@wf/db/budgets';
import type { PeriodsOverview, PeriodView } from '@wf/db/periods';
import { ratioBps } from '@wf/domain/budget';
import type { LocalDate, PeriodStartDay, YearMonth } from '@wf/domain/period';
import type { BudgetLookup } from '../src/components/budget/budget-note.tsx';

/** A period row; October 2026 unless patched. */
export function periodView(patch: Partial<PeriodView> = {}): PeriodView {
  return {
    id: 'p-okt',
    kind: 'normal',
    start: '2026-10-01' as LocalDate,
    end: '2026-10-31' as LocalDate,
    days: 31,
    label: '2026-10' as YearMonth,
    status: 'open',
    closedAt: null,
    ...patch,
  };
}

export const OCTOBER = periodView();
export const SEPTEMBER = periodView({
  id: 'p-sep',
  start: '2026-09-01' as LocalDate,
  end: '2026-09-30' as LocalDate,
  days: 30,
  label: '2026-09' as YearMonth,
  status: 'closed',
  closedAt: new Date('2026-10-01T00:00:00Z'),
});
export const AUGUST = periodView({
  id: 'p-agu',
  start: '2026-08-01' as LocalDate,
  end: '2026-08-31' as LocalDate,
  label: '2026-08' as YearMonth,
});

/** The switcher's periods: rows newest first (an open August row after a closed September). */
export function periodsOverview(patch: Partial<PeriodsOverview> = {}): PeriodsOverview {
  return {
    startDay: 1 as PeriodStartDay,
    baseCurrency: 'IDR',
    mode: 'fixed_day',
    today: '2026-10-15' as LocalDate,
    current: OCTOBER,
    periods: [OCTOBER, SEPTEMBER, AUGUST],
    upcoming: [],
    ...patch,
  };
}

/**
 * A budget line; `remainingMinor` and `usedBps` follow `limitMinor` and `spentMinor` unless patched. Defaults: a
 * user category "Makan" (needs) at Rp3.200.000 of Rp3.500.000.
 */
export function budgetLine(patch: Partial<BudgetLineView> & Pick<BudgetLineView, 'categoryId'>): BudgetLineView {
  const limitMinor = patch.limitMinor ?? 3_500_000n;
  const spentMinor = patch.spentMinor ?? 3_200_000n;
  return {
    kind: 'expense',
    group: 'needs',
    name: 'Makan',
    builtInKey: null,
    icon: 'utensils',
    color: 'orange',
    limitMinor,
    spentMinor,
    remainingMinor: limitMinor - spentMinor,
    usedBps: ratioBps(spentMinor, limitMinor),
    safeDailyMinor: 18_000n,
    weeklyMinor: 126_000n,
    projectionMinor: 3_300_000n,
    state: 'ok',
    willExceedByMinor: 0n,
    baseLimitMinor: limitMinor,
    overridesMinor: 0n,
    rollover: false,
    isFixed: false,
    alertPct: 85,
    count: 12,
    dismissed: false,
    ...patch,
  };
}

/** Makan: 91% used, at its warning threshold. */
export const FOOD = budgetLine({ categoryId: 'food', state: 'warning', projectionMinor: 6_600_000n });
/** Transportasi: Rp400.000 left, the largest remainder. */
export const TRANSPORT = budgetLine({
  categoryId: 'transport',
  name: 'Transportasi',
  icon: 'car',
  limitMinor: 2_000_000n,
  spentMinor: 1_600_000n,
  safeDailyMinor: 23_000n,
  projectionMinor: 3_200_000n,
});
/** Sewa: a fixed cost, paid. */
export const RENT = budgetLine({
  categoryId: 'rent',
  name: 'Sewa',
  icon: 'house',
  limitMinor: 4_000_000n,
  spentMinor: 4_000_000n,
  safeDailyMinor: null,
  projectionMinor: 4_000_000n,
  state: 'paid',
  isFixed: true,
});
/** Belanja: Rp400.000 over. */
export const SHOPPING = budgetLine({
  categoryId: 'shopping',
  group: 'wants',
  name: 'Belanja',
  icon: 'shopping-bag',
  limitMinor: 2_000_000n,
  spentMinor: 2_400_000n,
  safeDailyMinor: 0n,
  projectionMinor: 4_800_000n,
  state: 'over',
});
/** Hiburan: nothing spent yet. */
export const FUN = budgetLine({
  categoryId: 'fun',
  group: 'wants',
  name: 'Hiburan',
  icon: 'clapperboard',
  limitMinor: 1_000_000n,
  spentMinor: 0n,
  safeDailyMinor: 58_000n,
  projectionMinor: 0n,
  state: 'unused',
});

export const LINES: readonly BudgetLineView[] = [FOOD, TRANSPORT, RENT, SHOPPING, FUN];

/** The budget page of October on day 15 with {@link LINES}; patch what the test needs. */
export function budgetStatus(patch: Partial<BudgetStatus> = {}): BudgetStatus {
  const lines = [...(patch.lines ?? LINES)];
  const limitMinor = lines.reduce((total, line) => total + line.limitMinor, 0n);
  const spentMinor = lines.reduce((total, line) => total + line.spentMinor, 0n);
  return {
    period: OCTOBER,
    today: '2026-10-15' as LocalDate,
    readOnly: false,
    baseCurrency: 'IDR',
    version: { id: 'v-1', effectiveFrom: '2026-09' as YearMonth, expectedIncomeMinor: 15_000_000n },
    lines,
    groups: [
      {
        group: 'needs',
        limitMinor: 9_500_000n,
        spentMinor: 8_800_000n,
        usedBps: 9263,
        lineCount: 3,
        overCount: 0,
      },
      {
        group: 'wants',
        limitMinor: 3_000_000n,
        spentMinor: 2_400_000n,
        usedBps: 8000,
        lineCount: 2,
        overCount: 1,
      },
    ],
    totals: {
      limitMinor,
      spentMinor,
      remainingMinor: limitMinor - spentMinor,
      usedBps: ratioBps(spentMinor, limitMinor),
      day: 15,
      daysLeft: 17,
      idealBps: 4839,
      pace: 'ahead',
      safeDailyMinor: 140_000n,
      projectionMinor: 23_000_000n,
      projectedOverMinor: 10_500_000n,
      overCount: 1,
      unbudgetedSpentMinor: 0n,
    },
    attention: [
      { categoryId: 'food', reason: 'warning' },
      { categoryId: 'shopping', reason: 'over' },
    ],
    dismissedCount: 0,
    close: { rollovers: [], leftoverMinor: 1_300_000n },
    nextTransition: null,
    ...patch,
  };
}

/**
 * The Record sheet's budget (FR-T2/T3) with the built-in category ids of `ledger-fixtures.ts`: Makan & Dapur
 * Rp3.200.000 of 3.500.000 and Transportasi Rp1.600.000 of 2.000.000.
 */
export const RECORD_BUDGET: BudgetLookup = {
  currency: 'IDR',
  lines: [
    budgetLine({ categoryId: 'cat-food', name: 'system:food', builtInKey: 'system:food' }),
    budgetLine({
      categoryId: 'cat-transport',
      name: 'system:transport',
      builtInKey: 'system:transport',
      limitMinor: 2_000_000n,
      spentMinor: 1_600_000n,
    }),
  ],
};
