// SPDX-License-Identifier: AGPL-3.0-only
import { parseLocalDate as d } from '@wf/domain/period';
import { describe, expect, it, vi } from 'vitest';
import {
  formatDate,
  formatDateRange,
  formatMonth,
  formatTime,
  fromDate,
  monthWeeks,
  toLocalDate,
  weekdayName,
  weekdayNames,
} from './dates.ts';

describe('fromDate / toLocalDate', () => {
  it('reads the calendar date of a local Date', () => {
    expect(fromDate(new Date(2026, 9, 15, 23, 59))).toBe('2026-10-15');
  });

  it('places an instant on the calendar of the given time zone', () => {
    // 15 Oct 2026 18:30 UTC is already 16 Oct in Jakarta (UTC+7), still 15 Oct in New York.
    const instant = new Date(Date.UTC(2026, 9, 15, 18, 30));
    expect(toLocalDate(instant, 'Asia/Jakarta')).toBe('2026-10-16');
    expect(toLocalDate(instant, 'America/New_York')).toBe('2026-10-15');
  });
});

describe('monthWeeks', () => {
  it('fills whole weeks starting on Monday', () => {
    const weeks = monthWeeks(d('2026-10-15'), 1);
    expect(weeks).toHaveLength(5);
    expect(weeks[0]).toEqual([
      '2026-09-28',
      '2026-09-29',
      '2026-09-30',
      '2026-10-01',
      '2026-10-02',
      '2026-10-03',
      '2026-10-04',
    ]);
    expect(weeks.at(-1)?.at(-1)).toBe('2026-11-01');
  });

  it('fills whole weeks starting on Sunday', () => {
    const weeks = monthWeeks(d('2026-02-01'), 0);
    expect(weeks[0]?.[0]).toBe('2026-02-01');
    expect(weeks).toHaveLength(4);
  });
});

describe('names and formats', () => {
  it('names the weekdays in week order', () => {
    expect(weekdayNames('id', 1).map((day) => day.short)).toEqual(['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min']);
    expect(weekdayNames('en', 0)[0]).toEqual({ short: 'Sun', long: 'Sunday' });
    expect(weekdayName(4, 'id')).toBe('Kamis');
    expect(weekdayName(1, 'en')).toBe('Monday');
    expect(weekdayName(7, 'id')).toBe('Minggu');
  });

  it('names the month', () => {
    expect(formatMonth(d('2026-10-15'), 'id')).toBe('Oktober 2026');
    expect(formatMonth(d('2026-10-15'), 'en')).toBe('October 2026');
  });

  it.each([
    ['day', '15 Okt', 'Oct 15'],
    ['date', '15 Okt 2026', 'Oct 15, 2026'],
    ['weekday', 'Kamis, 15 Okt', 'Thursday, Oct 15'],
    ['full', 'Kamis, 15 Oktober 2026', 'Thursday, October 15, 2026'],
  ] as const)('formats a %s', (style, id, en) => {
    expect(formatDate(d('2026-10-15'), 'id', style)).toBe(id);
    expect(formatDate(d('2026-10-15'), 'en', style)).toBe(en);
  });

  it('formats a year of days without building a formatter per day', () => {
    const built = vi.spyOn(Intl, 'DateTimeFormat');
    const days = Array.from({ length: 365 }, (_, index) =>
      formatDate(fromDate(new Date(2025, 9, 16 + index)), 'en', 'weekday'),
    );
    expect(days[0]).toBe('Thursday, Oct 16');
    expect(days.at(-1)).toBe('Thursday, Oct 15');
    expect(built.mock.calls.length).toBeLessThanOrEqual(1);
    built.mockRestore();
  });

  it('formats the 24-hour time in the time zone', () => {
    const instant = new Date(Date.UTC(2026, 9, 15, 12, 30));
    expect(formatTime(instant, 'Asia/Jakarta', 'id')).toBe('19.30');
    expect(formatTime(instant, 'Asia/Jakarta', 'en')).toBe('19:30');
  });

  it('formats ranges compactly, with the year only outside the current one', () => {
    const today = d('2026-10-15');
    // Node's ICU puts thin spaces (U+2009) around the dash between months, browsers plain ones; both read plain.
    const range = (start: string, end: string) => formatDateRange({ start: d(start), end: d(end) }, 'id', today);
    expect(range('2026-10-12', '2026-10-15')).toBe('12–15 Okt');
    expect(range('2026-09-28', '2026-10-03')).toBe('28 Sep – 3 Okt');
    expect(range('2025-12-28', '2026-01-03')).toBe('28 Des 2025 – 3 Jan 2026');
    expect(range('2026-12-28', '2027-01-03')).toBe('28 Des 2026 – 3 Jan 2027');
    expect(formatDateRange({ start: today, end: today }, 'en', today)).toBe('Oct 15');
  });
});
