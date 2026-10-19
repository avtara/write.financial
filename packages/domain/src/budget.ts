// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Budget arithmetic (PRD §6.8 FR-B1–B5, §7.2): % used, ideal for day N, safe daily limit, weekly budget, end-of-period
 * projection (D8), "akan lewat anggaran", alert thresholds, fixed budgets, moving leftover, rollover, the 3-month fill,
 * and the saving rate. Amounts are `bigint` minor units in the base currency; ratios are basis points (1% = 100 bps,
 * `formatPercent(bps / 10_000, …)` renders them).
 */
import { currencyInfo } from './money.ts';
import { periodProgress, type LocalDate, type Period } from './period.ts';

/** FR-B4 "Ingatkan di …": the warning thresholds a budget line offers, in percent. */
export const ALERT_PCTS = [50, 80, 85, 100] as const;
export type AlertPct = (typeof ALERT_PCTS)[number];
export const DEFAULT_ALERT_PCT: AlertPct = 85;

/** FR-D2 "Saving Rate · Target 30%". */
export const SAVING_RATE_TARGET_BPS = 3_000;

/** FR-B1 "Isi dari rata-rata 3 bulan". */
export const FILL_AVERAGE_PERIODS = 3;

export class InvalidBudgetError extends RangeError {
  override readonly name = 'InvalidBudgetError';
}

/**
 * `part ÷ whole` in basis points, rounded half up (16.500.000 / 18.750.000 → 8800). `null` when `whole` is not
 * positive (no limit, no income).
 */
export function ratioBps(part: bigint, whole: bigint): number | null {
  if (whole <= 0n) return null;
  const numerator = part * 20_000n + whole;
  const denominator = 2n * whole;
  const quotient = numerator / denominator;
  // BigInt division truncates toward zero (the remainder takes the numerator's sign); round half up means flooring.
  return Number(numerator % denominator < 0n ? quotient - 1n : quotient);
}

/** Ideal share used on day N of the period: N ÷ days (15/31 → 4839 bps, shown as 48%). */
export function idealBps(day: number, periodDays: number): number {
  return Math.round((day * 10_000) / periodDays);
}

/**
 * The step the safe daily limit is rounded down to: Rp1.000 for IDR ([Decision] PRD §7.2), one major unit
 * otherwise (US$1 = 100 cents).
 */
export function safeDailyStepMinor(currency: string): bigint {
  return currency.toUpperCase() === 'IDR' ? 1_000n : 10n ** BigInt(currencyInfo(currency).minorDigits);
}

/**
 * Safe daily limit: what is left ÷ the days left, rounded down to `stepMinor` (2.250.000 / 16 → Rp140.000). On the
 * last day (no days left) the whole remainder is today's. Never negative.
 */
export function safeDailyLimit(remainingMinor: bigint, daysLeft: number, stepMinor: bigint): bigint {
  // Less than one step left: nothing (also when over the limit).
  if (remainingMinor < stepMinor) return 0n;
  const perDay = remainingMinor / BigInt(Math.max(daysLeft, 1));
  return (perDay / stepMinor) * stepMinor;
}

/** Weekly budget: monthly limit × 7 ÷ days in the period ([Decision], replaces the 4,4 factor), rounded half up. */
export function weeklyBudget(limitMinor: bigint, periodDays: number): bigint {
  const denominator = BigInt(periodDays);
  return (2n * limitMinor * 7n + denominator) / (2n * denominator);
}

/**
 * "Akan lewat anggaran" (PRD §7.2): by how much spent + the amount being typed + the category's unpaid scheduled
 * bills exceed the limit; `0n` when they fit.
 */
export function willExceedBy(input: {
  readonly limitMinor: bigint;
  readonly spentMinor: bigint;
  readonly typedMinor: bigint;
  readonly scheduledMinor: bigint;
}): bigint {
  const excess = input.spentMinor + input.typedMinor + input.scheduledMinor - input.limitMinor;
  return excess > 0n ? excess : 0n;
}

/** Inputs of one budget line in one period. */
export interface BudgetLineInput {
  /** Limit for this period: the version's limit, prorated for a transition period, plus overrides. */
  readonly limitMinor: bigint;
  readonly spentMinor: bigint;
  /** FR-B4 "Anggaran tetap": a fixed cost, no daily rate; "lunas" once fully spent. */
  readonly isFixed: boolean;
  readonly alertPct: AlertPct;
  /** Unpaid scheduled bills of the category in the rest of the period (M3; `0n` until then). */
  readonly scheduledMinor: bigint;
}

/**
 * - `over`: spent more than the limit ("lewat Rp400.000").
 * - `paid`: a fixed budget spent exactly ("lunas").
 * - `warning`: reached the line's alert threshold (85% by default).
 * - `unused`: nothing spent yet ("belum terpakai").
 * - `ok`: anything else.
 */
export type BudgetLineState = 'over' | 'paid' | 'warning' | 'unused' | 'ok';

export interface BudgetLineStatus {
  readonly limitMinor: bigint;
  readonly spentMinor: bigint;
  /** limit − spent; negative when over. */
  readonly remainingMinor: bigint;
  /** `null` without a positive limit. */
  readonly usedBps: number | null;
  /** `null` for fixed budgets (no daily rate). */
  readonly safeDailyMinor: bigint | null;
  readonly weeklyMinor: bigint;
  /** D8 projection for the end of the period. */
  readonly projectionMinor: bigint;
  readonly state: BudgetLineState;
  /** "Akan lewat" with the scheduled bills (nothing typed). */
  readonly willExceedByMinor: bigint;
}

/** Where the period stands, shared by every line. */
export interface BudgetContext {
  readonly period: Pick<Period, 'start' | 'end' | 'days'>;
  readonly today: LocalDate;
  /** {@link safeDailyStepMinor} of the base currency. */
  readonly stepMinor: bigint;
}

function lineState(line: BudgetLineInput): BudgetLineState {
  if (line.spentMinor > line.limitMinor) return 'over';
  if (line.spentMinor === 0n) return 'unused';
  if (line.isFixed && line.spentMinor === line.limitMinor) return 'paid';
  if (line.spentMinor * 100n >= line.limitMinor * BigInt(line.alertPct)) return 'warning';
  return 'ok';
}

/**
 * D8 projection of one line: a fixed budget counts in full (or what was spent, when more); a variable one at the
 * pace so far (spent ÷ elapsed days × days in period, rounded half up); plus unpaid scheduled bills.
 */
function lineProjection(line: BudgetLineInput, elapsedDays: number, periodDays: number): bigint {
  if (line.isFixed) {
    return (line.spentMinor > line.limitMinor ? line.spentMinor : line.limitMinor) + line.scheduledMinor;
  }
  if (elapsedDays === 0) return line.spentMinor + line.scheduledMinor;
  const elapsed = BigInt(elapsedDays);
  const paced = (2n * line.spentMinor * BigInt(periodDays) + elapsed) / (2n * elapsed);
  return paced + line.scheduledMinor;
}

export function lineStatus(line: BudgetLineInput, context: BudgetContext): BudgetLineStatus {
  const { day, daysLeft } = periodProgress(context.period, context.today);
  const remainingMinor = line.limitMinor - line.spentMinor;
  return {
    limitMinor: line.limitMinor,
    spentMinor: line.spentMinor,
    remainingMinor,
    usedBps: ratioBps(line.spentMinor, line.limitMinor),
    safeDailyMinor: line.isFixed ? null : safeDailyLimit(remainingMinor, daysLeft, context.stepMinor),
    weeklyMinor: weeklyBudget(line.limitMinor, context.period.days),
    projectionMinor: lineProjection(line, day, context.period.days),
    state: lineState(line),
    willExceedByMinor: willExceedBy({ ...line, typedMinor: 0n }),
  };
}

/** "Lebih cepat dari rencana" when more is used than the ideal for today, else "sesuai rencana". */
export type BudgetPace = 'ahead' | 'on_track';

export interface BudgetTotals {
  readonly limitMinor: bigint;
  readonly spentMinor: bigint;
  readonly remainingMinor: bigint;
  readonly usedBps: number | null;
  /** Day N of the period. */
  readonly day: number;
  readonly daysLeft: number;
  readonly idealBps: number;
  readonly pace: BudgetPace;
  readonly safeDailyMinor: bigint;
  readonly projectionMinor: bigint;
  /** projection − limit when the projection exceeds it ("lewat Rp5.400.000"), else `0n`. */
  readonly projectedOverMinor: bigint;
  readonly overCount: number;
}

/** The hero numbers of the budget page from its lines (88% / 48% / Rp140.000 for 15 Okt 2026). */
export function budgetTotals(lines: readonly BudgetLineStatus[], context: BudgetContext): BudgetTotals {
  const { day, daysLeft } = periodProgress(context.period, context.today);
  const sum = (pick: (line: BudgetLineStatus) => bigint): bigint =>
    lines.reduce((total, line) => total + pick(line), 0n);
  const limitMinor = sum((line) => line.limitMinor);
  const spentMinor = sum((line) => line.spentMinor);
  const projectionMinor = sum((line) => line.projectionMinor);
  const usedBps = ratioBps(spentMinor, limitMinor);
  const ideal = idealBps(day, context.period.days);
  return {
    limitMinor,
    spentMinor,
    remainingMinor: limitMinor - spentMinor,
    usedBps,
    day,
    daysLeft,
    idealBps: ideal,
    pace: (usedBps ?? 0) > ideal ? 'ahead' : 'on_track',
    safeDailyMinor: safeDailyLimit(limitMinor - spentMinor, daysLeft, context.stepMinor),
    projectionMinor,
    projectedOverMinor: projectionMinor > limitMinor ? projectionMinor - limitMinor : 0n,
    overCount: lines.filter((line) => line.state === 'over').length,
  };
}

/** A change of one category's limit in one period (`budget_period_overrides`). */
export interface LimitDelta {
  readonly categoryId: string;
  readonly deltaMinor: bigint;
}

/** What a line offers to others: its remainder; fixed budgets offer nothing. */
export interface LeftoverLine {
  readonly categoryId: string;
  readonly remainingMinor: bigint;
  readonly isFixed: boolean;
}

/**
 * FR-B3 "Pindahkan sisa": the overrides moving `sources` into `targetCategoryId`. The total budget is unchanged
 * (the deltas sum to zero); a source gives at most its remainder.
 * @throws {InvalidBudgetError} on an unknown, fixed, duplicate, or target source, a non-positive amount, or more
 * than a source's remainder.
 */
export function moveLeftover(
  lines: readonly LeftoverLine[],
  targetCategoryId: string,
  sources: readonly { readonly categoryId: string; readonly amountMinor: bigint }[],
): LimitDelta[] {
  if (sources.length === 0) throw new InvalidBudgetError('A move needs at least one source');
  const byId = new Map(lines.map((line) => [line.categoryId, line]));
  if (!byId.has(targetCategoryId)) throw new InvalidBudgetError('The target is not in the budget');
  const seen = new Set<string>();
  let total = 0n;
  const deltas: LimitDelta[] = [];
  for (const { categoryId, amountMinor } of sources) {
    const line = byId.get(categoryId);
    if (line === undefined) throw new InvalidBudgetError('A source is not in the budget');
    if (categoryId === targetCategoryId || seen.has(categoryId)) {
      throw new InvalidBudgetError('Sources must be distinct and differ from the target');
    }
    if (line.isFixed) throw new InvalidBudgetError('A fixed budget has no leftover to move');
    if (amountMinor <= 0n || amountMinor > line.remainingMinor) {
      throw new InvalidBudgetError('A source can give a positive amount up to its remainder');
    }
    seen.add(categoryId);
    total += amountMinor;
    deltas.push({ categoryId, deltaMinor: -amountMinor });
  }
  return [{ categoryId: targetCategoryId, deltaMinor: total }, ...deltas];
}

/**
 * FR-B3 suggested sources for covering `neededMinor` in `targetCategoryId`: the largest remainders first (fixed
 * budgets and the target excluded), until the need is covered or the remainders run out.
 */
export function suggestLeftoverSources(
  lines: readonly LeftoverLine[],
  targetCategoryId: string,
  neededMinor: bigint,
): { categoryId: string; amountMinor: bigint }[] {
  const candidates = lines
    .filter((line) => line.categoryId !== targetCategoryId && !line.isFixed && line.remainingMinor > 0n)
    // Largest first; `toSorted` is stable, so equal remainders keep the budget order.
    .toSorted((a, b) => Number(b.remainingMinor - a.remainingMinor));
  const sources: { categoryId: string; amountMinor: bigint }[] = [];
  let needed = neededMinor;
  for (const line of candidates) {
    if (needed <= 0n) break;
    const amountMinor = line.remainingMinor < needed ? line.remainingMinor : needed;
    sources.push({ categoryId: line.categoryId, amountMinor });
    needed -= amountMinor;
  }
  return sources;
}

/** Period close inputs per line (FR-P4): its remainder and whether it rolls over (FR-B4). */
export interface ClosingLine {
  readonly categoryId: string;
  readonly remainingMinor: bigint;
  readonly rollover: boolean;
}

export interface CloseProposals {
  /** Next-period overrides for rollover lines with a positive remainder. */
  readonly rollovers: LimitDelta[];
  /**
   * What is left to move to savings: total limit − total spent − rolled over, at least 0 (September: Rp1.150.000,
   * the Belanja Online overspend reduces it).
   */
  readonly leftoverMinor: bigint;
}

/** FR-P4 proposals at period close; applied only after the user confirms them in the Review queue (D14). */
export function closeProposals(lines: readonly ClosingLine[]): CloseProposals {
  const rollovers = lines
    .filter((line) => line.rollover && line.remainingMinor > 0n)
    .map((line) => ({ categoryId: line.categoryId, deltaMinor: line.remainingMinor }));
  const net = lines.reduce((total, line) => total + line.remainingMinor, 0n);
  const rolled = rollovers.reduce((total, line) => total + line.deltaMinor, 0n);
  const leftoverMinor = net - rolled;
  return { rollovers, leftoverMinor: leftoverMinor > 0n ? leftoverMinor : 0n };
}

/**
 * FR-B1 "Isi dari rata-rata 3 bulan": the average spending of the given periods, rounded up to `stepMinor`.
 * `0n` without periods.
 */
export function averageSpend(perPeriodMinor: readonly bigint[], stepMinor: bigint): bigint {
  if (perPeriodMinor.length === 0) return 0n;
  const total = perPeriodMinor.reduce((sum, amount) => sum + amount, 0n);
  const divisor = BigInt(perPeriodMinor.length) * stepMinor;
  return ((total + divisor - 1n) / divisor) * stepMinor;
}

/** Saving rate = (income − expense) ÷ income (9.500.000 / 26.000.000 → 3654 bps = 36,5%); `null` without income. */
export function savingRateBps(incomeMinor: bigint, expenseMinor: bigint): number | null {
  return ratioBps(incomeMinor - expenseMinor, incomeMinor);
}
