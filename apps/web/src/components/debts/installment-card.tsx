// SPDX-License-Identifier: AGPL-3.0-only
/**
 * One debt (FR-U1–U4, design `uzcYs`): what is left of the principal, the share paid ("67% lunas · Rp2.000.000
 * dilunasi lebih awal"), "JADWAL CICILAN" (card rows are billed on their statement and due on the card's due date;
 * other rows are paid from "Bayar dari" through the Review queue), and "RIWAYAT" (early payoffs and how it was made).
 */
import type { AccountView } from '@wf/db/accounts';
import { cardCycle } from '@wf/domain/creditcard';
import type { DebtKind } from '@wf/domain/debt';
import type { Locale } from '@wf/i18n/locale';
import { m } from '@wf/i18n/messages';
import { formatDate } from '@wf/ui/dates';
import { Money } from '@wf/ui/money';
import { Percent } from '@wf/ui/percent';
import {
  ArrowDownToLine,
  CalendarPlus,
  CreditCard,
  Home,
  Smartphone,
  Users,
  WalletCards,
  type LucideIcon,
} from 'lucide-react';
import { cardLabel, paidOffBps, settledCount } from '../../lib/debts.ts';
import type { CardBill, DebtItem } from '../../server/fn/debts.ts';
import { BudgetBar } from '../budget/budget-bar.tsx';

export const KIND_ICONS: Readonly<Record<DebtKind, LucideIcon>> = {
  card_installment: CreditCard,
  paylater: Smartphone,
  zero_percent: WalletCards,
  mortgage: Home,
  personal_loan: Users,
};

export const KIND_LABELS: Readonly<Record<DebtKind, () => string>> = {
  card_installment: m.debts_kind_card,
  paylater: m.debts_kind_paylater,
  zero_percent: m.debts_kind_zero,
  mortgage: m.debts_kind_mortgage,
  personal_loan: m.debts_kind_loan,
};

export interface InstallmentCardProps {
  readonly debt: DebtItem;
  /** The card of a card installment. */
  readonly card: CardBill | undefined;
  readonly accounts: readonly AccountView[];
  readonly locale: Locale;
}

export function InstallmentCard({ debt, card, accounts, locale }: InstallmentCardProps) {
  const Icon = KIND_ICONS[debt.kind];
  const isCard = debt.kind === 'card_installment';
  const account = accounts.find((candidate) => candidate.id === (debt.cardAccountId ?? debt.payFromAccountId));
  const rate = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(debt.monthlyRateBps / 100);
  const meta = [
    isCard ? cardLabel(card?.name ?? debt.provider ?? '', account) : (debt.provider ?? account?.displayName ?? null),
    `${rate}%`,
    debt.sourceDate === null
      ? null
      : m.debts_item_from_transaction({ date: formatDate(debt.sourceDate, locale, 'day') }),
    m.debts_item_months({ count: debt.tenorMonths }),
  ].filter((part) => part !== null);
  const paidBps = paidOffBps(debt);
  const settled = settledCount(debt);
  const days =
    card?.statementDay != null && card.dueDay != null ? { statement: card.statementDay, due: card.dueDay } : null;
  return (
    <article aria-label={debt.name} className="flex flex-col gap-4 rounded-[12px] border border-border bg-card p-5">
      <header className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-blue-tint-1 text-blue-fg">
          <Icon aria-hidden="true" className="size-4.5" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h2 className="flex flex-wrap items-center gap-2 text-[16px] font-semibold text-fg">
            {debt.name}
            <span className="rounded-[5px] bg-blue-tint-1 px-1.5 py-0.5 text-[11px] font-normal text-blue-fg">
              {KIND_LABELS[debt.kind]()}
            </span>
          </h2>
          <span className="text-[12px] text-subtle">{meta.join(' · ')}</span>
        </div>
        <div className="flex flex-col items-end gap-0.5">
          {
            <Money
              minor={debt.remainingPrincipalMinor}
              currency={debt.currency}
              context={'amount'}
              locale={locale}
              className={'text-[20px] font-medium text-fg'}
            />
          }
          <span className="text-[12px] text-subtle">
            {m.debts_item_left_of()}{' '}
            {
              <Money
                minor={debt.principalMinor}
                currency={debt.currency}
                context={'amount'}
                locale={locale}
                className={''}
              />
            }
          </span>
        </div>
      </header>
      <div className="flex flex-col gap-1.5">
        <BudgetBar usedBps={paidBps} tone="ok" idealBps={null} />
        <div className="flex flex-wrap justify-between gap-2 text-[11.5px]">
          <span className="text-green-fg">
            <Percent value={paidBps / 10_000} decimals={0} locale={locale} /> {m.debts_item_paid()}
            {debt.paidEarlyMinor > 0n ? (
              <>
                {' · '}
                {
                  <Money
                    minor={debt.paidEarlyMinor}
                    currency={debt.currency}
                    context={'amount'}
                    locale={locale}
                    className={''}
                  />
                }{' '}
                {m.debts_item_paid_early()}
              </>
            ) : null}
          </span>
          <span className="text-subtle">
            {isCard
              ? m.debts_item_billed({ count: settled, total: debt.installments.length })
              : m.debts_item_settled({ count: settled, total: debt.installments.length })}
          </span>
        </div>
      </div>
      <section aria-label={m.debts_item_schedule()} className="flex flex-col gap-2">
        <h3 className="text-[11px] font-medium tracking-[0.06em] text-subtle uppercase">
          {m.debts_item_schedule()}
          {debt.recalculatedAt === null
            ? null
            : ` · ${m.debts_item_recalculated({ date: formatDate(debt.allocations.at(-1)?.localDate ?? debt.firstDueDate, locale, 'day') })}`}
        </h3>
        <table className="w-full overflow-hidden rounded-[10px] border border-border text-[12.5px]">
          <tbody>
            {debt.installments.map((row) => {
              const due = days === null ? null : cardCycle(row.dueDate, days.statement, days.due).dueOn;
              const status = row.status === 'paid' ? 'paid' : row.billed ? 'billed' : 'scheduled';
              return (
                <tr key={row.id} className="border-b border-border last:border-b-0">
                  <td className="px-3 py-2.5 font-mono text-muted-fg">
                    {row.seq}/{debt.installments.length}
                  </td>
                  <td className="px-3 py-2.5 text-fg">
                    {isCard
                      ? m.debts_item_row_card()
                      : m.debts_item_row_pay_from({ account: account?.displayName ?? '' })}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-subtle">
                    {formatDate(row.dueDate, locale, 'day')}
                    {due === null ? null : ` · ${m.debts_card_due_short({ date: formatDate(due, locale, 'day') })}`}
                  </td>
                  <td className="px-3 py-2.5">
                    {
                      <Money
                        minor={row.totalMinor}
                        currency={debt.currency}
                        context={'table'}
                        locale={locale}
                        className={'text-fg'}
                      />
                    }
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <span className="rounded-[5px] border border-border px-1.5 py-0.5 text-[11px] text-muted-fg">
                      {status === 'paid'
                        ? m.debts_item_status_paid()
                        : status === 'billed'
                          ? m.debts_item_status_billed()
                          : m.debts_item_status_scheduled()}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {debt.recalcMode === null ? null : (
          <p className="text-[12px] text-subtle">
            {debt.recalcMode === 'reduce_amount' ? m.debts_item_mode_reduce() : m.debts_item_mode_shorten()}
          </p>
        )}
      </section>
      <section aria-label={m.debts_item_history()} className="flex flex-col gap-3">
        <h3 className="text-[11px] font-medium tracking-[0.06em] text-subtle uppercase">{m.debts_item_history()}</h3>
        <ol className="flex flex-col gap-3">
          {[...debt.allocations].reverse().map((allocation) => (
            <li key={allocation.transactionId} className="flex gap-3">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-green-tint-1 text-green-fg">
                <ArrowDownToLine aria-hidden="true" className="size-3.5" />
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex justify-between gap-2 text-[13px] text-fg">
                  <span>
                    {m.debts_item_event_paid()}{' '}
                    {
                      <Money
                        minor={allocation.amountMinor}
                        currency={debt.currency}
                        context={'amount'}
                        locale={locale}
                        className={''}
                      />
                    }
                  </span>
                  <span className="font-mono text-[12px] text-subtle">
                    {formatDate(allocation.localDate, locale, 'day')}
                  </span>
                </span>
                <span className="text-[12px] text-subtle">
                  {m.debts_item_event_paid_note({ card: card?.name ?? debt.provider ?? '' })}
                </span>
              </div>
            </li>
          ))}
          <li className="flex gap-3">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-3 text-muted-fg">
              <CalendarPlus aria-hidden="true" className="size-3.5" />
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="flex justify-between gap-2 text-[13px] text-fg">
                {debt.sourceDate === null ? m.debts_item_event_created() : m.debts_item_event_converted()}
                <span className="font-mono text-[12px] text-subtle">
                  {formatDate(debt.sourceDate ?? debt.firstDueDate, locale, 'day')}
                </span>
              </span>
              <span className="text-[12px] text-subtle">
                {debt.sourceDate === null
                  ? m.debts_item_event_created_note({ count: debt.tenorMonths })
                  : m.debts_item_event_converted_note({
                      count: debt.tenorMonths,
                      date: formatDate(debt.sourceDate, locale, 'day'),
                    })}{' '}
                {
                  <Money
                    minor={debt.principalMinor}
                    currency={debt.currency}
                    context={'amount'}
                    locale={locale}
                    className={''}
                  />
                }
              </span>
            </div>
          </li>
        </ol>
      </section>
    </article>
  );
}
