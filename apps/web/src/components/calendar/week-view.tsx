// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The calendar's week (FR-C1, design `qYzQD`, `oELDK`): "Keluar minggu ini" with its daily average, the same weekdays
 * of last week ("vs Sen–Kam lalu"), income, what is scheduled for the rest of the week, and "Batas aman sisa minggu"
 * (the budget's safe daily limit × the days left); then one column per day with its transactions by hour, its
 * scheduled events, the safe limit of the days to come, and "Catat" on the days that passed.
 */
import { addDays, type LocalDate } from '@wf/domain/period';
import type { Locale } from '@wf/i18n/locale';
import { m } from '@wf/i18n/messages';
import { formatDate, formatDateRange, formatTime, weekdayNames } from '@wf/ui/dates';
import { Money } from '@wf/ui/money';
import { Percent } from '@wf/ui/percent';
import { CalendarClock, Plus } from 'lucide-react';
import type { ReactNode } from 'react';
import type { CategoryView } from '@wf/db/categories';
import { useRecordTransaction } from '../ledger/record-transaction.tsx';
import { RichMessage } from '../rich-message.tsx';
import { SignedMoney } from '../transactions/transaction-row.tsx';
import { abs, type WeekStats } from './calendar-model.ts';
import { Kpi, KpiStrip } from './calendar-kpi.tsx';
import { CALENDAR_RECORD_TIME } from './day-panel.tsx';

export interface WeekViewProps {
  readonly week: WeekStats;
  readonly today: LocalDate;
  /** The budget's "batas aman harian" (`null` without a budget). */
  readonly safeDailyMinor: bigint | null;
  readonly categories: readonly CategoryView[];
  readonly baseCurrency: string;
  readonly timeZone: string;
  readonly locale: Locale;
}

/** The left edge of a transaction card: its kind (needs, wants, income, transfer). */
const EDGE = {
  needs: 'border-l-blue',
  wants: 'border-l-violet',
  income: 'border-l-green',
  transfer: 'border-l-subtle',
  other: 'border-l-border',
} as const;

export function WeekView({ week, today, safeDailyMinor, categories, baseCurrency, timeZone, locale }: WeekViewProps) {
  const record = useRecordTransaction();
  const groupOf = new Map(categories.map((category) => [category.id, category.group]));
  const names = weekdayNames(locale, 1);
  const first = week.days[0];
  const passed = names.slice(0, Math.max(week.elapsed, 1)).map((name) => name.short);
  const passedNames = [passed[0], passed.at(-1)].join('–');
  const change =
    week.previousMinor === null || week.previousMinor === 0n
      ? null
      : Number(week.spentMinor - week.previousMinor) / Number(week.previousMinor);
  const [nextBill] = week.scheduled.filter((item) => item.direction === 'out');
  const scheduledMinor = week.scheduled
    .filter((item) => item.direction === 'out')
    .reduce((total, item) => total + item.expectedMinor, 0n);
  const safeMinor = safeDailyMinor === null ? null : safeDailyMinor * BigInt(week.daysLeft);
  const money = (minor: bigint): ReactNode => (
    <Money minor={minor} currency={baseCurrency} context="amount" locale={locale} />
  );
  const average = money(week.averageMinor);
  const previous = week.previousMinor === null ? null : money(week.previousMinor);
  const scheduled = money(scheduledMinor);
  const safe = safeMinor === null ? '—' : money(safeMinor);
  const safeDaily = safeDailyMinor === null ? null : money(safeDailyMinor);

  return (
    <div className="flex flex-col gap-4">
      <KpiStrip columns={5}>
        <Kpi
          label={m.calendar_week_out()}
          value={<SignedMoney amountMinor={-week.spentMinor} currency={baseCurrency} locale={locale} />}
          note={
            <>
              {m.calendar_week_out_note({ days: week.elapsed })} ·{' '}
              <RichMessage message={m.calendar_week_average} slots={{ amount: average }} />
            </>
          }
        />
        <Kpi
          label={m.calendar_week_vs({ days: passedNames })}
          value={change === null ? '—' : <Percent value={change} signed locale={locale} />}
          note={
            week.previousMinor === null || first === undefined ? null : (
              <>
                {formatDateRange(
                  { start: addDays(first.date, -7), end: addDays(first.date, week.elapsed - 8) },
                  locale,
                  today,
                )}
                : {previous}
              </>
            )
          }
        />
        <Kpi
          label={m.calendar_week_in()}
          value={<SignedMoney amountMinor={week.incomeMinor} currency={baseCurrency} locale={locale} />}
          note={
            <>
              {week.largestIncome === null
                ? null
                : `${week.largestIncome.merchant ?? week.largestIncome.description ?? m.calendar_untitled()} · ${formatDate(week.largestIncome.localDate, locale, 'day')}`}
            </>
          }
        />
        <Kpi
          label={m.calendar_week_scheduled()}
          value={scheduled}
          note={
            <>
              {nextBill === undefined
                ? null
                : `${nextBill.name ?? m.calendar_scheduled_unnamed()} · ${formatDate(nextBill.dueDate, locale, 'weekday')}`}
            </>
          }
        />
        <Kpi
          label={m.calendar_week_safe()}
          value={safe}
          note={
            <>
              {safeDailyMinor === null ? (
                m.calendar_week_safe_none()
              ) : (
                <RichMessage
                  message={m.calendar_week_safe_note}
                  slots={{ amount: safeDaily, days: String(week.daysLeft) }}
                />
              )}
            </>
          }
        />
      </KpiStrip>

      <section
        aria-label={m.calendar_week_days()}
        className="overflow-x-auto rounded-[12px] border border-border bg-card"
      >
        <ol className="grid min-w-[980px] grid-cols-7">
          {week.days.map((day, index) => {
            const isToday = day.date === today;
            return (
              <li
                key={day.date}
                aria-label={formatDate(day.date, locale, 'full')}
                data-today={isToday ? 'true' : undefined}
                className="flex min-w-0 flex-col border-r border-border last:border-r-0 data-[today=true]:bg-blue-tint-1"
              >
                <header className="flex flex-col gap-1 border-b border-border px-3 py-3">
                  <span className="flex items-center gap-1.5 text-[12px] text-subtle">
                    {names[index]?.short}
                    <span className="text-[15px] font-semibold text-fg">{Number(day.date.slice(8))}</span>
                    {isToday ? (
                      <span className="rounded-[4px] bg-blue px-1 text-[9.5px] text-on-accent">
                        {m.calendar_today()}
                      </span>
                    ) : null}
                  </span>
                  {day.future ? (
                    safeDailyMinor === null ? null : (
                      <span className="text-[11.5px] text-subtle">
                        <RichMessage message={m.calendar_week_limit} slots={{ amount: safeDaily }} />
                      </span>
                    )
                  ) : (
                    <span className="flex items-center gap-1.5 font-mono text-[13px]">
                      <Money
                        minor={day.inMinor - day.outMinor}
                        currency={baseCurrency}
                        context="delta"
                        locale={locale}
                      />
                      {day.surplus ? (
                        <span className="rounded-[4px] bg-green-tint-2 px-1 font-sans text-[10px] text-green-fg">
                          {m.calendar_surplus()}
                        </span>
                      ) : null}
                    </span>
                  )}
                </header>
                <ul className="flex flex-col gap-2 p-2">
                  {day.rows.map((row) => {
                    const kind =
                      row.type === 'expense'
                        ? groupOf.get(row.categoryId ?? '') === 'needs'
                          ? 'needs'
                          : groupOf.get(row.categoryId ?? '') === 'wants'
                            ? 'wants'
                            : 'other'
                        : row.type === 'income'
                          ? 'income'
                          : 'transfer';
                    return (
                      <li
                        key={row.id}
                        className={`flex flex-col gap-0.5 rounded-[8px] border border-l-[3px] border-border px-2.5 py-2 ${EDGE[kind]}`}
                      >
                        <span className="font-mono text-[11px] text-subtle">
                          {formatTime(row.occurredAt, timeZone, locale)}
                        </span>
                        <span className="truncate text-[12.5px] text-fg">
                          {row.merchant ?? row.description ?? m.calendar_untitled()}
                        </span>
                        {row.type === 'transfer' ? (
                          <Money
                            minor={abs(row.amountMinor)}
                            currency={row.currency}
                            context="amount"
                            locale={locale}
                            className="text-[12px]"
                          />
                        ) : (
                          <SignedMoney
                            amountMinor={row.amountMinor}
                            currency={row.currency}
                            locale={locale}
                            className="text-[12px]"
                          />
                        )}
                      </li>
                    );
                  })}
                  {day.scheduled.map((item) => (
                    <li
                      key={`${item.sourceId}-${item.dueDate}`}
                      className="flex flex-col gap-0.5 rounded-[8px] border border-dashed border-border px-2.5 py-2"
                    >
                      <span className="flex items-center gap-1 text-[11px] text-subtle">
                        <CalendarClock aria-hidden="true" className="size-3" />
                        {m.calendar_day_scheduled_status()}
                      </span>
                      <span className="truncate text-[12.5px] text-fg">
                        {item.name ?? m.calendar_scheduled_unnamed()}
                      </span>
                      <SignedMoney
                        amountMinor={item.direction === 'in' ? item.expectedMinor : -item.expectedMinor}
                        currency={item.currency}
                        locale={locale}
                        className="text-[12px]"
                      />
                    </li>
                  ))}
                  {day.date > today ? null : (
                    <li>
                      <button
                        type="button"
                        onClick={() => {
                          record.open({ date: day.date, time: CALENDAR_RECORD_TIME });
                        }}
                        aria-label={m.calendar_week_record({ date: formatDate(day.date, locale, 'day') })}
                        className="flex w-full items-center justify-center gap-1 rounded-[8px] border border-border py-1.5 text-[12px] text-muted-fg hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
                      >
                        <Plus aria-hidden="true" className="size-3.5" />
                        {m.calendar_week_record_short()}
                      </button>
                    </li>
                  )}
                </ul>
              </li>
            );
          })}
        </ol>
      </section>
    </div>
  );
}
