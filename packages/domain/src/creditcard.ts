// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Credit cards (PRD §6.13 FR-R7, FR-U2): the billing cycle (statement day + 1 → statement day), the due date and its
 * H-3 reminder, the current bill and remaining limit with installments held against the limit, the statement amount,
 * and which card transactions can become installments. Card spending is an expense on its date; the card account
 * balance is negative while something is owed. Amounts are `bigint` minor units; ratios are basis points.
 */
import { ratioBps } from './budget.ts';
import type { Installment } from './debt.ts';
import type { AccountType } from './ledger.ts';
import { addDays, countDays, dateInMonth, shiftMonth, type LocalDate, type YearMonth } from './period.ts';
import type { TransactionType } from './transactions.ts';

/** FR-R7 "Pengingat bayar · H-3". */
export const CARD_REMINDER_DAYS_BEFORE = 3;

/** FR-U2: card transactions of at least Rp500.000 (IDR minor units) can be split into installments. */
export const INSTALLMENT_MIN_MINOR = 500_000n;

/** FR-U2 tenors offered for card installments, in months. */
export const INSTALLMENT_TENORS = [3, 6, 12, 24] as const;
export type InstallmentTenor = (typeof INSTALLMENT_TENORS)[number];

/** OEZIG "maks. 30 hari lalu": the oldest card transaction that can still become an installment. */
export const INSTALLMENT_MAX_AGE_DAYS = 30;

const MAX_DAY = 31;

export class InvalidCardError extends RangeError {
  override readonly name = 'InvalidCardError';
}

export interface CardCycle {
  /** The day after the previous statement. */
  readonly start: LocalDate;
  /** "Cetak tagihan (rekening koran)": the last day of the cycle. */
  readonly statementOn: LocalDate;
  /** "Jatuh tempo": the first `dueDay` after the statement. */
  readonly dueOn: LocalDate;
  /** H-3 payment reminder. */
  readonly remindOn: LocalDate;
}

/**
 * FR-R7 billing cycle containing `date` for a card that prints on `statementDay` and is due on `dueDay` (both 1–31,
 * clamped to short months). BCA Visa (20 / 5) on 15 Okt 2026: 21 Sep – 20 Okt, due 5 Nov, reminder 2 Nov.
 */
export function cardCycle(date: LocalDate, statementDay: number, dueDay: number): CardCycle {
  for (const day of [statementDay, dueDay]) {
    if (!Number.isInteger(day) || day < 1 || day > MAX_DAY) throw new InvalidCardError(`Invalid card day: ${day}`);
  }
  const month = date.slice(0, 7) as YearMonth;
  const thisMonth = dateInMonth(month, statementDay);
  const statementOn = date <= thisMonth ? thisMonth : dateInMonth(shiftMonth(month, 1), statementDay);
  const statementMonth = statementOn.slice(0, 7) as YearMonth;
  const sameMonthDue = dateInMonth(statementMonth, dueDay);
  const dueOn = sameMonthDue > statementOn ? sameMonthDue : dateInMonth(shiftMonth(statementMonth, 1), dueDay);
  return {
    start: addDays(dateInMonth(shiftMonth(statementMonth, -1), statementDay), 1),
    statementOn,
    dueOn,
    remindOn: addDays(dueOn, -CARD_REMINDER_DAYS_BEFORE),
  };
}

export interface CardStatusInput {
  /** "Limit" (`accounts.cc_limit_minor`). */
  readonly limitMinor: bigint;
  /** The card account balance: negative while something is owed, positive with credit balance. */
  readonly balanceMinor: bigint;
  /** Σ installment principal not billed yet ("Cicilan ditahan di limit"). */
  readonly installmentsMinor: bigint;
}

export interface CardStatus {
  /** "Tagihan berjalan": what is owed outside installments. */
  readonly currentBillMinor: bigint;
  /** "Saldo kredit" from overpayments. */
  readonly creditMinor: bigint;
  /** "Total kewajiban kartu": current bill + installments. */
  readonly owedMinor: bigint;
  /** "Sisa limit" = limit − current bill − remaining installment principal (PRD §7.2); negative when over the limit. */
  readonly remainingLimitMinor: bigint;
  /** owed ÷ limit ("8% dari limit"); `null` without a limit. */
  readonly usedBps: number | null;
}

/**
 * FR-R7 card status. rHTMd: limit 15.000.000, bill 1.250.000 → remaining 13.750.000 (8%). A7ttc: installment A
 * Rp1.000.000 left after the Rp2.000.000 payoff + bill B Rp1.000.000 → remaining 13.000.000.
 */
export function cardStatus(input: CardStatusInput): CardStatus {
  if (input.installmentsMinor < 0n) throw new InvalidCardError('Installments must not be negative');
  const outside = -input.balanceMinor - input.installmentsMinor;
  const currentBillMinor = outside > 0n ? outside : 0n;
  const owedMinor = currentBillMinor + input.installmentsMinor;
  return {
    currentBillMinor,
    creditMinor: outside < 0n ? -outside : 0n,
    owedMinor,
    remainingLimitMinor: input.limitMinor - owedMinor,
    usedBps: ratioBps(owedMinor, input.limitMinor),
  };
}

/**
 * The amount of the statement printed on `statementOn`: the cycle's non-installment spending plus the installments
 * billed on that date ("Rekening koran 20 Nov · cicilan 333.334 + B 1.000.000" = 1.333.334).
 */
export function statementAmount(
  spendingMinor: bigint,
  installments: readonly Pick<Installment, 'dueOn' | 'totalMinor'>[],
  statementOn: LocalDate,
): bigint {
  return installments
    .filter((installment) => installment.dueOn === statementOn)
    .reduce((total, installment) => total + installment.totalMinor, spendingMinor);
}

export type InstallmentIneligibility = 'not_card' | 'not_expense' | 'below_minimum' | 'too_old' | 'billed';

export interface InstallmentCandidate {
  readonly accountType: AccountType;
  readonly type: TransactionType;
  readonly amountMinor: bigint;
  readonly localDate: LocalDate;
}

/**
 * FR-U2 "Ubah jadi cicilan": why a transaction cannot become an installment, or `null` when it can: an expense on a
 * credit card of at least Rp500.000, at most 30 days old, not printed on a statement yet ("selama belum tertagih").
 */
export function installmentIneligibility(
  candidate: InstallmentCandidate,
  card: { readonly statementDay: number; readonly dueDay: number },
  today: LocalDate,
): InstallmentIneligibility | null {
  if (candidate.accountType !== 'credit_card') return 'not_card';
  if (candidate.type !== 'expense') return 'not_expense';
  if (candidate.amountMinor < INSTALLMENT_MIN_MINOR) return 'below_minimum';
  if (countDays(candidate.localDate, today) - 1 > INSTALLMENT_MAX_AGE_DAYS) return 'too_old';
  if (candidate.localDate < cardCycle(today, card.statementDay, card.dueDay).start) return 'billed';
  return null;
}
