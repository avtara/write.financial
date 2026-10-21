// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The calendar's header (design `zEWoe`, `qYzQD`, `Ncucu`): the title with what the view shows, Minggu / Bulan / Tahun,
 * the previous and next week, month or year, "Hari ini", and "Catat Transaksi". Every switch is a link, so the view
 * lives in the URL (`?view=week|year`, `?date=YYYY-MM-DD`).
 */
import { Link } from '@tanstack/react-router';
import { addDays, type LocalDate, type YearMonth } from '@wf/domain/period';
import type { Locale } from '@wf/i18n/locale';
import { m } from '@wf/i18n/messages';
import { formatDateRange, formatMonth } from '@wf/ui/dates';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '../form.tsx';
import { useRecordTransaction } from '../ledger/record-transaction.tsx';
import { PageHeader } from '../page-header.tsx';
import { shiftMonth, weekOf, type CalendarView } from './calendar-model.ts';

const SEGMENT =
  'inline-flex items-center rounded-[6px] px-3 py-[5px] text-[12.5px] text-muted-fg hover:text-fg focus-visible:outline-2 focus-visible:outline-ring aria-[current=page]:bg-muted aria-[current=page]:font-medium aria-[current=page]:text-fg';
const SQUARE =
  'inline-flex size-8 items-center justify-center rounded-[7px] text-muted-fg hover:bg-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-ring';

/** The URL search of a view on a date (the month view and today are the defaults). */
export function calendarSearch(view: CalendarView, date: LocalDate, today: LocalDate) {
  return {
    ...(view === 'month' ? {} : { view }),
    ...(date === today ? {} : { date }),
  };
}

export interface CalendarHeaderProps {
  readonly view: CalendarView;
  /** The day the view is on. */
  readonly date: LocalDate;
  readonly today: LocalDate;
  readonly locale: Locale;
  readonly description: ReactNode;
}

export function CalendarHeader({ view, date, today, locale, description }: CalendarHeaderProps) {
  const record = useRecordTransaction();
  const step = (direction: 1 | -1): LocalDate => {
    if (view === 'week') return addDays(weekOf(date).first, 7 * direction);
    if (view === 'month') return `${shiftMonth(date.slice(0, 7) as YearMonth, direction)}-01` as LocalDate;
    return `${String(Number(date.slice(0, 4)) + direction)}-01-01` as LocalDate;
  };
  const week = weekOf(date);
  const title =
    view === 'week'
      ? formatDateRange(
          { start: week.first, end: week.last },
          locale,
          `${date.slice(0, 4)}-01-01` as LocalDate,
        ).replace(
          // The same text on the server and in the browser: ICU's thin spaces around the dash differ between them.
          /[\u2009\u202f]/g,
          ' ',
        )
      : view === 'month'
        ? formatMonth(date, locale)
        : date.slice(0, 4);
  const views = [
    ['week', m.calendar_view_week()],
    ['month', m.calendar_view_month()],
    ['year', m.calendar_view_year()],
  ] as const;
  return (
    <PageHeader
      breadcrumb={[m.breadcrumb_finance(), m.nav_calendar()]}
      title={m.nav_calendar()}
      description={description}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <nav aria-label={m.calendar_view_label()}>
            <ul className="inline-flex gap-0.5 rounded-[8px] border border-border bg-card p-[3px]">
              {views.map(([value, label]) => (
                <li key={value}>
                  <Link
                    to="/calendar"
                    search={calendarSearch(value, date, today)}
                    aria-current={view === value ? 'page' : undefined}
                    className={SEGMENT}
                  >
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <div className="inline-flex items-center gap-1 rounded-[8px] border border-border bg-card p-[3px]">
            <Link
              to="/calendar"
              search={calendarSearch(view, step(-1), today)}
              aria-label={m.calendar_previous()}
              className={SQUARE}
            >
              <ChevronLeft aria-hidden="true" className="size-4" />
            </Link>
            <span aria-live="polite" className="min-w-[120px] px-2 text-center text-[13px] font-medium text-fg">
              {title}
            </span>
            <Link
              to="/calendar"
              search={calendarSearch(view, step(1), today)}
              aria-label={m.calendar_next()}
              className={SQUARE}
            >
              <ChevronRight aria-hidden="true" className="size-4" />
            </Link>
          </div>
          <Link
            to="/calendar"
            search={calendarSearch(view, today, today)}
            className="inline-flex h-9 items-center rounded-[8px] border border-border px-3 text-[13px] text-fg hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
          >
            {m.calendar_today()}
          </Link>
          <Button
            onClick={() => {
              record.open();
            }}
          >
            <Plus aria-hidden="true" className="size-4" />
            {m.calendar_record()}
          </Button>
        </div>
      }
    />
  );
}
