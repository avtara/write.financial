// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A day's breakdown (FR-C3, design `sYRh0`, `V0mbHr`, `z6baj`): the day's net with its ratio to the daily average,
 * spending per category, the transactions (time, category, account, tags), the scheduled events with "Buka di
 * Langganan", the projected income of a month that has not started ("Perkiraan dari pola Okt"), "Buka di Transaksi",
 * and "Catat di tanggal ini" — the Record sheet on that day at 12.00.
 */
import { Link } from '@tanstack/react-router';
import type { AccountView } from '@wf/db/accounts';
import type { CategoryView } from '@wf/db/categories';
import type { LocalDate, YearMonth } from '@wf/domain/period';
import type { Locale } from '@wf/i18n/locale';
import { m } from '@wf/i18n/messages';
import { formatDate, formatTime } from '@wf/ui/dates';
import { Money } from '@wf/ui/money';
import { ArrowUpRight, CalendarClock, Info, Plus } from 'lucide-react';
import { categoryName } from '../../lib/ledger-labels.ts';
import { CategoryIcon } from '../category-icon.tsx';
import { Button } from '../form.tsx';
import { useRecordTransaction } from '../ledger/record-transaction.tsx';
import { daysFrom } from '../subscriptions/subscriptions-model.ts';
import { SignedMoney } from '../transactions/transaction-row.tsx';
import { abs, type DayDetail } from './calendar-model.ts';

/** "Catat di tanggal ini" records at noon (FR-C3). */
export const CALENDAR_RECORD_TIME = '12:00';

export interface DayPanelProps {
  readonly day: DayDetail;
  readonly today: LocalDate;
  readonly averageMinor: bigint;
  /** The month a projection comes from ("pola Okt"), for days of a month that has not started. */
  readonly patternMonth: YearMonth | null;
  readonly categories: readonly CategoryView[];
  readonly accounts: readonly AccountView[];
  readonly baseCurrency: string;
  readonly timeZone: string;
  readonly locale: Locale;
}

export function DayPanel({
  day,
  today,
  averageMinor,
  patternMonth,
  categories,
  accounts,
  baseCurrency,
  timeZone,
  locale,
}: DayPanelProps) {
  const record = useRecordTransaction();
  const categoryOf = new Map(categories.map((category) => [category.id, category]));
  const accountOf = new Map(accounts.map((account) => [account.id, account]));
  const netMinor = day.inMinor - day.outMinor + day.projected.reduce((total, income) => total + income.amountMinor, 0n);
  const ratio = averageMinor === 0n || day.outMinor === 0n ? null : Number(day.outMinor) / Number(averageMinor);
  const until = daysFrom(today, day.date);
  const weekend = new Date(`${day.date}T00:00:00Z`).getUTCDay() % 6 === 0;
  const spending = new Map<string | null, bigint>();
  for (const row of day.rows) {
    if (row.type !== 'expense') continue;
    spending.set(row.categoryId, (spending.get(row.categoryId) ?? 0n) + abs(row.amountBaseMinor));
  }
  const byCategory = [...spending].toSorted((a, b) => Number(b[1] - a[1]));
  const patternName =
    patternMonth === null
      ? ''
      : new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' }).format(
          new Date(`${patternMonth}-01T00:00:00Z`),
        );
  const facts = [
    day.future && until > 0 ? m.calendar_day_in({ days: until }) : null,
    day.rows.length > 0 ? m.calendar_tip_count({ count: day.rows.length }) : null,
    day.scheduled.length > 0 ? m.calendar_day_scheduled({ count: day.scheduled.length }) : null,
    weekend ? m.calendar_day_weekend() : null,
  ].filter((fact) => fact !== null);

  return (
    <section aria-labelledby="calendar-day" className="flex flex-col rounded-[12px] border border-border bg-card">
      <header className="flex flex-col gap-0.5 border-b border-border px-5 py-4">
        <h2 id="calendar-day" className="text-[15px] font-semibold text-fg">
          {formatDate(day.date, locale, 'full')}
        </h2>
        <p className="text-[12px] text-subtle">{facts.length === 0 ? m.calendar_day_empty() : facts.join(' · ')}</p>
      </header>
      <div className="flex flex-col gap-4 px-5 py-4">
        <p className="flex flex-wrap items-center gap-2">
          <SignedMoney
            amountMinor={netMinor}
            currency={baseCurrency}
            locale={locale}
            className="text-[24px] font-medium"
          />
          {ratio === null ? null : (
            <span className="rounded-[4px] bg-red-tint-2 px-1.5 text-[11px] text-red-fg">
              {m.calendar_tip_ratio({
                times: new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(ratio),
              })}
            </span>
          )}
          {day.projected.length > 0 ? (
            <span className="rounded-[4px] bg-blue-tint-2 px-1.5 text-[11px] text-blue-fg">
              {m.calendar_projection()}
            </span>
          ) : null}
        </p>
        {byCategory.length === 0 ? null : (
          <ul aria-label={m.calendar_day_by_category()} className="flex flex-col gap-1">
            {byCategory.map(([categoryId, totalMinor]) => {
              const category = categoryId === null ? undefined : categoryOf.get(categoryId);
              return (
                <li key={categoryId ?? 'none'} className="flex items-center justify-between gap-2 text-[12.5px]">
                  <span className="text-muted-fg">
                    {category === undefined ? m.calendar_uncategorized() : categoryName(category)}
                  </span>
                  <Money
                    minor={totalMinor}
                    currency={baseCurrency}
                    context="amount"
                    locale={locale}
                    className="text-fg"
                  />
                </li>
              );
            })}
          </ul>
        )}
        {day.projected.length > 0 ? (
          <p className="flex gap-2 rounded-[10px] border border-border bg-surface-2 p-3 text-[12px] text-muted-fg">
            <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
            {m.calendar_day_projection({ month: patternName })}
          </p>
        ) : null}
        {day.rows.length === 0 && day.scheduled.length === 0 && day.projected.length === 0 ? (
          <p className="text-[12.5px] text-subtle">
            {day.future ? m.calendar_day_no_transactions_future() : m.calendar_day_no_transactions()}
          </p>
        ) : null}
        <ul aria-label={m.calendar_day_items()} className="flex flex-col">
          {day.projected.map((income) => (
            <li key={`projected-${income.label}`} className="flex items-center gap-3 border-t border-border py-2.5">
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[13px] text-fg">{income.label}</span>
                <span className="text-[11.5px] text-subtle">{m.calendar_day_regular_income()}</span>
              </span>
              <SignedMoney amountMinor={income.amountMinor} currency={baseCurrency} locale={locale} />
            </li>
          ))}
          {day.scheduled.map((item) => {
            const account = accountOf.get(item.accountId);
            return (
              <li
                key={`${item.sourceId}-${item.dueDate}`}
                className="flex items-center gap-3 border-t border-border py-2.5"
              >
                <CalendarClock aria-hidden="true" className="size-4 shrink-0 text-amber-fg" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[13px] text-fg">{item.name ?? m.calendar_scheduled_unnamed()}</span>
                  <span className="text-[11.5px] text-subtle">
                    {[
                      item.sourceType === 'subscription' ? m.nav_subscriptions() : m.calendar_day_recurring(),
                      account?.displayName,
                      m.calendar_day_scheduled_status(),
                    ]
                      .filter((part) => part !== undefined)
                      .join(' · ')}
                  </span>
                  {item.sourceType === 'subscription' ? (
                    <Link
                      to="/subscriptions"
                      search={{ subscription: item.sourceId }}
                      className="inline-flex w-fit items-center gap-0.5 text-[12px] font-medium text-blue-fg hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                    >
                      {m.calendar_day_open_subscription()}
                      <ArrowUpRight aria-hidden="true" className="size-3" />
                    </Link>
                  ) : null}
                </span>
                {item.direction === 'transfer' ? (
                  <Money minor={item.expectedMinor} currency={item.currency} context="amount" locale={locale} />
                ) : (
                  <SignedMoney
                    amountMinor={item.direction === 'in' ? item.expectedMinor : -item.expectedMinor}
                    currency={item.currency}
                    locale={locale}
                  />
                )}
              </li>
            );
          })}
          {day.rows.map((row) => {
            const category = row.categoryId === null ? undefined : categoryOf.get(row.categoryId);
            const account = accountOf.get(row.accountId);
            return (
              <li key={row.id} className="flex items-center gap-3 border-t border-border py-2.5">
                {category === undefined ? (
                  <span aria-hidden="true" className="size-7 shrink-0 rounded-[7px] bg-tint-06" />
                ) : (
                  <CategoryIcon icon={category.icon} color={category.color} />
                )}
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[13px] text-fg">
                    {row.merchant ?? row.description ?? m.calendar_untitled()}
                  </span>
                  <span className="truncate text-[11.5px] text-subtle">
                    {[
                      category === undefined ? null : categoryName(category),
                      account?.displayName ?? null,
                      formatTime(row.occurredAt, timeZone, locale),
                      ...row.tags.map((tag) => `#${tag}`),
                    ]
                      .filter((part) => part !== null)
                      .join(' · ')}
                  </span>
                </span>
                {row.type === 'transfer' ? (
                  <Money minor={abs(row.amountMinor)} currency={row.currency} context="amount" locale={locale} />
                ) : (
                  <SignedMoney amountMinor={row.amountMinor} currency={row.currency} locale={locale} />
                )}
              </li>
            );
          })}
        </ul>
      </div>
      <footer className="flex flex-wrap gap-2 border-t border-border px-5 py-3">
        <Link
          to="/transactions"
          search={{ range: `${day.date}..${day.date}` }}
          className="inline-flex h-9 items-center gap-1 rounded-[8px] border border-border px-3 text-[13px] text-fg hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
        >
          {m.calendar_day_open_transactions()}
          <ArrowUpRight aria-hidden="true" className="size-3.5" />
        </Link>
        {day.date > today ? null : (
          <Button
            onClick={() => {
              record.open({ date: day.date, time: CALENDAR_RECORD_TIME });
            }}
          >
            <Plus aria-hidden="true" className="size-4" />
            {m.calendar_day_record()}
          </Button>
        )}
      </footer>
    </section>
  );
}
