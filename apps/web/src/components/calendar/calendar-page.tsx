// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Kalender" (FR-C1–C3, design section 08): daily spending, income and scheduled bills in one view, by week, month or
 * year. The month view selects a day (today, else its costliest, else its first) for the breakdown panel, hides
 * layers from the legend, and projects a month that has not started from the current one ("Perkiraan dari pola Okt").
 */
import type { AccountView } from '@wf/db/accounts';
import type { CategoryView } from '@wf/db/categories';
import type { LocalDate, YearMonth } from '@wf/domain/period';
import { m } from '@wf/i18n/messages';
import { EmptyState } from '@wf/ui/empty-state';
import { CalendarDays, Plus, Repeat } from 'lucide-react';
import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import type { CalendarRange, CalendarYear } from '../../server/fn/calendar.ts';
import { weekendRatio } from '../dashboard/calendar-model.ts';
import { Button } from '../form.tsx';
import { useRecordTransaction } from '../ledger/record-transaction.tsx';
import { usePreferences } from '../preferences.tsx';
import { CalendarHeader } from './calendar-header.tsx';
import {
  CALENDAR_LAYERS,
  monthGrid,
  monthOf,
  monthStats,
  weekOf,
  weekStats,
  type CalendarInputs,
  type CalendarLayer,
  type DayDetail,
} from './calendar-model.ts';
import { DayPanel } from './day-panel.tsx';
import { MonthGrid, MonthKpis, WeekdayPattern } from './month-view.tsx';
import { WeekView } from './week-view.tsx';
import { YearView } from './year-view.tsx';

export type CalendarData =
  | {
      readonly view: 'month';
      readonly range: CalendarRange;
      /** The current month's data when the month shown has not started (the projection's pattern). */
      readonly pattern: CalendarRange | null;
    }
  | { readonly view: 'week'; readonly range: CalendarRange }
  | { readonly view: 'year'; readonly year: CalendarYear };

export interface CalendarPageProps {
  readonly data: CalendarData;
  /** The day the view is on. */
  readonly date: LocalDate;
  readonly today: LocalDate;
  readonly accounts: readonly AccountView[];
  readonly categories: readonly CategoryView[];
  readonly baseCurrency: string;
  /** The budget's "batas aman harian", `null` without a budget. */
  readonly safeDailyMinor: bigint | null;
  readonly timeZone: string;
}

export function CalendarPage({
  data,
  date,
  today,
  accounts,
  categories,
  baseCurrency,
  safeDailyMinor,
  timeZone,
}: CalendarPageProps) {
  const { preferences } = usePreferences();
  const { locale } = preferences;
  const record = useRecordTransaction();
  const [layers, setLayers] = useState<readonly CalendarLayer[]>(CALENDAR_LAYERS);
  const [chosen, setChosen] = useState<LocalDate | null>(null);
  const inputsOf = (range: CalendarRange): CalendarInputs => ({ ...range, categories, accounts, today });

  const hasData =
    data.view === 'year' ? data.year.hasTransactions : data.range.hasTransactions || data.range.scheduled.length > 0;
  if (!hasData) {
    return (
      <>
        <CalendarHeader
          view={data.view}
          date={date}
          today={today}
          locale={locale}
          description={m.calendar_description()}
        />
        <EmptyState
          icon={CalendarDays}
          title={m.calendar_empty_title()}
          description={m.calendar_empty_description()}
          actions={
            <>
              <Button
                onClick={() => {
                  record.open();
                }}
              >
                <Plus aria-hidden="true" className="size-4" />
                {m.calendar_record()}
              </Button>
              <Link
                to="/subscriptions"
                search={{ new: true }}
                className="inline-flex h-9 items-center gap-1.5 rounded-[8px] border border-border px-3 text-[13px] text-fg hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
              >
                <Repeat aria-hidden="true" className="size-4" />
                {m.subscriptions_add()}
              </Link>
            </>
          }
        />
      </>
    );
  }

  if (data.view === 'year') {
    const year = Number(date.slice(0, 4));
    const last = today.startsWith(String(year)) ? today.slice(0, 7) : `${String(year)}-12`;
    return (
      <>
        <CalendarHeader
          view="year"
          date={date}
          today={today}
          locale={locale}
          description={m.calendar_year_description({
            // Plain spaces around the dash, as on the server: ICU's thin ones differ between Node and the browser.
            range: new Intl.DateTimeFormat(locale, { month: 'long', timeZone: 'UTC' })
              .formatRange(new Date(`${String(year)}-01-01T00:00:00Z`), new Date(`${last}-01T00:00:00Z`))
              .replace(/[\u2009\u202f]/g, ' '),
            year,
          })}
        />
        <YearView year={year} days={data.year.days} today={today} baseCurrency={baseCurrency} locale={locale} />
      </>
    );
  }

  if (data.view === 'week') {
    const week = weekStats(weekOf(date).first, inputsOf(data.range));
    return (
      <>
        <CalendarHeader
          view="week"
          date={date}
          today={today}
          locale={locale}
          description={m.calendar_week_description({ passed: week.elapsed, ahead: week.daysLeft })}
        />
        <WeekView
          week={week}
          today={today}
          safeDailyMinor={safeDailyMinor}
          categories={categories}
          baseCurrency={baseCurrency}
          timeZone={timeZone}
          locale={locale}
        />
      </>
    );
  }

  const month = date.slice(0, 7) as YearMonth;
  const { first, last } = monthOf(date);
  const future = first > today;
  const pattern = data.pattern === null ? undefined : inputsOf(data.pattern);
  const grid = monthGrid(month, inputsOf(data.range), future ? pattern : undefined);
  const stats = monthStats(grid, today);
  const ratio = weekendRatio({ from: first, to: last }, data.range.days, today);
  const days = grid.flat().filter((day) => day.inRange);
  const fallback = today >= first && today <= last ? today : (stats.costliest?.date ?? first);
  const selectedDate = chosen !== null && chosen >= first && chosen <= last ? chosen : fallback;
  // The selected date is always a day of the shown month.
  const selected = days.find((day) => day.date === selectedDate) as DayDetail;
  const patternMonth = future && pattern !== undefined ? (today.slice(0, 7) as YearMonth) : null;

  return (
    <>
      <CalendarHeader view="month" date={date} today={today} locale={locale} description={m.calendar_description()} />
      <div className="flex flex-col gap-4">
        <MonthKpis
          stats={stats}
          grid={grid}
          weekendRatio={ratio}
          future={future}
          baseCurrency={baseCurrency}
          locale={locale}
        />
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
          <MonthGrid
            month={month}
            grid={grid}
            stats={stats}
            today={today}
            future={future}
            patternMonth={patternMonth}
            selected={selectedDate}
            onSelect={setChosen}
            layers={layers}
            onToggleLayer={(layer) => {
              setLayers((current) =>
                current.includes(layer) ? current.filter((shown) => shown !== layer) : [...current, layer],
              );
            }}
            baseCurrency={baseCurrency}
            locale={locale}
          />
          <div className="flex min-w-0 flex-col gap-4">
            <DayPanel
              day={selected}
              today={today}
              averageMinor={stats.averageMinor}
              patternMonth={patternMonth}
              categories={categories}
              accounts={accounts}
              baseCurrency={baseCurrency}
              timeZone={timeZone}
              locale={locale}
            />
            {future ? null : (
              <WeekdayPattern stats={stats} weekendRatio={ratio} baseCurrency={baseCurrency} locale={locale} />
            )}
          </div>
        </div>
      </div>
    </>
  );
}
