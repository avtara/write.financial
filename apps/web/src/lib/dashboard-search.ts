// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The Overview URL (FR-D1, FR-S7): `/` is this month's period; `?scope=week` this week, `?scope=year[&year=2025]` a
 * year, `?period=2026-09` another period, `?range=2026-09-14..2026-10-13` a custom range (wins over the rest). Invalid
 * params are dropped (`.catch`), never an error page.
 */
import type { Dashboard, DashboardRequest } from '@wf/db/dashboard';
import type { PeriodView } from '@wf/db/periods';
import { addDays, countDays } from '@wf/domain/period';
import * as z from 'zod';
import { rangeOf, rangeParam, rangeParamOf, yearMonthParam, type TransactionsSearch } from './transactions-search.ts';

/** The dashboard repository refuses longer ranges. */
export const MAX_DASHBOARD_RANGE_DAYS = 366;

export const DASHBOARD_SEARCH = z.object({
  /** The Week / Year segment; without it, a month (period). */
  scope: z.enum(['week', 'year']).optional().catch(undefined),
  /** Month: the period label; without it, the current period. */
  period: yearMonthParam.optional().catch(undefined),
  /** Year: without it, this year. */
  year: z.int().min(1970).max(9998).optional().catch(undefined),
  range: rangeParam(MAX_DASHBOARD_RANGE_DAYS).optional().catch(undefined),
});
export type DashboardSearch = z.infer<typeof DASHBOARD_SEARCH>;

/**
 * The `getDashboard` request for `search`: a range wins, then the scope. A month is the period row labelled
 * `period` among `periods`; an unknown label (no row) shows the current period, like `/transactions`.
 */
export function dashboardRequestOf(search: DashboardSearch, periods: readonly PeriodView[]): DashboardRequest {
  if (search.range !== undefined) return { scope: 'range', ...rangeOf(search.range) };
  if (search.scope === 'week') return { scope: 'week' };
  if (search.scope === 'year')
    return search.year === undefined ? { scope: 'year' } : { scope: 'year', year: search.year };
  const id = periods.find((period) => period.label === search.period)?.id ?? null;
  return id === null ? { scope: 'month' } : { scope: 'month', periodId: id };
}

/** The `/transactions` dates of what the Overview shows: the period by label, else the range so far. */
export function transactionsDatesOf(
  dashboard: Pick<Dashboard, 'period' | 'scope' | 'ranges'>,
): Pick<TransactionsSearch, 'period' | 'range'> {
  if (dashboard.scope === 'month' && dashboard.period !== null) return { period: dashboard.period.label };
  const { from, to } = dashboard.ranges.current;
  return { range: rangeParamOf(from, to) };
}

/**
 * The Overview one step back or forward ("‹ Oktober 2026 ›"): the period row before / after (rows newest first in
 * `periods`), the year before / after, or the week / range shifted by its length (as a range); `null` past the last
 * row, after this year or this week, or past today.
 */
export function adjacentSearch(
  dashboard: Pick<Dashboard, 'scope' | 'period' | 'ranges' | 'today'>,
  periods: readonly Pick<PeriodView, 'label'>[],
  step: -1 | 1,
): DashboardSearch | null {
  if (dashboard.scope === 'month') {
    const index = periods.findIndex((period) => period.label === dashboard.period?.label);
    const next = periods[index - step];
    if (index === -1 || next === undefined) return null;
    return index - step === 0 ? {} : { period: next.label };
  }
  if (dashboard.scope === 'year') {
    const year = Number(dashboard.ranges.full.from.slice(0, 4)) + step;
    if (year > Number(dashboard.today.slice(0, 4))) return null;
    return year === Number(dashboard.today.slice(0, 4)) ? { scope: 'year' } : { scope: 'year', year };
  }
  if (dashboard.scope === 'week' && step === 1) return null;
  const { from, to } = dashboard.ranges.full;
  const days = countDays(from, to);
  const start = addDays(from, step * days);
  return start > dashboard.today ? null : { range: rangeParamOf(start, addDays(to, step * days)) };
}
