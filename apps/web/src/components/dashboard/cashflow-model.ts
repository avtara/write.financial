// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Pemasukan vs Pengeluaran" (FR-D2): the columns of the chart for the scope — the six periods up to the range
 * ("6 bulan terakhir"), the week's days ("Per hari, 12–18 Oktober"), or the year's twelve periods ("Per bulan,
 * Januari–Desember 2026") — the value axis, and the figures under it.
 */
import type { Dashboard } from '@wf/db/dashboard';
import { changeBps } from '@wf/domain/dashboard';
import { addDays } from '@wf/domain/period';
import type { Locale } from '@wf/i18n/locale';
import { dayTitle, monthName, weekdayName } from './dashboard-format.ts';

export interface CashflowColumn {
  /** The day or the period label. */
  readonly key: string;
  /** Under the bars: `Sep`, `Rab`. */
  readonly label: string;
  /** In the tooltip: `September 2026`, `Rabu, 14 Oktober 2026`. */
  readonly title: string;
  readonly incomeMinor: bigint;
  readonly expenseMinor: bigint;
  /** Moved to savings and investment accounts (the period's "Ditabung"); `null` for a week's days. */
  readonly savedMinor: bigint | null;
  /** The column containing the end of what is shown (highlighted). */
  readonly current: boolean;
  /** Not started yet: an empty placeholder. */
  readonly future: boolean;
}

/** The chart's columns: the week's seven days, else the trend periods. */
export function cashflowColumns(dashboard: Dashboard, locale: Locale): CashflowColumn[] {
  const { today, ranges } = dashboard;
  if (dashboard.scope === 'week') {
    const byDate = new Map(dashboard.calendar.days.map((day) => [day.date, day]));
    return Array.from({ length: 7 }, (_, offset) => {
      const date = addDays(ranges.full.from, offset);
      const day = byDate.get(date);
      return {
        key: date,
        label: weekdayName(date, locale),
        title: dayTitle(date, locale),
        incomeMinor: day?.inMinor ?? 0n,
        expenseMinor: day?.outMinor ?? 0n,
        savedMinor: null,
        current: date === today,
        future: date > today,
      };
    });
  }
  const end = ranges.current.to;
  return dashboard.trend.periods.map((period) => ({
    key: period.label,
    label: monthName(period.label, locale),
    title: `${monthName(period.label, locale, 'long')} ${period.label.slice(0, 4)}`,
    incomeMinor: period.incomeMinor,
    expenseMinor: period.expenseMinor,
    savedMinor: period.savedMinor,
    current: period.start <= end && end <= period.end,
    future: period.start > today,
  }));
}

/** The largest spending among the columns that have started; `null` when nothing was spent. */
export function biggestSpending(columns: readonly CashflowColumn[]): CashflowColumn | null {
  let biggest: CashflowColumn | null = null;
  for (const column of columns) {
    if (!column.future && column.expenseMinor > (biggest?.expenseMinor ?? 0n)) biggest = column;
  }
  return biggest;
}

/**
 * "Tren pengeluaran −7,3% / 3 bulan": the last three started periods' spending against the three before; `null`
 * with fewer than six or nothing spent before.
 */
export function spendingTrendBps(columns: readonly CashflowColumn[]): number | null {
  const started = columns.filter((column) => !column.future);
  if (started.length < 6) return null;
  const sum = (list: readonly CashflowColumn[]) => list.reduce((total, column) => total + column.expenseMinor, 0n);
  return changeBps(sum(started.slice(-3)), sum(started.slice(-6, -3)));
}

/** Average spending per started column ("Rata-rata keluar Rp18.800.000/bulan"). */
export function averageSpending(columns: readonly CashflowColumn[]): bigint {
  const started = columns.filter((column) => !column.future);
  return started.reduce((total, column) => total + column.expenseMinor, 0n) / BigInt(Math.max(started.length, 1));
}

/** Steps of 1, 2, 2.5, or 5 × 10ⁿ. */
const NICE = [1, 2, 2.5, 5, 10];

/**
 * The value axis for bars up to `maxMinor`: 0 and three round steps above it (`0 · 10.000.000 · 20.000.000 ·
 * 30.000.000`), the last at or above the maximum.
 */
export function axisTicks(maxMinor: bigint): bigint[] {
  if (maxMinor <= 0n) return [0n, 1n, 2n, 3n];
  const rough = Number(maxMinor) / 3;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = BigInt(Math.round((NICE.find((nice) => nice * power >= rough) as number) * power));
  return [0n, step, 2n * step, 3n * step];
}
