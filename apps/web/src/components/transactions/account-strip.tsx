// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Rekening & dompet · Klik kartu untuk memfilter tabel" (FR-L1, design `t7l0Cj`, `NCqkQ`, `aCSAu`, `h26Rk`): the
 * available balance, the account cards, and "N lainnya". A card filters the table to its account (pressed again, or
 * "Saldo tersedia", clears it); "N lainnya" opens the other everyday accounts, where one or all of them can be picked.
 */
import { Link } from '@tanstack/react-router';
import type { AccountView } from '@wf/db/accounts';
import { m } from '@wf/i18n/messages';
import { Money } from '@wf/ui/money';
import { Settings2, Wallet } from 'lucide-react';
import { useRef, useState } from 'react';
import { cardSlots } from '../../lib/accounts.ts';
import { listParamOf, listValues } from '../../lib/transactions-search.ts';
import type { TransactionsView } from '../../server/fn/transactions.ts';
import { AccountCards } from '../accounts/account-cards.tsx';
import { AccountOthersPopover } from '../accounts/account-others-popover.tsx';
import { usePreferences } from '../preferences.tsx';

export interface AccountStripProps {
  readonly accounts: readonly AccountView[];
  readonly baseCurrency: string;
  /** "Saldo tersedia" (accounts counted as available, without investments). */
  readonly availableMinor: bigint;
  readonly view: TransactionsView;
  /** The `account` search param. */
  readonly selected: string | undefined;
  readonly onSelect: (account: string | undefined) => void;
}

export function AccountStrip({ accounts, baseCurrency, availableMinor, view, selected, onSelect }: AccountStripProps) {
  const { preferences } = usePreferences();
  const { locale } = preferences;
  const [othersOpen, setOthersOpen] = useState(false);
  // The "N lainnya" card that was pressed: the list opens under it, wherever it sits in the strip.
  const othersCard = useRef<HTMLElement | null>(null);
  const ids = listValues(selected);
  const { others } = cardSlots(accounts);
  const counts = new Map(view.accounts.map((group) => [group.accountId, group.count]));
  const selectedCard = ids.length === 1 ? ids[0] : undefined;
  return (
    <section aria-labelledby="transactions-accounts" className="flex flex-col gap-2.5">
      <div className="flex items-center gap-2">
        <h2 id="transactions-accounts" className="text-[13.5px] font-semibold text-fg">
          {m.accounts_title()}
        </h2>
        <p className="text-[12px] text-subtle">{m.transactions_accounts_hint()}</p>
        <Link
          to="/accounts"
          className="ml-auto inline-flex items-center gap-1.5 rounded-[6px] px-2 py-1 text-[12.5px] text-muted-fg hover:text-fg focus-visible:outline-2 focus-visible:outline-ring"
        >
          <Settings2 aria-hidden="true" className="size-3.5" />
          {m.transactions_accounts_manage()}
        </Link>
      </div>
      <AccountOthersPopover
        others={others}
        baseCurrency={baseCurrency}
        open={othersOpen}
        onOpenChange={setOthersOpen}
        anchor={othersCard}
        hint={m.transactions_accounts_hint()}
        pickedIds={ids}
        detail={(account) => m.transactions_summary_count({ count: counts.get(account.id) ?? 0 })}
        allDetail={m.transactions_summary_count({
          count: others.reduce((sum, account) => sum + (counts.get(account.id) ?? 0), 0),
        })}
        onPick={(picked) => {
          onSelect(listParamOf(picked));
        }}
      >
        {/* On a tablet the strip scrolls sideways instead of squeezing the tiles' amounts. */}
        <div className="flex gap-3 overflow-x-auto pb-1">
          <button
            type="button"
            aria-pressed={ids.length === 0}
            onClick={() => {
              onSelect(undefined);
            }}
            className="flex w-[188px] shrink-0 flex-col gap-2 rounded-[10px] border border-border bg-card p-3.5 text-left hover:border-border-strong focus-visible:outline-2 focus-visible:outline-ring aria-pressed:border-fg"
          >
            <span className="flex items-start justify-between gap-2">
              <span className="flex size-[22px] items-center justify-center rounded-[6px] bg-tint-06 text-muted-fg">
                <Wallet aria-hidden="true" className="size-3.5" />
              </span>
              {/* The total is in the base currency, not any one account's. */}
              <span className="rounded-[4px] border border-border px-1.5 text-[10.5px] whitespace-nowrap text-subtle">
                {baseCurrency}
              </span>
            </span>
            <span className="flex flex-col">
              <span className="text-[13px] font-medium text-fg">{m.transactions_accounts_available()}</span>
              <span className="font-mono text-[11px] text-subtle">{m.transactions_accounts_available_note()}</span>
            </span>
            <Money
              minor={availableMinor}
              currency={baseCurrency}
              context="amount"
              locale={locale}
              className="text-[17px] font-semibold text-fg"
            />
          </button>
          <div className="flex-1">
            <AccountCards
              accounts={accounts}
              baseCurrency={baseCurrency}
              selectedId={selectedCard ?? null}
              onSelect={(account) => {
                onSelect(selectedCard === account.id ? undefined : account.id);
              }}
              onShowOthers={(card) => {
                othersCard.current = card;
                setOthersOpen(true);
              }}
            />
          </div>
        </div>
      </AccountOthersPopover>
    </section>
  );
}
