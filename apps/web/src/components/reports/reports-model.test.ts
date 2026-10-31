// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import type { LocalDate } from '@wf/domain/period';
import { FINAL_VIEW, TODAY, summary } from '../../../test/report-fixtures.ts';
import {
  comparisonLabel,
  emptyTimeline,
  formatFileSize,
  formatPoints,
  isCustomRangeValid,
  monthEnd,
  monthlyOptions,
  neutralLabel,
  netWorthPoints,
  notesFor,
  quarterOptions,
  requestOf,
  selectionLabel,
  yearOptions,
} from './reports-model.ts';

const d = (value: string) => value as LocalDate;

describe('requestOf', () => {
  it('maps every selection kind to its wire shape', () => {
    expect(requestOf({ kind: 'monthly', id: 'r1', periodId: 'p1' })).toEqual({ kind: 'monthly', periodId: 'p1' });
    expect(requestOf({ kind: 'quarterly', year: 2026, quarter: 3 })).toEqual({
      kind: 'quarterly',
      year: 2026,
      quarter: 3,
    });
    expect(requestOf({ kind: 'yearly', year: 2026 })).toEqual({ kind: 'yearly', year: 2026 });
    expect(requestOf({ kind: 'custom', from: d('2026-10-01'), to: d('2026-10-15') })).toEqual({
      kind: 'custom',
      from: '2026-10-01',
      to: '2026-10-15',
    });
  });
});

describe('monthlyOptions', () => {
  it('lists the saved months newest first, every month fetchable through its period id', () => {
    const options = monthlyOptions(
      [summary('2026-08'), summary('2026-09'), summary('2026-10', { kind: 'quarterly' })],
      FINAL_VIEW,
    );
    expect(options.map((option) => option.label)).toEqual(['2026-09', '2026-08']);
    expect(options[0]).toEqual({ id: FINAL_VIEW.id, periodId: 'period-sep', label: '2026-09', status: 'final' });
    expect(options[1]).toEqual({
      id: 'report-2026-08',
      periodId: 'period-2026-08',
      label: '2026-08',
      status: 'final',
    });
  });

  it('adds the latest final when it is not among the summaries', () => {
    const options = monthlyOptions([], FINAL_VIEW);
    expect(options).toEqual([{ id: FINAL_VIEW.id, periodId: 'period-sep', label: '2026-09', status: 'final' }]);
  });
});

describe('quarterOptions', () => {
  it('offers the ended quarters of this year, all of last year, newest first', () => {
    expect(quarterOptions(d('2026-10-23'))).toEqual([
      { year: 2026, quarter: 3 },
      { year: 2026, quarter: 2 },
      { year: 2026, quarter: 1 },
      { year: 2025, quarter: 4 },
      { year: 2025, quarter: 3 },
      { year: 2025, quarter: 2 },
      { year: 2025, quarter: 1 },
    ]);
    expect(quarterOptions(d('2026-03-31'))).toEqual([
      { year: 2026, quarter: 1 },
      { year: 2025, quarter: 4 },
      { year: 2025, quarter: 3 },
      { year: 2025, quarter: 2 },
      { year: 2025, quarter: 1 },
    ]);
  });
});

describe('yearOptions', () => {
  it('offers this year and the previous one', () => {
    expect(yearOptions(TODAY)).toEqual([2026, 2025]);
  });
});

describe('isCustomRangeValid', () => {
  it('accepts an ordered range only', () => {
    expect(isCustomRangeValid(d('2026-10-01'), d('2026-10-15'))).toBe(true);
    expect(isCustomRangeValid(d('2026-10-15'), d('2026-10-01'))).toBe(false);
    expect(isCustomRangeValid(d('2026-10-01'), d('2026-10-01'))).toBe(true);
  });
});

describe('neutralLabel', () => {
  it('localizes months, quarters, years, and ranges', () => {
    expect(neutralLabel('2026-09', 'id', TODAY)).toBe('September 2026');
    expect(neutralLabel('2026-09', 'en', TODAY)).toBe('September 2026');
    expect(neutralLabel('2026-Q3', 'id', TODAY)).toBe('Q3 2026');
    expect(neutralLabel('2026', 'id', TODAY)).toBe('2026');
    expect(neutralLabel('2026-10-01/2026-10-15', 'id', TODAY)).toBe('1–15 Okt');
    expect(neutralLabel('2026-10-01/2026-10-15', 'en', TODAY)).toBe('Oct 1 – 15');
  });

  it('keeps an unknown label as is', () => {
    expect(neutralLabel('something', 'id', TODAY)).toBe('something');
  });
});

describe('selectionLabel', () => {
  it('labels each selection kind from the summaries or the selection itself', () => {
    const reports = [summary('2026-09'), summary('2026-08')];
    expect(
      selectionLabel({ kind: 'monthly', id: 'report-2026-08', periodId: 'x' }, reports, FINAL_VIEW, 'id', TODAY),
    ).toBe('Agustus 2026');
    expect(selectionLabel({ kind: 'monthly', id: 'other', periodId: 'x' }, reports, FINAL_VIEW, 'id', TODAY)).toBe(
      'September 2026',
    );
    expect(selectionLabel({ kind: 'monthly', id: 'other', periodId: 'x' }, [], FINAL_VIEW, 'id', TODAY)).toBe(
      'September 2026',
    );
    expect(selectionLabel({ kind: 'monthly', id: 'other', periodId: '2026-09' }, [], null, 'id', TODAY)).toBe(
      'September 2026',
    );
    expect(selectionLabel({ kind: 'quarterly', year: 2026, quarter: 3 }, reports, FINAL_VIEW, 'id', TODAY)).toBe(
      'Q3 2026',
    );
    expect(selectionLabel({ kind: 'yearly', year: 2026 }, reports, FINAL_VIEW, 'id', TODAY)).toBe('2026');
    expect(
      selectionLabel({ kind: 'custom', from: d('2026-10-01'), to: d('2026-10-15') }, reports, FINAL_VIEW, 'id', TODAY),
    ).toBe('1–15 Okt');
  });
});

describe('formatPoints', () => {
  it('formats signed points with the locale decimal mark and a real minus', () => {
    expect(formatPoints(-3, 'id')).toBe('−3');
    expect(formatPoints(2.5, 'id')).toBe('+2,5');
    expect(formatPoints(2.5, 'en')).toBe('+2.5');
    expect(formatPoints(0, 'id')).toBe('0');
  });
});

describe('netWorthPoints', () => {
  it('maps the history, keeping missing months as null gaps', () => {
    const points = netWorthPoints(FINAL_VIEW);
    expect(points.map((point) => point.date)).toEqual(['2026-04-30', '2026-05-31', '2026-06-30', '2026-09-30']);
    expect(points.map((point) => point.valueMinor)).toEqual([85_200_000n, null, 95_500_000n, 112_200_000n]);
  });
});

describe('notesFor', () => {
  it('collects over-budget categories, unconverted subscriptions, and unvalued currencies', () => {
    expect(notesFor(FINAL_VIEW)).toEqual([
      { kind: 'overBudget', name: 'Belanja', overMinor: 600_000n },
      { kind: 'subsUnconverted', count: 1 },
      { kind: 'unvalued', currencies: ['USD'] },
    ]);
  });

  it('is empty for a clean report', () => {
    const clean = {
      ...FINAL_VIEW,
      sections: {
        ...FINAL_VIEW.sections,
        categories: FINAL_VIEW.sections.categories.filter((line) => line.overMinor === 0n),
        subscriptions: { ...FINAL_VIEW.sections.subscriptions, unconverted: 0 },
        netWorth: null,
      },
    };
    expect(notesFor(clean)).toEqual([]);
  });
});

describe('monthEnd and emptyTimeline', () => {
  it('finds the month end', () => {
    expect(monthEnd(d('2026-10-23'))).toBe('2026-10-31');
    expect(monthEnd(d('2026-02-12'))).toBe('2026-02-28');
  });

  it('names the closing month as the first report, published the day after it closes', () => {
    expect(emptyTimeline(TODAY, 'id')).toEqual({
      period: { start: '2026-10-01', end: '2026-10-31' },
      month: 'Oktober',
      publishedAt: '2026-11-01',
      publishedMonth: 'November',
    });
    expect(emptyTimeline(d('2026-12-05'), 'en')).toEqual({
      period: { start: '2026-12-01', end: '2026-12-31' },
      month: 'December',
      publishedAt: '2027-01-01',
      publishedMonth: 'January',
    });
  });
});

describe('comparisonLabel', () => {
  it('renders the compared period or nothing', () => {
    expect(comparisonLabel(FINAL_VIEW.compare, 'id', TODAY)).toBe('Agustus 2026');
    expect(comparisonLabel(null, 'id', TODAY)).toBeNull();
  });
});

describe('formatFileSize', () => {
  it('scales to the unit under 1000 and keeps one decimal from kB up', () => {
    expect(formatFileSize(0, 'id')).toBe('0 B');
    expect(formatFileSize(999, 'id')).toBe('999 B');
    expect(formatFileSize(86_000, 'id')).toBe('86,0 kB');
    expect(formatFileSize(1_240_000, 'id')).toBe('1,2 MB');
    expect(formatFileSize(2_450_000_000, 'en')).toBe('2.5 GB');
  });
});
