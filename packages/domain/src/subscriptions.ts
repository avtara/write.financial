// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Subscriptions (FR-SUB1–SUB6): billing schedules, totals, pause/cancel plans, savings, price increases, the
 * "Bisa dihemat" card and detection of recurring charges from transactions. Amounts are bigint minor units.
 */
import { addDays, type LocalDate } from './period.ts';
import { nextOccurrences, type IsoWeekday, type RecurrenceRule } from './recurrence.ts';

export const SUBSCRIPTION_CYCLES = ['weekly', 'monthly', 'yearly'] as const;
export type SubscriptionCycle = (typeof SUBSCRIPTION_CYCLES)[number];

export const SUBSCRIPTION_STATUSES = ['active', 'paused', 'cancelled'] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const CANCEL_MODES = ['after_next_bill', 'now'] as const;
export type CancelMode = (typeof CANCEL_MODES)[number];

export const USAGE_RATINGS = ['often', 'sometimes', 'rarely'] as const;
export type UsageRating = (typeof USAGE_RATINGS)[number];

/** Bill (scheduled occurrence) states, mirroring `scheduled_occurrences.status`. */
export type BillStatus = 'scheduled' | 'due_review' | 'unconfirmed' | 'confirmed' | 'skipped';

/** Rounding step of the "≈" yearly figures (Rp10.000). */
export const APPROX_STEP_MINOR = 10_000n;
/** Default "Ingatkan N hari sebelum aktif lagi" for a pause (FR-SUB3). */
export const PAUSE_REMIND_DAYS = 3;
/** Detection needs at least this many charges (FR-SUB4). */
export const DETECTION_MIN_CHARGES = 3;
/** Detection needs at least this many months of data (FR-SUB4). */
export const DETECTION_MIN_MONTHS = 2;
/** Charges count as "the same date" within ± this many days of month. */
export const DETECTION_DAY_TOLERANCE = 3;
/** Charges count as "the same price" within ± this percentage. */
export const DETECTION_AMOUNT_TOLERANCE_PERCENT = 20n;

export type InvalidSubscriptionReason = 'trial' | 'pause';

export class InvalidSubscriptionError extends RangeError {
  override readonly name = 'InvalidSubscriptionError';
  readonly reason: InvalidSubscriptionReason;
  constructor(reason: InvalidSubscriptionReason) {
    super(`Invalid subscription: ${reason}`);
    this.reason = reason;
  }
}

export interface PricedSubscription {
  readonly priceMinor: bigint;
  readonly cycle: SubscriptionCycle;
}

export interface SubscriptionTotals {
  /** Monthly-cycle prices + weekly × 52 / 12 (yearly cycles are not spread over months). */
  readonly monthlyMinor: bigint;
  /** Monthly × 12 + weekly × 52 + yearly. */
  readonly yearlyMinor: bigint;
  /** `yearlyMinor` rounded half-up to `APPROX_STEP_MINOR` (the "≈" figure). */
  readonly approxYearlyMinor: bigint;
}

export interface Bill {
  readonly dueDate: LocalDate;
  readonly amountMinor: bigint;
  readonly status: BillStatus;
}

export interface RemainingBills {
  readonly totalMinor: bigint;
  readonly count: number;
  readonly firstDue: LocalDate | null;
  readonly lastDue: LocalDate | null;
}

export interface SkippedBills {
  readonly count: number;
  readonly savedMinor: bigint;
}

export interface CancelledSubscription extends PricedSubscription {
  readonly endsOn: LocalDate;
}

export interface CancelledSavings {
  readonly totalMinor: bigint;
  /** Per input subscription, same order. */
  readonly items: readonly SkippedBills[];
}

export type TrialLength = { readonly days: number } | { readonly months: number } | { readonly until: LocalDate };

export interface TrialPlan {
  /** Last free day. */
  readonly trialEndsOn: LocalDate;
  /** First bill = start + trial length (FR-SUB1). */
  readonly firstBillOn: LocalDate;
}

export type PauseLength = { readonly months: 1 | 2 } | { readonly until: LocalDate };

export interface PausePlan {
  /** The resume date ("aktif lagi"); its bill is charged again. */
  readonly pausedUntil: LocalDate;
  readonly skippedCount: number;
  readonly savedMinor: bigint;
  /** Reminder before resuming, or `null` without one. */
  readonly remindOn: LocalDate | null;
}

export interface CancelPlan {
  readonly endsOn: LocalDate;
  /** `after_next_bill`: the next bill still goes to review; `now`: it is removed from the schedule. */
  readonly keepsNextBill: boolean;
}

export interface SubscriptionState {
  readonly status: SubscriptionStatus;
  readonly pausedUntil: LocalDate | null;
  readonly endsOn: LocalDate | null;
  readonly cancelMode: CancelMode | null;
}

export interface Charge {
  readonly date: LocalDate;
  readonly amountMinor: bigint;
}

export interface PriceIncrease {
  readonly previousMinor: bigint;
  readonly currentMinor: bigint;
  readonly increaseMinor: bigint;
  /** Increase relative to the previous price in basis points, half-up (299.000 → 329.000 = 1003). */
  readonly increaseBps: number;
  /** Date of the first charge at the new price. */
  readonly since: LocalDate;
}

export interface RatedSubscription extends PricedSubscription {
  readonly usageRating: UsageRating | null;
}

export interface SavingSuggestion<T> {
  readonly subscription: T;
  readonly yearlyMinor: bigint;
}

export interface DetectionTransaction {
  readonly merchant: string;
  readonly localDate: LocalDate;
  /** Outflow amount (positive). */
  readonly amountMinor: bigint;
  readonly currency: string;
  readonly accountId: string;
  readonly categoryId: string | null;
}

export interface DetectedSubscription {
  readonly merchantKey: string;
  /** Merchant name as written on the latest charge. */
  readonly merchant: string;
  /** Day of month of the latest charge. */
  readonly dayOfMonth: number;
  /** Amount of the latest charge. */
  readonly amountMinor: bigint;
  readonly currency: string;
  /** Matching charges (one per month). */
  readonly occurrences: number;
  readonly lastSeenOn: LocalDate;
  readonly accountId: string;
  readonly categoryId: string | null;
}

export interface DetectionImpact {
  readonly totalMinor: bigint;
  readonly addedMinor: bigint;
}

const WEEKS_PER_YEAR = 52n;
const MONTHS_PER_YEAR = 12n;
const BPS = 10_000n;
const PERCENT = 100n;

function dayOfMonth(date: LocalDate): number {
  return Number(date.slice(8, 10));
}

/**
 * `date` shifted by whole calendar months, the day clamped to the target month's end (31 Jan + 1 → 28/29 Feb).
 */
function addMonths(date: LocalDate, months: number): LocalDate {
  const target = new Date(0);
  target.setUTCFullYear(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1 + months, 1);
  const last = new Date(0);
  last.setUTCFullYear(target.getUTCFullYear(), target.getUTCMonth() + 1, 0);
  return addDays(
    `${String(target.getUTCFullYear()).padStart(4, '0')}-${String(target.getUTCMonth() + 1).padStart(2, '0')}-01` as LocalDate,
    Math.min(dayOfMonth(date), last.getUTCDate()) - 1,
  );
}

/** Yearly cost of one subscription: monthly × 12, weekly × 52, yearly × 1. */
function yearlyMinorOf(subscription: PricedSubscription): bigint {
  if (subscription.cycle === 'weekly') return subscription.priceMinor * WEEKS_PER_YEAR;
  if (subscription.cycle === 'monthly') return subscription.priceMinor * MONTHS_PER_YEAR;
  return subscription.priceMinor;
}

/** Non-negative `numerator / denominator` rounded half-up. */
function divideHalfUp(numerator: bigint, denominator: bigint): bigint {
  return (numerator * 2n + denominator) / (denominator * 2n);
}

/** The billing rule of a subscription whose bill falls on `anchor` (weekday / day of month / date of year). */
export function cycleRule(anchor: LocalDate, cycle: SubscriptionCycle): RecurrenceRule {
  return {
    freq: cycle,
    interval: 1,
    startOn: anchor,
    weekday: cycle === 'weekly' ? ((((new Date(`${anchor}T00:00:00Z`).getUTCDay() + 6) % 7) + 1) as IsoWeekday) : null,
    monthDay: cycle === 'monthly' ? dayOfMonth(anchor) : null,
    end: { type: 'never' },
  };
}

/** `minor` rounded half-up to `APPROX_STEP_MINOR` (Netflix 2.232.000/yr → ≈ 2.230.000). */
export function approxMinor(minor: bigint): bigint {
  return divideHalfUp(minor, APPROX_STEP_MINOR) * APPROX_STEP_MINOR;
}

/** KPIs "Per bulan" / "Per tahun" of the given (active) subscriptions, in one currency. */
export function subscriptionTotals(subscriptions: readonly PricedSubscription[]): SubscriptionTotals {
  let monthly = 0n;
  let weekly = 0n;
  let yearlyMinor = 0n;
  for (const subscription of subscriptions) {
    if (subscription.cycle === 'monthly') monthly += subscription.priceMinor;
    if (subscription.cycle === 'weekly') weekly += subscription.priceMinor;
    yearlyMinor += yearlyMinorOf(subscription);
  }
  return {
    monthlyMinor: monthly + divideHalfUp(weekly * WEEKS_PER_YEAR, MONTHS_PER_YEAR),
    yearlyMinor,
    approxYearlyMinor: approxMinor(yearlyMinor),
  };
}

/** "Sisa tagihan" of today's calendar month: unpaid bills due today or later this month. */
export function remainingInMonth(bills: readonly Bill[], today: LocalDate): RemainingBills {
  const month = today.slice(0, 7);
  let totalMinor = 0n;
  let count = 0;
  let firstDue: LocalDate | null = null;
  let lastDue: LocalDate | null = null;
  for (const bill of bills) {
    const unpaid = bill.status !== 'confirmed' && bill.status !== 'skipped';
    if (!unpaid || bill.dueDate < today || bill.dueDate.slice(0, 7) !== month) continue;
    totalMinor += bill.amountMinor;
    count += 1;
    if (firstDue === null || bill.dueDate < firstDue) firstDue = bill.dueDate;
    if (lastDue === null || bill.dueDate > lastDue) lastDue = bill.dueDate;
  }
  return { totalMinor, count, firstDue, lastDue };
}

/** Bills not paid between `firstSkipped` and `today` (inclusive) of a cancelled or paused subscription. */
export function skippedBills(
  priceMinor: bigint,
  cycle: SubscriptionCycle,
  firstSkipped: LocalDate,
  today: LocalDate,
): SkippedBills {
  const count = nextOccurrences(cycleRule(firstSkipped, cycle), { from: firstSkipped, until: today }).length;
  return { count, savedMinor: priceMinor * BigInt(count) };
}

/** "Total dihemat" of cancelled subscriptions: bills from the day after `endsOn` through `today`. */
export function cancelledSavings(subscriptions: readonly CancelledSubscription[], today: LocalDate): CancelledSavings {
  const items = subscriptions.map((subscription) =>
    skippedBills(subscription.priceMinor, subscription.cycle, addDays(subscription.endsOn, 1), today),
  );
  return { totalMinor: items.reduce((sum, item) => sum + item.savedMinor, 0n), items };
}

/** Free trial from `startedOn`: the first bill is start + length; the trial ends the day before. */
export function trialFirstBill(startedOn: LocalDate, trial: TrialLength): TrialPlan {
  let firstBillOn: LocalDate;
  if ('until' in trial) {
    if (trial.until < startedOn) throw new InvalidSubscriptionError('trial');
    firstBillOn = addDays(trial.until, 1);
  } else {
    const length = 'days' in trial ? trial.days : trial.months;
    if (!Number.isInteger(length) || length < 1) throw new InvalidSubscriptionError('trial');
    firstBillOn = 'days' in trial ? addDays(startedOn, length) : addMonths(startedOn, length);
  }
  return { trialEndsOn: addDays(firstBillOn, -1), firstBillOn };
}

/**
 * Pausing from the next bill: bills before the resume date are skipped (1 month on Netflix 18 Okt → aktif lagi
 * 18 Nov, −186.000, reminder 15 Nov). `remindDays` null = no reminder.
 */
export function pausePlan(
  nextBill: LocalDate,
  cycle: SubscriptionCycle,
  priceMinor: bigint,
  length: PauseLength,
  remindDays: number | null = PAUSE_REMIND_DAYS,
): PausePlan {
  const pausedUntil = 'until' in length ? length.until : addMonths(nextBill, length.months);
  if (pausedUntil <= nextBill) throw new InvalidSubscriptionError('pause');
  const skipped = skippedBills(priceMinor, cycle, nextBill, addDays(pausedUntil, -1));
  return {
    pausedUntil,
    skippedCount: skipped.count,
    savedMinor: skipped.savedMinor,
    remindOn: remindDays === null ? null : addDays(pausedUntil, -remindDays),
  };
}

/** Cancel after the next bill (it still goes to review) or now (today; the next bill is dropped). */
export function cancelPlan(nextBill: LocalDate, mode: CancelMode, today: LocalDate): CancelPlan {
  return mode === 'now' ? { endsOn: today, keepsNextBill: false } : { endsOn: nextBill, keepsNextBill: true };
}

/**
 * Status on `today`: cancelled after `endsOn` (from `endsOn` itself when cancelled `now`), paused while
 * `pausedUntil > today`; without dates the stored status applies.
 */
export function effectiveStatus(subscription: SubscriptionState, today: LocalDate): SubscriptionStatus {
  const { endsOn, pausedUntil } = subscription;
  const ended =
    endsOn === null
      ? subscription.status === 'cancelled'
      : endsOn < today || (endsOn === today && subscription.cancelMode === 'now');
  if (ended) return 'cancelled';
  const paused = pausedUntil === null ? subscription.status === 'paused' : pausedUntil > today;
  return paused ? 'paused' : 'active';
}

/** Latest charge vs the one before it; `null` unless the price went up (FR-SUB3). */
export function priceIncrease(charges: readonly Charge[]): PriceIncrease | null {
  const sorted = charges.toSorted((a, b) => a.date.localeCompare(b.date));
  const current = sorted.at(-1);
  const previous = sorted.at(-2);
  if (current === undefined || previous === undefined || current.amountMinor <= previous.amountMinor) return null;
  const increaseMinor = current.amountMinor - previous.amountMinor;
  return {
    previousMinor: previous.amountMinor,
    currentMinor: current.amountMinor,
    increaseMinor,
    increaseBps: Number(divideHalfUp(increaseMinor * BPS, previous.amountMinor)),
    since: current.date,
  };
}

/** "Bisa dihemat" (FR-SUB5): subscriptions rated rarely used, with their yearly cost. */
export function couldSave<T extends RatedSubscription>(subscriptions: readonly T[]): SavingSuggestion<T>[] {
  return subscriptions
    .filter((subscription) => subscription.usageRating === 'rarely')
    .map((subscription) => ({ subscription, yearlyMinor: yearlyMinorOf(subscription) }));
}

/** Normalized merchant for matching: lowercase, accents and punctuation removed, single spaces. */
export function merchantKey(merchant: string): string {
  return merchant
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** The charges of one merchant that repeat the latest charge: one per month, similar day and amount. */
function matchingMonths(charges: readonly DetectionTransaction[], latest: DetectionTransaction): number {
  const months = new Set<string>();
  for (const charge of charges) {
    const similarDay = Math.abs(dayOfMonth(charge.localDate) - dayOfMonth(latest.localDate)) <= DETECTION_DAY_TOLERANCE;
    const difference = charge.amountMinor - latest.amountMinor;
    const similarAmount =
      (difference < 0n ? -difference : difference) * PERCENT <= latest.amountMinor * DETECTION_AMOUNT_TOLERANCE_PERCENT;
    if (similarDay && similarAmount && charge.currency === latest.currency) months.add(charge.localDate.slice(0, 7));
  }
  return months.size;
}

/**
 * Recurring charges that look like untracked subscriptions (FR-SUB4): only once the data spans
 * `DETECTION_MIN_MONTHS` months; merchants not in `known` with ≥ 3 charges in distinct months on a similar day
 * (± 3) and amount (± 20 %) as the latest charge. Sorted by latest charge, newest first.
 */
export function detectSubscriptions(
  transactions: readonly DetectionTransaction[],
  options: { readonly today: LocalDate; readonly known: ReadonlySet<string> },
): DetectedSubscription[] {
  const sorted = transactions
    .filter((transaction) => transaction.amountMinor > 0n)
    .toSorted((a, b) => b.localDate.localeCompare(a.localDate));
  const earliest = sorted.at(-1);
  if (earliest === undefined || earliest.localDate > addMonths(options.today, -DETECTION_MIN_MONTHS)) return [];
  const byMerchant = new Map<string, [DetectionTransaction, ...DetectionTransaction[]]>();
  for (const transaction of sorted) {
    const key = merchantKey(transaction.merchant);
    if (key === '' || options.known.has(key)) continue;
    const group = byMerchant.get(key);
    if (group === undefined) byMerchant.set(key, [transaction]);
    else group.push(transaction);
  }
  const detected: DetectedSubscription[] = [];
  for (const [key, charges] of byMerchant) {
    const latest = charges[0];
    const occurrences = matchingMonths(charges, latest);
    if (occurrences < DETECTION_MIN_CHARGES) continue;
    detected.push({
      merchantKey: key,
      merchant: latest.merchant,
      dayOfMonth: dayOfMonth(latest.localDate),
      amountMinor: latest.amountMinor,
      currency: latest.currency,
      occurrences,
      lastSeenOn: latest.localDate,
      accountId: latest.accountId,
      categoryId: latest.categoryId,
    });
  }
  return detected;
}

/** "Jika ditambahkan: Rp970.800/bulan (+Rp65.900)": monthly total after adding the candidates. */
export function detectionImpact(
  monthlyMinor: bigint,
  candidates: readonly Pick<DetectedSubscription, 'amountMinor'>[],
): DetectionImpact {
  const addedMinor = candidates.reduce((sum, candidate) => sum + candidate.amountMinor, 0n);
  return { totalMinor: monthlyMinor + addedMinor, addedMinor };
}
