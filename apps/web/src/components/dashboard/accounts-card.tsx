// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Rekening & dompet · Klik kartu untuk melihat transaksinya" on the Overview (FR-D2, FR-TB2): the available balance,
 * at most three account cards and "N lainnya" (FR-R2), each with its net flow in what the
 * dashboard shows ("+Rp1.200.000 bulan ini"). A card opens its transactions for the same dates.
 */
import { Link, useNavigate } from '@tanstack/react-router';
import type { AccountsOverview, AccountView } from '@wf/db/accounts';
import type { Dashboard } from '@wf/db/dashboard';
import { m } from '@wf/i18n/messages';
import { Money } from '@wf/ui/money';
import { usePrivacy } from '@wf/ui/privacy';
import { ArrowDown, ArrowUp, Minus, Wallet } from 'lucide-react';
import { cardSlots } from '../../lib/accounts.ts';
import { transactionsDatesOf } from '../../lib/dashboard-search.ts';
import { listParamOf } from '../../lib/transactions-search.ts';
import { AccountCards } from '../accounts/account-cards.tsx';
import { usePreferences } from '../preferences.tsx';
import { scopeSuffix } from './dashboard-format.ts';

export interface AccountsCardProps {
  readonly overview: AccountsOverview;
  readonly dashboard: Dashboard;
}

const CARD =
  'flex w-[188px] shrink-0 flex-col gap-2 rounded-[10px] border border-border bg-card p-3.5 text-left hover:border-border-strong focus-visible:outline-2 focus-visible:outline-ring max-xl:w-[172px]';

export function AccountsCard({ overview, dashboard }: AccountsCardProps) {
  const { preferences } = usePreferences();
  const { locale } = preferences;
  const { hidden } = usePrivacy();
  const navigate = useNavigate();
  const { baseCurrency } = overview;
  const active = overview.accounts.filter((account) => account.status === 'active');
  const dates = transactionsDatesOf(dashboard);
  const suffix = scopeSuffix(dashboard, locale);
  const nets = new Map(dashboard.accounts.map((flow) => [flow.accountId, flow.inflowMinor - flow.outflowMinor]));
  const open = (ids: readonly string[]) =>
    void navigate({ to: '/transactions', search: { ...dates, account: listParamOf(ids) } });

  /** The net flow line; several accounts add up only in the base currency (others have no common unit here). */
  const footer = (accounts: readonly AccountView[]) => {
    const single = accounts.length === 1 ? accounts[0] : undefined;
    const counted = single === undefined ? accounts.filter((a) => a.currency === baseCurrency) : accounts;
    const netMinor = counted.reduce((total, account) => total + (nets.get(account.id) ?? 0n), 0n);
    // In privacy mode the arrow and its colour would give the direction away (`<Money>` drops its colour too).
    // Money coming in points up, money going out points down: the amount's sign read as an arrow.
    const direction = hidden ? 0 : Number(netMinor > 0n) - Number(netMinor < 0n);
    const Icon = direction > 0 ? ArrowUp : direction < 0 ? ArrowDown : Minus;
    return (
      <span className="mt-auto flex items-center gap-1.5 border-t border-border pt-2 text-[11px] text-subtle">
        <Icon
          aria-hidden="true"
          className={`size-3 ${direction > 0 ? 'text-green-fg' : direction < 0 ? 'text-red-fg' : ''}`}
        />
        <Money
          minor={netMinor}
          currency={single?.currency ?? baseCurrency}
          context="delta"
          locale={locale}
          className="text-[11px]"
        />
        <span className="truncate">{suffix}</span>
      </span>
    );
  };

  const available = active.filter((account) => account.includeInAvailable);
  return (
    <section aria-labelledby="overview-accounts" className="flex flex-col gap-2.5">
      <div className="flex items-center gap-2">
        <h2 id="overview-accounts" className="text-[13.5px] font-semibold text-fg">
          {m.accounts_title()}
        </h2>
        <p className="text-[12px] text-subtle max-md:hidden">{m.overview_accounts_hint()}</p>
        <Link
          to="/transactions"
          search={dates}
          className="ml-auto rounded-[6px] px-2 py-1 text-[12.5px] text-muted-fg hover:text-fg focus-visible:outline-2 focus-visible:outline-ring"
        >
          {m.overview_accounts_all()}
        </Link>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-1">
        <button
          type="button"
          className={CARD}
          onClick={() => {
            open(available.map((account) => account.id));
          }}
        >
          <span className="flex items-start justify-between gap-2">
            <span className="flex size-[22px] items-center justify-center rounded-[6px] bg-tint-06 text-muted-fg">
              <Wallet aria-hidden="true" className="size-3.5" />
            </span>
            <span className="rounded-[4px] border border-border px-1.5 text-[10.5px] text-subtle">{baseCurrency}</span>
          </span>
          <span className="flex flex-col">
            <span className="text-[13px] font-medium text-fg">{m.transactions_accounts_available()}</span>
            <span className="font-mono text-[11px] text-subtle">{m.transactions_accounts_available_note()}</span>
          </span>
          <Money
            minor={overview.availableMinor}
            currency={baseCurrency}
            context="amount"
            locale={locale}
            className="text-[17px] font-semibold text-fg"
          />
          {footer(available)}
        </button>
        {/* At least the tiles' own width: on a tablet the strip scrolls sideways instead of squeezing amounts. */}
        <div className="flex-1">
          <AccountCards
            accounts={active}
            baseCurrency={baseCurrency}
            onSelect={(account) => {
              open([account.id]);
            }}
            onShowOthers={() => {
              open(cardSlots(active).others.map((account) => account.id));
            }}
            footer={footer}
          />
        </div>
      </div>
    </section>
  );
}
