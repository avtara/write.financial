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
