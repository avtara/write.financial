// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Expected refusals of the ledger repositories. Each has a stable `code` the web app passes to the page
 * (`EXPECTED_CODES`), so the UI can explain it; messages are for logs and never contain amounts or notes.
 */

export const LEDGER_ERROR_CODES = [
  /** The row does not exist for this user (or RLS hides it). */
  'NOT_FOUND',
  /** FR-R3: currency and opening balance are locked once the account has transactions. */
  'ACCOUNT_LOCKED',
  /** FR-R2: at most three accounts are shown as cards. */
  'TOO_MANY_CARDS',
  /** Invalid account input (currency code, display name, last 4 digits, credit-card days, …). */
  'INVALID_ACCOUNT',
  /** The account is archived (no new transactions, no default) or, for permanent deletion, not archived. */
  'ACCOUNT_ARCHIVED',
  'ACCOUNT_NOT_ARCHIVED',
  /** FR-K1: another live category of the same kind has this name (case-insensitive). */
  'CATEGORY_NAME_TAKEN',
  /** Invalid category name, group for the kind, or a user name starting with `system:`. */
  'INVALID_CATEGORY',
  /** System categories (the "Biaya keuangan" group) cannot be deleted, archived, merged away, or moved. */
  'CATEGORY_SYSTEM',
  /** The category's kind does not fit the transaction (income category on an expense, …). */
  'CATEGORY_KIND_MISMATCH',
  /** FR-K3: a tag that does not normalize to a slug. */
  'INVALID_TAG',
  /** FR-K3: more than five tags on a transaction. */
  'TOO_MANY_TAGS',
  /** FR-T8: amounts must be positive, a transfer needs two different accounts, … */
  'INVALID_TRANSACTION',
  /** FR-L5: the parts of a split do not add up to the total. */
  'SPLIT_MISMATCH',
  /** No reference or manual exchange rate is known for a currency that needs one. */
  'FX_RATE_MISSING',
  /** Invalid exchange rate input (not a positive decimal with ≤ 8 fraction digits, or base = quote). */
  'INVALID_RATE',
  /** Invalid goal input. */
  'INVALID_GOAL',
  /** FR-P3: the transaction is dated inside a closed period (or would move into or out of one), or the budget edit
   * targets a closed period. Closed periods are read-only. */
  'PERIOD_CLOSED',
  /** Invalid period input: a start day outside 1–28, the same start day again, or locking a period that has not
   * ended. */
  'INVALID_PERIOD',
  /** Invalid budget input: a negative limit, a category that is not an expense or fee category, an alert threshold
   * other than 50/80/85/100, or a leftover move beyond a category's remainder. */
  'INVALID_BUDGET',
  /** FR-T6: invalid repeat rule (interval, weekday, day of month, end count, reminder offset) or template. */
  'INVALID_RECURRENCE',
  /** FR-SUB1/SUB3: invalid subscription input (name, price, cycle, dates, trial, pause or cancel option). */
  'INVALID_SUBSCRIPTION',
  /** FR-L7: the review item was already confirmed or ignored (another tab, a double click). */
  'REVIEW_RESOLVED',
  /** FR-U1–U4: invalid debt input (a schedule that does not add up, a card installment from a non-card or managed
   * transaction, a card payment allocation beyond the payment or the remaining principal, …). */
  'INVALID_DEBT',
  /** FR-U7: invalid receivable input, a payment beyond the remaining amount, or an action on a settled or
   * written-off receivable. */
  'INVALID_RECEIVABLE',
  /** FR-I1: invalid asset input (symbol, platform that is not an investment account in the asset's currency, a
   * category or price that does not fit). */
  'INVALID_ASSET',
  /** FR-I2: invalid investment trade (units, amounts, more units sold than held, a goal choice missing for an asset
   * held by two or more goals, a trade that is not pending when settling). */
  'INVALID_TRADE',
  /** FR-ST4: invalid market data key input (a provider without BYOK, an empty key). */
  'INVALID_MARKET_CREDENTIAL',
  /** FR-ST4: saving a market data key requires active two-factor authentication. */
  'TWO_FACTOR_REQUIRED',
  /** FR-LP1–LP5: invalid report input (a range that starts after it ends or is longer than a year, a stored row that
   * cannot be read back). */
  'INVALID_REPORT',
  /** FR-AI1: invalid auto rule (name, condition fields or values, action, or a category that does not fit). */
  'INVALID_RULE',
] as const;

export type LedgerErrorCode = (typeof LEDGER_ERROR_CODES)[number];

export class LedgerError extends Error {
  override readonly name = 'LedgerError';
  readonly code: LedgerErrorCode;

  constructor(code: LedgerErrorCode, message: string = code) {
    super(message);
    this.code = code;
  }
}
