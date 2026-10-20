// SPDX-License-Identifier: AGPL-3.0-only
import type { LocalDate } from '@wf/domain/period';
import { describe, expect, it } from 'vitest';
import { day } from '../../../test/dashboard-fixtures.ts';
import {
  calendarMonths,
  calendarWeeks,
  cheapestMonth,
  costliestDay,
  heatLevel,
  weekendRatio,
} from './calendar-model.ts';

const d = (value: string) => value as LocalDate;
const TODAY = d('2026-10-15');

describe('heatLevel', () => {
  it('splits spending into quarters of the costliest day', () => {
    expect(heatLevel(0n, 100n)).toBe(0);
    expect(heatLevel(1n, 100n)).toBe(1);
    expect(heatLevel(50n, 100n)).toBe(2);
    expect(heatLevel(51n, 100n)).toBe(3);
    expect(heatLevel(100n, 100n)).toBe(4);
  });
});

describe('calendarWeeks', () => {
  it('covers the range in Monday-first weeks with each day’s totals', () => {
    const days = [day('2026-10-01', 6_500_000n, 20_150_000n, 6), day('2026-10-11', 3_380_000n, 0n, 5)];
    const weeks = calendarWeeks({ from: d('2026-10-01'), to: d('2026-10-31') }, days, TODAY);
    expect(weeks).toHaveLength(5);
    expect(weeks[0]?.[0]).toMatchObject({ date: '2026-09-28', inRange: false, heat: 0, count: 0, surplus: false });
    expect(weeks[0]?.[3]).toMatchObject({ date: '2026-10-01', inRange: true, surplus: true, heat: 4 });
    expect(weeks[1]?.[6]).toMatchObject({ date: '2026-10-11', heat: 3, count: 5, future: false });
    expect(weeks[2]?.[4]).toMatchObject({ date: '2026-10-16', future: true });
    expect(weeks[4]?.[6]?.date).toBe('2026-11-01');
  });
});

describe('calendarMonths', () => {
  it('lays out each month of a year, the heat relative to the whole year', () => {
    const days = [day('2026-09-09', 1_650_000n), day('2026-10-11', 3_300_000n), day('2026-10-02', 300_000n)];
    const months = calendarMonths({ from: d('2026-01-01'), to: d('2026-12-31') }, days, TODAY);
    expect(months.map((month) => month.label)).toHaveLength(12);
    const september = months[8];
    expect(september).toMatchObject({ label: '2026-09', end: '2026-09-30', outMinor: 1_650_000n, future: false });
    expect(september?.weeks.flat().find((cell) => cell.date === '2026-09-09')?.heat).toBe(2);
    expect(months[9]?.outMinor).toBe(3_600_000n);
    expect(months[10]).toMatchObject({ label: '2026-11', future: true, outMinor: 0n });
    expect(months[1]?.end).toBe('2026-02-28');
  });
});

describe('insights', () => {
  it('finds the costliest day', () => {
    expect(costliestDay([day('2026-10-01', 5n), day('2026-10-02', 9n), day('2026-10-03', 9n)])?.date).toBe(
      '2026-10-02',
    );
    expect(costliestDay([day('2026-10-01', 0n, 5n)])).toBeNull();
  });

  it('finds the thriftiest month among those over with spending', () => {
    const months = calendarMonths(
      { from: d('2026-07-01'), to: d('2026-10-31') },
      [day('2026-08-03', 900n), day('2026-09-03', 400n), day('2026-10-03', 100n)],
      TODAY,
    );
    expect(cheapestMonth(months, TODAY)?.label).toBe('2026-09');
    expect(cheapestMonth(months.slice(0, 1), TODAY)).toBeNull();
    expect(cheapestMonth([...months.slice(2, 3), ...months.slice(1, 2)], TODAY)?.label).toBe('2026-09');
  });

  it('compares weekend with weekday spending up to today', () => {
    const range = { from: d('2026-10-05'), to: d('2026-10-18') };
    // Mon 5 – Sun 11: weekdays 500 over 5 days, weekend 600 over 2 days → 300 / 100 = 3×.
    const days = [day('2026-10-06', 500n), day('2026-10-10', 600n), day('2026-10-17', 9_999n)];
    expect(weekendRatio(range, days, d('2026-10-11'))).toBe(3);
    expect(weekendRatio(range, [day('2026-10-10', 600n)], d('2026-10-11'))).toBeNull();
    expect(weekendRatio({ from: d('2026-10-05'), to: d('2026-10-09') }, days, TODAY)).toBeNull();
  });
});
