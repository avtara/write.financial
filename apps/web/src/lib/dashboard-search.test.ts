// SPDX-License-Identifier: AGPL-3.0-only
import type { YearMonth } from '@wf/domain/period';
import { describe, expect, it } from 'vitest';
import { OCTOBER, SEPTEMBER, AUGUST } from '../../test/budget-fixtures.ts';
import { dashboard, rangeDashboard, weekDashboard, yearDashboard } from '../../test/dashboard-fixtures.ts';
import {
  adjacentSearch,
  DASHBOARD_SEARCH,
  dashboardRequestOf,
  MAX_DASHBOARD_RANGE_DAYS,
  transactionsDatesOf,
} from './dashboard-search.ts';

const ROWS = [OCTOBER, SEPTEMBER, AUGUST];

describe('DASHBOARD_SEARCH', () => {
  it('keeps valid params and drops invalid ones', () => {
    expect(
      DASHBOARD_SEARCH.parse({ scope: 'year', period: '2026-09', year: 2025, range: '2026-09-14..2026-10-13' }),
    ).toEqual({ scope: 'year', period: '2026-09', year: 2025, range: '2026-09-14..2026-10-13' });
    expect(
      DASHBOARD_SEARCH.parse({ scope: 'decade', period: '2026-13', year: 2025.5, range: '2026-10-13..2026-09-14' }),
    ).toEqual({});
    expect(MAX_DASHBOARD_RANGE_DAYS).toBe(366);
    expect(DASHBOARD_SEARCH.parse({ range: '2025-01-01..2026-01-02' })).toEqual({});
  });
});

describe('dashboardRequestOf', () => {
  it('lets a range win, then the scope', () => {
    expect(dashboardRequestOf({ range: '2026-09-14..2026-10-13', scope: 'week' }, ROWS)).toEqual({
      scope: 'range',
      from: '2026-09-14',
      to: '2026-10-13',
    });
    expect(dashboardRequestOf({ scope: 'week' }, ROWS)).toEqual({ scope: 'week' });
    expect(dashboardRequestOf({ scope: 'year' }, ROWS)).toEqual({ scope: 'year' });
    expect(dashboardRequestOf({ scope: 'year', year: 2025 }, ROWS)).toEqual({ scope: 'year', year: 2025 });
  });

  it('finds a month by its label among the period rows, else the current period', () => {
    expect(dashboardRequestOf({ period: '2026-09' as YearMonth }, ROWS)).toEqual({ scope: 'month', periodId: 'p-sep' });
    expect(dashboardRequestOf({ period: '2026-01' as YearMonth }, ROWS)).toEqual({ scope: 'month' });
    expect(dashboardRequestOf({}, ROWS)).toEqual({ scope: 'month' });
  });
});

describe('transactionsDatesOf', () => {
  it('links a month by its period and anything else by the range so far', () => {
    expect(transactionsDatesOf(dashboard())).toEqual({ period: '2026-10' });
    expect(transactionsDatesOf(weekDashboard())).toEqual({ range: '2026-10-12..2026-10-15' });
    expect(transactionsDatesOf(dashboard({ period: null }))).toEqual({ range: '2026-10-01..2026-10-15' });
  });
});

describe('adjacentSearch', () => {
  it('steps through the period rows', () => {
    expect(adjacentSearch(dashboard(), ROWS, -1)).toEqual({ period: '2026-09' });
    expect(adjacentSearch(dashboard(), ROWS, 1)).toBeNull();
    expect(adjacentSearch(dashboard({ period: SEPTEMBER }), ROWS, 1)).toEqual({});
    expect(adjacentSearch(dashboard({ period: SEPTEMBER }), ROWS, -1)).toEqual({ period: '2026-08' });
    expect(adjacentSearch(dashboard({ period: AUGUST }), ROWS, -1)).toBeNull();
    expect(adjacentSearch(dashboard({ period: null }), ROWS, -1)).toBeNull();
  });

  it('steps through years up to this one', () => {
    expect(adjacentSearch(yearDashboard(), ROWS, -1)).toEqual({ scope: 'year', year: 2025 });
    expect(adjacentSearch(yearDashboard(), ROWS, 1)).toBeNull();
    const last = yearDashboard({
      ranges: {
        full: { from: '2025-01-01' as never, to: '2025-12-31' as never },
        current: { from: '2025-01-01' as never, to: '2025-12-31' as never },
        previous: { from: '2024-01-01' as never, to: '2024-12-31' as never },
      },
    });
    expect(adjacentSearch(last, ROWS, 1)).toEqual({ scope: 'year' });
  });

  it('shifts a week or a range by its length, never past today', () => {
    expect(adjacentSearch(weekDashboard(), ROWS, -1)).toEqual({ range: '2026-10-05..2026-10-11' });
    expect(adjacentSearch(weekDashboard(), ROWS, 1)).toBeNull();
    expect(adjacentSearch(rangeDashboard(), ROWS, -1)).toEqual({ range: '2026-08-15..2026-09-13' });
    expect(adjacentSearch(rangeDashboard(), ROWS, 1)).toEqual({ range: '2026-10-14..2026-11-12' });
    expect(
      adjacentSearch(
        rangeDashboard({
          ranges: {
            full: { from: '2026-10-10' as never, to: '2026-10-15' as never },
            current: { from: '2026-10-10' as never, to: '2026-10-15' as never },
            previous: { from: '2026-10-04' as never, to: '2026-10-09' as never },
          },
        }),
        ROWS,
        1,
      ),
    ).toBeNull();
    expect(
      adjacentSearch(
        rangeDashboard({
          ranges: {
            full: { from: '2026-09-01' as never, to: '2026-09-07' as never },
            current: { from: '2026-09-01' as never, to: '2026-09-07' as never },
            previous: { from: '2026-08-25' as never, to: '2026-08-31' as never },
          },
        }),
        ROWS,
        1,
      ),
    ).toEqual({ range: '2026-09-08..2026-09-14' });
  });
});
