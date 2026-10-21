// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Debts and installments (PRD §6.13 FR-U1–U6, D12): installment schedules (0% = principal ÷ tenor with the rounding
 * remainder in the first installment; flat monthly interest for cards and paylater; effective annuity for mortgages
 * and loans), the allocation of a card payment by the configurable priority, the recalculation after an early
 * partial payoff, the debt KPIs, and the impact simulation of a new debt. Amounts are `bigint` minor units; rates and
 * ratios are basis points (175 = 1,75% per month).
 */
import { SAVING_RATE_TARGET_BPS, ratioBps, savingRateBps } from './budget.ts';
import { divideCeil, divideHalfUp, splitEvenly } from './money.ts';
import { addMonths, type LocalDate } from './period.ts';

/** FR-U1 debt types; receivables live in `receivables`. */
export const DEBT_KINDS = ['card_installment', 'paylater', 'zero_percent', 'mortgage', 'personal_loan'] as const;
export type DebtKind = (typeof DEBT_KINDS)[number];

export const INTEREST_METHODS = ['flat', 'annuity'] as const;
export type InterestMethod = (typeof INTEREST_METHODS)[number];

/** D12: effective annuity for KPR/KPM and personal loans, flat for cards and paylater. */
export const DEFAULT_INTEREST_METHOD: Readonly<Record<DebtKind, InterestMethod>> = {
  card_installment: 'flat',
  paylater: 'flat',
  zero_percent: 'flat',
  mortgage: 'annuity',
  personal_loan: 'annuity',
};

/** FR-U4 after a partial payoff: "Kurangi nominal (tenor tetap)" or "Persingkat tenor". */
export const RECALC_MODES = ['reduce_amount', 'shorten_tenor'] as const;
export type RecalcMode = (typeof RECALC_MODES)[number];

/**
 * FR-U4 "Prioritas pembayaran kartu": installments (early payoff) and non-installment spending, in the user's order
 * (`user_preferences.cc_payment_priority`); an overpayment always ends up as credit balance.
 */
export const CC_PAYMENT_BUCKETS = ['installments', 'spending'] as const;
export type CcPaymentBucket = (typeof CC_PAYMENT_BUCKETS)[number];
export const DEFAULT_CC_PAYMENT_PRIORITY: readonly CcPaymentBucket[] = ['installments', 'spending'];

/** FR-U5 "batas sehat ≤ 30%" of installments ÷ income. */
export const HEALTHY_DEBT_RATIO_BPS = 3_000;

/** Longest schedule accepted (50 years of monthly installments). */
export const MAX_TENOR = 600;

const BPS = 10_000n;

export type InvalidDebtReason = 'principal' | 'tenor' | 'rate' | 'fee' | 'payment' | 'priority' | 'schedule';

export class InvalidDebtError extends RangeError {
  override readonly name = 'InvalidDebtError';
  readonly reason: InvalidDebtReason;
  constructor(reason: InvalidDebtReason) {
    super(`Invalid debt: ${reason}`);
    this.reason = reason;
  }
}

export interface ScheduleInput {
  readonly principalMinor: bigint;
  /** Number of monthly installments (cards: 3/6/12/24, `creditcard.INSTALLMENT_TENORS`). */
  readonly tenor: number;
  /** Monthly interest in bps (0 = "Cicilan 0%"). */
  readonly monthlyRateBps: number;
  /** One-off admin fee, billed with the first installment. */
  readonly adminFeeMinor: bigint;
  readonly method: InterestMethod;
  /** Due date (cards: statement date) of the first installment; the next ones follow monthly on the same day. */
  readonly firstDue: LocalDate;
}

export interface Installment {
  /** 1-based ("Cicilan MacBook Air M4 (1/12)"). */
  readonly number: number;
  readonly dueOn: LocalDate;
  readonly principalMinor: bigint;
  readonly interestMinor: bigint;
  readonly feeMinor: bigint;
  /** principal + interest + fee. */
  readonly totalMinor: bigint;
  /** Principal still owed after this installment. */
  readonly balanceAfterMinor: bigint;
}

export interface ScheduleTotals {
  readonly principalMinor: bigint;
  readonly interestMinor: bigint;
  readonly feeMinor: bigint;
  readonly totalMinor: bigint;
}

function row(
  number: number,
  dueOn: LocalDate,
  principalMinor: bigint,
  interestMinor: bigint,
  feeMinor: bigint,
  balanceAfterMinor: bigint,
): Installment {
  return {
    number,
    dueOn,
    principalMinor,
    interestMinor,
    feeMinor,
    totalMinor: principalMinor + interestMinor + feeMinor,
    balanceAfterMinor,
  };
}

/** Flat interest: every installment pays `rate` of the principal the schedule started from. */
function flatRows(
  principalMinor: bigint,
  parts: readonly bigint[],
  dues: readonly LocalDate[],
  firstNumber: number,
  rateBps: number,
  feeMinor: bigint,
): Installment[] {
  const interestMinor = divideHalfUp(principalMinor * BigInt(rateBps), BPS);
  let balance = principalMinor;
  return parts.map((part, index) => {
    balance -= part;
    return row(
      firstNumber + index,
      dues[index] as LocalDate,
      part,
      interestMinor,
      index === 0 ? feeMinor : 0n,
      balance,
    );
  });
}

/** The annuity payment that clears `principal` in `count` months at `rate` per month (both rounded half up). */
function annuityPayment(principalMinor: bigint, rateBps: number, count: number): bigint {
  const growth = (BPS + BigInt(rateBps)) ** BigInt(count);
  return divideHalfUp(principalMinor * BigInt(rateBps) * growth, BPS * (growth - BPS ** BigInt(count)));
}

/**
 * Effective-rate amortization: interest on the balance still owed, the rest of `payment` repays principal (never
 * more than is owed); the last due date clears what is left.
 */
function amortizedRows(
  principalMinor: bigint,
  paymentMinor: bigint,
  dues: readonly LocalDate[],
  firstNumber: number,
  rateBps: number,
  feeMinor: bigint,
): Installment[] {
  const rows: Installment[] = [];
  let balance = principalMinor;
  for (const [index, dueOn] of dues.entries()) {
    const interestMinor = divideHalfUp(balance * BigInt(rateBps), BPS);
    // The payment always covers the interest: it exceeds balance × rate, and the balance only shrinks.
    const due = paymentMinor - interestMinor;
    const principal = index === dues.length - 1 || due > balance ? balance : due;
    balance -= principal;
    rows.push(row(firstNumber + index, dueOn, principal, interestMinor, index === 0 ? feeMinor : 0n, balance));
  }
  return rows;
}

function checkTerms(monthlyRateBps: number, method: InterestMethod): void {
  if (!Number.isInteger(monthlyRateBps) || monthlyRateBps < 0) throw new InvalidDebtError('rate');
  if (!INTEREST_METHODS.includes(method)) throw new InvalidDebtError('rate');
}

/**
 * FR-U2/U3 installment schedule. Flat (and every 0% schedule): principal ÷ tenor with the remainder in the first
 * installment, interest = principal × rate each month. Annuity (D12): equal payments of principal + interest on the
 * remaining balance, the last one absorbing the rounding. The admin fee rides on the first installment.
 * Σ total = principal + Σ interest + admin fee.
 */
export function installmentSchedule(input: ScheduleInput): Installment[] {
  if (input.principalMinor <= 0n) throw new InvalidDebtError('principal');
  if (!Number.isInteger(input.tenor) || input.tenor < 1 || input.tenor > MAX_TENOR) {
    throw new InvalidDebtError('tenor');
  }
  checkTerms(input.monthlyRateBps, input.method);
  if (input.adminFeeMinor < 0n) throw new InvalidDebtError('fee');
  const dues = Array.from({ length: input.tenor }, (_, index) => addMonths(input.firstDue, index));
  if (input.method === 'annuity' && input.monthlyRateBps > 0) {
    const payment = annuityPayment(input.principalMinor, input.monthlyRateBps, input.tenor);
    return amortizedRows(input.principalMinor, payment, dues, 1, input.monthlyRateBps, input.adminFeeMinor);
  }
  const parts = splitEvenly(input.principalMinor, input.tenor);
  return flatRows(input.principalMinor, parts, dues, 1, input.monthlyRateBps, input.adminFeeMinor);
}

/** Σ principal / interest / fees / total of installments. */
export function scheduleTotals(installments: readonly Installment[]): ScheduleTotals {
  let principalMinor = 0n;
  let interestMinor = 0n;
  let feeMinor = 0n;
  for (const installment of installments) {
    principalMinor += installment.principalMinor;
    interestMinor += installment.interestMinor;
    feeMinor += installment.feeMinor;
  }
  return { principalMinor, interestMinor, feeMinor, totalMinor: principalMinor + interestMinor + feeMinor };
}

/** "Cicilan per bulan": the largest principal + interest of the schedule (one-off fees aside). */
export function monthlyInstallment(installments: readonly Installment[]): bigint {
  let largest = 0n;
  for (const installment of installments) {
    const regular = installment.principalMinor + installment.interestMinor;
    if (regular > largest) largest = regular;
  }
  return largest;
}

export interface PayoffInput {
  /** The installments not billed yet, in order (their principal is what an early payoff reduces). */
  readonly remaining: readonly Installment[];
  /** Early payoff applied to their principal (FR-U4 priority 1). */
  readonly paidMinor: bigint;
  readonly mode: RecalcMode;
  readonly monthlyRateBps: number;
  readonly method: InterestMethod;
}

/**
 * FR-U4 recalculation after an early partial payoff, on the same due dates. "Kurangi nominal": the rest over as many
 * installments as were left (A7ttc: Rp3.000.000 in 3×, Rp2.000.000 paid → 333.334 / 333.333 / 333.333).
 * "Persingkat tenor": installments keep the largest remaining principal and the last one takes what is left
 * (→ 1× Rp1.000.000); annuities keep their payment. Interest restarts on the remaining principal. `[]` when paid off.
 */
export function recalculateAfterPayoff(input: PayoffInput): Installment[] {
  const [first] = input.remaining;
  if (first === undefined) throw new InvalidDebtError('schedule');
  checkTerms(input.monthlyRateBps, input.method);
  const { principalMinor } = scheduleTotals(input.remaining);
  if (input.paidMinor <= 0n || input.paidMinor > principalMinor) throw new InvalidDebtError('payment');
  const rest = principalMinor - input.paidMinor;
  if (rest === 0n) return [];
  const dues = input.remaining.map((installment) => installment.dueOn);
  const rate = input.monthlyRateBps;
  if (input.method === 'annuity' && rate > 0) {
    if (input.mode === 'reduce_amount') {
      return amortizedRows(rest, annuityPayment(rest, rate, dues.length), dues, first.number, rate, 0n);
    }
    const rows = amortizedRows(rest, monthlyInstallment(input.remaining), dues, first.number, rate, 0n);
    return rows.slice(0, rows.findIndex((row) => row.balanceAfterMinor === 0n) + 1);
  }
  if (input.mode === 'reduce_amount')
    return flatRows(rest, splitEvenly(rest, dues.length), dues, first.number, rate, 0n);
  // The largest principal is positive whenever the rest is, and `count` never exceeds the remaining due dates.
  const regular = input.remaining.reduce(
    (largest, installment) => (installment.principalMinor > largest ? installment.principalMinor : largest),
    0n,
  );
  const count = Number(divideCeil(rest, regular));
  const parts = Array.from({ length: count }, (_, index) =>
    index === count - 1 ? rest - regular * BigInt(count - 1) : regular,
  );
  return flatRows(rest, parts, dues, first.number, rate, 0n);
}

export interface CardInstallmentDue {
  readonly id: string;
  /** Principal not billed yet. */
  readonly remainingMinor: bigint;
}

export interface CardPaymentDue {
  /** Installments in payoff order (oldest first). */
  readonly installments: readonly CardInstallmentDue[];
  /** Outstanding non-installment spending ("tagihan berjalan" and printed bills). */
  readonly spendingMinor: bigint;
}

export interface CardPaymentAllocation {
  /** Early payoff per installment (only those that receive something). */
  readonly installments: readonly { readonly id: string; readonly paidMinor: bigint }[];
  readonly spendingMinor: bigint;
  /** "Lebih bayar · jadi saldo kredit". */
  readonly creditMinor: bigint;
}

/**
 * FR-U4 allocation of a payment (transfer) to a card by priority; `[]` (the stored default) = the default order.
 * qrRRV: Rp2.000.000 with installment A Rp3.000.000 and bill B Rp1.000.000 → A 2.000.000, B 0, credit 0.
 */
export function allocateCardPayment(
  amountMinor: bigint,
  due: CardPaymentDue,
  priority: readonly CcPaymentBucket[] = DEFAULT_CC_PAYMENT_PRIORITY,
): CardPaymentAllocation {
  if (amountMinor <= 0n) throw new InvalidDebtError('payment');
  if (due.spendingMinor < 0n || due.installments.some((installment) => installment.remainingMinor < 0n)) {
    throw new InvalidDebtError('payment');
  }
  const order = priority.length === 0 ? DEFAULT_CC_PAYMENT_PRIORITY : priority;
  if (order.length !== CC_PAYMENT_BUCKETS.length || CC_PAYMENT_BUCKETS.some((bucket) => !order.includes(bucket))) {
    throw new InvalidDebtError('priority');
  }
  let left = amountMinor;
  const take = (owed: bigint): bigint => {
    const paid = owed < left ? owed : left;
    left -= paid;
    return paid;
  };
  const installments: { id: string; paidMinor: bigint }[] = [];
  let spendingMinor = 0n;
  for (const bucket of order) {
    if (bucket === 'spending') {
      spendingMinor = take(due.spendingMinor);
      continue;
    }
    for (const installment of due.installments) {
      const paidMinor = take(installment.remainingMinor);
      if (paidMinor > 0n) installments.push({ id: installment.id, paidMinor });
    }
  }
  return { installments, spendingMinor, creditMinor: left };
}

export interface ScheduledInstallment extends Installment {
  readonly paid: boolean;
}

export interface DebtSummary {
  /** "Sisa utang": Σ principal of unpaid installments. */
  readonly remainingMinor: bigint;
  /** "Harus dibayar": Σ total of unpaid installments due in `today`'s month or earlier. */
  readonly dueMinor: bigint;
  /** "Jatuh tempo terdekat": the earliest unpaid due date; `null` when everything is paid. */
  readonly nextDue: LocalDate | null;
}

/** FR-U1 KPIs over the installments of all debts. */
export function debtSummary(installments: readonly ScheduledInstallment[], today: LocalDate): DebtSummary {
  const month = today.slice(0, 7);
  let remainingMinor = 0n;
  let dueMinor = 0n;
  let nextDue: LocalDate | null = null;
  for (const installment of installments) {
    if (installment.paid) continue;
    remainingMinor += installment.principalMinor;
    if (installment.dueOn.slice(0, 7) <= month) dueMinor += installment.totalMinor;
    if (nextDue === null || installment.dueOn < nextDue) nextDue = installment.dueOn;
  }
  return { remainingMinor, dueMinor, nextDue };
}

export interface DebtImpactInput {
  /** The schedule of the debt being added. */
  readonly schedule: readonly Installment[];
  /** Monthly income and spending of the reference month ("pola Oktober": 26.000.000 / 16.500.000). */
  readonly incomeMinor: bigint;
  readonly expenseMinor: bigint;
  /** Installments of existing debts per month. */
  readonly existingMonthlyMinor: bigint;
  readonly netWorthMinor: bigint;
}

export interface DebtImpact {
  /** {@link monthlyInstallment} of the new schedule. */
  readonly monthlyMinor: bigint;
  /** "Rasio cicilan / pemasukan": (existing + new) ÷ income; `null` without income. */
  readonly ratioBps: number | null;
  /** ratio ≤ 30%; `null` without income. */
  readonly healthy: boolean | null;
  readonly savingRateBeforeBps: number | null;
  /** Saving rate with the new installment counted as spending. */
  readonly savingRateAfterBps: number | null;
  /** after − the 30% target ("sisa ruang 0,4 poin"); negative below the target. */
  readonly headroomBps: number | null;
  /** Net worth once the debt is recorded: the item bought is not an asset, so it drops by the principal. */
  readonly netWorthAfterMinor: bigint;
}

/**
 * FR-U5 impact simulation (v3Igd, MacBook Air M4 Rp18.999.000 in 12× 0%): Rp1.583.250 per month, 6,1% of
 * Rp26.000.000, saving rate 36,5% → 30,4%, net worth Rp116.443.000 → Rp97.444.000.
 */
export function debtImpact(input: DebtImpactInput): DebtImpact {
  const monthlyMinor = monthlyInstallment(input.schedule);
  const ratio = ratioBps(input.existingMonthlyMinor + monthlyMinor, input.incomeMinor);
  const after = savingRateBps(input.incomeMinor, input.expenseMinor + monthlyMinor);
  return {
    monthlyMinor,
    ratioBps: ratio,
    healthy: ratio === null ? null : ratio <= HEALTHY_DEBT_RATIO_BPS,
    savingRateBeforeBps: savingRateBps(input.incomeMinor, input.expenseMinor),
    savingRateAfterBps: after,
    headroomBps: after === null ? null : after - SAVING_RATE_TARGET_BPS,
    netWorthAfterMinor: input.netWorthMinor - scheduleTotals(input.schedule).principalMinor,
  };
}
