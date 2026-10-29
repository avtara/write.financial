// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A credit card on the Debts page (FR-R7): the summary strip (design `toyph`/`q1cOt`: "Tagihan berjalan", "Cicilan
 * ditahan di limit", "Sisa limit", the next statement) and the bill card (`PaukT`: the share of the limit used, the
 * transactions of the current cycle, "Bayar tagihan" and "Ubah jadi cicilan").
 */
import type { AccountView } from '@wf/db/accounts';
import type { Locale } from '@wf/i18n/locale';
import { m } from '@wf/i18n/messages';
import { formatDate } from '@wf/ui/dates';
import { Money } from '@wf/ui/money';
import { Percent } from '@wf/ui/percent';
import { CreditCard, Split } from 'lucide-react';
import type { ReactNode } from 'react';
import { cardLabel, type CardState } from '../../lib/debts.ts';
import type { CardBill } from '../../server/fn/debts.ts';
import { AccountLogo } from '../accounts/account-logo.tsx';
import { BudgetBar } from '../budget/budget-bar.tsx';
import { Button } from '../form.tsx';

export interface CardSectionProps {
  readonly bill: CardBill;
  readonly state: CardState;
  readonly account: AccountView | undefined;
  /** Names of the installments held against the limit ("sisa pokok A"). */
  readonly heldNames: readonly string[];
  readonly locale: Locale;
}

/** The summary strip of one card. */
export function CardStrip({ bill, state, account, heldNames, locale }: CardSectionProps) {
  const { status, cycle } = state;
  const [only] = bill.transactions;
  const monthName = new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' }).format(
    new Date(`${(cycle?.statementOn ?? '2000-01-01').slice(0, 7)}-01T00:00:00Z`),
  );
  const withInstallments = state.statementMinor > status.currentBillMinor;
  return (
    <section
      aria-label={cardLabel(bill.name, account)}
      className="grid grid-cols-2 items-center gap-4 rounded-[12px] border border-border bg-card px-5 py-4 lg:flex lg:flex-wrap"
    >
      <div className="col-span-2 flex min-w-[220px] flex-1 items-center gap-3">
        <AccountLogo
          account={
            account ?? { id: bill.accountId, type: 'credit_card', color: 'blue', logoKey: null, catalogId: null }
          }
        />
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-[14px] font-semibold text-fg">{cardLabel(bill.name, account)}</span>
          <span className="text-[12px] text-subtle">{m.debts_card_kind_note()}</span>
        </div>
      </div>
      <Kv
        label={m.debts_card_current_bill()}
        note={
          bill.transactions.length === 1 && only !== undefined
            ? `${only.description ?? only.merchant ?? ''} ${formatDate(only.localDate, locale, 'day')}`
            : m.debts_card_transactions({ count: bill.transactions.length, month: monthName })
        }
      >
        {
          <Money
            minor={status.currentBillMinor}
            currency={bill.currency}
            context="table"
            locale={locale}
            className={`text-left! text-[14px] text-fg`}
          />
        }
      </Kv>
      {bill.installmentsHeldMinor > 0n ? (
        <Kv label={m.debts_card_held()} note={m.debts_card_held_note({ names: heldNames.join(', ') })}>
          {
            <Money
              minor={bill.installmentsHeldMinor}
              currency={bill.currency}
              context="table"
              locale={locale}
              className={`text-left! text-[14px] text-fg`}
            />
          }
        </Kv>
      ) : null}
      {bill.limitMinor === null ? null : (
        <Kv
          label={m.debts_card_remaining_limit()}
          note={
            <>
              {m.debts_card_from()}{' '}
              <Money minor={bill.limitMinor} currency={bill.currency} context="amount" locale={locale} />
            </>
          }
        >
          {
            <Money
              minor={status.remainingLimitMinor}
              currency={bill.currency}
              context="table"
              locale={locale}
              className={`text-left! text-[14px] ${status.remainingLimitMinor < 0n ? 'text-red-fg' : 'text-green-fg'}`}
            />
          }
        </Kv>
      )}
      {cycle === null ? null : (
        <Kv
          label={
            withInstallments
              ? m.debts_card_statement({ date: formatDate(cycle.statementOn, locale, 'day') })
              : m.debts_card_bill_on({ date: formatDate(cycle.statementOn, locale, 'day') })
          }
          note={
            withInstallments ? (
              <>
                {m.debts_card_statement_installments()}{' '}
                <Money
                  minor={state.statementMinor - status.currentBillMinor}
                  currency={bill.currency}
                  context="table"
                  locale={locale}
                  className="inline! text-left!"
                />{' '}
                + {m.debts_card_statement_bill()}{' '}
                <Money
                  minor={status.currentBillMinor}
                  currency={bill.currency}
                  context="table"
                  locale={locale}
                  className="inline! text-left!"
                />{' '}
                · {m.debts_card_due_short({ date: formatDate(cycle.dueOn, locale, 'day') })}
              </>
            ) : (
              m.debts_card_pay_by({ date: formatDate(cycle.dueOn, locale, 'day') })
            )
          }
        >
          {
            <Money
              minor={state.statementMinor}
              currency={bill.currency}
              context="table"
              locale={locale}
              className={`text-left! text-[14px] text-fg`}
            />
          }
        </Kv>
      )}
    </section>
  );
}

function Kv({
  label,
  note,
  children,
}: {
  readonly label: string;
  readonly note: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <div className="flex min-w-[150px] flex-1 flex-col gap-0.5 lg:border-l lg:border-border lg:pl-4">
      <span className="text-[12.5px] text-fg">{label}</span>
      <span className="text-[11.5px] text-subtle">{note}</span>
      {children}
    </div>
  );
}

export interface CardBillCardProps extends CardSectionProps {
  readonly onPay: () => void;
  readonly onConvert: () => void;
}

/** "Tagihan BCA Visa": the bill with its transactions and actions. */
export function CardBillCard({ bill, state, account, locale, onPay, onConvert }: CardBillCardProps) {
  const { status, cycle } = state;
  const name = cardLabel(bill.name, account);
  const meta = [
    account?.last4 == null ? null : `•• ${account.last4}`,
    bill.statementDay === null ? null : m.debts_card_statement_day({ day: bill.statementDay }),
    bill.dueDay === null ? null : m.debts_card_due_day({ day: bill.dueDay }),
  ].filter((part) => part !== null);
  return (
    <article
      aria-label={m.debts_card_bill_title({ name: bill.name })}
      className="flex flex-col gap-4 rounded-[12px] border border-border bg-card p-5"
    >
      <header className="flex items-start gap-3">
        <AccountLogo
          account={
            account ?? { id: bill.accountId, type: 'credit_card', color: 'blue', logoKey: null, catalogId: null }
          }
        />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h2 className="flex flex-wrap items-center gap-2 text-[16px] font-semibold text-fg">
            {m.debts_card_bill_title({ name: bill.name })}
            <span className="rounded-[5px] bg-blue-tint-1 px-1.5 py-0.5 text-[11px] font-normal text-blue-fg">
              {m.debts_card_badge()}
            </span>
          </h2>
          <span className="text-[12px] text-subtle">{meta.join(' · ')}</span>
        </div>
        <div className="flex flex-col items-end gap-0.5">
          <Money
            minor={status.currentBillMinor}
            currency={bill.currency}
            context="amount"
            locale={locale}
            className="text-[20px] font-medium text-fg"
          />
          {cycle === null ? null : (
            <span className="text-[12px] text-amber-fg">
              {m.debts_card_pay_by({ date: formatDate(cycle.dueOn, locale, 'day') })}
            </span>
          )}
        </div>
      </header>
      {bill.limitMinor === null || status.usedBps === null ? null : (
        <div className="flex flex-col gap-1.5">
          <BudgetBar usedBps={status.usedBps} tone="warning" idealBps={null} />
          <div className="flex justify-between gap-2 text-[11.5px] text-subtle">
            <span>
              <Percent value={status.usedBps / 10_000} decimals={0} locale={locale} /> {m.debts_card_of_limit()}{' '}
              <Money minor={bill.limitMinor} currency={bill.currency} context="amount" locale={locale} />
            </span>
            <span>
              {m.debts_card_remaining_limit_lower()}{' '}
              <Money minor={status.remainingLimitMinor} currency={bill.currency} context="amount" locale={locale} />
            </span>
          </div>
        </div>
      )}
      <section aria-label={m.debts_card_bill_transactions()} className="flex flex-col">
        <h3 className="pb-1 text-[11px] font-medium tracking-[0.06em] text-subtle uppercase">
          {m.debts_card_bill_transactions()}
        </h3>
        {bill.transactions.length === 0 ? (
          <p className="py-2 text-[12.5px] text-muted-fg">{m.debts_card_bill_empty()}</p>
        ) : (
          <ul className="flex flex-col">
            {bill.transactions.map((row) => (
              <li
                key={row.id}
                className="flex items-center gap-3 border-b border-border py-3 text-[13px] last:border-b-0"
              >
                <span className="min-w-0 flex-1 truncate text-fg">{row.description ?? row.merchant ?? name}</span>
                <span className="font-mono text-[12px] text-subtle">{formatDate(row.localDate, locale, 'day')}</span>
                <Money
                  minor={-row.amountMinor}
                  currency={row.currency}
                  context="amount"
                  locale={locale}
                  className="text-fg"
                />
              </li>
            ))}
          </ul>
        )}
      </section>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={onPay} disabled={status.owedMinor === 0n}>
          <CreditCard aria-hidden="true" className="size-3.5" />
          {m.debts_card_pay()}
        </Button>
        <Button size="sm" variant="secondary" onClick={onConvert}>
          <Split aria-hidden="true" className="size-3.5" />
          {m.debts_card_convert()}
        </Button>
      </div>
    </article>
  );
}
