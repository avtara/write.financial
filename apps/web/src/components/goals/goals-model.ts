// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Pure helpers of "Tabungan" (design 13): a goal's state for `@wf/domain/goals` (progress, estimate, emergency-fund
 * months), the card's badge and contribution days, sorting, the month's contribution summary, the Record sheet's
 * goal match (FR-G4), and the dates a new monthly contribution runs on.
 */
import type { GoalView } from '@wf/db/goals';
import { goalSnapshot, planRunsIn, type GoalSnapshot, type GoalState } from '@wf/domain/goals';
import { dateInMonth, monthsBetween, shiftMonth, type LocalDate, type YearMonth } from '@wf/domain/period';
import type { Locale } from '@wf/i18n/locale';
import type { GoalMovement } from '../../lib/goal-movements.ts';
import type { GoalSummary } from '../../server/fn/goals.ts';

export type GoalSort = 'deadline' | 'progress' | 'remaining' | 'name';
export const GOAL_SORTS: readonly GoalSort[] = ['deadline', 'progress', 'remaining', 'name'];

/** Progress from 80% on is "Hampir tercapai". */
const ALMOST_BPS = 8_000;
/** A deadline this many months away or closer reads "2 bulan lagi". */
const SOON_MONTHS = 2;

/**
 * The monthly spending an emergency fund ("3× pengeluaran bulanan") is measured in: its target over its months;
 * `null` for a fixed target.
 */
export function monthlySpending(goal: Pick<GoalView, 'targetMode' | 'targetMonths' | 'targetMinor'>): bigint | null {
  if (goal.targetMode !== 'monthly_expenses' || goal.targetMonths === null) return null;
  return goal.targetMinor / BigInt(goal.targetMonths);
}

export function goalState(goal: GoalSummary): GoalState {
  return {
    targetMinor: goal.targetMinor,
    savedMinor: goal.savedMinor,
    deadline: goal.deadlineMonth,
    monthlyMinor: goal.monthlyPlanMinor,
    nextMonth: goal.nextMonth,
    monthlySpendingMinor: monthlySpending(goal),
  };
}

export type GoalBadge =
  { readonly kind: 'reached' | 'almost' | 'on_track' | 'behind' } | { readonly kind: 'soon'; readonly months: number };

/** "Tercapai", "Hampir tercapai", "2 bulan lagi", "Sesuai rencana", or "Melewati tenggat"; `null` without a plan. */
export function goalBadge(
  goal: Pick<GoalView, 'deadlineMonth'>,
  snapshot: GoalSnapshot,
  currentMonth: YearMonth,
): GoalBadge | null {
  if (snapshot.reached) return { kind: 'reached' };
  if (snapshot.progressBps !== null && snapshot.progressBps >= ALMOST_BPS) return { kind: 'almost' };
  if (goal.deadlineMonth !== null) {
    const months = monthsBetween(currentMonth, goal.deadlineMonth);
    if (months < 0) return { kind: 'behind' };
    if (months <= SOON_MONTHS) return { kind: 'soon', months };
  }
  if (snapshot.onTrack === null) return null;
  return { kind: snapshot.onTrack ? 'on_track' : 'behind' };
}

/** The days of the month its active contributions run on ("tgl 1 & 14"), ascending. */
export function planDays(goal: Pick<GoalView, 'plans'>): number[] {
  return [
    ...new Set(goal.plans.flatMap((plan) => (plan.active && plan.monthDay !== null ? [plan.monthDay] : []))),
  ].sort((a, b) => a - b);
}

/** Active goals by the chosen order ("Tenggat terdekat": goals without a deadline last). */
export function sortGoals(goals: readonly GoalSummary[], sort: GoalSort, locale: Locale): GoalSummary[] {
  type Entry = { readonly goal: GoalSummary; readonly snapshot: GoalSnapshot };
  const byName = (a: Entry, b: Entry) => a.goal.name.localeCompare(b.goal.name, locale);
  const compare: Readonly<Record<GoalSort, (a: Entry, b: Entry) => number>> = {
    deadline: ({ goal: a }, { goal: b }) =>
      a.deadlineMonth === b.deadlineMonth
        ? 0
        : a.deadlineMonth === null
          ? 1
          : b.deadlineMonth === null || a.deadlineMonth < b.deadlineMonth
            ? -1
            : 1,
    progress: (a, b) => (b.snapshot.progressBps ?? 0) - (a.snapshot.progressBps ?? 0) || byName(a, b),
    remaining: (a, b) =>
      a.snapshot.remainingMinor === b.snapshot.remainingMinor
        ? byName(a, b)
        : a.snapshot.remainingMinor > b.snapshot.remainingMinor
          ? -1
          : 1,
    name: byName,
  };
  return goals
    .map((goal) => ({ goal, snapshot: goalSnapshot(goalState(goal)) }))
    .sort(compare[sort])
    .map(({ goal }) => goal);
}

/** Completed and used goals, the latest first ("Terbaru selesai"). */
export function sortDone(goals: readonly GoalSummary[]): GoalSummary[] {
  return [...goals].sort((a, b) => (b.completedAt?.getTime() ?? 0) - (a.completedAt?.getTime() ?? 0));
}

export interface MonthSummary {
  /** Contributions recorded in the month (withdrawals subtract). */
  readonly recordedMinor: bigint;
  /** Σ active goals' plans running in the month ("dari rencana Rp4.650.000"; a "Nov–Apr" fund not in October). */
  readonly plannedMinor: bigint;
  /** Days of the month's contributions still to confirm ("sisa tgl 25"), ascending. */
  readonly pendingDays: number[];
}

export function monthSummary(
  goals: readonly GoalSummary[],
  movements: readonly GoalMovement[],
  currency: string,
  month: YearMonth,
): MonthSummary {
  const active = goals.filter((goal) => goal.status === 'active' && goal.currency === currency);
  return {
    recordedMinor: movements.reduce(
      (sum, movement) => (movement.status === 'recorded' ? sum + movement.amountMinor : sum),
      0n,
    ),
    plannedMinor: active
      .flatMap((goal) => goal.plans)
      .reduce((sum, plan) => (plan.active && planRunsIn(plan, month) ? sum + plan.amountMinor : sum), 0n),
    pendingDays: [
      ...new Set(
        movements.flatMap((movement) =>
          movement.status === 'scheduled' || movement.status === 'review' ? [Number(movement.date.slice(8))] : [],
        ),
      ),
    ].sort((a, b) => a - b),
  };
}

/** The active emergency fund (a "× pengeluaran bulanan" target) the "Dana darurat" KPI measures. */
export function emergencyGoal(goals: readonly GoalSummary[]): GoalSummary | null {
  return goals.find((goal) => goal.status === 'active' && goal.targetMode === 'monthly_expenses') ?? null;
}

/** `0,6` (id) / `0.6` (en): months of spending covered, from basis points of a month. */
export function formatMonths(bps: number, locale: Locale): string {
  return new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(bps / 10_000);
}

/**
 * FR-G4 "Bayar dari tujuan": the active goal an expense looks paid for: one of its tags is the goal's, or its
 * description names the goal ("Perpanjang STNK — Samsat Jaksel").
 */
export function matchGoal(
  goals: readonly GoalView[],
  expense: { readonly description: string; readonly tags: readonly string[] },
): GoalView | null {
  const active = goals.filter((goal) => goal.status === 'active');
  const text = expense.description.toLocaleLowerCase();
  return (
    active.find((goal) => goal.tag !== null && expense.tags.includes(goal.tag)) ??
    active.find((goal) => text !== '' && text.includes(goal.name.toLocaleLowerCase())) ??
    null
  );
}

/**
 * The first date a new monthly contribution on `day` runs: next month's (this month's set-aside is already
 * planned), so "Tiap tgl 25" from 15 Okt starts on 25 Nov ("8× setoran (Nov 2026 – Jun 2027)").
 */
export function firstContribution(today: LocalDate, day: number): LocalDate {
  return dateInMonth(shiftMonth(today.slice(0, 7) as YearMonth, 1), day);
}

/** Contributions from `start`'s month to the deadline, both included ("8× setoran"); `null` without a deadline. */
export function contributionCount(start: LocalDate, deadline: YearMonth | null): number | null {
  if (deadline === null) return null;
  return Math.max(monthsBetween(start.slice(0, 7) as YearMonth, deadline) + 1, 1);
}
