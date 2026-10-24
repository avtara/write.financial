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

/** D10: only closed monthly reports are final; quarterly/yearly/custom aggregates are always provisional. */
export const REPORT_STATUSES = ['final', 'provisional'] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

/** Export formats of a stored report (FR-LP4, plan §6 `rep.{reportId}.{format}`): PDF to print, XLSX, CSV. */
export const REPORT_FORMATS = ['pdf', 'xlsx', 'csv'] as const;
export type ReportFormat = (typeof REPORT_FORMATS)[number];

/**
 * Sections of an exported report, in print order (design yLlRY: 4 A4 pages):
 * `summary` "Ringkasan & Kekayaan Bersih" p. 1, `flow` "Arus Uang & Pemasukan" p. 2, `spending` "Pengeluaran" p. 3,
 * `largest` "Transaksi Terbesar & Langganan" p. 4. The export dialog selects a subset; XLSX and CSV keep their
 * sheets/blocks in the same order.
 */
export const REPORT_EXPORT_SECTIONS = ['summary', 'flow', 'spending', 'largest'] as const;
export type ReportExportSection = (typeof REPORT_EXPORT_SECTIONS)[number];

/** Appearance options of an export (design yLlRY): theme for ink/paper, `paper` A4 or Letter, account masking. */
export interface ReportExportOptions {
  readonly sections: readonly ReportExportSection[];
  readonly theme: 'light' | 'dark';
  readonly paper: 'a4' | 'letter';
  /** "Samarkan nomor rekening": `BCA 1234` → `BCA •• 1234` keeps the last 4 digits, amounts stay visible. */
  readonly maskAccountNumbers: boolean;
}

/** The auto-send defaults (FR-LP4): every section, light "hemat tinta", A4, unmasked — the owner's own copy. */
export const DEFAULT_REPORT_EXPORT_OPTIONS: ReportExportOptions = {
  sections: REPORT_EXPORT_SECTIONS,
  theme: 'light',
  paper: 'a4',
  maskAccountNumbers: false,
};

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
  /** Cash + investments − debt at the cutoff; `null` when the valuation is incomplete or unavailable. */
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
export function shareLines<K>(
  rows: readonly { readonly key: K; readonly totalMinor: bigint }[],
  totalMinor: bigint,
): ShareLine<K>[] {
  return rows.map((row) => ({
    key: row.key,
    totalMinor: row.totalMinor,
    shareBps: totalMinor > 0n ? Number(divideFloor(row.totalMinor * 10_000n, totalMinor)) : 0,
  }));
}

/** A goal's progress ("Dana Darurat 7.625.000/54.000.000 = 14,1%"), 0 for a goal without a target. */
export function progressBps(savedMinor: bigint, targetMinor: bigint): number {
  return targetMinor > 0n ? Number(divideFloor(savedMinor * 10_000n, targetMinor)) : 0;
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
 * The highest seven consecutive calendar days within `range`; ties use the earliest start. `days` must be sorted
 * oldest first. Sparse days count as zero, and a range shorter than a week uses its complete, bounded interval.
 */
export function busiestWeek(days: readonly ReportDay[], range: DateRange): BusiestWeek | null {
  let left = 0;
  let right = 0;
  let totalMinor = 0n;
  let best: BusiestWeek | null = null;
  const lastStart = countDays(range.from, range.to) < 7 ? range.from : addDays(range.to, -6);
  for (let from = range.from; from <= lastStart && from <= range.to; from = addDays(from, 1)) {
    const weekEnd = addDays(from, 6);
    const to = weekEnd < range.to ? weekEnd : range.to;
    while (right < days.length && (days[right] as ReportDay).date <= to) {
      totalMinor += (days[right] as ReportDay).outMinor;
      right += 1;
    }
    while (left < right && (days[left] as ReportDay).date < from) {
      totalMinor -= (days[left] as ReportDay).outMinor;
      left += 1;
    }
    if (totalMinor > 0n && (best === null || totalMinor > best.totalMinor)) best = { from, to, totalMinor };
  }
  return best;
}

/**
 * "6 transaksi = 40% dari pengeluaran": the share of all expenses that the first `count` of `rows` (already largest
 * first) make up. `null` without expenses.
 */
export function topShareBps(
  rows: readonly { readonly amountMinor: bigint }[],
  count: number,
  expenseMinor: bigint,
): number | null {
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
  let last = months[0] as ReportMonth;
  let incomeMinor = 0n;
  let expenseMinor = 0n;
  let txCount = 0;
  for (const month of months) {
    incomeMinor += month.totals.incomeMinor;
    expenseMinor += month.totals.expenseMinor;
    txCount += month.totals.txCount;
    if (month.range.to > last.range.to) last = month;
  }
  return reportTotals({ incomeMinor, expenseMinor, txCount, netWorthMinor: last.totals.netWorthMinor });
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
