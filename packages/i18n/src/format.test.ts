// SPDX-License-Identifier: AGPL-3.0-only
import * as money from '@wf/domain/money';
import { describe, expect, it } from 'vitest';
import {
  formatDate,
  formatDateRange,
  formatDateTime,
  formatMoney,
  formatNumber,
  formatPercent,
  MINUS,
} from './format.ts';

/** Calendar date as the domain passes it: `LocalDate` at UTC midnight. */
const day = (iso: string): Date => new Date(`${iso}T00:00:00Z`);

describe('formatNumber', () => {
  it('uses the locale separators and U+2212 for negatives', () => {
    expect(formatNumber(1234567.5, 'id')).toBe('1.234.567,5');
    expect(formatNumber(1234567.5, 'en')).toBe('1,234,567.5');
    expect(formatNumber(-2277000, 'id')).toBe(`${MINUS}2.277.000`);
    expect(formatNumber(-2277000, 'en')).toBe(`${MINUS}2,277,000`);
    expect(formatNumber(0.6, 'id')).toBe('0,6');
  });

  it('honours fraction digits and never shows a sign on zero', () => {
    expect(formatNumber(1.005, 'en', { maximumFractionDigits: 0 })).toBe('1');
    expect(formatNumber(16474, 'id', { minimumFractionDigits: 2 })).toBe('16.474,00');
    expect(formatNumber(-0.04, 'id', { maximumFractionDigits: 1 })).toBe('0');
    expect(formatNumber(-0, 'en')).toBe('0');
  });

  it('signs flows when asked', () => {
    expect(formatNumber(9500000, 'id', { signed: true })).toBe('+9.500.000');
    expect(formatNumber(-2277000, 'en', { signed: true })).toBe(`${MINUS}2,277,000`);
    expect(formatNumber(0, 'id', { signed: true })).toBe('0');
  });

  it('rejects values that have no display form', () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(() => formatNumber(value, 'id')).toThrow(RangeError);
    }
  });
});

describe('formatPercent', () => {
  it('matches the PRD §7.1 goldens: decimal comma in id, point in en, integers when whole', () => {
    expect(formatPercent(0.365, 'id')).toBe('36,5%');
    expect(formatPercent(0.365, 'en')).toBe('36.5%');
    expect(formatPercent(0.87, 'id')).toBe('87%');
    expect(formatPercent(0.87, 'en')).toBe('87%');
    expect(formatPercent(15 / 31, 'id')).toBe('48,4%');
    expect(formatPercent(0.031, 'id')).toBe('3,1%');
  });

  it('rounds to the requested precision', () => {
    expect(formatPercent(15 / 31, 'id', { maximumFractionDigits: 0 })).toBe('48%');
    expect(formatPercent(0.2, 'en', { minimumFractionDigits: 1 })).toBe('20.0%');
    expect(formatPercent(-0.0001, 'id')).toBe('0%');
  });

  it('signs differences when asked and uses U+2212', () => {
    expect(formatPercent(0.139, 'id', { signed: true })).toBe('+13,9%');
    expect(formatPercent(-0.139, 'en', { signed: true })).toBe(`${MINUS}13.9%`);
    expect(formatPercent(-0.036, 'id')).toBe(`${MINUS}3,6%`);
    expect(() => formatPercent(Number.NaN, 'en')).toThrow(RangeError);
  });
});

describe('formatDate', () => {
  it('uses Indonesian short months and the design order', () => {
    expect(formatDate(day('2026-10-25'), 'id')).toBe('25 Okt 2026');
    expect(formatDate(day('2026-08-01'), 'id')).toBe('1 Agu 2026');
    expect(formatDate(day('2026-05-14'), 'id')).toBe('14 Mei 2026');
    expect(formatDate(day('2026-12-24'), 'id')).toBe('24 Des 2026');
    expect(formatDate(day('2026-10-15'), 'id', { year: false })).toBe('15 Okt');
  });

  it('uses US English conventions', () => {
    expect(formatDate(day('2026-10-25'), 'en')).toBe('Oct 25, 2026');
    expect(formatDate(day('2026-10-15'), 'en', { year: false })).toBe('Oct 15');
  });

  it('shows calendar dates in UTC by default and instants in the given time zone', () => {
    const instant = new Date('2026-10-14T20:00:00Z');
    expect(formatDate(instant, 'id')).toBe('14 Okt 2026');
    expect(formatDate(instant, 'id', { timeZone: 'Asia/Jakarta' })).toBe('15 Okt 2026');
  });
});

describe('formatDateTime', () => {
  const instant = new Date('2026-10-14T20:05:00Z');

  it('shows the instant in the given zone with a 24-hour clock and the zone name', () => {
    expect(formatDateTime(instant, 'id', 'Asia/Jakarta')).toBe('15 Okt 2026, 03.05 WIB');
    expect(formatDateTime(instant, 'id', 'Asia/Makassar')).toBe('15 Okt 2026, 04.05 WITA');
    expect(formatDateTime(instant, 'en', 'UTC')).toBe('Oct 14, 2026, 20:05 UTC');
  });
});

describe('formatDateRange', () => {
  it('matches the design styles with normal spaces around the dash', () => {
    expect(formatDateRange(day('2026-09-25'), day('2026-10-24'), 'id')).toBe('25 Sep – 24 Okt 2026');
    expect(formatDateRange(day('2026-09-25'), day('2026-10-24'), 'id', { year: false })).toBe('25 Sep – 24 Okt');
    expect(formatDateRange(day('2026-11-01'), day('2026-11-24'), 'id', { year: false })).toBe('1–24 Nov');
    expect(formatDateRange(day('2026-10-01'), day('2026-10-31'), 'id')).toBe('1–31 Okt 2026');
    expect(formatDateRange(day('2026-11-25'), day('2027-10-25'), 'id')).toBe('25 Nov 2026 – 25 Okt 2027');
    expect(formatDateRange(day('2026-10-15'), day('2026-10-15'), 'id')).toBe('15 Okt 2026');
  });

  it('formats English ranges', () => {
    expect(formatDateRange(day('2026-09-25'), day('2026-10-24'), 'en')).toBe('Sep 25 – Oct 24, 2026');
    expect(formatDateRange(day('2026-10-01'), day('2026-10-31'), 'en', { year: false })).toBe('Oct 1 – 31');
  });

  it('rejects a range that ends before it starts', () => {
    expect(() => formatDateRange(day('2026-10-24'), day('2026-09-25'), 'id')).toThrow(
      'Date range ends before it starts: 2026-10-24T00:00:00.000Z – 2026-09-25T00:00:00.000Z',
    );
  });
});

describe('formatMoney', () => {
  it('is the domain formatter, not a copy', () => {
    expect(formatMoney).toBe(money.formatMoney);
    expect(MINUS).toBe(money.MINUS);
    expect(formatMoney(55023000n, 'IDR', { locale: 'id', context: 'amount' })).toBe('Rp55.023.000');
    expect(formatMoney(55023000n, 'IDR', { locale: 'en', context: 'amount' })).toBe('Rp55,023,000');
  });
});
