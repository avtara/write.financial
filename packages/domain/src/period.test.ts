// SPDX-License-Identifier: AGPL-3.0-only
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  InvalidLocalDateError,
  InvalidPeriodRangeError,
  InvalidPeriodStartDayError,
  InvalidProrationError,
  InvalidTransitionError,
  PRORATION_BASE_DAYS,
  addDays,
  countDays,
  formatPeriodLabel,
  nextPeriod,
  parseLocalDate,
  periodFor,
  periodStartDay,
  periodsBetween,
  previousPeriod,
  prorateLimit,
  transitionPeriod,
  type LocalDate,
  type Period,
  type YearMonth,
} from './period.ts';

const d = parseLocalDate;
const day = periodStartDay;

const EPOCH = d('1970-01-01');
/** Local dates 1900-01-01 … 2199-12-31. */
const localDates = fc.integer({ min: -25_567, max: 84_005 }).map((offset) => addDays(EPOCH, offset));
const startDays = fc.integer({ min: 1, max: 28 }).map(day);

const dayOfMonth = (date: LocalDate): number => Number(date.slice(8));

describe('parseLocalDate', () => {
  it.each(['2026-10-15', '2024-02-29', '2026-12-31', '2026-01-01', '0001-01-01', '9999-12-31', '0099-03-01'])(
    'accepts %s',
    (value) => {
      expect(parseLocalDate(value)).toBe(value);
    },
  );

  it.each([
    '2026-02-29',
    '2026-04-31',
    '2026-10-32',
    '2026-10-00',
    '2026-00-10',
    '2026-13-01',
    '0000-06-15',
    '2026-1-15',
    '2026-10-5',
    '26-10-15',
    'x2026-10-15',
    '2026-10-15x',
    '2026/10/15',
    '2026-10-15T00:00:00Z',
    '',
    '2026-09-14..2026-10-13',
  ])('rejects %j', (value) => {
    expect(() => parseLocalDate(value)).toThrow(InvalidLocalDateError);
    expect(() => parseLocalDate(value)).toThrow(`Invalid local date: ${value} (expected YYYY-MM-DD, years 0001–9999)`);
  });

  it('throws a RangeError subclass with its own name', () => {
    const error = new InvalidLocalDateError('nope');
    expect(error).toBeInstanceOf(RangeError);
    expect(error.name).toBe('InvalidLocalDateError');
  });
});

describe('addDays and countDays', () => {
  it('moves across month, year, and leap-day boundaries', () => {
    expect(addDays(d('2026-10-31'), 1)).toBe('2026-11-01');
    expect(addDays(d('2026-12-31'), 1)).toBe('2027-01-01');
    expect(addDays(d('2024-03-01'), -1)).toBe('2024-02-29');
    expect(addDays(d('2026-03-01'), -1)).toBe('2026-02-28');
    expect(addDays(d('2026-10-15'), 0)).toBe('2026-10-15');
    expect(addDays(d('0100-01-01'), -1)).toBe('0099-12-31');
    expect(addDays(d('0999-12-31'), 1)).toBe('1000-01-01');
  });

  it('stays within years 0001–9999', () => {
    expect(addDays(d('0001-01-02'), -1)).toBe('0001-01-01');
    expect(addDays(d('9999-12-30'), 1)).toBe('9999-12-31');
    expect(() => addDays(d('0001-01-01'), -1)).toThrow(InvalidLocalDateError);
    expect(() => addDays(d('9999-12-31'), 1)).toThrow('Invalid local date: 10000-01-01');
  });

  it('counts both ends: 14 Sep – 13 Okt is 30 days (FR-S7)', () => {
    expect(countDays(d('2026-09-14'), d('2026-10-13'))).toBe(30);
    expect(countDays(d('2026-10-15'), d('2026-10-15'))).toBe(1);
  });

  it('round-trips: shifting by n days spans n + 1 days and yields a valid date', () => {
    fc.assert(
      fc.property(localDates, fc.integer({ min: -1_000, max: 1_000 }), (date, n) => {
        const shifted = addDays(date, n);
        expect(parseLocalDate(shifted)).toBe(shifted);
        expect(countDays(date, shifted)).toBe(n + 1);
        expect(addDays(shifted, -n)).toBe(date);
      }),
    );
  });
});

describe('periodStartDay', () => {
  it.each([1, 15, 25, 28])('accepts %d', (value) => {
    expect(periodStartDay(value)).toBe(value);
  });

  it.each([0, 29, 31, -1, 1.5, Number.NaN])('rejects %d (29–31 are not offered, FR-P1)', (value) => {
    expect(() => periodStartDay(value)).toThrow(InvalidPeriodStartDayError);
    expect(() => periodStartDay(value)).toThrow(`Invalid period start day: ${value} (expected an integer 1–28)`);
  });

  it('throws a RangeError subclass with its own name', () => {
    const error = new InvalidPeriodStartDayError(0);
    expect(error).toBeInstanceOf(RangeError);
    expect(error.name).toBe('InvalidPeriodStartDayError');
  });
});

const normal = (start: string, end: string, days: number, label: string): Period => ({
  kind: 'normal',
  start: d(start),
  end: d(end),
  days,
  label: label as YearMonth,
});

describe('periodFor — golden values (FR-P1, design Section 14)', () => {
  it('names 25 Sep – 24 Okt "Oktober" for start day 25', () => {
    const period = periodFor(d('2026-10-15'), day(25));
    expect(period).toEqual(normal('2026-09-25', '2026-10-24', 30, '2026-10'));
    expect(formatPeriodLabel(period.label, 'id', 'month')).toBe('Oktober');
  });

  it('seed October with start day 1 is 1–31 Okt, day 15 of 31', () => {
    const period = periodFor(d('2026-10-15'), day(1));
    expect(period).toEqual(normal('2026-10-01', '2026-10-31', 31, '2026-10'));
    expect(countDays(period.start, d('2026-10-15'))).toBe(15);
  });

  it('starts a new period on the start day itself', () => {
    expect(periodFor(d('2026-10-24'), day(25))).toEqual(normal('2026-09-25', '2026-10-24', 30, '2026-10'));
    expect(periodFor(d('2026-10-25'), day(25))).toEqual(normal('2026-10-25', '2026-11-24', 31, '2026-11'));
  });

  it('labels across the year boundary by the month the period ends', () => {
    expect(periodFor(d('2026-01-10'), day(25))).toEqual(normal('2025-12-25', '2026-01-24', 31, '2026-01'));
    const january = periodFor(d('2026-12-28'), day(25));
    expect(january).toEqual(normal('2026-12-25', '2027-01-24', 31, '2027-01'));
    expect(formatPeriodLabel(january.label, 'id', 'monthYear')).toBe('Januari 2027');
  });

  it('handles February for the shortest and longest periods', () => {
    expect(periodFor(d('2026-02-14'), day(1))).toEqual(normal('2026-02-01', '2026-02-28', 28, '2026-02'));
    expect(periodFor(d('2024-02-14'), day(1))).toEqual(normal('2024-02-01', '2024-02-29', 29, '2024-02'));
    expect(periodFor(d('2026-02-10'), day(28))).toEqual(normal('2026-01-28', '2026-02-27', 31, '2026-02'));
    expect(periodFor(d('2026-02-28'), day(28))).toEqual(normal('2026-02-28', '2026-03-27', 28, '2026-03'));
  });

  it('steps to the dashboard picker neighbours: September 1–30 Sep, Agustus 1–31 Agu', () => {
    const october = periodFor(d('2026-10-15'), day(1));
    const september = previousPeriod(october, day(1));
    expect(september).toEqual(normal('2026-09-01', '2026-09-30', 30, '2026-09'));
    expect(previousPeriod(september, day(1))).toEqual(normal('2026-08-01', '2026-08-31', 31, '2026-08'));
    expect(nextPeriod(september, day(1))).toEqual(october);
  });
});

describe('periodFor — properties', () => {
  it('every local date belongs to exactly one period', () => {
    fc.assert(
      fc.property(localDates, startDays, (date, startDay) => {
        const period = periodFor(date, startDay);
        expect(period.start <= date && date <= period.end).toBe(true);
        expect(periodFor(period.start, startDay)).toEqual(period);
        expect(periodFor(period.end, startDay)).toEqual(period);
        expect(previousPeriod(period, startDay).end < date).toBe(true);
        expect(nextPeriod(period, startDay).start > date).toBe(true);
      }),
    );
  });

  it('consecutive periods are contiguous with no gaps or overlaps', () => {
    fc.assert(
      fc.property(localDates, startDays, (date, startDay) => {
        const period = periodFor(date, startDay);
        const next = nextPeriod(period, startDay);
        expect(next.start).toBe(addDays(period.end, 1));
        expect(previousPeriod(next, startDay)).toEqual(period);
      }),
    );
  });

  it('normal periods start on the start day, last 28–31 days, and are named after their end month', () => {
    fc.assert(
      fc.property(localDates, startDays, (date, startDay) => {
        const period = periodFor(date, startDay);
        expect(period.kind).toBe('normal');
        expect(dayOfMonth(period.start)).toBe(startDay);
        expect(period.days).toBe(countDays(period.start, period.end));
        expect(period.days).toBeGreaterThanOrEqual(28);
        expect(period.days).toBeLessThanOrEqual(31);
        expect(period.label).toBe(period.end.slice(0, 7));
      }),
    );
  });
});

describe('periodsBetween', () => {
  it('14 Sep – 13 Okt spans 2 periods (FR-S7 "30 hari · melintasi 2 periode")', () => {
    expect(periodsBetween(d('2026-09-14'), d('2026-10-13'), day(1))).toEqual([
      normal('2026-09-01', '2026-09-30', 30, '2026-09'),
      normal('2026-10-01', '2026-10-31', 31, '2026-10'),
    ]);
  });

  it('returns one period for a single day and stops at the period containing the end', () => {
    expect(periodsBetween(d('2026-10-15'), d('2026-10-15'), day(25))).toEqual([periodFor(d('2026-10-15'), day(25))]);
    expect(periodsBetween(d('2026-09-25'), d('2026-10-24'), day(25))).toHaveLength(1);
    expect(periodsBetween(d('2026-09-25'), d('2026-10-25'), day(25))).toHaveLength(2);
  });

  it('rejects a range that ends before it starts', () => {
    expect(() => periodsBetween(d('2026-10-14'), d('2026-10-13'), day(1))).toThrow(InvalidPeriodRangeError);
    expect(() => periodsBetween(d('2026-10-14'), d('2026-10-13'), day(1))).toThrow(
      'Invalid range: 2026-10-14 is after 2026-10-13',
    );
    expect(new InvalidPeriodRangeError('x').name).toBe('InvalidPeriodRangeError');
  });

  it('covers the range with contiguous periods', () => {
    fc.assert(
      fc.property(localDates, fc.integer({ min: 0, max: 400 }), startDays, (from, length, startDay) => {
        const to = addDays(from, length);
        const periods = periodsBetween(from, to, startDay);
        expect(periods[0]).toEqual(periodFor(from, startDay));
        expect(periods.at(-1)).toEqual(periodFor(to, startDay));
        for (const [index, period] of periods.slice(1).entries()) {
          expect(period.start).toBe(addDays((periods[index] as Period).end, 1));
        }
      }),
    );
  });
});

describe('transitionPeriod (FR-P2 option a)', () => {
  it('start day 1 → 25 on 15 Okt: Oktober stays 1–31 Okt, transition 1–24 Nov, then Desember 25 Nov – 24 Des', () => {
    const transition = transitionPeriod(day(1), day(25), d('2026-10-15'));
    expect(transition).toEqual({
      kind: 'transition',
      start: '2026-11-01',
      end: '2026-11-24',
      days: 24,
      label: '2026-11',
    });
    const december = nextPeriod(transition, day(25));
    expect(december).toEqual(normal('2026-11-25', '2026-12-24', 30, '2026-12'));
    expect(formatPeriodLabel(december.label, 'id', 'monthYear')).toBe('Desember 2026');
    expect(prorateLimit(18_750_000n, transition.days)).toBe(15_000_000n);
  });

  it('moving the start day earlier gives a short transition until the end of the month', () => {
    expect(transitionPeriod(day(25), day(1), d('2026-10-15'))).toEqual({
      kind: 'transition',
      start: '2026-10-25',
      end: '2026-10-31',
      days: 7,
      label: '2026-10',
    });
  });

  it('rejects an unchanged start day', () => {
    expect(() => transitionPeriod(day(25), day(25), d('2026-10-15'))).toThrow(InvalidTransitionError);
    expect(() => transitionPeriod(day(25), day(25), d('2026-10-15'))).toThrow(
      'No transition: the start day is already 25',
    );
    expect(new InvalidTransitionError('x')).toBeInstanceOf(RangeError);
    expect(new InvalidTransitionError('x').name).toBe('InvalidTransitionError');
  });

  it('follows the old period, lasts 1–30 days, and is followed by a normal period on the new start day', () => {
    fc.assert(
      fc.property(localDates, startDays, startDays, (changeDate, oldStartDay, newStartDay) => {
        fc.pre(oldStartDay !== newStartDay);
        const transition = transitionPeriod(oldStartDay, newStartDay, changeDate);
        expect(transition.kind).toBe('transition');
        expect(transition.start).toBe(addDays(periodFor(changeDate, oldStartDay).end, 1));
        expect(transition.days).toBe(countDays(transition.start, transition.end));
        expect(transition.days).toBeGreaterThanOrEqual(1);
        expect(transition.days).toBeLessThanOrEqual(PRORATION_BASE_DAYS);
        expect(transition.label).toBe(transition.end.slice(0, 7));
        expect(dayOfMonth(nextPeriod(transition, newStartDay).start)).toBe(newStartDay);
        expect(prorateLimit(1_000_000n, transition.days)).toBeLessThanOrEqual(1_000_000n);
      }),
    );
  });
});

describe('prorateLimit (PRD §7.2: limit × transition_days ÷ 30)', () => {
  it('golden: 18.750.000 × 24/30 = 15.000.000', () => {
    expect(prorateLimit(18_750_000n, 24)).toBe(15_000_000n);
  });

  it('keeps the full limit for 30 days and handles 1 day and a zero limit', () => {
    expect(prorateLimit(18_750_000n, 30)).toBe(18_750_000n);
    expect(prorateLimit(18_750_000n, 1)).toBe(625_000n);
    expect(prorateLimit(0n, 24)).toBe(0n);
  });

  it('rounds half up to the minor unit (PRD gives no rule; half away from zero for limits ≥ 0)', () => {
    expect(prorateLimit(1n, 14)).toBe(0n); // 0,466…
    expect(prorateLimit(1n, 15)).toBe(1n); // 0,5
    expect(prorateLimit(1n, 16)).toBe(1n); // 0,533…
    expect(prorateLimit(10n, 1)).toBe(0n); // 0,333…
    expect(prorateLimit(20n, 1)).toBe(1n); // 0,666…
    expect(prorateLimit(45n, 1)).toBe(2n); // 1,5
    expect(prorateLimit(1_000_001n, 7)).toBe(233_334n); // 233.333,566…
  });

  it('is within half a minor unit of the exact value', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: 10n ** 15n }), fc.integer({ min: 1, max: 30 }), (limit, days) => {
        const prorated = prorateLimit(limit, days);
        const error = prorated * 30n - limit * BigInt(days);
        expect(error > -15n && error <= 15n).toBe(true);
      }),
    );
  });

  it.each([0, 31, 1.5, -1])('rejects %d transition days', (days) => {
    expect(() => prorateLimit(1_000n, days)).toThrow(InvalidProrationError);
    expect(() => prorateLimit(1_000n, days)).toThrow(`Transition days must be an integer 1–30: ${days}`);
  });

  it('rejects a negative limit', () => {
    expect(() => prorateLimit(-1n, 24)).toThrow('Budget limit must not be negative: -1');
    expect(new InvalidProrationError('x').name).toBe('InvalidProrationError');
  });
});

describe('formatPeriodLabel', () => {
  const months = [
    ['01', 'Januari', 'January'],
    ['02', 'Februari', 'February'],
    ['03', 'Maret', 'March'],
    ['04', 'April', 'April'],
    ['05', 'Mei', 'May'],
    ['06', 'Juni', 'June'],
    ['07', 'Juli', 'July'],
    ['08', 'Agustus', 'August'],
    ['09', 'September', 'September'],
    ['10', 'Oktober', 'October'],
    ['11', 'November', 'November'],
    ['12', 'Desember', 'December'],
  ] as const;

  it.each(months)('month %s → %s / %s', (month, indonesian, english) => {
    const label = `2026-${month}` as YearMonth;
    expect(formatPeriodLabel(label, 'id', 'month')).toBe(indonesian);
    expect(formatPeriodLabel(label, 'en', 'month')).toBe(english);
    expect(formatPeriodLabel(label, 'id', 'monthYear')).toBe(`${indonesian} 2026`);
    expect(formatPeriodLabel(label, 'en', 'monthYear')).toBe(`${english} 2026`);
  });
});
