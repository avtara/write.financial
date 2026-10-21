// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Calendar-date helpers for the date components. Dates are domain `LocalDate`s (`2026-10-15`, no time zone).
 * date-fns does month and week arithmetic on local-midnight `Date`s (`parseISO` of a date-only string), so no time
 * zone is ever crossed; an instant becomes a calendar date only through {@link toLocalDate} with the user's time zone.
 * Names of months and days come from `Intl` for the active locale (`Okt`, `Kamis`; `Oct`, `Thursday`).
 */
import { TZDate } from '@date-fns/tz';
import type { Locale } from '@wf/domain/money';
import { parseLocalDate, type LocalDate } from '@wf/domain/period';
import { eachWeekOfInterval, endOfMonth, format, parseISO, startOfMonth } from 'date-fns';

/** First day of the week: 1 = Monday (Indonesia, the default), 0 = Sunday. */
export type WeekStart = 0 | 1;

/** An inclusive range of calendar dates. */
export interface DateRange {
  readonly start: LocalDate;
  readonly end: LocalDate;
}

/**
 * - `day`: `15 Okt` · `date`: `15 Okt 2026` · `weekday`: `Kamis, 15 Okt` · `full`: `Kamis, 15 Oktober 2026`
 *   (`Oct 15` · `Oct 15, 2026` · `Thursday, Oct 15` · `Thursday, October 15, 2026` in English).
 */
export type DateFormat = 'day' | 'date' | 'weekday' | 'full';

const FORMATS: Readonly<Record<DateFormat, Intl.DateTimeFormatOptions>> = {
  day: { day: 'numeric', month: 'short' },
  date: { day: 'numeric', month: 'short', year: 'numeric' },
  weekday: { weekday: 'long', day: 'numeric', month: 'short' },
  full: { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' },
};

/** The calendar date of a `Date` as seen through its own getters (local time, or a `TZDate`'s zone). */
export function fromDate(date: Date): LocalDate {
  return parseLocalDate(format(date, 'yyyy-MM-dd'));
}

/** The calendar date an instant falls on in `timeZone` (IANA name, e.g. `Asia/Jakarta`). */
export function toLocalDate(instant: Date, timeZone: string): LocalDate {
  return fromDate(new TZDate(instant, timeZone));
}

/**
 * The weeks shown for `month`'s calendar: each week is seven dates starting on `weekStartsOn`, including the
 * days of the neighbouring months that complete the first and last week.
 */
export function monthWeeks(month: LocalDate, weekStartsOn: WeekStart): LocalDate[][] {
  const first = startOfMonth(parseISO(month));
  return eachWeekOfInterval({ start: first, end: endOfMonth(first) }, { weekStartsOn }).map((weekStart) =>
    Array.from({ length: 7 }, (_, offset) =>
      fromDate(new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + offset)),
    ),
  );
}

/** Day names in week order: `short` for column headers (`Sen`), `long` for their abbreviation (`Senin`). */
export function weekdayNames(locale: Locale, weekStartsOn: WeekStart): { short: string; long: string }[] {
  const short = new Intl.DateTimeFormat(locale, { weekday: 'short' });
  const long = new Intl.DateTimeFormat(locale, { weekday: 'long' });
  // 4 Jan 2026 is a Sunday, so day `n` of the week is 4 + n January.
  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(2026, 0, 4 + ((index + weekStartsOn) % 7));
    return { short: short.format(day), long: long.format(day) };
  });
}

/** The full name of an ISO weekday (1 = Monday … 7 = Sunday): `Kamis` / `Thursday`. */
export function weekdayName(isoWeekday: 1 | 2 | 3 | 4 | 5 | 6 | 7, locale: Locale): string {
  // 4 Jan 2026 is a Sunday (ISO 7), so ISO weekday `n` falls on 4 + n January.
  return new Intl.DateTimeFormat(locale, { weekday: 'long' }).format(new Date(2026, 0, 4 + isoWeekday));
}

/** `Oktober 2026` / `October 2026`. */
export function formatMonth(month: LocalDate, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(parseISO(month));
}

/** A calendar date in one of the {@link DateFormat}s. */
export function formatDate(date: LocalDate, locale: Locale, style: DateFormat): string {
  return new Intl.DateTimeFormat(locale, FORMATS[style]).format(parseISO(date));
}

/** The 24-hour time of an instant in `timeZone`: `19.30` / `19:30`. */
export function formatTime(instant: Date, timeZone: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone }).format(
    instant,
  );
}

/**
 * A range as compact as the locale allows: `12–15 Okt`, `28 Sep – 3 Okt`; the year is added when the range does not
 * lie within `today`'s year (`28 Des 2025 – 3 Jan 2026`).
 */
export function formatDateRange(range: DateRange, locale: Locale, today: LocalDate): string {
  const year = today.slice(0, 4);
  const withYear = !range.start.startsWith(year) || !range.end.startsWith(year);
  return new Intl.DateTimeFormat(locale, withYear ? FORMATS.date : FORMATS.day).formatRange(
    parseISO(range.start),
    parseISO(range.end),
  );
}
