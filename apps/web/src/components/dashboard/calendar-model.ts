// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Kalender Pengeluaran" (FR-D2): the heat of each day (Sedikit → Banyak), surplus days, the weeks of a month or a
 * range, the year's mini months, the day to open first (the costliest), and the year's insights ("Hari termahal",
 * "Bulan terhemat", "Akhir pekan 2,4× lebih boros").
 */
import type { DayGroup } from '@wf/db/transaction-query';
import { weekStartOf, type DateRange } from '@wf/domain/dashboard';
import { addDays, countDays, type LocalDate, type YearMonth } from '@wf/domain/period';

/** 0 = nothing spent; 1–4 = quarters of the costliest day. */
export type HeatLevel = 0 | 1 | 2 | 3 | 4;

export function heatLevel(outMinor: bigint, maxMinor: bigint): HeatLevel {
  if (outMinor <= 0n) return 0;
  return Math.min(4, Math.ceil((Number(outMinor) / Number(maxMinor)) * 4)) as HeatLevel;
}

const maxOut = (days: readonly DayGroup[]): bigint =>
  days.reduce((max, day) => (day.outMinor > max ? day.outMinor : max), 0n);

export interface CalendarDay {
  readonly date: LocalDate;
  readonly inMinor: bigint;
  readonly outMinor: bigint;
  readonly count: number;
  /** Inside what the dashboard shows (other days complete the weeks, dimmed). */
  readonly inRange: boolean;
  readonly future: boolean;
  readonly heat: HeatLevel;
  /** More came in than went out ("+13.650.000"). */
  readonly surplus: boolean;
}

/**
 * The Monday-first weeks (the Indonesian default) covering `range`, each day with its totals from `days`; the heat
 * is relative to the costliest of `days`.
 */
export function calendarWeeks(range: DateRange, days: readonly DayGroup[], today: LocalDate): CalendarDay[][] {
  const byDate = new Map(days.map((day) => [day.date, day]));
  const maxMinor = maxOut(days);
  const weeks: CalendarDay[][] = [];
  for (let start = weekStartOf(range.from, 'monday'); start <= range.to; start = addDays(start, 7)) {
    weeks.push(
      Array.from({ length: 7 }, (_, offset) => {
        const date = addDays(start, offset);
        const day = byDate.get(date);
        const inMinor = day?.inMinor ?? 0n;
        const outMinor = day?.outMinor ?? 0n;
        return {
          date,
          inMinor,
          outMinor,
          count: day?.count ?? 0,
          inRange: range.from <= date && date <= range.to,
          future: date > today,
          heat: heatLevel(outMinor, maxMinor),
          surplus: inMinor > outMinor,
        };
      }),
    );
  }
  return weeks;
}

export interface CalendarMonth {
  readonly label: YearMonth;
  readonly end: LocalDate;
  readonly weeks: CalendarDay[][];
  readonly outMinor: bigint;
  /** Starts after today ("Nov —"). */
  readonly future: boolean;
}

/** The year view: each calendar month from `range.from`'s to `range.to`'s, the heat relative to the whole range. */
export function calendarMonths(range: DateRange, days: readonly DayGroup[], today: LocalDate): CalendarMonth[] {
  const months: CalendarMonth[] = [];
  for (let first = `${range.from.slice(0, 7)}-01` as LocalDate; first <= range.to;) {
    const next = `${addDays(first, 31).slice(0, 7)}-01` as LocalDate;
    const end = addDays(next, -1);
    const inMonth = days.filter((day) => first <= day.date && day.date <= end);
    const heatOf = (outMinor: bigint) => heatLevel(outMinor, maxOut(days));
    months.push({
      label: first.slice(0, 7) as YearMonth,
      end,
      weeks: calendarWeeks({ from: first, to: end }, inMonth, today).map((week) =>
        week.map((day) => ({ ...day, heat: heatOf(day.outMinor) })),
      ),
      outMinor: inMonth.reduce((total, day) => total + day.outMinor, 0n),
      future: first > today,
    });
    first = next;
  }
  return months;
}

/** The costliest day (the one the calendar opens on), `null` when nothing was spent. */
export function costliestDay(days: readonly DayGroup[]): DayGroup | null {
  let costliest: DayGroup | null = null;
  for (const day of days) if (day.outMinor > (costliest?.outMinor ?? 0n)) costliest = day;
  return costliest;
}

/** "Bulan terhemat": the month with the least spending among those already over that had any. */
export function cheapestMonth(months: readonly CalendarMonth[], today: LocalDate): CalendarMonth | null {
  let cheapest: CalendarMonth | null = null;
  for (const month of months) {
    if (month.end >= today || month.outMinor === 0n) continue;
    if (cheapest === null || month.outMinor < cheapest.outMinor) cheapest = month;
  }
  return cheapest;
}

/**
 * "Akhir pekan 2,4× lebih boros dari hari kerja": the average spending per weekend day over that per weekday, days
 * without spending included, up to today; `null` without weekday spending or weekend days.
 */
export function weekendRatio(range: DateRange, days: readonly DayGroup[], today: LocalDate): number | null {
  const byDate = new Map(days.map((day) => [day.date, day.outMinor]));
  let weekendMinor = 0;
  let weekendDays = 0;
  let weekdayMinor = 0;
  let weekdayDays = 0;
  for (let date = range.from; date <= range.to && date <= today; date = addDays(date, 1)) {
    const outMinor = Number(byDate.get(date) ?? 0n);
    // Saturday and Sunday are days 5 and 6 of a Monday-first week.
    if (countDays(weekStartOf(date, 'monday'), date) > 5) {
      weekendMinor += outMinor;
      weekendDays += 1;
    } else {
      weekdayMinor += outMinor;
      weekdayDays += 1;
    }
  }
  if (weekdayMinor === 0 || weekendDays === 0) return null;
  return weekendMinor / weekendDays / (weekdayMinor / weekdayDays);
}
