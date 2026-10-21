// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What the calendar (FR-C1–C3) derives from a range's day totals, transactions, and scheduled events: each day's
 * needs / wants split, savings transfers, largest spend and events; the weeks of a month with their totals (W1–W6,
 * "+186.000 terjadwal"); the month's KPIs and per-weekday pattern; the projection of a month that has not started
 * ("Perkiraan dari pola Okt": paydays and daily spending from the current month); a week's columns and the safe limit
 * for the rest of it; and a year's months and trend. Amounts are in the base currency.
 */
import type { AccountView } from '@wf/db/accounts';
import type { CategoryView } from '@wf/db/categories';
import type { ScheduledItem } from '@wf/db/schedules';
import type { DayGroup, TransactionRow } from '@wf/db/transaction-query';
import { weekStartOf } from '@wf/domain/dashboard';
import { addDays, countDays, type LocalDate, type YearMonth } from '@wf/domain/period';
import { calendarWeeks, type CalendarDay } from '../dashboard/calendar-model.ts';

export type CalendarView = 'week' | 'month' | 'year';

/** The legend's toggles (FR-C3: the legend filters the grid). */
export type CalendarLayer = 'spending' | 'income' | 'savings' | 'scheduled';
export const CALENDAR_LAYERS: readonly CalendarLayer[] = ['spending', 'income', 'savings', 'scheduled'];

/** Scheduled bills that are still to come (paid and skipped ones are transactions or nothing). */
const OPEN: Readonly<Partial<Record<ScheduledItem['status'], true>>> = {
  scheduled: true,
  due_review: true,
  unconfirmed: true,
};

export interface ProjectedIncome {
  readonly label: string;
  readonly amountMinor: bigint;
}

export interface DayDetail extends CalendarDay {
  readonly needsMinor: bigint;
  readonly wantsMinor: bigint;
  /** Transfers into savings and investment accounts ("Setoran tabungan"). */
  readonly savingsMinor: bigint;
  /** The biggest expense ("terbesar Tokopedia"). */
  readonly largest: TransactionRow | null;
  /** The day's transactions, earliest first. */
  readonly rows: readonly TransactionRow[];
  /** Open scheduled events (FR-C2; they never affect balances). */
  readonly scheduled: readonly ScheduledItem[];
  /** Income expected from the pattern month (paydays of a month that has not started). */
  readonly projected: readonly ProjectedIncome[];
}

export interface CalendarInputs {
  readonly days: readonly DayGroup[];
  readonly rows: readonly TransactionRow[];
  readonly scheduled: readonly ScheduledItem[];
  readonly categories: readonly CategoryView[];
  readonly accounts: readonly AccountView[];
  readonly today: LocalDate;
}

const sum = (values: readonly bigint[]) => values.reduce((total, value) => total + value, 0n);
/** The size of an amount, whichever its sign. */
export const abs = (value: bigint) => (value < 0n ? -value : value);

/** The first day of `date`'s month and its last day. */
export function monthOf(date: LocalDate): { readonly first: LocalDate; readonly last: LocalDate } {
  const first = `${date.slice(0, 7)}-01` as LocalDate;
  return { first, last: addDays(`${addDays(first, 31).slice(0, 7)}-01` as LocalDate, -1) };
}

/** `month` shifted by `months` (any sign). */
export function shiftMonth(month: YearMonth, months: number): YearMonth {
  const index = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1 + months;
  return `${String(Math.floor(index / 12))}-${String((index % 12) + 1).padStart(2, '0')}` as YearMonth;
}

/** The Monday of `date`'s week and its Sunday. */
export function weekOf(date: LocalDate): { readonly first: LocalDate; readonly last: LocalDate } {
  const first = weekStartOf(date, 'monday');
  return { first, last: addDays(first, 6) };
}

/** Whether a transfer moves money into savings (an investment account, or one kept out of the available balance). */
function isSavings(row: TransactionRow, accounts: ReadonlyMap<string, AccountView>): boolean {
  const to = row.toAccountId === null ? undefined : accounts.get(row.toAccountId);
  return to !== undefined && (to.type === 'investment' || !to.includeInAvailable);
}

/** Each day of `weeks` with its details. */
export function dayDetails(
  weeks: readonly (readonly CalendarDay[])[],
  inputs: CalendarInputs,
  projected: ReadonlyMap<LocalDate, readonly ProjectedIncome[]> = new Map(),
): DayDetail[][] {
  const groupOf = new Map(inputs.categories.map((category) => [category.id, category.group]));
  const accountOf = new Map(inputs.accounts.map((account) => [account.id, account]));
  return weeks.map((week) =>
    week.map((day) => {
      const rows = inputs.rows
        .filter((row) => row.localDate === day.date)
        .toSorted((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
      const expenses = rows.filter((row) => row.type === 'expense');
      const inGroup = (group: string) =>
        sum(
          expenses.filter((row) => groupOf.get(row.categoryId ?? '') === group).map((row) => abs(row.amountBaseMinor)),
        );
      return {
        ...day,
        needsMinor: inGroup('needs'),
        wantsMinor: inGroup('wants'),
        savingsMinor: sum(
          rows
            .filter((row) => row.type === 'transfer' && isSavings(row, accountOf))
            .map((row) => abs(row.amountBaseMinor)),
        ),
        largest: expenses.reduce<TransactionRow | null>(
          (top, row) => (top === null || abs(row.amountBaseMinor) > abs(top.amountBaseMinor) ? row : top),
          null,
        ),
        rows,
        scheduled: inputs.scheduled.filter((item) => item.dueDate === day.date && OPEN[item.status] === true),
        projected: day.future ? (projected.get(day.date) ?? []) : [],
      };
    }),
  );
}

/** A month's grid: its Monday-first weeks with every day's details. */
export function monthGrid(month: YearMonth, inputs: CalendarInputs, pattern?: CalendarInputs): DayDetail[][] {
  const { first, last } = monthOf(`${month}-01` as LocalDate);
  const weeks = calendarWeeks({ from: first, to: last }, inputs.days, inputs.today);
  return dayDetails(weeks, inputs, pattern === undefined ? undefined : paydays(month, pattern));
}

/** Out, net and still-scheduled bills of a week's days within the month (W1–W6). */
export function weekTotal(week: readonly DayDetail[]): {
  readonly outMinor: bigint;
  readonly netMinor: bigint;
  readonly scheduledMinor: bigint;
  readonly projectedMinor: bigint;
} {
  const days = week.filter((day) => day.inRange);
  return {
    outMinor: sum(days.map((day) => day.outMinor)),
    netMinor: sum(days.map((day) => day.inMinor - day.outMinor)),
    scheduledMinor: sum(
      days
        .filter((day) => day.future)
        .flatMap((day) => day.scheduled.filter((item) => item.direction === 'out').map((item) => item.expectedMinor)),
    ),
    projectedMinor: sum(days.flatMap((day) => day.projected.map((income) => income.amountMinor))),
  };
}

export interface MonthStats {
  /** Days from the 1st through today (or the whole month once over); 0 for a month that has not started. */
  readonly elapsed: number;
  readonly spentMinor: bigint;
  readonly incomeMinor: bigint;
  readonly averageMinor: bigint;
  readonly costliest: DayDetail | null;
  /** "Hari hemat": elapsed days spending below {@link MonthStats.frugalLimitMinor}. */
  readonly frugalDays: number;
  readonly frugalLimitMinor: bigint;
  /** Still-open bills from tomorrow to the month's end. */
  readonly scheduledLeftMinor: bigint;
  /** Average spending per weekday, Monday first, over the elapsed days. */
  readonly weekdays: readonly bigint[];
}

/** "Hari hemat": days below 30 % of the daily average, rounded down to Rp100.000 steps (Rp1.100.000 → Rp300.000). */
const FRUGAL_SHARE_PERCENT = 30n;
const FRUGAL_STEP_MINOR = 100_000n;

export function monthStats(grid: readonly (readonly DayDetail[])[], today: LocalDate): MonthStats {
  const days = grid.flat().filter((day) => day.inRange);
  const passed = days.filter((day) => day.date <= today);
  const spentMinor = sum(passed.map((day) => day.outMinor));
  const averageMinor = passed.length === 0 ? 0n : spentMinor / BigInt(passed.length);
  const share = (averageMinor * FRUGAL_SHARE_PERCENT) / 100n;
  const frugalLimitMinor = share >= FRUGAL_STEP_MINOR ? (share / FRUGAL_STEP_MINOR) * FRUGAL_STEP_MINOR : share;
  const weekdays = Array.from({ length: 7 }, (_, index) => {
    const same = passed.filter((day) => countDays(weekStartOf(day.date, 'monday'), day.date) - 1 === index);
    return same.length === 0 ? 0n : sum(same.map((day) => day.outMinor)) / BigInt(same.length);
  });
  return {
    elapsed: passed.length,
    spentMinor,
    incomeMinor: sum(passed.map((day) => day.inMinor)),
    averageMinor,
    // Paydays are surplus days, not costly ones (design: 11 Okt, not 1 Okt with the rent).
    costliest: passed.reduce<DayDetail | null>(
      (top, day) => (day.outMinor > 0n && !day.surplus && (top === null || day.outMinor > top.outMinor) ? day : top),
      null,
    ),
    frugalDays: passed.filter((day) => day.outMinor < frugalLimitMinor).length,
    frugalLimitMinor,
    scheduledLeftMinor: sum(
      days
        .filter((day) => day.date > today)
        .flatMap((day) => day.scheduled.filter((item) => item.direction === 'out').map((item) => item.expectedMinor)),
    ),
    weekdays,
  };
}

/**
 * "Gajian · 1 Nov · diperkirakan Rp18.500.000": the pattern month's salary incomes, on the same day of `month`
 * (clamped to its end), by date.
 */
export function paydays(month: YearMonth, pattern: CalendarInputs): Map<LocalDate, ProjectedIncome[]> {
  const salary = new Set(
    pattern.categories.filter((category) => category.builtInKey === 'system:salary').map((category) => category.id),
  );
  const { last } = monthOf(`${month}-01` as LocalDate);
  const projected = new Map<LocalDate, ProjectedIncome[]>();
  for (const row of pattern.rows) {
    if (row.type !== 'income' || !salary.has(row.categoryId ?? '')) continue;
    const day = `${month}-${row.localDate.slice(8)}` as LocalDate;
    const date = day > last ? last : day;
    projected.set(date, [
      ...(projected.get(date) ?? []),
      { label: row.merchant ?? row.description ?? '', amountMinor: abs(row.amountBaseMinor) },
    ]);
  }
  return projected;
}

export interface WeekStats {
  readonly days: readonly DayDetail[];
  readonly spentMinor: bigint;
  readonly elapsed: number;
  readonly averageMinor: bigint;
  /** The same weekdays of the week before ("vs Sen–Kam lalu"); `null` before the week starts. */
  readonly previousMinor: bigint | null;
  readonly incomeMinor: bigint;
  readonly largestIncome: TransactionRow | null;
  readonly scheduled: readonly ScheduledItem[];
  /** Days after today in the week (the safe limit multiplies the daily one by them). */
  readonly daysLeft: number;
}

/** The week of `first` (a Monday) from a two-week range's inputs (the week before compares). */
export function weekStats(first: LocalDate, inputs: CalendarInputs): WeekStats {
  const [previous = [], week = []] = dayDetails(
    calendarWeeks({ from: addDays(first, -7), to: addDays(first, 6) }, inputs.days, inputs.today),
    inputs,
  );
  const passed = week.filter((day) => day.date <= inputs.today);
  const spentMinor = sum(passed.map((day) => day.outMinor));
  const incomes = week.flatMap((day) => day.rows.filter((row) => row.type === 'income'));
  return {
    days: week,
    spentMinor,
    elapsed: passed.length,
    averageMinor: passed.length === 0 ? 0n : spentMinor / BigInt(passed.length),
    previousMinor: passed.length === 0 ? null : sum(previous.slice(0, passed.length).map((day) => day.outMinor)),
    incomeMinor: sum(week.map((day) => day.inMinor)),
    largestIncome: incomes.reduce<TransactionRow | null>(
      (top, row) => (top === null || abs(row.amountBaseMinor) > abs(top.amountBaseMinor) ? row : top),
      null,
    ),
    scheduled: week.flatMap((day) => (day.date > inputs.today ? day.scheduled : [])),
    daysLeft: week.filter((day) => day.date > inputs.today).length,
  };
}

export interface YearMonthTotals {
  readonly month: YearMonth;
  readonly inMinor: bigint;
  readonly outMinor: bigint;
  /** In − out as a share of in, `null` without income. */
  readonly savedRatio: number | null;
  readonly future: boolean;
  readonly current: boolean;
}

/** The twelve months of `year` with their totals. */
export function yearMonths(year: number, days: readonly DayGroup[], today: LocalDate): YearMonthTotals[] {
  return Array.from({ length: 12 }, (_, index) => {
    const month = `${String(year)}-${String(index + 1).padStart(2, '0')}` as YearMonth;
    const inMonth = days.filter((day) => day.date.startsWith(month));
    const inMinor = sum(inMonth.map((day) => day.inMinor));
    const outMinor = sum(inMonth.map((day) => day.outMinor));
    return {
      month,
      inMinor,
      outMinor,
      savedRatio: inMinor === 0n ? null : Number(inMinor - outMinor) / Number(inMinor),
      future: `${month}-01` > today,
      current: today.startsWith(month),
    };
  });
}
