// SPDX-License-Identifier: AGPL-3.0-only
import type { LocalDate, YearMonth } from '@wf/domain/period';
import { setLocale } from '@wf/i18n/runtime';
import { beforeEach, describe, expect, it } from 'vitest';
import { SEPTEMBER } from '../../../test/budget-fixtures.ts';
import { dashboard, rangeDashboard, weekDashboard, yearDashboard } from '../../../test/dashboard-fixtures.ts';
import {
  comparisonLabel,
  dayTitle,
  greeting,
  longRange,
  monthName,
  periodButtonLabel,
  periodLabel,
  scopeSuffix,
  shortRange,
  summaryLine,
  weekdayName,
} from './dashboard-format.ts';

const d = (value: string) => value as LocalDate;
const at = (time: string) => new Date(`2026-10-15T${time}:00+07:00`);

beforeEach(async () => {
  await setLocale('id', { reload: false });
});

describe('greeting', () => {
  it('follows the time of day in the user’s zone', () => {
    expect(greeting(at('03:59'), 'Asia/Jakarta', 'Avtara')).toBe('Selamat malam, Avtara');
    expect(greeting(at('04:00'), 'Asia/Jakarta', 'Avtara')).toBe('Selamat pagi, Avtara');
    expect(greeting(at('11:00'), 'Asia/Jakarta', 'Avtara')).toBe('Selamat siang, Avtara');
    expect(greeting(at('15:00'), 'Asia/Jakarta', 'Avtara')).toBe('Selamat sore, Avtara');
    expect(greeting(at('18:00'), 'Asia/Jakarta', 'Avtara')).toBe('Selamat malam, Avtara');
    // 16.42 in Jakarta is 17.42 in Makassar.
    expect(greeting(at('17:42'), 'Asia/Makassar', 'Avtara')).toBe('Selamat malam, Avtara');
  });
});

describe('dates', () => {
  it('formats ranges, months, and days the way the design writes them', () => {
    expect(longRange({ from: d('2026-10-01'), to: d('2026-10-15') }, 'id')).toBe('1–15 Oktober 2026');
    expect(longRange({ from: d('2026-10-01'), to: d('2026-10-15') }, 'en')).toBe('October 1 – 15, 2026');
    expect(shortRange({ from: d('2026-09-14'), to: d('2026-10-13') }, 'id', d('2026-10-15'))).toBe('14 Sep – 13 Okt');
    expect(shortRange({ from: d('2025-12-20'), to: d('2026-01-05') }, 'id', d('2026-10-15'))).toBe(
      '20 Des 2025 – 5 Jan 2026',
    );
    expect(periodLabel('2026-10' as YearMonth, 'id')).toBe('Okt 2026');
    expect(monthName('2026-09' as YearMonth, 'id')).toBe('Sep');
    expect(monthName('2026-09' as YearMonth, 'en', 'long')).toBe('September');
    expect(weekdayName(d('2026-10-14'), 'id')).toBe('Rab');
    expect(dayTitle(d('2026-10-11'), 'id')).toBe('Minggu, 11 Oktober');
  });
});

describe('summaryLine', () => {
  it('says what the page sums up for each scope', () => {
    expect(summaryLine(dashboard(), 'id')).toBe('Ini ringkasan uangmu periode 1–15 Oktober 2026.');
    expect(summaryLine(weekDashboard(), 'id')).toBe('Ini ringkasan uangmu minggu ini, 12–18 Oktober 2026.');
    expect(summaryLine(yearDashboard(), 'id')).toBe('Ini ringkasan uangmu sepanjang 2026, Januari – Oktober.');
    expect(summaryLine(rangeDashboard(), 'id')).toBe(
      'Ini ringkasan uangmu 14 September – 13 Oktober 2026 · 30 hari · melintasi 2 periode.',
    );
  });
});

describe('periodButtonLabel', () => {
  it('reads the period, the week, or the year', () => {
    expect(periodButtonLabel(dashboard(), 'id')).toBe('Okt 2026');
    expect(periodButtonLabel(weekDashboard(), 'id')).toBe('12–18 Okt');
    expect(periodButtonLabel(yearDashboard(), 'id')).toBe('2026');
  });
});

describe('comparisonLabel', () => {
  it('names the like-for-like comparison', () => {
    expect(comparisonLabel(dashboard(), 'id')).toBe('vs Sep');
    expect(comparisonLabel(weekDashboard(), 'id')).toBe('vs Sen–Kam lalu');
    const fullWeek = weekDashboard({
      ranges: {
        full: { from: d('2026-10-05'), to: d('2026-10-11') },
        current: { from: d('2026-10-05'), to: d('2026-10-11') },
        previous: { from: d('2026-09-28'), to: d('2026-10-04') },
      },
    });
    expect(comparisonLabel(fullWeek, 'id')).toBe('vs mgg lalu');
    expect(comparisonLabel(yearDashboard(), 'id')).toBe('vs 2025');
    expect(comparisonLabel(rangeDashboard(), 'id')).toBe('vs 15 Agu – 13 Sep');
  });
});

describe('scopeSuffix', () => {
  it('says "this …" for the span containing today, else names it', () => {
    expect(scopeSuffix(dashboard(), 'id')).toBe('bulan ini');
    expect(
      scopeSuffix(
        dashboard({
          period: SEPTEMBER,
          ranges: {
            full: { from: d('2026-09-01'), to: d('2026-09-30') },
            current: { from: d('2026-09-01'), to: d('2026-09-30') },
            previous: { from: d('2026-08-01'), to: d('2026-08-31') },
          },
        }),
        'id',
      ),
    ).toBe('di Sep');
    expect(scopeSuffix(weekDashboard(), 'id')).toBe('minggu ini');
    expect(scopeSuffix(yearDashboard(), 'id')).toBe('tahun ini');
    expect(scopeSuffix(yearDashboard({ today: d('2027-02-01') }), 'id')).toBe('di 2026');
    expect(scopeSuffix(rangeDashboard(), 'id')).toBe('di rentang ini');
  });
});
