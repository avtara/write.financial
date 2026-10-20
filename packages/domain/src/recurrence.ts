// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Repeating schedules (FR-T6, FR-L8): recurring transactions and contributions, plus subscription bills (FR-SUB1).
 * Pure calendar arithmetic on `LocalDate`s; reminders resolve to instants in the user's time zone.
 */
import { addDays, countDays, parseLocalDate, type LocalDate } from './period.ts';

export const RECURRENCE_FREQS = ['weekly', 'monthly', 'yearly'] as const;
export type RecurrenceFreq = (typeof RECURRENCE_FREQS)[number];

export const RECURRENCE_END_TYPES = ['never', 'after'] as const;
export type RecurrenceEndType = (typeof RECURRENCE_END_TYPES)[number];

/** ISO weekday: 1 = Monday … 7 = Sunday. */
export type IsoWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export type RecurrenceEnd = { readonly type: 'never' } | { readonly type: 'after'; readonly count: number };

export interface RecurrenceRule {
  readonly freq: RecurrenceFreq;
  /** Every `interval` weeks/months/years (1–99). */
  readonly interval: number;
  /** First possible occurrence; `end.after` counts occurrences from here. */
  readonly startOn: LocalDate;
  /** Weekly only: the weekday of every occurrence. */
  readonly weekday: IsoWeekday | null;
  /** Monthly only: the day of month (1–31), clamped to the month's last day. */
  readonly monthDay: number | null;
  readonly end: RecurrenceEnd;
}

export type InvalidRecurrenceReason = 'freq' | 'interval' | 'startOn' | 'weekday' | 'monthDay' | 'end';

export class InvalidRecurrenceError extends RangeError {
  override readonly name = 'InvalidRecurrenceError';
  readonly reason: InvalidRecurrenceReason;
  constructor(reason: InvalidRecurrenceReason) {
    super(`Invalid recurrence: ${reason}`);
    this.reason = reason;
  }
}

export interface OccurrenceWindow {
  /** Earliest date returned (inclusive). */
  readonly from: LocalDate;
  /** At most this many dates (default and upper bound `MAX_OCCURRENCES`). */
  readonly count?: number;
  /** Latest date returned (inclusive). */
  readonly until?: LocalDate;
}

/** Local wall-clock time of every reminder (09.00 in the user's time zone). */
export const REMINDER_TIME = '09:00';
/** Upper bound of dates returned by one `nextOccurrences` call (guards unbounded rules). */
export const MAX_OCCURRENCES = 1000;

const MAX_INTERVAL = 99;
const MAX_END_COUNT = 999;
const MAX_MONTH_DAY = 31;
const DAYS_PER_WEEK = 7;
const MONTHS_PER_YEAR = 12;
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

function inRange(value: number, max: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= max;
}

/** Validates a rule; throws `InvalidRecurrenceError` naming the first offending field. */
export function checkRecurrence(rule: RecurrenceRule): RecurrenceRule {
  if (!RECURRENCE_FREQS.includes(rule.freq)) throw new InvalidRecurrenceError('freq');
  if (!inRange(rule.interval, MAX_INTERVAL)) throw new InvalidRecurrenceError('interval');
  try {
    parseLocalDate(rule.startOn);
  } catch {
    throw new InvalidRecurrenceError('startOn');
  }
  const weekly = rule.freq === 'weekly';
  if (weekly ? !inRange(Number(rule.weekday), DAYS_PER_WEEK) : rule.weekday !== null) {
    throw new InvalidRecurrenceError('weekday');
  }
  const monthly = rule.freq === 'monthly';
  if (monthly ? !inRange(Number(rule.monthDay), MAX_MONTH_DAY) : rule.monthDay !== null) {
    throw new InvalidRecurrenceError('monthDay');
  }
  if (rule.end.type === 'after' && !inRange(rule.end.count, MAX_END_COUNT)) {
    throw new InvalidRecurrenceError('end');
  }
  return rule;
}

/** Occurrence `n` (0-based from startOn) and the first `n` whose date is ≥ `from`. */
interface Sequence {
  at(n: number): LocalDate;
  firstAtOrAfter(from: LocalDate): number;
}

function weeklySequence(rule: RecurrenceRule, weekday: number): Sequence {
  // getUTCDay: 0 = Sunday … 6 = Saturday, so ISO 7 (Sunday) ≡ 0 modulo 7.
  const startDay = new Date(`${rule.startOn}T00:00:00Z`).getUTCDay();
  const first = addDays(rule.startOn, (weekday - startDay + DAYS_PER_WEEK) % DAYS_PER_WEEK);
  const step = DAYS_PER_WEEK * rule.interval;
  return {
    at: (n) => addDays(first, step * n),
    firstAtOrAfter: (from) => Math.max(0, Math.ceil((countDays(first, from) - 1) / step)),
  };
}

function monthIndex(date: LocalDate): number {
  return Number(date.slice(0, 4)) * MONTHS_PER_YEAR + Number(date.slice(5, 7)) - 1;
}

/** `day` in month `index` (year × 12 + month − 1), clamped to the month's last day. */
function dayInMonth(index: number, day: number): LocalDate {
  const year = Math.floor(index / MONTHS_PER_YEAR);
  const month = (index % MONTHS_PER_YEAR) + 1;
  const end = new Date(0);
  end.setUTCFullYear(year, month, 0);
  const last = end.getUTCDate();
  const iso = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(Math.min(day, last)).padStart(2, '0')}`;
  return parseLocalDate(iso);
}

function monthlySequence(rule: RecurrenceRule, day: number, months: number): Sequence {
  const base = monthIndex(rule.startOn);
  // The anchor month's occurrence may fall before startOn (day 14, start 15 Oct): then it starts a month later.
  const shift = dayInMonth(base, day) < rule.startOn ? 1 : 0;
  const at = (n: number): LocalDate => dayInMonth(base + months * (n + shift), day);
  return {
    at,
    firstAtOrAfter: (from) => {
      const n = Math.max(0, Math.ceil((monthIndex(from) - base) / months) - shift);
      return at(n) < from ? n + 1 : n;
    },
  };
}

function sequenceOf(rule: RecurrenceRule): Sequence {
  if (rule.freq === 'weekly') return weeklySequence(rule, Number(rule.weekday));
  if (rule.freq === 'monthly') return monthlySequence(rule, Number(rule.monthDay), rule.interval);
  // Yearly: startOn's month/day every `interval` years; 29 Feb clamps to 28 Feb in non-leap years.
  return monthlySequence(rule, Number(rule.startOn.slice(8, 10)), MONTHS_PER_YEAR * rule.interval);
}

/**
 * Occurrence dates of a valid rule, ascending: ≥ `from`, ≤ `until`, at most `count` (and `MAX_OCCURRENCES`),
 * never past `end.after` occurrences counted from `startOn`.
 */
export function nextOccurrences(rule: RecurrenceRule, window: OccurrenceWindow): LocalDate[] {
  checkRecurrence(rule);
  const sequence = sequenceOf(rule);
  const limit = Math.min(window.count ?? MAX_OCCURRENCES, MAX_OCCURRENCES);
  const end = rule.end.type === 'after' ? rule.end.count : Number.POSITIVE_INFINITY;
  const dates: LocalDate[] = [];
  for (let n = sequence.firstAtOrAfter(window.from); n < end && dates.length < limit; n++) {
    const date = sequence.at(n);
    if (window.until !== undefined && date > window.until) break;
    dates.push(date);
  }
  return dates;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/** Offset (ms) of `timeZone` from UTC at the whole-minute instant `epochMs`. */
function offsetAt(epochMs: number, timeZone: string): number {
  const fields = Object.fromEntries(
    formatterFor(timeZone)
      .formatToParts(epochMs)
      .map((part) => [part.type, Number(part.value)]),
  );
  return (
    Date.UTC(Number(fields['year']), Number(fields['month']) - 1, fields['day'], fields['hour'], fields['minute']) -
    epochMs
  );
}

/**
 * The instant at local wall-clock `time` ('HH:MM') on `date` in `timeZone`. DST-safe: a skipped wall time maps to the
 * same duration after the gap, a repeated one to its later instant.
 */
export function zonedInstant(date: LocalDate, time: string, timeZone: string): Date {
  const match = TIME.exec(time);
  if (match === null) throw new RangeError(`Invalid time: ${time}`);
  const wall = Date.UTC(
    Number(date.slice(0, 4)),
    Number(date.slice(5, 7)) - 1,
    Number(date.slice(8, 10)),
    Number(match[1]),
    Number(match[2]),
  );
  const first = offsetAt(wall, timeZone);
  const second = offsetAt(wall - first, timeZone);
  return new Date(wall - second);
}

/** When to remind about a bill due on `due`: 09.00 local on `due − offsetDays` (H-1 → the day before). */
export function reminderAt(due: LocalDate, offsetDays: number, timeZone: string): Date {
  return zonedInstant(addDays(due, -offsetDays), REMINDER_TIME, timeZone);
}
