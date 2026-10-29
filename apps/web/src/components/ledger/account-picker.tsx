// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The account picker of the ledger forms (FR-T2 "Pilih rekening", FR-T4 "Dari → ke"): active accounts grouped by
 * type with their balances, a "saldo kurang" marker where the balance does not cover the amount, and the account
 * chosen on the other side of a transfer disabled with the reason. Archived accounts are never offered.
 */
import type { AccountView } from '@wf/db/accounts';
import { ACCOUNT_TYPES } from '@wf/domain/ledger';
import type { Locale } from '@wf/domain/money';
import { m } from '@wf/i18n/messages';
import { Combobox, type ComboboxGroup } from '@wf/ui/command';
import { Money } from '@wf/ui/money';
import { ChevronsUpDown } from 'lucide-react';
import type { ComponentProps, ReactElement } from 'react';
import { accountTypeLabel } from '../../lib/ledger-labels.ts';
import { AccountLogo } from '../accounts/account-logo.tsx';

export interface AccountPickerProps {
  /** The user's accounts; archived ones are left out. */
  readonly accounts: readonly AccountView[];
  readonly value: string | null;
  readonly onValueChange: (id: string) => void;
  /** Names the search field and list, e.g. "Pilih rekening". */
  readonly label: string;
  readonly searchPlaceholder: string;
  readonly locale: Locale;
  /** What the transaction takes out of the account; accounts whose balance is below it are marked "saldo kurang". */
  readonly outflowMinor?: bigint | null;
  /** The account chosen on the other side of a transfer, offered disabled with `disabledReason`. */
  readonly disabledId?: string | null;
  readonly disabledReason?: string;
  /** The element that opens the picker, e.g. an {@link AccountTrigger}. */
  readonly children: ReactElement;
}

export function AccountPicker({
  accounts,
  value,
  onValueChange,
  label,
  searchPlaceholder,
  locale,
  outflowMinor = null,
  disabledId = null,
  disabledReason,
  children,
}: AccountPickerProps) {
  const groups: ComboboxGroup[] = ACCOUNT_TYPES.map((type) => ({
    heading: accountTypeLabel(type),
    options: accounts
      .filter((account) => account.type === type && account.status === 'active')
      .map((account) => {
        const disabled = account.id === disabledId;
        const short = outflowMinor !== null && account.type !== 'credit_card' && account.balanceMinor < outflowMinor;
        return {
          value: account.id,
          label: account.displayName,
          keywords: [account.providerName, ...(account.last4 === null ? [] : [account.last4])],
          media: <AccountLogo account={account} size="sm" />,
          disabled,
          aside:
            disabled && disabledReason !== undefined ? (
              <span className="font-sans">{disabledReason}</span>
            ) : (
              <span className="flex flex-col items-end">
                <Money
                  minor={account.balanceMinor}
                  currency={account.currency}
                  context="amount"
                  locale={locale}
                  className={short ? 'text-red-fg' : ''}
                />
                {short ? <span className="font-sans text-[10.5px] text-red-fg">{m.account_picker_short()}</span> : null}
              </span>
            ),
        };
      }),
  })).filter((group) => group.options.length > 0);

  return (
    <Combobox
      value={value}
      onValueChange={onValueChange}
      groups={groups}
      label={label}
      searchPlaceholder={searchPlaceholder}
      emptyLabel={m.account_picker_empty()}
    >
      {children}
    </Combobox>
  );
}

/** The account's logo (uploaded, catalog, or its type icon in the account color). */
export function AccountSwatch({
  account,
}: {
  readonly account: Pick<AccountView, 'id' | 'type' | 'color' | 'logoKey' | 'catalogId'>;
}) {
  return <AccountLogo account={account} size="sm" />;
}

export interface AccountTriggerProps extends ComponentProps<'button'> {
  readonly account: AccountView | undefined;
  readonly placeholder: string;
}

/** A field-like button showing the chosen account (design "Rekening" select); pass it as the picker's child. */
export function AccountTrigger({ account, placeholder, className = '', ...props }: AccountTriggerProps) {
  return (
    <button
      type="button"
      {...props}
      className={`flex h-[42px] w-full min-w-0 items-center gap-2.5 rounded-[9px] border border-border-input bg-input px-3 text-left text-[14px] text-fg outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring aria-invalid:border-red ${className}`}
    >
      {account === undefined ? null : <AccountSwatch account={account} />}
      <span className={`min-w-0 flex-1 truncate ${account === undefined ? 'text-subtle' : ''}`}>
        {account?.displayName ?? placeholder}
      </span>
      <ChevronsUpDown aria-hidden="true" className="size-3.5 shrink-0 text-subtle" />
    </button>
  );
}
