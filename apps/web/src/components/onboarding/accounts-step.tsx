// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Onboarding 3 — rekening (design `VE8Zf`): quick rows of name and today's balance (the opening balance, dated
 * today; old transactions are not needed), chips that add the common banks and wallets ("+ Mandiri · + OVO · + Tunai"),
 * "+ Lainnya…" and "Detail" with the full `AccountForm`, and the live "Saldo tersedia". "Lanjut" saves the rows.
 */
import type { AccountView } from '@wf/db/accounts';
import type { AccountType } from '@wf/domain/ledger';
import { m } from '@wf/i18n/messages';
import { AmountInput } from '@wf/ui/amount-input';
import { Money } from '@wf/ui/money';
import { ArrowRight, Lock, Plus, SlidersHorizontal, X } from 'lucide-react';
import { useLayoutEffect, useRef, useState, type SyntheticEvent } from 'react';
import { quickAccountChips, type QuickAccount } from '../../lib/onboarding.ts';
import { ledgerErrorMessage } from '../../lib/ledger-errors.ts';
import { accountTypeLabel } from '../../lib/ledger-labels.ts';
import { archiveAccount, deleteAccount } from '../../server/fn/accounts.ts';
import { saveOnboardingAccounts, type OnboardingView } from '../../server/fn/onboarding.ts';
import { AccountForm } from '../accounts/account-form.tsx';
import { AccountLogo } from '../accounts/account-logo.tsx';
import { Button, FormError, INPUT_FRAME } from '../form.tsx';
import { Modal } from '../modal.tsx';
import { usePreferences } from '../preferences.tsx';
import { OnboardingBack, OnboardingFooter, OnboardingHeading } from './onboarding-layout.tsx';

/** A row of the list: a saved account (`account`) or one still to create. */
interface Row {
  readonly key: string;
  readonly account: AccountView | null;
  readonly type: AccountType;
  readonly providerName: string;
  readonly displayName: string;
  readonly currency: string;
  readonly color: string;
  /** Today's balance as typed; `null` while empty. */
  readonly balance: bigint | null;
}

type Dialog = { readonly kind: 'new' } | { readonly kind: 'detail'; readonly key: string };

function rowOf(account: AccountView): Row {
  return {
    key: account.id,
    account,
    type: account.type,
    providerName: account.providerName,
    displayName: account.displayName,
    currency: account.currency,
    color: account.color,
    balance: account.openingBalanceMinor,
  };
}

/** Rows typed here: not credit cards (their opening balance is a bill) and not accounts with transactions. */
function editable(row: Row): boolean {
  return row.type !== 'credit_card' && row.account?.locked !== true;
}

export function AccountsStep({ view, onSaved }: { view: OnboardingView; onSaved: () => void }) {
  const { preferences } = usePreferences();
  const { locale } = preferences;
  const { baseCurrency } = view.accounts;
  const [rows, setRows] = useState<readonly Row[]>(() =>
    view.accounts.accounts.filter((account) => account.status === 'active').map(rowOf),
  );
  /** The row whose name gets the focus once it renders (a row just added from a chip). */
  const focusKey = useRef<string | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [invalid, setInvalid] = useState<ReadonlySet<string>>(new Set());
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // After the render that added the row: its name takes the focus (the chip that added it is gone).
  useLayoutEffect(() => {
    if (focusKey.current === null) return;
    const input = document.getElementById(`onboarding-account-${focusKey.current}`) as HTMLInputElement;
    focusKey.current = null;
    input.focus();
    input.select();
  });

  const update = (key: string, patch: Partial<Row>) => {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  };
  const add = (quick: QuickAccount) => {
    const key = crypto.randomUUID();
    setRows((current) => [...current, { ...quick, key, account: null, currency: baseCurrency, balance: null }]);
    focusKey.current = key;
  };
  const remove = async (row: Row) => {
    setFailure(null);
    if (row.account !== null) {
      // A saved account goes for good: it has no transactions yet (archive, then delete).
      const archived = await archiveAccount({ data: { id: row.account.id } });
      const deleted = archived.ok ? await deleteAccount({ data: { id: row.account.id } }) : archived;
      if (!deleted.ok) {
        setFailure(ledgerErrorMessage(deleted.code, locale));
        return;
      }
    }
    setRows((current) => current.filter((candidate) => candidate.key !== row.key));
  };
  const saved = (account: AccountView) => {
    const key = dialog?.kind === 'detail' ? dialog.key : account.id;
    setRows((current) =>
      current.some((row) => row.key === key)
        ? current.map((row) => (row.key === key ? rowOf(account) : row))
        : [...current, rowOf(account)],
    );
    setDialog(null);
  };

  const availableMinor = rows.reduce((total, row) => {
    const included = row.account?.includeInAvailable ?? row.type !== 'investment';
    if (!included) return total;
    if (row.currency === baseCurrency && editable(row)) return total + (row.balance ?? 0n);
    // Only saved accounts are foreign or read-only; without a rate they count nothing (as on the accounts page).
    return total + ((row.account as AccountView).balanceBaseMinor ?? 0n);
  }, 0n);

  const submit = async (event: SyntheticEvent) => {
    event.preventDefault();
    const wrong = new Set(
      rows
        .filter((row) => editable(row) && (row.displayName.trim() === '' || row.balance === null))
        .map((row) => row.key),
    );
    setInvalid(wrong);
    if (wrong.size > 0) {
      for (const key of wrong) {
        (document.getElementById(`onboarding-account-${key}`) as HTMLElement).focus();
        break;
      }
      return;
    }
    setPending(true);
    setFailure(null);
    const result = await saveOnboardingAccounts({
      data: {
        accounts: rows.filter(editable).map((row) => ({
          ...(row.account === null ? {} : { id: row.account.id }),
          type: row.type,
          providerName: row.providerName,
          displayName: row.displayName.trim(),
          currency: row.currency,
          // Checked above: every editable row has a balance.
          openingBalanceMinor: row.balance as bigint,
          color: row.color,
        })),
      },
    });
    setPending(false);
    if (result.ok) onSaved();
    else setFailure(ledgerErrorMessage(result.code, locale));
  };

  const detailRow = dialog?.kind === 'detail' ? rows.find((row) => row.key === dialog.key) : undefined;
  const cardHolders = rows
    .filter((row) => row.account?.showAsCard === true && row.key !== detailRow?.key)
    .map((row) => row.displayName);

  return (
    // The dialog stays outside the form: its own form's submit would bubble up to this one through React.
    <>
      <form onSubmit={(event) => void submit(event)} noValidate className="flex flex-col gap-5">
        <OnboardingHeading title={m.onboarding_accounts_title()} description={m.onboarding_accounts_description()} />
        {rows.length === 0 ? (
          <p className="rounded-[10px] border border-dashed border-border px-4 py-5 text-center text-[13px] text-muted-fg">
            {m.onboarding_accounts_empty()}
          </p>
        ) : (
          <ul aria-label={m.onboarding_accounts_list()} className="flex flex-col gap-2.5">
            {rows.map((row) => {
              const wrong = invalid.has(row.key);
              const name = row.displayName.trim() === '' ? accountTypeLabel(row.type) : row.displayName;
              return (
                <li
                  key={row.key}
                  className={`flex items-center gap-3 rounded-[10px] border bg-surface-sunken px-3 py-2.5 ${wrong ? 'border-red' : 'border-border'}`}
                >
                  <AccountLogo
                    account={{
                      id: row.account?.id ?? row.key,
                      type: row.type,
                      color: row.color,
                      logoKey: row.account?.logoKey ?? null,
                      catalogId: row.account?.catalogId ?? null,
                    }}
                  />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <input
                      id={`onboarding-account-${row.key}`}
                      aria-label={m.onboarding_account_name()}
                      aria-invalid={wrong && row.displayName.trim() === ''}
                      maxLength={40}
                      value={row.displayName}
                      onChange={(event) => {
                        update(row.key, { displayName: event.target.value });
                      }}
                      className="w-full min-w-0 rounded-[5px] bg-transparent text-[13.5px] font-medium text-fg outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                    />
                    <span className="text-[11.5px] text-subtle">{accountTypeLabel(row.type)}</span>
                  </div>
                  {editable(row) ? (
                    <div className="w-[160px] shrink-0">
                      <div className={`${INPUT_FRAME.lg} ${wrong && row.balance === null ? 'border-red' : ''}`}>
                        <AmountInput
                          aria-label={m.onboarding_account_balance({ name })}
                          aria-invalid={wrong && row.balance === null}
                          size="inline"
                          value={row.balance}
                          onValueChange={(balance) => {
                            update(row.key, { balance });
                          }}
                          currency={row.currency}
                          locale={locale}
                        />
                      </div>
                    </div>
                  ) : (
                    <span className="flex items-center gap-1.5 text-[13px]">
                      <Lock aria-hidden="true" className="size-3 text-subtle" />
                      <Money
                        minor={(row.account as AccountView).balanceMinor}
                        currency={row.currency}
                        context="amount"
                        locale={locale}
                      />
                    </span>
                  )}
                  <button
                    type="button"
                    aria-label={m.onboarding_account_details({ name })}
                    onClick={() => {
                      setDialog({ kind: 'detail', key: row.key });
                    }}
                    className="rounded-[6px] p-1.5 text-subtle hover:bg-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    <SlidersHorizontal aria-hidden="true" className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label={m.onboarding_account_remove({ name })}
                    onClick={() => void remove(row)}
                    className="rounded-[6px] p-1.5 text-subtle hover:bg-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    <X aria-hidden="true" className="size-3.5" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <div role="group" aria-label={m.onboarding_accounts_add()} className="flex flex-wrap gap-2">
          {quickAccountChips(rows.map((row) => row.providerName)).map((quick) => (
            <Button
              key={quick.providerName}
              variant="secondary"
              size="sm"
              aria-label={m.onboarding_account_add({ name: quick.displayName })}
              onClick={() => {
                add(quick);
              }}
            >
              <Plus aria-hidden="true" className="size-3" />
              {quick.displayName}
            </Button>
          ))}
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setDialog({ kind: 'new' });
            }}
          >
            <Plus aria-hidden="true" className="size-3" />
            {m.onboarding_account_other()}
          </Button>
        </div>
        <div
          role="status"
          className="flex items-center justify-between rounded-[10px] bg-surface-sunken px-3.5 py-3 text-[13px]"
        >
          <span className="text-muted-fg">{m.onboarding_available()}</span>
          <Money
            minor={availableMinor}
            currency={baseCurrency}
            context="amount"
            locale={locale}
            className="font-semibold"
          />
        </div>
        {failure === null ? null : <FormError>{failure}</FormError>}
        <OnboardingFooter step="accounts" start={<OnboardingBack to="period" />}>
          <Button type="submit" size="sm" pending={pending}>
            <ArrowRight aria-hidden="true" className="size-3.5" />
            {m.onboarding_next()}
          </Button>
        </OnboardingFooter>
      </form>
      {dialog === null ? null : (
        <Modal
          open
          size="xl"
          onOpenChange={() => {
            setDialog(null);
          }}
          title={detailRow?.account == null ? m.accounts_add_title() : m.accounts_edit_title()}
          description={m.accounts_add_description()}
        >
          <AccountForm
            {...(detailRow?.account == null ? {} : { account: detailRow.account })}
            {...(detailRow === undefined
              ? {}
              : {
                  initial: {
                    type: detailRow.type,
                    providerName: detailRow.providerName,
                    displayName: detailRow.displayName,
                    color: detailRow.color,
                    ...(editable(detailRow) ? { openingMinor: detailRow.balance } : {}),
                  },
                })}
            baseCurrency={baseCurrency}
            today={view.today}
            cardHolders={cardHolders}
            submitLabel={detailRow?.account == null ? m.accounts_add() : m.accounts_save()}
            onSaved={saved}
            onCancel={() => {
              setDialog(null);
            }}
          />
        </Modal>
      )}
    </>
  );
}
