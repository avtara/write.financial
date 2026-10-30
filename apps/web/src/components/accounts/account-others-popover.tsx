// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The list behind the "N lainnya" card (FR-R2, design `h26Rk`): the everyday accounts that did not get a card, with
 * their balances. One of them, or all of them at once, can be picked; the strip around it decides what picking does
 * (filter the table, open the transactions).
 */
import type { AccountView } from '@wf/db/accounts';
import { m } from '@wf/i18n/messages';
import { Money } from '@wf/ui/money';
import { Popover, PopoverAnchor, PopoverContent } from '@wf/ui/popover';
import type { ReactNode, RefObject } from 'react';
import { accountTypeLabel } from '../../lib/ledger-labels.ts';
import { usePreferences } from '../preferences.tsx';
import { AccountLogo } from './account-logo.tsx';
import { ApproxBalance } from './approx-balance.tsx';

export interface AccountOthersPopoverProps {
  readonly others: readonly AccountView[];
  readonly baseCurrency: string;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** The "N lainnya" card that was pressed: the list opens under it, wherever it sits in the strip. */
  readonly anchor: RefObject<HTMLElement | null>;
  /** The line next to the title, saying what picking does. */
  readonly hint: string;
  /** The accounts picked now; their options read as pressed. */
  readonly pickedIds: readonly string[];
  /** What follows the account type under a name ("· 12 transaksi"); nothing without it. */
  readonly detail?: (account: AccountView) => ReactNode;
  /** The same for "Semua rekening lainnya". */
  readonly allDetail?: ReactNode;
  readonly onPick: (ids: readonly string[]) => void;
  /** The strip the list hangs from. */
  readonly children: ReactNode;
}

const OPTION =
  'flex w-full items-center gap-2.5 rounded-[6px] px-2 py-1.5 text-left hover:bg-tint-06 focus-visible:outline-2 focus-visible:outline-ring aria-pressed:bg-tint-06';

export function AccountOthersPopover({
  others,
  baseCurrency,
  open,
  onOpenChange,
  anchor,
  hint,
  pickedIds,
  detail,
  allDetail,
  onPick,
  children,
}: AccountOthersPopoverProps) {
  const { preferences } = usePreferences();
  const { locale } = preferences;
  const allIds = others.map((account) => account.id);
  const pick = (ids: readonly string[]) => {
    onPick(ids);
    onOpenChange(false);
  };
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverAnchor virtualRef={anchor} />
      {children}
      <PopoverContent align="start" className="w-[320px] p-1.5" aria-label={m.transactions_accounts_others_title()}>
        <div className="flex items-baseline justify-between gap-2 px-2 pt-1 pb-2">
          <h3 className="text-[13px] font-semibold text-fg">{m.transactions_accounts_others_title()}</h3>
          <span className="text-[11.5px] text-subtle">{hint}</span>
        </div>
        <ul className="flex flex-col gap-0.5">
          <li>
            <button
              type="button"
              aria-pressed={
                allIds.length > 0 && pickedIds.length === allIds.length && allIds.every((id) => pickedIds.includes(id))
              }
              className={OPTION}
              onClick={() => {
                pick(allIds);
              }}
            >
              <span className="flex-1 text-[13px] text-fg">{m.transactions_accounts_others_all()}</span>
              {allDetail === undefined ? null : <span className="text-[11.5px] text-subtle">{allDetail}</span>}
            </button>
          </li>
          {others.map((account) => (
            <li key={account.id}>
              <button
                type="button"
                aria-pressed={pickedIds.length === 1 && pickedIds[0] === account.id}
                className={OPTION}
                onClick={() => {
                  pick([account.id]);
                }}
              >
                <AccountLogo account={account} size="sm" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[13px] text-fg">{account.displayName}</span>
                  <span className="text-[11.5px] text-subtle">
                    {accountTypeLabel(account.type)}
                    {detail === undefined ? null : <> · {detail(account)}</>}
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end">
                  <Money
                    minor={account.balanceMinor}
                    currency={account.currency}
                    context="amount"
                    locale={locale}
                    className="text-[12.5px] text-fg"
                  />
                  <ApproxBalance account={account} baseCurrency={baseCurrency} />
                </span>
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
