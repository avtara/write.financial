// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Reports (FR-LP1–LP5). A monthly report is a snapshot of one closed period: the KPIs with their comparison, the
 * savings rate and its change in points, the spending lines (categories against their budget, merchants, tags,
 * accounts), goals, the largest transactions, subscriptions, and net worth at the period end. Quarters, years, and
 * custom ranges are aggregated from the final monthly reports plus the current period, and are marked provisional.
 * Everything here is arithmetic on rows the database already totalled; amounts are `bigint` minor units, shares and
 * rates basis points (10 000 = 100%).
 */
import { divideFloor } from './decimal.ts';
import { changeBps, type DateRange } from './dashboard.ts';
import { savingRateBps } from './budget.ts';
import { addDays, countDays } from './period.ts';

export const REPORT_KINDS = ['monthly', 'quarterly', 'yearly', 'custom'] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

/** A monthly report is final once its period closed; an aggregate that includes the current period is provisional. */
export const REPORT_STATUSES = ['final', 'provisional'] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

/** The KPIs of a report ("Pemasukan · Pengeluaran · Ditabung · Tingkat tabungan · Kekayaan bersih"). */
export interface ReportTotals {
  readonly incomeMinor: bigint;
  /** Expense principal + fees + FX-difference losses; transfers are not spending. */
  readonly expenseMinor: bigint;
  readonly savedMinor: bigint;
  /** `null` without income. */
  readonly savingRateBps: number | null;
  /** Transactions in the range, transfers included (the design's "121 transaksi"). */
  readonly txCount: number;
  /** Cash + investments at the range end; `null` when it could not be valued. */
  readonly netWorthMinor: bigint | null;
}

/** The KPI inputs: net worth is optional (a range with no valuation still reports its flows). */
export interface ReportTotalsInput {
  readonly incomeMinor: bigint;
  readonly expenseMinor: bigint;
  readonly txCount: number;
  readonly netWorthMinor?: bigint | null;
}

/** {@link ReportTotals} with the derived fields, so every caller computes them the same way. */
export function reportTotals(input: ReportTotalsInput): ReportTotals {
  const savedMinor = input.incomeMinor - input.expenseMinor;
  return {
    incomeMinor: input.incomeMinor,
    expenseMinor: input.expenseMinor,
    savedMinor,
    savingRateBps: savingRateBps(input.incomeMinor, input.expenseMinor),
    txCount: input.txCount,
    netWorthMinor: input.netWorthMinor ?? null,
  };
}

/**
 * Changes against the compared range: income and expenses in relative basis points ("+3,6%"), the saved amount the
 * same way, and the savings rate in points ("−3,0 poin"), which is the difference of the two rates, not a ratio.
 */
export interface TotalsDelta {
  readonly incomeBps: number | null;
  readonly expenseBps: number | null;
  readonly savedBps: number | null;
  readonly savingRatePoints: number | null;
}

/** `null` without a previous range (a first report, or the design's August). */
export function totalsDelta(current: ReportTotals, previous: ReportTotals | null): TotalsDelta | null {
  if (previous === null) return null;
  return {
    incomeBps: changeBps(current.incomeMinor, previous.incomeMinor),
    expenseBps: changeBps(current.expenseMinor, previous.expenseMinor),
    savedBps: changeBps(current.savedMinor, previous.savedMinor),
    savingRatePoints:
      current.savingRateBps === null || previous.savingRateBps === null
        ? null
        : current.savingRateBps - previous.savingRateBps,
  };
}

/** One line of a ranking: its share of `totalMinor` ("Sewa Kos 4.500.000 = 17%"). */
export interface ShareLine<K> {
  readonly key: K;
  readonly totalMinor: bigint;
  /** Of `totalMinor` (rounded). */
  readonly shareBps: number;
}

/** Share of each row in `totalMinor`; rows keep their order, ties are not reordered. */
export function shareLines<K>(rows: readonly { readonly key: K; readonly totalMinor: bigint }[], totalMinor: bigint): ShareLine<K>[] {
  return rows.map((row) => ({
    key: row.key,
    totalMinor: row.totalMinor,
    shareBps: totalMinor > 0n ? Number(divideFloor(row.totalMinor * 10_000n, totalMinor)) : 0,
  }));
}

/** "Rata-rata Rp610.000/hari": expenses ÷ the days of the range, floored. */
export function dailyAverageMinor(expenseMinor: bigint, range: DateRange): bigint {
  const days = countDays(range.from, range.to);
  return days > 0 ? divideFloor(expenseMinor, BigInt(days)) : 0n;
}

/** A day of spending (the report's daily chart and its busiest-week annotation). */
export interface ReportDay {
  readonly date: DateRange['from'];
  readonly outMinor: bigint;
}

/** The most expensive seven days of the range ("Minggu terboros 7–13 Sep Rp5.200.000"). */
export interface BusiestWeek {
  readonly from: DateRange['from'];
  readonly to: DateRange['to'];
  readonly totalMinor: bigint;
}

/**
 * The highest seven consecutive days inside the range, walking day by day so a week cut by a period boundary still
 * counts; `null` without spending or a range shorter than a day. The window starts on the first day when it ties.
 */
export function busiestWeek(days: readonly ReportDay[]): BusiestWeek | null {
  if (days.length === 0) return null;
  let best: BusiestWeek | null = null;
  for (let start = 0; start < days.length; start += 1) {
    const from = days[start]?.date;
    if (from === undefined) continue;
    const to = addDays(from, 6);
    const totalMinor = days
      .slice(start)
      .filter((day) => day.date <= to)
      .reduce((total, day) => total + day.outMinor, 0n);
    if (totalMinor === 0n) continue;
    if (best === null || totalMinor > best.totalMinor) best = { from, to, totalMinor };
  }
  return best;
}

/**
 * "6 transaksi = 40% dari pengeluaran": the share of all expenses that the first `count` of `rows` (already largest
 * first) make up. `null` without expenses.
 */
export function topShareBps(rows: readonly { readonly amountMinor: bigint }[], count: number, expenseMinor: bigint): number | null {
  if (expenseMinor <= 0n) return null;
  const top = rows.slice(0, count).reduce((total, row) => total + row.amountMinor, 0n);
  return Number(divideFloor(top * 10_000n, expenseMinor));
}

/** A month the aggregate is built from (a final monthly report, or the current period). */
export interface ReportMonth {
  readonly range: DateRange;
  readonly totals: ReportTotals;
}

/**
 * Quarters, years, and custom ranges are aggregated from their months: the flows add up, the count adds up, the
 * savings rate is recomputed from the sums (not averaged), and net worth is the last month's (the range end).
 */
export function combineMonths(months: readonly ReportMonth[]): ReportTotals | null {
  if (months.length === 0) return null;
  const totals = months.reduce(
    (sum, month) => ({
      incomeMinor: sum.incomeMinor + month.totals.incomeMinor,
      expenseMinor: sum.expenseMinor + month.totals.expenseMinor,
      txCount: sum.txCount + month.totals.txCount,
    }),
    { incomeMinor: 0n, expenseMinor: 0n, txCount: 0 },
  );
  const last = [...months].sort((a, b) => (a.range.to < b.range.to ? -1 : a.range.to > b.range.to ? 1 : 0)).at(-1);
  return reportTotals({ ...totals, netWorthMinor: last?.totals.netWorthMinor ?? null });
}

/** The calendar quarter of a month (`2026-09` → 3). */
export function quarterOf(yearMonth: string): 1 | 2 | 3 | 4 {
  const month = Number(yearMonth.slice(5, 7));
  return (Math.floor((month - 1) / 3) + 1) as 1 | 2 | 3 | 4;
}

/** The calendar bounds of a quarter ("Q3 2026" = 1 Jul – 30 Sep). */
export function quarterRange(year: number, quarter: 1 | 2 | 3 | 4): DateRange {
  const first = String((quarter - 1) * 3 + 1).padStart(2, '0');
  const last = String((quarter - 1) * 3 + 3).padStart(2, '0');
  const lastDay = [31, 30, 30, 31][quarter - 1] as number;
  return { from: `${year}-${first}-01` as DateRange['from'], to: `${year}-${last}-${lastDay}` as DateRange['to'] };
}

/** The calendar year ("Rekap SPT Tahunan 2025"). */
export function yearRange(year: number): DateRange {
  return { from: `${year}-01-01` as DateRange['from'], to: `${year}-12-31` as DateRange['to'] };
}

/**
 * The range to compare with: the same number of days immediately before (`2026-09-01…09-30` → `2026-08-02…08-31`),
 * so a month with a different length still compares like for like.
 */
export function previousRange(range: DateRange): DateRange {
  const days = countDays(range.from, range.to);
  const to = addDays(range.from, -1);
  return { from: addDays(to, -(days - 1)), to };
}

/** Whether the range ends before `today` (a final report) or includes it (provisional). */
export function statusOf(range: DateRange, today: DateRange['from']): ReportStatus {
  return range.to < today ? 'final' : 'provisional';
}
