// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Pure rules of the "Rekening & dompet" screens (FR-R1–R6): grouping by type, the page totals, the 14-day
 * reconciliation reminder, card slots, and masking an e-wallet phone number before it is stored.
 */
import type { AccountView } from '@wf/db/accounts';
import type { CategoryView } from '@wf/db/categories';
import { ACCOUNT_TYPES, type AccountType } from '@wf/domain/ledger';
import { countDays, type LocalDate } from '@wf/domain/period';
import { toLocalDate } from '@wf/ui/dates';
import { accountTypeLabel } from './ledger-labels.ts';

/** FR-R2: at most this many accounts show as cards; the rest are merged into "N lainnya". */
export const MAX_CARDS = 3;
/** FR-R4: an account not checked for more than this many days needs adjusting ("Perlu disesuaikan"). */
export const STALE_AFTER_DAYS = 14;

export interface AccountGroup {
  readonly type: AccountType;
  readonly accounts: AccountView[];
  /** Σ base-currency balances (accounts without a rate are left out). */
  readonly totalBaseMinor: bigint;
}

/** Non-empty groups in the order of {@link ACCOUNT_TYPES}, each keeping the accounts' order. */
export function groupByType(accounts: readonly AccountView[]): AccountGroup[] {
  return ACCOUNT_TYPES.flatMap((type) => {
    const members = accounts.filter((account) => account.type === type);
    if (members.length === 0) return [];
    const totalBaseMinor = members.reduce((sum, account) => sum + (account.balanceBaseMinor ?? 0n), 0n);
    return [{ type, accounts: members, totalBaseMinor }];
  });
}

export interface AccountTotals {
  /** Σ base-currency values of the investment accounts. */
  readonly investmentsMinor: bigint;
  readonly investmentCount: number;
  /** Total assets: Σ base-currency balances of every account (credit-card bills are negative). */
  readonly totalMinor: bigint;
  /** Currencies other than the base one among the accounts, sorted ("≈" in front of converted totals). */
  readonly foreignCurrencies: string[];
  /** Active accounts that count toward the available balance. */
  readonly spendingCount: number;
}

/** The page's summary figures over the active `accounts`. */
export function accountTotals(accounts: readonly AccountView[], baseCurrency: string): AccountTotals {
  const investments = accounts.filter((account) => account.type === 'investment');
  const sum = (list: readonly AccountView[]) => list.reduce((total, a) => total + (a.balanceBaseMinor ?? 0n), 0n);
  return {
    investmentsMinor: sum(investments),
    investmentCount: investments.length,
    totalMinor: sum(accounts),
    foreignCurrencies: [...new Set(accounts.map((a) => a.currency))].filter((c) => c !== baseCurrency).sort(),
    spendingCount: accounts.filter((account) => account.includeInAvailable).length,
  };
}

/** Whole days since the account was last reconciled (or created), in the user's time zone. */
export function daysSinceCheck(account: AccountView, today: LocalDate, timeZone: string): number {
  return countDays(toLocalDate(account.lastReconciledAt ?? account.createdAt, timeZone), today) - 1;
}

export interface StaleAccount {
  readonly account: AccountView;
  readonly days: number;
}

/** FR-R4: every account with its days since the last check, the longest unchecked first. */
export function byCheckAge(accounts: readonly AccountView[], today: LocalDate, timeZone: string): StaleAccount[] {
  return accounts
    .map((account) => ({ account, days: daysSinceCheck(account, today, timeZone) }))
    .sort((a, b) => b.days - a.days);
}

/** FR-R2 card strip: the accounts shown as cards and the active everyday accounts merged into "N lainnya". */
export function cardSlots(accounts: readonly AccountView[]): { cards: AccountView[]; others: AccountView[] } {
  const active = accounts.filter((account) => account.status === 'active');
  return {
    cards: active.filter((account) => account.showAsCard).slice(0, MAX_CARDS),
    others: active.filter((account) => !account.showAsCard && account.type !== 'investment'),
  };
}

/**
 * FR-R1: the masked form of an e-wallet phone number (`0812 3456 7818` → `0812•• 18`); only this is stored.
 * `null` when the input has fewer than 8 digits.
 */
export function maskPhone(input: string): string | null {
  const digits = input.replace(/\D/g, '');
  if (digits.length < 8) return null;
  return `${digits.slice(0, 4)}•• ${digits.slice(-2)}`;
}

/**
 * Where the balance chart's axis starts ("Sumbu dimulai dari Rp30.000.000"): three quarters of the lowest balance,
 * rounded down to its leading digit, so small changes stay visible; the lowest value itself when it is not positive.
 */
export function axisStart(values: readonly bigint[]): bigint {
  const lowest = values.reduce((min, value) => (value < min ? value : min), values[0] ?? 0n);
  if (lowest <= 0n) return lowest;
  const scaled = (lowest * 3n) / 4n;
  const unit = 10n ** BigInt(scaled.toString().length - 1);
  return (scaled / unit) * unit;
}

/** Relative change from `first` to `last` as a ratio (`0.121` = +12,1%); `null` when `first` is 0. */
export function changeRatio(first: bigint, last: bigint): number | null {
  if (first === 0n) return null;
  return Number(last - first) / Math.abs(Number(first));
}

/** Categories that may book a difference of this sign (the FX difference is reserved for transfers). */
export function differenceCategories(categories: readonly CategoryView[], differenceMinor: bigint): CategoryView[] {
  return categories.filter(
    (category) =>
      category.archivedAt === null &&
      category.builtInKey !== 'system:fx_difference' &&
      (differenceMinor > 0n ? category.kind === 'income' : category.kind !== 'income'),
  );
}

/** The design's default for a shortfall: "Biaya keuangan → Admin bulanan". */
export const DEFAULT_SHORTFALL_CATEGORY = 'system:monthly_admin';

/** The subtitle under an account's name: type · currency · last digits or phone. */
export function accountMeta(account: AccountView): string {
  const number = account.last4 === null ? account.phoneMasked : `•• ${account.last4}`;
  return [accountTypeLabel(account.type), account.currency, number].filter((part) => part !== null).join(' · ');
}
