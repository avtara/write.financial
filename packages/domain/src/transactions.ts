// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Transactions and their postings (PRD §8, plan §4.1). A transaction is a header; its postings are one line per
 * account, signed (+ in, − out) in the account currency and valued in the base currency. A transfer has two
 * principal postings, an optional `fee` line (FR-T4; the repository writes it as its own expense transaction), and, across
 * currencies, an `fx_diff` posting that moves no money (amount 0) but carries the FX difference in the base
 * currency for the "Selisih kurs" category. Balances therefore only see real money movements.
 */
import { convert, findRate, fxDifference, MissingRateError, rateToBase } from './fx.ts';
import type { FxDifference, FxRate, Money } from './fx.ts';

export const TRANSACTION_TYPES = [
  'expense',
  'income',
  'transfer',
  'dividend',
  'adjustment',
  'investment',
  'receivable_out',
  'receivable_in',
  'writeoff',
] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

export const TRANSACTION_SOURCES = [
  'manual',
  'quick',
  'assistant',
  'receipt',
  'import',
  'gmail',
  'recurring',
  'period_close',
] as const;
export type TransactionSource = (typeof TRANSACTION_SOURCES)[number];

export const POSTING_ROLES = ['principal', 'fee', 'fx_diff', 'tax'] as const;
export type PostingRole = (typeof POSTING_ROLES)[number];

/** Maximum number of tags on one transaction (FR-K3). */
export const MAX_TAGS_PER_TRANSACTION = 5;

export interface AccountRef {
  readonly id: string;
  readonly currency: string;
}

export interface PostingDraft {
  readonly accountId: string;
  /** Signed, in the account currency. */
  readonly amountMinor: bigint;
  readonly currency: string;
  /** Units of the base currency per unit of `currency`; `null` when `currency` is the base currency. */
  readonly fxRateToBase: string | null;
  /** Signed, in the base currency. */
  readonly amountBaseMinor: bigint;
  readonly role: PostingRole;
  /** Only `fee` and `fx_diff` postings carry a category; principal postings use the transaction's. */
  readonly categoryId: string | null;
}

/** An amount is zero or negative where the ledger needs a positive one (FR-T8). */
export class NonPositiveAmountError extends RangeError {
  override readonly name = 'NonPositiveAmountError';
  constructor(field: string) {
    super(`${field} must be greater than zero`);
  }
}

/** A transfer from an account to itself (FR-T8). */
export class SameAccountTransferError extends Error {
  override readonly name = 'SameAccountTransferError';
  constructor() {
    super('A transfer needs two different accounts');
  }
}

/** The parts of a split do not add up to the total (FR-L5). */
export class SplitMismatchError extends RangeError {
  override readonly name = 'SplitMismatchError';
  readonly remainingMinor: bigint;
  constructor(remainingMinor: bigint) {
    super(`Split parts differ from the total by ${remainingMinor}`);
    this.remainingMinor = remainingMinor;
  }
}

/** Common inputs: the base currency and the rates to value foreign amounts with. */
export interface Valuation {
  readonly baseCurrency: string;
  /** Rates connecting every non-base currency involved to the base currency (and, for transfers, to each other). */
  readonly rates: readonly FxRate[];
}

function posting(
  valuation: Valuation,
  account: AccountRef,
  amountMinor: bigint,
  role: PostingRole,
  categoryId: string | null,
): PostingDraft {
  const { baseCurrency, rates } = valuation;
  const common = { accountId: account.id, amountMinor, currency: account.currency, role, categoryId };
  if (account.currency === baseCurrency) return { ...common, fxRateToBase: null, amountBaseMinor: amountMinor };
  const rate = findRate(rates, account.currency, baseCurrency);
  if (rate === undefined) throw new MissingRateError(account.currency, baseCurrency);
  return {
    ...common,
    fxRateToBase: rateToBase(account.currency, baseCurrency, rate),
    amountBaseMinor: convert({ minor: amountMinor, currency: account.currency }, baseCurrency, rate),
  };
}

export interface SimpleTransactionInput extends Valuation {
  readonly account: AccountRef;
  /** Positive, in the account currency. */
  readonly amountMinor: bigint;
}

/** Postings of an expense: one principal posting of −amount (the category lives on the transaction). */
export function expensePostings(input: SimpleTransactionInput): PostingDraft[] {
  if (input.amountMinor <= 0n) throw new NonPositiveAmountError('amount');
  return [posting(input, input.account, -input.amountMinor, 'principal', null)];
}

/** Postings of an income: one principal posting of +amount. */
export function incomePostings(input: SimpleTransactionInput): PostingDraft[] {
  if (input.amountMinor <= 0n) throw new NonPositiveAmountError('amount');
  return [posting(input, input.account, input.amountMinor, 'principal', null)];
}

export interface TransferInput extends Valuation {
  readonly from: AccountRef;
  readonly to: AccountRef;
  /** Positive, in `from`'s currency. */
  readonly sentMinor: bigint;
  /** Positive, in `to`'s currency; equal to `sentMinor` for same-currency transfers. */
  readonly receivedMinor: bigint;
  /** Reference or manual rate between the two currencies; required across currencies. */
  readonly reference?: FxRate;
  /** Transfer fee, paid from `from` in its currency, recorded as an expense in `categoryId` (FR-T4). */
  readonly fee?: { readonly minor: bigint; readonly categoryId: string };
  /** The "Selisih kurs" category the FX difference is recorded to. */
  readonly fxDifferenceCategoryId: string;
}

export interface TransferPostings {
  readonly postings: PostingDraft[];
  /** `null` for same-currency transfers. */
  readonly fxDifference: FxDifference | null;
}

/** Postings of a transfer: −sent on `from`, +received on `to`, plus the fee and the FX difference (FR-T4). */
export function transferPostings(input: TransferInput): TransferPostings {
  const { from, to, sentMinor, receivedMinor, fee } = input;
  if (from.id === to.id) throw new SameAccountTransferError();
  if (sentMinor <= 0n) throw new NonPositiveAmountError('sent');
  if (receivedMinor <= 0n) throw new NonPositiveAmountError('received');
  if (fee !== undefined && fee.minor <= 0n) throw new NonPositiveAmountError('fee');

  let difference: FxDifference | null = null;
  // Across currencies the reference rate also values the legs, so it joins the valuation rates.
  let valuation: Valuation = input;
  if (from.currency !== to.currency) {
    const { reference } = input;
    if (reference === undefined) throw new MissingRateError(from.currency, to.currency);
    valuation = { baseCurrency: input.baseCurrency, rates: [reference, ...input.rates] };
    // Only needed when neither leg is in the base currency; otherwise the reference values the difference.
    const receivedToBase =
      from.currency === input.baseCurrency || to.currency === input.baseCurrency
        ? undefined
        : findRate(input.rates, to.currency, input.baseCurrency);
    difference = fxDifference({
      sent: { minor: sentMinor, currency: from.currency },
      received: { minor: receivedMinor, currency: to.currency },
      reference,
      baseCurrency: input.baseCurrency,
      ...(receivedToBase === undefined ? {} : { receivedToBase }),
    });
  } else if (sentMinor !== receivedMinor) {
    throw new RangeError('A same-currency transfer receives what it sends');
  }

  const postings = [
    posting(valuation, from, -sentMinor, 'principal', null),
    posting(valuation, to, receivedMinor, 'principal', null),
  ];
  if (fee !== undefined) postings.push(posting(valuation, from, -fee.minor, 'fee', fee.categoryId));
  if (difference !== null && difference.differenceBaseMinor !== 0n) {
    postings.push({
      accountId: to.id,
      amountMinor: 0n,
      currency: to.currency,
      fxRateToBase: null,
      amountBaseMinor: difference.differenceBaseMinor,
      role: 'fx_diff',
      categoryId: input.fxDifferenceCategoryId,
    });
  }
  return { postings, fxDifference: difference };
}

/** Total − Σ parts of a split ("Sisa Rp0 · pas" when 0, FR-L5). */
export function splitRemainder(totalMinor: bigint, partsMinor: readonly bigint[]): bigint {
  return partsMinor.reduce((remaining, part) => remaining - part, totalMinor);
}

/** Validates a split: at least two parts, each positive, adding up exactly to the total. */
export function assertSplit(totalMinor: bigint, partsMinor: readonly bigint[]): void {
  if (partsMinor.length < 2) throw new RangeError('A split needs at least two parts');
  for (const part of partsMinor) if (part <= 0n) throw new NonPositiveAmountError('part');
  const remaining = splitRemainder(totalMinor, partsMinor);
  if (remaining !== 0n) throw new SplitMismatchError(remaining);
}

/** The value of `amount` in the base currency, as {@link expensePostings} would record it. */
export function toBase(amount: Money, valuation: Valuation): bigint {
  return posting(valuation, { id: '', currency: amount.currency }, amount.minor, 'principal', null).amountBaseMinor;
}
