// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The account card strip (FR-R2, design "Rekening & dompet" cards on the Dashboard and Transactions): at most three
 * accounts marked "Tampilkan sebagai kartu", then the other everyday accounts merged into "N lainnya". Investments
 * have their own summary and are left out.
 */
import type { AccountView } from '@wf/db/accounts';
import { m } from '@wf/i18n/messages';
import { Money } from '@wf/ui/money';
import { Ellipsis } from 'lucide-react';
import type { ReactNode } from 'react';
import { cardSlots } from '../../lib/accounts.ts';
import { accountTypeLabel } from '../../lib/ledger-labels.ts';
import { usePreferences } from '../preferences.tsx';
import { AccountLogo } from './account-logo.tsx';
import { ApproxBalance } from './approx-balance.tsx';

export interface AccountCardsProps {
  readonly accounts: readonly AccountView[];
  readonly baseCurrency: string;
  /** The pressed card (a filter); leave out where a card only navigates (the Overview). */
  readonly selectedId?: string | null;
  readonly onSelect: (account: AccountView) => void;
  /** "N lainnya" pressed, with its card (e.g. to open a list under it, or scroll to the full list). */
  readonly onShowOthers: (card: HTMLElement) => void;
  /** A last line under a card's balance (`[account]`) or under "N lainnya" (its accounts): "+Rp1.200.000 bulan ini". */
  readonly footer?: (accounts: readonly AccountView[]) => ReactNode;
}

const CARD =
  'flex min-w-0 flex-col gap-2 rounded-[10px] border border-border bg-card p-3.5 text-left hover:border-border-strong focus-visible:outline-2 focus-visible:outline-ring aria-pressed:border-fg';

export function AccountCards({
  accounts,
  baseCurrency,
  selectedId,
  onSelect,
  onShowOthers,
  footer,
}: AccountCardsProps) {
  const { preferences } = usePreferences();
  const { locale } = preferences;
  const { cards, others } = cardSlots(accounts);
  if (cards.length === 0 && others.length === 0) return null;
  const othersTotal = others.reduce((sum, account) => sum + (account.balanceBaseMinor ?? 0n), 0n);
  return (
    <ul aria-label={m.accounts_cards_label()} className="grid grid-cols-[repeat(4,minmax(10rem,1fr))] gap-3">
      {cards.map((account) => (
        <li key={account.id} className="flex">
          <button
            type="button"
            aria-pressed={selectedId === undefined ? undefined : account.id === selectedId}
            className={`${CARD} flex-1`}
            onClick={() => {
              onSelect(account);
            }}
          >
            <span className="flex items-start justify-between gap-2">
              <AccountLogo account={account} size="sm" />
              <span className="rounded-[4px] border border-border px-1.5 text-[10.5px] whitespace-nowrap text-subtle">
                {accountTypeLabel(account.type)} · {account.currency}
              </span>
            </span>
            <span className="flex flex-col">
              <span className="truncate text-[13px] font-medium text-fg">{account.displayName}</span>
              <span className="truncate font-mono text-[11px] text-subtle">
                {account.last4 === null ? (account.phoneMasked ?? ' ') : `•• ${account.last4}`}
              </span>
            </span>
            <span className="flex flex-col gap-0.5">
              <Money
                minor={account.balanceMinor}
                currency={account.currency}
                context="amount"
                locale={locale}
                className="text-[17px] font-semibold text-fg"
              />
              <ApproxBalance account={account} baseCurrency={baseCurrency} />
            </span>
            {footer?.([account])}
          </button>
        </li>
      ))}
      {others.length === 0 ? null : (
        <li className="flex">
          <button
            type="button"
            className={`${CARD} flex-1`}
            onClick={(event) => {
              onShowOthers(event.currentTarget);
            }}
          >
            <span className="flex size-[22px] items-center justify-center rounded-[6px] bg-tint-06 text-muted-fg">
              <Ellipsis aria-hidden="true" className="size-3.5" />
            </span>
            <span className="flex flex-col">
              <span className="text-[13px] font-medium text-fg">
                {m.accounts_cards_others({ count: others.length })}
              </span>
              <span className="truncate text-[11px] text-subtle">
                {others.map((account) => account.displayName).join(' · ')}
              </span>
            </span>
            <Money
              minor={othersTotal}
              currency={baseCurrency}
              context="amount"
              locale={locale}
              className="text-[17px] font-semibold text-fg"
            />
            {footer?.(others)}
          </button>
        </li>
      )}
    </ul>
  );
}
