// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Monthly periods that follow payday (PRD §6.7 FR-P1–P2, §7.2).
 *
 * All dates are plain calendar dates (`YYYY-MM-DD`). Callers derive the local
 * date in the user's time zone first (PRD §9); nothing here depends on the
 * host time zone. `Date` is only used in UTC as a calendar calculator.
 */

import type { Locale } from './money.ts';

/** A calendar date `YYYY-MM-DD` (years 0001–9999). Build with {@link parseLocalDate}. */
export type LocalDate = string & { readonly __brand: 'LocalDate' };

/** A calendar month `YYYY-MM`; the period label key (route `?period=2026-10`). */
export type YearMonth = string & { readonly __brand: 'YearMonth' };

/** Period start day 1–28 (FR-P1). Build with {@link periodStartDay}. */
export type PeriodStartDay = number & { readonly __brand: 'PeriodStartDay' };

export type PeriodKind = 'normal' | 'transition';

export interface Period {
  readonly kind: PeriodKind;
  readonly start: LocalDate;
  /** Inclusive. */
  readonly end: LocalDate;
  readonly days: number;
  /** The month in which the period ends (FR-P1: 25 Sep – 24 Oct = "Oktober"). */
  readonly label: YearMonth;
}

export type PeriodLabelStyle = 'month' | 'monthYear';

/** Divisor of the transition proration `limit × transition_days ÷ 30` (PRD §7.2). */
export const PRORATION_BASE_DAYS = 30;

export class InvalidLocalDateError extends RangeError {
  override readonly name = 'InvalidLocalDateError';
  constructor(value: string) {
    super(`Invalid local date: ${value} (expected YYYY-MM-DD, years 0001–9999)`);
  }
}

export class InvalidPeriodStartDayError extends RangeError {
  override readonly name = 'InvalidPeriodStartDayError';
  constructor(value: number) {
    super(`Invalid period start day: ${value} (expected an integer 1–28)`);
  }
}

export class InvalidPeriodRangeError extends RangeError {
  override readonly name = 'InvalidPeriodRangeError';
}

export class InvalidTransitionError extends RangeError {
  override readonly name = 'InvalidTransitionError';
}

export class InvalidProrationError extends RangeError {
  override readonly name = 'InvalidProrationError';
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_DAY = 86_400_000;
const MAX_START_DAY = 28;

const INDONESIAN_MONTHS = [
  'Januari',
  'Februari',
  'Maret',
  'April',
  'Mei',
  'Juni',
  'Juli',
  'Agustus',
  'September',
  'Oktober',
  'November',
  'Desember',
] as const;

const ENGLISH_MONTH = new Intl.DateTimeFormat('en', { month: 'long' });

/** Days since 1970-01-01 for a proleptic Gregorian date; month may overflow (13 = next January). */
function epochDay(year: number, month: number, day: number): number {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return date.getTime() / MS_PER_DAY;
}

function fromEpochDay(epoch: number): LocalDate {
  const date = new Date(epoch * MS_PER_DAY);
  const year = date.getUTCFullYear();
  const iso = [
    String(year).padStart(4, '0'),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0'),
  ].join('-');
  if (year < 1 || year > 9999) throw new InvalidLocalDateError(iso);
  return iso as LocalDate;
}

function parts(date: LocalDate): [year: number, month: number, day: number] {
  return [Number(date.slice(0, 4)), Number(date.slice(5, 7)), Number(date.slice(8, 10))];
}

/** Validates an ISO calendar date such as `2026-10-15`. */
export function parseLocalDate(value: string): LocalDate {
  if (!ISO_DATE.test(value)) throw new InvalidLocalDateError(value);
  const [year, month, day] = parts(value as LocalDate);
  const daysInMonth = epochDay(year, month + 1, 1) - epochDay(year, month, 1);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > daysInMonth) throw new InvalidLocalDateError(value);
  return value as LocalDate;
}

/** Validates a period start day: an integer 1–28 (days 29–31 are not offered, FR-P1). */
export function periodStartDay(day: number): PeriodStartDay {
  if (!Number.isInteger(day) || day < 1 || day > MAX_START_DAY) throw new InvalidPeriodStartDayError(day);
  return day as PeriodStartDay;
}

/** Calendar arithmetic: `date` shifted by `days` (may be negative). */
export function addDays(date: LocalDate, days: number): LocalDate {
  return fromEpochDay(epochDay(...parts(date)) + days);
}

/** Number of days from `start` to `end`, both inclusive (14 Sep – 13 Okt = 30). */
export function countDays(start: LocalDate, end: LocalDate): number {
  return epochDay(...parts(end)) - epochDay(...parts(start)) + 1;
}

function makePeriod(kind: PeriodKind, start: LocalDate, end: LocalDate): Period {
  return { kind, start, end, days: countDays(start, end), label: end.slice(0, 7) as YearMonth };
}

/** The normal period containing `date` for periods starting on `startDay`. */
export function periodFor(date: LocalDate, startDay: PeriodStartDay): Period {
  const [year, month, day] = parts(date);
  const startMonth = day >= startDay ? month : month - 1;
  const start = fromEpochDay(epochDay(year, startMonth, startDay));
  const end = fromEpochDay(epochDay(year, startMonth + 1, startDay) - 1);
  return makePeriod('normal', start, end);
}

/** The normal period right after `period` (also after a transition period, using the new start day). */
export function nextPeriod(period: Period, startDay: PeriodStartDay): Period {
  return periodFor(addDays(period.end, 1), startDay);
}

/** The normal period right before `period`. */
export function previousPeriod(period: Period, startDay: PeriodStartDay): Period {
  return periodFor(addDays(period.start, -1), startDay);
}

/** All normal periods that overlap `from`–`to` (inclusive), in order (FR-S7 "melintasi N periode"). */
export function periodsBetween(from: LocalDate, to: LocalDate, startDay: PeriodStartDay): Period[] {
  if (from > to) throw new InvalidPeriodRangeError(`Invalid range: ${from} is after ${to}`);
  let last = periodFor(from, startDay);
  const periods = [last];
  while (last.end < to) {
    last = nextPeriod(last, startDay);
    periods.push(last);
  }
  return periods;
}

/**
 * FR-P2 option (a) "Mulai periode berikutnya": the period containing `changeDate`
 * keeps the old start day; the transition period runs from the day after it until
 * the day before the first new start day. Example: 1 → 25 on 15 Oct 2026 gives
 * 1 Nov – 24 Nov (24 days), then 25 Nov – 24 Des.
 */
export function transitionPeriod(
  oldStartDay: PeriodStartDay,
  newStartDay: PeriodStartDay,
  changeDate: LocalDate,
): Period {
  if (oldStartDay === newStartDay) {
    throw new InvalidTransitionError(`No transition: the start day is already ${newStartDay}`);
  }
  const start = addDays(periodFor(changeDate, oldStartDay).end, 1);
  return makePeriod('transition', start, periodFor(start, newStartDay).end);
}

/**
 * Transition budget `limit × transition_days ÷ 30` (PRD §7.2), rounded half up to
 * the minor unit (the PRD gives no rounding rule). A transition lasts 1–30 days.
 */
export function prorateLimit(limitMinor: bigint, transitionDays: number): bigint {
  if (limitMinor < 0n) throw new InvalidProrationError(`Budget limit must not be negative: ${limitMinor}`);
  if (!Number.isInteger(transitionDays) || transitionDays < 1 || transitionDays > PRORATION_BASE_DAYS) {
    throw new InvalidProrationError(`Transition days must be an integer 1–30: ${transitionDays}`);
  }
  const base = BigInt(PRORATION_BASE_DAYS);
  return (2n * limitMinor * BigInt(transitionDays) + base) / (2n * base);
}

/** Localized period name: "Oktober" / "Oktober 2026" (id), "October" / "October 2026" (en). */
export function formatPeriodLabel(label: YearMonth, locale: Locale, style: PeriodLabelStyle): string {
  const year = Number(label.slice(0, 4));
  const month = Number(label.slice(5, 7));
  // Mid-month, so no host time zone offset can shift it into another month.
  const name =
    locale === 'id' ? (INDONESIAN_MONTHS[month - 1] as string) : ENGLISH_MONTH.format(Date.UTC(2000, month - 1, 15));
  return style === 'month' ? name : `${name} ${year}`;
}
