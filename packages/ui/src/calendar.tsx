// SPDX-License-Identifier: AGPL-3.0-only
import type { Locale } from '@wf/domain/money';
import { addDays, parseLocalDate, type LocalDate } from '@wf/domain/period';
import { addMonths, parseISO } from 'date-fns';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { formatDate, formatMonth, fromDate, monthWeeks, weekdayNames, type WeekStart } from './dates.ts';

export interface CalendarLabels {
  previousMonth: string;
  nextMonth: string;
}

export interface CalendarProps {
  /** Any date in the month shown; the caller owns it so two calendars can move together (`RangePicker`). */
  month: LocalDate;
  onMonthChange: (month: LocalDate) => void;
  /** Single selection (`DatePicker`). */
  selected?: LocalDate | null;
  /** Range selection (`RangePicker`): both ends filled, the days between banded. */
  range?: { start: LocalDate; end: LocalDate | null } | null;
  onSelect: (date: LocalDate) => void;
  today: LocalDate;
  locale: Locale;
  /** Default 1 (Monday). */
  weekStartsOn?: WeekStart;
  /** Dates after `today` can be seen but not chosen (FR-S7, past-only filters). */
  disableFuture?: boolean;
  /** Days that get a dot, e.g. days with transactions (FR-T2 "ada transaksi"). */
  isMarked?: ((date: LocalDate) => boolean) | undefined;
  /** Announced after a marked day's name, e.g. "ada transaksi". */
  markerLabel?: string | undefined;
  labels: CalendarLabels;
  /** Which month buttons to show; the two calendars of a range share one pair. Default `both`. */
  navigation?: 'both' | 'previous' | 'next';
}

const NAV_BUTTON =
  'flex size-[26px] items-center justify-center rounded-[6px] border border-border text-muted-fg hover:bg-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-ring';

/** Keyboard moves within the grid (WAI-ARIA date picker pattern), in days; month keys are handled separately. */
const DAY_KEYS: Readonly<Record<string, number>> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };

/**
 * A month grid (`role="grid"`): arrow keys move by day and week, Home/End to the start and end of the week,
 * PageUp/PageDown by month; Enter or Space selects. Only one day is in the tab order (roving tabindex). Disabled days
 * stay focusable so the keyboard can pass over them, but cannot be selected. Days of the neighbouring months fill the
 * first and last week and are only decoration.
 */
export function Calendar({
  month,
  onMonthChange,
  selected = null,
  range = null,
  onSelect,
  today,
  locale,
  weekStartsOn = 1,
  disableFuture = false,
  isMarked,
  markerLabel,
  labels,
  navigation = 'both',
}: CalendarProps) {
  const titleId = useId();
  const grid = useRef<HTMLTableElement>(null);
  const [focused, setFocused] = useState<LocalDate | null>(null);
  const focusAfterRender = useRef(false);
  const monthKey = month.slice(0, 7);
  const firstOfMonth = parseLocalDate(`${monthKey}-01`);
  const inMonth = (date: LocalDate | null): date is LocalDate => date?.slice(0, 7) === monthKey;
  const tabbable = [focused, selected, range?.start ?? null, today].find(inMonth) ?? firstOfMonth;

  useEffect(() => {
    if (!focusAfterRender.current) return;
    focusAfterRender.current = false;
    grid.current?.querySelector<HTMLButtonElement>(`button[data-date="${tabbable}"]`)?.focus();
  });

  const moveTo = (date: LocalDate) => {
    setFocused(date);
    focusAfterRender.current = true;
    if (!inMonth(date)) onMonthChange(date);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTableElement>) => {
    const from = tabbable;
    const weekday = (parseISO(from).getDay() - weekStartsOn + 7) % 7;
    const days = DAY_KEYS[event.key];
    if (days !== undefined) moveTo(addDays(from, days));
    else if (event.key === 'Home') moveTo(addDays(from, -weekday));
    else if (event.key === 'End') moveTo(addDays(from, 6 - weekday));
    else if (event.key === 'PageUp' || event.key === 'PageDown')
      moveTo(fromDate(addMonths(parseISO(from), event.key === 'PageUp' ? -1 : 1)));
    else return;
    event.preventDefault();
  };

  const shift = (months: number) => {
    onMonthChange(fromDate(addMonths(parseISO(firstOfMonth), months)));
  };
  const weekdays = weekdayNames(locale, weekStartsOn);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between pb-1">
        {navigation === 'next' ? (
          <span className="size-[26px]" />
        ) : (
          <button
            type="button"
            className={NAV_BUTTON}
            aria-label={labels.previousMonth}
            onClick={() => {
              shift(-1);
            }}
          >
            <ChevronLeft aria-hidden="true" className="size-[13px]" />
          </button>
        )}
        <p id={titleId} aria-live="polite" className="text-[13px] font-medium text-fg">
          {formatMonth(month, locale)}
        </p>
        {navigation === 'previous' ? (
          <span className="size-[26px]" />
        ) : (
          <button
            type="button"
            className={NAV_BUTTON}
            aria-label={labels.nextMonth}
            onClick={() => {
              shift(1);
            }}
          >
            <ChevronRight aria-hidden="true" className="size-[13px]" />
          </button>
        )}
      </div>
      <table
        ref={grid}
        role="grid"
        aria-labelledby={titleId}
        onKeyDown={onKeyDown}
        className="w-full table-fixed border-separate border-spacing-y-0.5"
      >
        <thead>
          <tr>
            {weekdays.map((name) => (
              <th key={name.long} scope="col" abbr={name.long} className="pb-1 text-[11px] font-normal text-subtle">
                {name.short}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {monthWeeks(month, weekStartsOn).map((week) => (
            <tr key={week[0]}>
              {week.map((date) => {
                const day = String(Number(date.slice(8)));
                if (!inMonth(date)) {
                  return (
                    <td key={date} className="h-[34px] text-center text-[12.5px] text-subtle">
                      <span aria-hidden="true">{day}</span>
                    </td>
                  );
                }
                const disabled = disableFuture && date > today;
                const end = range?.end ?? range?.start;
                const isEnd = selected === date || range?.start === date || end === date;
                const between = range !== null && end !== undefined && date > range.start && date < end;
                const marked = isMarked?.(date) === true;
                const tone = isEnd
                  ? 'rounded-[6px] bg-fg font-semibold text-primary-fg'
                  : disabled
                    ? 'rounded-[6px] text-text-faint'
                    : between
                      ? 'bg-surface-5 text-fg'
                      : 'rounded-[6px] text-fg hover:bg-muted';
                return (
                  <td key={date} role="gridcell" aria-selected={isEnd || between} className="p-0">
                    <button
                      type="button"
                      data-date={date}
                      tabIndex={date === tabbable ? 0 : -1}
                      aria-label={
                        marked && markerLabel !== undefined
                          ? `${formatDate(date, locale, 'full')}, ${markerLabel}`
                          : formatDate(date, locale, 'full')
                      }
                      aria-disabled={disabled || undefined}
                      aria-current={date === today ? 'date' : undefined}
                      onClick={() => {
                        setFocused(date);
                        if (!disabled) onSelect(date);
                      }}
                      className={`flex h-[34px] w-full flex-col items-center justify-center gap-0.5 text-[12.5px] tabular-nums focus-visible:outline-2 focus-visible:outline-ring aria-disabled:cursor-default aria-[current=date]:font-semibold ${tone}`}
                    >
                      {day}
                      {marked ? (
                        <span
                          aria-hidden="true"
                          className={`size-[3px] rounded-full ${isEnd ? 'bg-primary-fg' : 'bg-red'}`}
                        />
                      ) : null}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
