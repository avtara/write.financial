// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Savings goals and sinking funds (PRD §6.12 FR-G1, G3, G4; §6.8 FR-B6; §7.2): the dynamic emergency-fund target,
 * progress, the monthly contribution a deadline needs, the estimated completion month, the emergency-fund coverage,
 * the deposit/withdraw previews, "Bayar dari tujuan", and the rule of a recurring contribution. Amounts are `bigint`
 * minor units in the goal's currency; ratios are basis points (`formatPercent(bps / 10_000, …)`), and the coverage is
 * basis points of a month (6181 → "0,6 bulan"). Contributions only ever reach the ledger through the Review queue
 * (D14); nothing here writes anything.
 */
import { ratioBps } from './budget.ts';
import { divideCeil } from './money.ts';
import { dateInMonth, monthsBetween, shiftMonth, type YearMonth } from './period.ts';
import type { RecurrenceRule } from './recurrence.ts';

/** D9: sinking funds ("Dana tidak rutin") are goals of kind `sinking`. */
export const GOAL_KINDS = ['savings', 'sinking'] as const;
export type GoalKind = (typeof GOAL_KINDS)[number];

/** FR-G1 target: a fixed amount, or a multiple of the monthly spending ("3× pengeluaran bulanan"). */
export const GOAL_TARGET_MODES = ['fixed', 'monthly_expenses'] as const;
export type GoalTargetMode = (typeof GOAL_TARGET_MODES)[number];

/** FR-G4: active, completed ("Tandai selesai", tab Selesai), used ("Terpakai" after "Bayar dari tujuan"). */
export const GOAL_STATUSES = ['active', 'completed', 'used'] as const;
export type GoalStatus = (typeof GOAL_STATUSES)[number];

/** FR-G1 emergency fund "target 3 bulan pengeluaran". */
export const EMERGENCY_FUND_MONTHS = 3;

const MAX_MONTH_DAY = 31;

export type InvalidGoalReason = 'months' | 'amount' | 'withdraw' | 'plan';

export class InvalidGoalError extends RangeError {
  override readonly name = 'InvalidGoalError';
  readonly reason: InvalidGoalReason;
  constructor(reason: InvalidGoalReason) {
    super(`Invalid goal: ${reason}`);
    this.reason = reason;
  }
}

/**
 * FR-G1 dynamic target: `months` × the average monthly spending (`budget.averageSpend` of the last 3 periods):
 * 3 × 18.000.000 = Rp54.000.000.
 */
export function dynamicTarget(averageMonthlySpendingMinor: bigint, months: number = EMERGENCY_FUND_MONTHS): bigint {
  if (!Number.isInteger(months) || months < 1) throw new InvalidGoalError('months');
  return averageMonthlySpendingMinor * BigInt(months);
}

export interface SinkingFundInput {
  readonly targetMinor: bigint;
  readonly savedMinor: bigint;
  /** The month of the first contribution still to come. */
  readonly from: YearMonth;
  /** The deadline month, which gets the last contribution. */
  readonly deadline: YearMonth;
  /** The contribution is rounded up to this step (Rp1.000 for IDR: `budget.safeDailyStepMinor`). */
  readonly stepMinor: bigint;
}

export interface SinkingFundPlan {
  /** Contributions from `from` to `deadline`, both included; at least 1 (a passed deadline asks for the rest now). */
  readonly count: number;
  /** (target − saved) ÷ count, rounded up to the step; `0n` once the target is reached. */
  readonly monthlyMinor: bigint;
}

/**
 * FR-B6 / PRD §7.2 monthly contribution = (target − saved) ÷ months left to the deadline, rounded up so the deadline
 * is met: Laptop 18.000.000 over Nov 2026 – Jun 2027 → 8× Rp2.250.000; STNK 170.000 over Nov – Feb → Rp43.000.
 */
export function sinkingFundPlan(input: SinkingFundInput): SinkingFundPlan {
  const count = Math.max(monthsBetween(input.from, input.deadline) + 1, 1);
  const remaining = input.targetMinor - input.savedMinor;
  if (remaining <= 0n) return { count, monthlyMinor: 0n };
  return { count, monthlyMinor: divideCeil(remaining, BigInt(count) * input.stepMinor) * input.stepMinor };
}

export interface GoalState {
  readonly targetMinor: bigint;
  readonly savedMinor: bigint;
  readonly deadline: YearMonth | null;
  /** Σ of the goal's active recurring contributions per month (Dana Darurat: 500.000 + 3.000.000). */
  readonly monthlyMinor: bigint;
  /** The month of the next recurring contribution (2026-11 on 15 Okt once October's have landed). */
  readonly nextMonth: YearMonth;
  /** Emergency funds: the average monthly spending the coverage is measured in; `null` for other goals. */
  readonly monthlySpendingMinor: bigint | null;
}

export interface GoalSnapshot {
  readonly savedMinor: bigint;
  /** What is still missing ("kurang Rp170.000", the "Pas target" chip); `0n` once reached. */
  readonly remainingMinor: bigint;
  /** saved ÷ target (11.125.000 / 54.000.000 → 2060 = 21%); above 10 000 for a reserve; `null` without a target. */
  readonly progressBps: number | null;
  readonly reached: boolean;
  /**
   * "Estimasi tercapai": the month of the contribution that reaches the target at the current monthly rate;
   * `null` once reached or without recurring contributions.
   */
  readonly estimate: YearMonth | null;
  /** estimate ≤ deadline ("Sesuai rencana"); `null` without an estimate or a deadline. */
  readonly onTrack: boolean | null;
  /** Emergency-fund coverage: saved ÷ monthly spending, in bps of a month (6181 → "0,6 bulan"); `null` otherwise. */
  readonly coverageBps: number | null;
}

/** Where a goal stands (FR-G3 card and detail: progress, coverage, estimated completion). */
export function goalSnapshot(goal: GoalState): GoalSnapshot {
  const missing = goal.targetMinor - goal.savedMinor;
  const remainingMinor = missing > 0n ? missing : 0n;
  const estimate =
    remainingMinor === 0n || goal.monthlyMinor <= 0n
      ? null
      : shiftMonth(goal.nextMonth, Number(divideCeil(remainingMinor, goal.monthlyMinor)) - 1);
  return {
    savedMinor: goal.savedMinor,
    remainingMinor,
    progressBps: ratioBps(goal.savedMinor, goal.targetMinor),
    reached: remainingMinor === 0n,
    estimate,
    onTrack: estimate === null || goal.deadline === null ? null : estimate <= goal.deadline,
    coverageBps: goal.monthlySpendingMinor === null ? null : ratioBps(goal.savedMinor, goal.monthlySpendingMinor),
  };
}

export interface GoalMovePreview {
  readonly before: GoalSnapshot;
  readonly after: GoalSnapshot;
  /** "Tercapai setelah setoran ini". */
  readonly reachesTarget: boolean;
}

function movePreview(goal: GoalState, deltaMinor: bigint): GoalMovePreview {
  const before = goalSnapshot(goal);
  const after = goalSnapshot({ ...goal, savedMinor: goal.savedMinor + deltaMinor });
  return { before, after, reachesTarget: !before.reached && after.reached };
}

/** FR-G3 "Setor manual" preview: progress 21% → 22%, estimate Nov 2027 → Okt 2027 for Rp1.000.000. */
export function depositPreview(goal: GoalState, amountMinor: bigint): GoalMovePreview {
  if (amountMinor <= 0n) throw new InvalidGoalError('amount');
  return movePreview(goal, amountMinor);
}

/** FR-G3 "Tarik dana" preview: progress 21% → 17%, coverage 0,6 → 0,5 bulan for Rp2.000.000; at most the saved amount. */
export function withdrawPreview(goal: GoalState, amountMinor: bigint): GoalMovePreview {
  if (amountMinor <= 0n) throw new InvalidGoalError('amount');
  if (amountMinor > goal.savedMinor) throw new InvalidGoalError('withdraw');
  return movePreview(goal, -amountMinor);
}

export interface GoalPayment {
  /** Paid with the goal's money. */
  readonly fromGoalMinor: bigint;
  /** The part of the expense beyond the goal's money, paid from the free balance. */
  readonly fromFreeMinor: bigint;
  /** "Sisa Rp38.000": left in the goal, to move to another goal or release as free balance. */
  readonly leftoverMinor: bigint;
}

/** FR-G4 "Bayar dari tujuan": Perpanjang STNK Rp850.000 pays Samsat Rp812.000 → leftover Rp38.000. */
export function payFromGoal(savedMinor: bigint, expenseMinor: bigint): GoalPayment {
  if (expenseMinor <= 0n) throw new InvalidGoalError('amount');
  const availableMinor = savedMinor > 0n ? savedMinor : 0n;
  const fromGoalMinor = expenseMinor < availableMinor ? expenseMinor : availableMinor;
  return {
    fromGoalMinor,
    fromFreeMinor: expenseMinor - fromGoalMinor,
    leftoverMinor: availableMinor - fromGoalMinor,
  };
}

export interface ContributionPlan {
  /** Day of month (1–31, clamped to short months). */
  readonly day: number;
  readonly from: YearMonth;
  /** The last month with a contribution; `null` = until changed. */
  readonly until: YearMonth | null;
}

/**
 * FR-G1 / FR-B6 recurring contribution as a monthly recurrence (its occurrences enter the Review queue): "Tiap tgl 25,
 * Nov 2026 – Jun 2027" → 8 occurrences from 25 Nov 2026.
 */
export function contributionRule(plan: ContributionPlan): RecurrenceRule {
  if (!Number.isInteger(plan.day) || plan.day < 1 || plan.day > MAX_MONTH_DAY) throw new InvalidGoalError('plan');
  if (plan.until !== null && plan.until < plan.from) throw new InvalidGoalError('plan');
  return {
    freq: 'monthly',
    interval: 1,
    startOn: dateInMonth(plan.from, plan.day),
    weekday: null,
    monthDay: plan.day,
    end: plan.until === null ? { type: 'never' } : { type: 'after', count: monthsBetween(plan.from, plan.until) + 1 },
  };
}
