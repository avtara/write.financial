// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Pure helpers of "Laporan": the period selection and its request, the localized rendering of a report's neutral
 * labels ("2026-09" → "September 2026"), the savings-rate change in points, the picker's options derived from
 * `today`, the empty state's timeline, and the "Catatan untuk periode berikutnya" notes derived from the snapshot.
 */
import type { ReportRangeLabel, ReportRequest, ReportSummary, ReportView } from '@wf/db/reports';
import { quarterRange, type ReportStatus } from '@wf/domain/report';
import { addDays, dateInMonth, shiftMonth, type LocalDate, type YearMonth } from '@wf/domain/period';
import { MINUS } from '@wf/domain/money';
import type { Locale } from '@wf/i18n/locale';
import { monthName, shortRange } from '../dashboard/dashboard-format.ts';

/** The report amounts are the ledger's base currency; the page contract carries no currency, so the app default. */
export const REPORTS_CURRENCY = 'IDR';

/** What the user picked in the segmented control; a monthly pick keeps the summary's id and the period's id. */
export type ReportSelection =
  | { readonly kind: 'monthly'; readonly id: string; readonly periodId: string }
  | { readonly kind: 'quarterly'; readonly year: number; readonly quarter: 1 | 2 | 3 | 4 }
  | { readonly kind: 'yearly'; readonly year: number }
  | { readonly kind: 'custom'; readonly from: LocalDate; readonly to: LocalDate };

/** The wire shape of {@link viewReport}. */
export function requestOf(selection: ReportSelection): ReportRequest {
  switch (selection.kind) {
    case 'monthly':
      return { kind: 'monthly', periodId: selection.periodId };
    case 'quarterly':
      return { kind: 'quarterly', year: selection.year, quarter: selection.quarter };
    case 'yearly':
      return { kind: 'yearly', year: selection.year };
    case 'custom':
      return { kind: 'custom', from: selection.from, to: selection.to };
  }
}

/** A month in the picker: a saved monthly report; `periodId` is only known with the full view in hand. */
export interface MonthlyOption {
  readonly id: string;
  readonly periodId: string | null;
  readonly label: string;
  readonly status: ReportStatus;
}

/**
 * The months to pick, newest first: the saved monthly summaries plus the latest final when it is not among them.
 * A summary's period id arrives only through the latest final view; other months become pickable once the home
 * response carries their `periodId`.
 */
export function monthlyOptions(reports: readonly ReportSummary[], latestFinal: ReportView | null): MonthlyOption[] {
  const options = reports
    .filter((report) => report.kind === 'monthly')
    .map((report) => ({
      id: report.id,
      periodId:
        report.id === latestFinal?.id
          ? latestFinal.periodId
          : ((report as { readonly periodId?: string | null }).periodId ?? null),
      label: report.label,
      status: report.status,
    }));
  if (latestFinal !== null && !options.some((option) => option.id === latestFinal.id)) {
    options.push({
      id: latestFinal.id,
      periodId: latestFinal.periodId,
      label: latestFinal.label,
      status: latestFinal.status,
    });
  }
  return options.toSorted((a, b) => b.label.localeCompare(a.label));
}

/** Quarters to pick, newest first: all of last year's plus this year's that already ended. */
export function quarterOptions(today: LocalDate): { year: number; quarter: 1 | 2 | 3 | 4 }[] {
  const year = Number(today.slice(0, 4));
  const options: { year: number; quarter: 1 | 2 | 3 | 4 }[] = [];
  for (let y = year; y >= year - 1; y -= 1) {
    for (const quarter of [4, 3, 2, 1] as const) {
      if (y === year && quarterRange(y, quarter).to > today) continue;
      options.push({ year: y, quarter });
    }
  }
  return options;
}

/** Years to pick, newest first: this partial year and the complete one before it. */
export function yearOptions(today: LocalDate): number[] {
  const year = Number(today.slice(0, 4));
  return [year, year - 1];
}

/** A custom range is valid when it is ordered (the core refuses more than a year with its own code). */
export function isCustomRangeValid(from: LocalDate, to: LocalDate): boolean {
  return from <= to;
}

/** `2026-09` → "September 2026", `2026-Q3` → "Q3 2026", `2026` → "2026", `from/to` → "1–15 Okt". */
export function neutralLabel(label: string, locale: Locale, today: LocalDate): string {
  const month = /^(\d{4})-(\d{2})$/.exec(label);
  if (month !== null) return `${monthName(label.slice(0, 7) as YearMonth, locale, 'long')} ${month[1]}`;
  const quarter = /^(\d{4})-Q([1-4])$/.exec(label);
  if (quarter !== null) return `Q${quarter[2]} ${quarter[1]}`;
  if (/^\d{4}$/.test(label)) return label;
  const [from, to] = label.split('/');
  if (from !== undefined && to !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return shortRange({ from: from as LocalDate, to: to as LocalDate }, locale, today);
  }
  return label;
}

/** The picker's label of a selection ("September 2026", "Q3 2026", "2026", "1–15 Okt"). */
export function selectionLabel(
  selection: ReportSelection,
  reports: readonly ReportSummary[],
  latestFinal: ReportView | null,
  locale: Locale,
  today: LocalDate,
): string {
  if (selection.kind === 'monthly') {
    const summary = reports.find((report) => report.id === selection.id);
    return neutralLabel(summary?.label ?? latestFinal?.label ?? selection.periodId, locale, today);
  }
  if (selection.kind === 'quarterly') return `Q${selection.quarter} ${selection.year}`;
  if (selection.kind === 'yearly') return String(selection.year);
  return shortRange({ from: selection.from, to: selection.to }, locale, today);
}

/** The change of the savings rate in percentage points, signed ("−3,0"). */
export function formatPoints(points: number, locale: Locale): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 1, signDisplay: 'exceptZero' })
    .format(points)
    .replace('-', MINUS);
}

/** A stored export's size ("86 kB", "1,2 MB"), as the saved files list shows it. */
export function formatFileSize(sizeBytes: number, locale: Locale): string {
  const units = ['B', 'kB', 'MB', 'GB'] as const;
  let value = sizeBytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  const formatted = new Intl.NumberFormat(locale, {
    minimumFractionDigits: unit === 0 ? 0 : 1,
    maximumFractionDigits: unit === 0 ? 0 : 1,
  }).format(value);
  return `${formatted} ${units[unit]}`;
}

/** One month-end of the net worth history; `valueMinor: null` is a gap (no observation), never zero. */
export interface NetWorthPoint {
  readonly date: LocalDate;
  readonly valueMinor: bigint | null;
}

/** The history as chart points. */
export function netWorthPoints(view: ReportView): NetWorthPoint[] {
  return view.sections.netWorthHistory.map((point) => ({
    date: point.date,
    valueMinor: point.valuation === null ? null : point.valuation.valueMinor,
  }));
}

/** One "Catatan untuk periode berikutnya" item, derived from the snapshot's own facts. */
export type ReportNote =
  | { readonly kind: 'overBudget'; readonly name: string | null; readonly overMinor: bigint }
  | { readonly kind: 'subsUnconverted'; readonly count: number }
  | { readonly kind: 'unvalued'; readonly currencies: readonly string[] };

/** Over-budget categories, unconverted subscriptions, and currencies without a rate. */
export function notesFor(view: ReportView): ReportNote[] {
  const notes: ReportNote[] = [];
  for (const line of view.sections.categories) {
    if (line.overMinor > 0n) notes.push({ kind: 'overBudget', name: line.name, overMinor: line.overMinor });
  }
  if (view.sections.subscriptions.unconverted > 0) {
    notes.push({ kind: 'subsUnconverted', count: view.sections.subscriptions.unconverted });
  }
  const unvalued = view.sections.netWorth?.unvaluedCurrencies ?? [];
  if (unvalued.length > 0) notes.push({ kind: 'unvalued', currencies: unvalued });
  return notes;
}

/** The last day of `today`'s month ("31 Okt"). */
export function monthEnd(today: LocalDate): LocalDate {
  return addDays(dateInMonth(shiftMonth(today.slice(0, 7) as YearMonth, 1), 1), -1);
}

/** The empty state's timeline (design `gyfhQ`): recording starts today, the first period closes, its report is out. */
export interface EmptyTimeline {
  /** The first period: `today`'s month, from its first to its last day. */
  readonly period: { readonly start: LocalDate; readonly end: LocalDate };
  /** The first period's month in words ("Oktober"): the month the first report covers. */
  readonly month: string;
  /** The day after the period closes, when its report is published and the next period starts. */
  readonly publishedAt: LocalDate;
  /** {@link publishedAt}'s month in words ("November"). */
  readonly publishedMonth: string;
}

export function emptyTimeline(today: LocalDate, locale: Locale): EmptyTimeline {
  const month = today.slice(0, 7) as YearMonth;
  const next = shiftMonth(month, 1);
  return {
    period: { start: dateInMonth(month, 1), end: monthEnd(today) },
    month: monthName(month, locale, 'long'),
    publishedAt: dateInMonth(next, 1),
    publishedMonth: monthName(next, locale, 'long'),
  };
}

/** The comparison's label for the header ("dibandingkan dengan Agustus 2026") or `null` without one. */
export function comparisonLabel(compare: ReportRangeLabel | null, locale: Locale, today: LocalDate): string | null {
  return compare === null ? null : neutralLabel(compare.label, locale, today);
}
