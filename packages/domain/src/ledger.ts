// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Balances and net worth (PRD §7.2, FR-U7). All amounts are `bigint` minor units
 * already converted to the base currency where noted; conversion lives in `fx`.
 */

export interface AvailableBalanceAccount {
  /** `accounts.include_in_available` ("Hitung dalam saldo tersedia"). */
  readonly includeInAvailable: boolean;
  /** Account balance converted to the base currency. */
  readonly balanceBaseMinor: bigint;
}

export interface NetWorthInput {
  /** {@link availableBalance}; may be negative. */
  readonly available: bigint;
  /** Portfolio value incl. platform cash; ≥ 0. */
  readonly investments: bigint;
  /** Σ (principal − payments) of open receivables; ≥ 0. */
  readonly receivablesOutstanding: bigint;
  /** Remaining debt principal; ≥ 0. */
  readonly debtRemaining: bigint;
}

export class NegativeAmountError extends RangeError {
  override readonly name = 'NegativeAmountError';
  constructor(field: string, value: bigint) {
    super(`${field} must not be negative: ${value}`);
  }
}

const sum = (amounts: readonly bigint[]): bigint => amounts.reduce((total, amount) => total + amount, 0n);

/** Opening balance + Σ confirmed postings + Σ adjustments (PRD §7.2). */
export function accountBalance(
  openingMinor: bigint,
  postingsMinor: readonly bigint[],
  adjustmentsMinor: readonly bigint[],
): bigint {
  return openingMinor + sum(postingsMinor) + sum(adjustmentsMinor);
}

/** Σ balances of `include_in_available` accounts, converted to the base currency (PRD §7.2). */
export function availableBalance(accounts: readonly AvailableBalanceAccount[]): bigint {
  return sum(accounts.filter((account) => account.includeInAvailable).map((account) => account.balanceBaseMinor));
}

/**
 * Net worth = available + investments + outstanding receivables − remaining debt.
 * Receivables count toward net worth but not the available balance (FR-U7).
 */
export function netWorth(input: NetWorthInput): bigint {
  for (const field of ['investments', 'receivablesOutstanding', 'debtRemaining'] as const) {
    if (input[field] < 0n) throw new NegativeAmountError(field, input[field]);
  }
  return input.available + input.investments + input.receivablesOutstanding - input.debtRemaining;
}
