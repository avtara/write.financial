// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Receivables (PRD §6.13 FR-U7) and split bills (§6.4 FR-L5): splitting a bill equally, by amount, by percent, or per
 * item with exact-sum rounding (other people's shares become receivables); remaining, progress and status of a
 * receivable with Σ payments ≤ principal; receiving a payment; write-off; due-date presets and the outstanding total
 * that counts toward net worth (not the available balance). Lending is a transfer to the receivable and a payment an
 * incoming transfer, so neither is spending or income. Amounts are `bigint` minor units; ratios are basis points.
 */
import { divideHalfUp, splitEvenly } from './money.ts';
import { addDays, dateInMonth, type LocalDate, type YearMonth } from './period.ts';
import { splitRemainder } from './transactions.ts';

export const RECEIVABLE_SOURCES = ['split_bill', 'loan'] as const;
export type ReceivableSource = (typeof RECEIVABLE_SOURCES)[number];

export const RECEIVABLE_STATUSES = ['open', 'partial', 'settled', 'written_off'] as const;
export type ReceivableStatus = (typeof RECEIVABLE_STATUSES)[number];

/** FR-L5 "Cara bagi": Sama rata / Nominal / Persen / Per item. */
export const SPLIT_METHODS = ['equal', 'amount', 'percent', 'item'] as const;
export type SplitMethod = (typeof SPLIT_METHODS)[number];

/** FR-U7 "Jatuh tempo": 1 week, 2 weeks, end of month, no deadline. */
export const DUE_PRESETS = ['one_week', 'two_weeks', 'end_of_month', 'none'] as const;
export type DuePreset = (typeof DUE_PRESETS)[number];

/** FR-U7 reminder to the user 1 day before the due date. */
export const RECEIVABLE_REMIND_DAYS_BEFORE = 1;

/** FR-U7 paid history window ("90 hari terakhir"). */
export const PAID_HISTORY_DAYS = 90;

const BPS = 10_000n;
const DAYS_PER_WEEK = 7;

export type InvalidReceivableReason = 'principal' | 'payment' | 'overpaid' | 'closed' | 'split';

export class InvalidReceivableError extends RangeError {
  override readonly name = 'InvalidReceivableError';
  readonly reason: InvalidReceivableReason;
  constructor(reason: InvalidReceivableReason) {
    super(`Invalid receivable: ${reason}`);
    this.reason = reason;
  }
}

export interface ReceivableInput {
  readonly principalMinor: bigint;
  /** Amounts received so far (`receivable_payments`). */
  readonly paymentsMinor: readonly bigint[];
  readonly writtenOff: boolean;
}

export interface ReceivableState {
  readonly paidMinor: bigint;
  /** "Sisa": principal − Σ payments; `0n` once written off. */
  readonly remainingMinor: bigint;
  /** Σ payments ÷ principal (Raka 300.000 / 400.000 → 7500 = 75%). */
  readonly progressBps: number;
  readonly status: ReceivableStatus;
}

/** Where a receivable stands; refuses payments that are not positive or add up to more than the principal. */
export function receivableState(input: ReceivableInput): ReceivableState {
  if (input.principalMinor <= 0n) throw new InvalidReceivableError('principal');
  let paidMinor = 0n;
  for (const payment of input.paymentsMinor) {
    if (payment <= 0n) throw new InvalidReceivableError('payment');
    paidMinor += payment;
  }
  if (paidMinor > input.principalMinor) throw new InvalidReceivableError('overpaid');
  const open = input.principalMinor - paidMinor;
  const status: ReceivableStatus = input.writtenOff
    ? 'written_off'
    : open === 0n
      ? 'settled'
      : paidMinor === 0n
        ? 'open'
        : 'partial';
  return {
    paidMinor,
    remainingMinor: input.writtenOff ? 0n : open,
    progressBps: Number(divideHalfUp(paidMinor * BPS, input.principalMinor)),
    status,
  };
}

/**
 * FR-U7 "Terima pembayaran": the state after receiving `amountMinor` (positive, at most what remains; "Lunas" chip =
 * all of it). Raka 400.000 with 100.000 paid, receives 200.000 → remaining 100.000 (75%).
 */
export function receivePayment(input: ReceivableInput, amountMinor: bigint): ReceivableState {
  const { status } = receivableState(input);
  if (status === 'settled' || status === 'written_off') throw new InvalidReceivableError('closed');
  return receivableState({ ...input, paymentsMinor: [...input.paymentsMinor, amountMinor] });
}

/**
 * FR-U7 "Hapuskan": the amount recorded, after confirmation, as an expense in `categories.BAD_DEBT_CATEGORY` — what
 * is still open. Net worth drops by it; the receivable becomes `written_off`.
 */
export function writeOffAmount(input: ReceivableInput): bigint {
  const state = receivableState(input);
  if (state.status === 'settled' || state.status === 'written_off') throw new InvalidReceivableError('closed');
  return state.remainingMinor;
}

/** Σ remaining of receivables neither settled nor written off (`ledger.netWorth` `receivablesOutstanding`). */
export function receivablesOutstanding(receivables: readonly ReceivableInput[]): bigint {
  return receivables.reduce((total, receivable) => total + receivableState(receivable).remainingMinor, 0n);
}

/** FR-U7 due-date presets from `today`: +7 / +14 days, the month's last day, or none. */
export function dueDateFor(preset: DuePreset, today: LocalDate): LocalDate | null {
  if (preset === 'none') return null;
  if (preset === 'end_of_month') return dateInMonth(today.slice(0, 7) as YearMonth, 31);
  return addDays(today, preset === 'one_week' ? DAYS_PER_WEEK : 2 * DAYS_PER_WEEK);
}

export interface SplitItem {
  readonly amountMinor: bigint;
  /** Indexes of the people sharing the item equally (the first listed gets the rounding remainder). */
  readonly people: readonly number[];
}

export type SplitInput =
  | { readonly method: 'equal'; readonly people: number }
  | { readonly method: 'amount'; readonly amountsMinor: readonly bigint[] }
  /** Basis points per person, Σ = 10 000. */
  | { readonly method: 'percent'; readonly bps: readonly number[] }
  /** Items per person; the difference to the total (tax, service, discount) is shared in proportion to them. */
  | { readonly method: 'item'; readonly people: number; readonly items: readonly SplitItem[] };

/**
 * `total` in proportion to `weights` (largest remainder: floors first, the leftover units go to the largest
 * fractional parts, earlier people first on ties). Σ = total exactly.
 */
function proportional(totalMinor: bigint, weights: readonly bigint[]): bigint[] {
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0n);
  if (weightTotal <= 0n) throw new InvalidReceivableError('split');
  const shares = weights.map((weight) => (totalMinor * weight) / weightTotal);
  const order = weights
    .map((weight, index) => ({ index, fraction: (totalMinor * weight) % weightTotal }))
    .sort((a, b) => (a.fraction === b.fraction ? a.index - b.index : a.fraction > b.fraction ? -1 : 1));
  let leftover = Number(splitRemainder(totalMinor, shares));
  for (const { index } of order) {
    if (leftover === 0) break;
    shares[index] = (shares[index] as bigint) + 1n;
    leftover -= 1;
  }
  return shares;
}

function checkPeople(people: number): void {
  if (!Number.isInteger(people) || people < 2) throw new InvalidReceivableError('split');
}

/**
 * FR-L5 "Pisah tagihan": each person's share of `totalMinor` (the payer usually first), adding up exactly to the total
 * ("Total cocok"). Equal: the rounding remainder goes to the first person (CGV 485.000 / 2 → 242.500 + 242.500).
 */
export function splitBill(totalMinor: bigint, input: SplitInput): bigint[] {
  if (totalMinor <= 0n) throw new InvalidReceivableError('split');
  switch (input.method) {
    case 'equal': {
      checkPeople(input.people);
      return splitEvenly(totalMinor, input.people);
    }
    case 'amount': {
      checkPeople(input.amountsMinor.length);
      if (input.amountsMinor.some((amount) => amount < 0n) || splitRemainder(totalMinor, input.amountsMinor) !== 0n) {
        throw new InvalidReceivableError('split');
      }
      return [...input.amountsMinor];
    }
    case 'percent': {
      checkPeople(input.bps.length);
      if (
        input.bps.some((bps) => !Number.isInteger(bps) || bps < 0) ||
        input.bps.reduce((sum, bps) => sum + bps, 0) !== Number(BPS)
      ) {
        throw new InvalidReceivableError('split');
      }
      return proportional(
        totalMinor,
        input.bps.map((bps) => BigInt(bps)),
      );
    }
    case 'item': {
      checkPeople(input.people);
      const subtotals = Array.from({ length: input.people }, () => 0n);
      for (const item of input.items) {
        const sharing = new Set(item.people);
        if (
          item.amountMinor < 0n ||
          sharing.size === 0 ||
          sharing.size !== item.people.length ||
          item.people.some((person) => !Number.isInteger(person) || person < 0 || person >= input.people)
        ) {
          throw new InvalidReceivableError('split');
        }
        const parts = splitEvenly(item.amountMinor, item.people.length);
        for (const [index, person] of item.people.entries()) {
          subtotals[person] = (subtotals[person] as bigint) + (parts[index] as bigint);
        }
      }
      return proportional(totalMinor, subtotals);
    }
  }
}
