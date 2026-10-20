// SPDX-License-Identifier: AGPL-3.0-only
/** Helpers of the onboarding steps (FR-A4, design Section 16 `vSYBL`). */
import type { AccountType } from '@wf/domain/ledger';
import type { Period } from '@wf/domain/period';
import { formatDateRange } from '@wf/i18n/format';
import type { Locale } from '@wf/i18n/locale';
import { m } from '@wf/i18n/messages';

/** A quick-add chip of step 3 ("+ Mandiri · + OVO · + Tunai"): a new row with these values. */
export interface QuickAccount {
  readonly type: AccountType;
  readonly providerName: string;
  readonly displayName: string;
  readonly color: string;
}

/** In this order; the step offers the first {@link QUICK_ACCOUNT_CHIPS} the user does not have yet. */
export function quickAccounts(): QuickAccount[] {
  const cash = m.onboarding_account_cash();
  return [
    { type: 'bank', providerName: 'BCA', displayName: 'BCA', color: 'blue' },
    { type: 'bank', providerName: 'Bank Jago', displayName: 'Bank Jago', color: 'orange' },
    { type: 'ewallet', providerName: 'GoPay', displayName: 'GoPay', color: 'green' },
    { type: 'bank', providerName: 'Mandiri', displayName: 'Mandiri', color: 'yellow' },
    { type: 'ewallet', providerName: 'OVO', displayName: 'OVO', color: 'violet' },
    { type: 'cash', providerName: cash, displayName: cash, color: 'cyan' },
    { type: 'bank', providerName: 'BRI', displayName: 'BRI', color: 'blue' },
    { type: 'ewallet', providerName: 'DANA', displayName: 'DANA', color: 'cyan' },
  ];
}

/** Chips shown next to "+ Lainnya…" (design: three). */
export const QUICK_ACCOUNT_CHIPS = 3;

/** The chips to show: providers none of `taken` (provider names of the rows) has, case-insensitively. */
export function quickAccountChips(taken: readonly string[]): QuickAccount[] {
  const names = new Set(taken.map((name) => name.trim().toLowerCase()));
  return quickAccounts()
    .filter((account) => !names.has(account.providerName.toLowerCase()))
    .slice(0, QUICK_ACCOUNT_CHIPS);
}

/** "Okt 2026" and "1–31 Okt" of a period ("Okt 2026 = 1–31 Okt", design `N1A49s`). */
export function periodPreview(period: Pick<Period, 'start' | 'end'>, locale: Locale) {
  const start = new Date(`${period.start}T00:00:00Z`);
  const end = new Date(`${period.end}T00:00:00Z`);
  // The month the period ends in names it (M2: 25 Sep – 24 Okt is "Oktober").
  const month = new Intl.DateTimeFormat(locale === 'id' ? 'id-ID' : 'en-US', { month: 'short', timeZone: 'UTC' });
  return {
    month: month.format(end),
    year: String(end.getUTCFullYear()),
    range: formatDateRange(start, end, locale, { year: false }),
  };
}
