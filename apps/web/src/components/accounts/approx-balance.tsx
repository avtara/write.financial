// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "≈ Rp45.420.300" under the balance of an account in another currency (design Investasi "US$825,69 · ≈ Rp13.500.000"):
 * the balance in the base currency at the current reference rate (`balanceBaseMinor`, see `@wf/db/accounts`).
 * Nothing for accounts in the base currency, or while no rate is known for the account's currency.
 */
import type { AccountView } from '@wf/db/accounts';
import { m } from '@wf/i18n/messages';
import { Money } from '@wf/ui/money';
import { usePreferences } from '../preferences.tsx';

export interface ApproxBalanceProps {
  readonly account: Pick<AccountView, 'currency' | 'balanceBaseMinor'>;
  readonly baseCurrency: string;
}

export function ApproxBalance({ account, baseCurrency }: ApproxBalanceProps) {
  const { preferences } = usePreferences();
  if (account.currency === baseCurrency || account.balanceBaseMinor === null) return null;
  return (
    <span className="font-mono text-[11px] whitespace-nowrap text-subtle">
      {m.overview_accounts_approx()}{' '}
      <Money minor={account.balanceBaseMinor} currency={baseCurrency} context="amount" locale={preferences.locale} />
    </span>
  );
}
