// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { InvalidLocalDateError, type LocalDate } from './period.ts';
import {
  InvalidRecurrenceError,
  MAX_OCCURRENCES,
  RECURRENCE_END_TYPES,
  RECURRENCE_FREQS,
  REMINDER_TIME,
  checkRecurrence,
  nextOccurrences,
  reminderAt,
  zonedInstant,
  type RecurrenceRule,
} from './recurrence.ts';

const d = (value: string): LocalDate => value as LocalDate;

const monthly = (overrides: Partial<RecurrenceRule> = {}): RecurrenceRule => ({
  freq: 'monthly',
  interval: 1,
  startOn: d('2026-01-14'),
  weekday: null,
  monthDay: 14,
  end: { type: 'never' },
  ...overrides,
});

const weekly = (overrides: Partial<RecurrenceRule> = {}): RecurrenceRule => ({
  freq: 'weekly',
  interval: 1,
  startOn: d('2026-10-15'), // Thursday
  weekday: 1,
  monthDay: null,
  end: { type: 'never' },
  ...overrides,
});

const yearly = (overrides: Partial<RecurrenceRule> = {}): RecurrenceRule => ({
  freq: 'yearly',
  interval: 1,
  startOn: d('2025-10-05'),
  weekday: null,
  monthDay: null,
  end: { type: 'never' },
  ...overrides,
});

function reasonOf(rule: RecurrenceRule): string | null {
  try {
    checkRecurrence(rule);
    return null;
  } catch (error) {
    expect(error).toBeInstanceOf(InvalidRecurrenceError);
    expect((error as InvalidRecurrenceError).name).toBe('InvalidRecurrenceError');
    expect((error as Error).message).toBe(`Invalid recurrence: ${(error as InvalidRecurrenceError).reason}`);
    return (error as InvalidRecurrenceError).reason;
  }
}

describe('constants', () => {
  it('exposes enums and the reminder time', () => {
    expect(RECURRENCE_FREQS).toEqual(['weekly', 'monthly', 'yearly']);
    expect(RECURRENCE_END_TYPES).toEqual(['never', 'after']);
    expect(REMINDER_TIME).toBe('09:00');
    expect(MAX_OCCURRENCES).toBe(1000);
  });
});

describe('checkRecurrence', () => {
  it('accepts valid rules and returns them', () => {
    const rule = monthly();
    expect(checkRecurrence(rule)).toBe(rule);
    expect(reasonOf(weekly({ weekday: 7, interval: 99 }))).toBeNull();
    expect(reasonOf(weekly({ weekday: 1 }))).toBeNull();
    expect(reasonOf(monthly({ monthDay: 1 }))).toBeNull();
    expect(reasonOf(monthly({ monthDay: 31 }))).toBeNull();
    expect(reasonOf(yearly({ end: { type: 'after', count: 1 } }))).toBeNull();
    expect(reasonOf(yearly({ end: { type: 'after', count: 999 } }))).toBeNull();
  });

  it('rejects an unknown frequency', () => {
    expect(reasonOf(monthly({ freq: 'daily' as never }))).toBe('freq');
  });

  it('rejects intervals outside 1–99 or fractional', () => {
    expect(reasonOf(monthly({ interval: 0 }))).toBe('interval');
    expect(reasonOf(monthly({ interval: 100 }))).toBe('interval');
    expect(reasonOf(monthly({ interval: 1.5 }))).toBe('interval');
  });

  it('rejects an invalid start date', () => {
    expect(reasonOf(monthly({ startOn: d('2026-02-30') }))).toBe('startOn');
  });

  it('requires a weekday 1–7 iff weekly', () => {
    expect(reasonOf(weekly({ weekday: null }))).toBe('weekday');
    expect(reasonOf(weekly({ weekday: 0 as never }))).toBe('weekday');
    expect(reasonOf(weekly({ weekday: 8 as never }))).toBe('weekday');
    expect(reasonOf(monthly({ weekday: 1 }))).toBe('weekday');
  });

  it('requires a month day 1–31 iff monthly', () => {
    expect(reasonOf(monthly({ monthDay: null }))).toBe('monthDay');
    expect(reasonOf(monthly({ monthDay: 0 }))).toBe('monthDay');
    expect(reasonOf(monthly({ monthDay: 32 }))).toBe('monthDay');
    expect(reasonOf(yearly({ monthDay: 5 }))).toBe('monthDay');
    expect(reasonOf(weekly({ monthDay: 5 }))).toBe('monthDay');
  });

  it('requires an end count 1–999 and a known end type', () => {
    expect(reasonOf(monthly({ end: { type: 'after', count: 0 } }))).toBe('end');
    expect(reasonOf(monthly({ end: { type: 'after', count: 1000 } }))).toBe('end');
  });
});

describe('nextOccurrences — monthly', () => {
  it('golden: day 14 from 15 Okt → 14 Nov, 14 Des, 14 Jan', () => {
    expect(nextOccurrences(monthly(), { from: d('2026-10-15'), count: 3 })).toEqual([
      '2026-11-14',
      '2026-12-14',
      '2027-01-14',
    ]);
  });

  it('includes an occurrence equal to `from` and `until`', () => {
    expect(nextOccurrences(monthly(), { from: d('2026-10-14'), until: d('2026-12-14') })).toEqual([
      '2026-10-14',
      '2026-11-14',
      '2026-12-14',
    ]);
    expect(nextOccurrences(monthly(), { from: d('2026-10-14'), until: d('2026-12-13') })).toEqual([
      '2026-10-14',
      '2026-11-14',
    ]);
  });

  it('starts the month after startOn when the anchor month day already passed', () => {
    const rule = monthly({ startOn: d('2026-10-15') });
    expect(nextOccurrences(rule, { from: d('2026-01-01'), count: 2 })).toEqual(['2026-11-14', '2026-12-14']);
    expect(nextOccurrences(rule, { from: d('2026-12-01'), count: 1 })).toEqual(['2026-12-14']);
    expect(nextOccurrences(rule, { from: d('2026-12-14'), count: 1 })).toEqual(['2026-12-14']);
    expect(nextOccurrences(rule, { from: d('2026-12-15'), count: 1 })).toEqual(['2027-01-14']);
  });

  it('starts at startOn when the month day falls on it', () => {
    const rule = monthly({ startOn: d('2026-10-14') });
    expect(nextOccurrences(rule, { from: d('2020-01-01'), count: 2 })).toEqual(['2026-10-14', '2026-11-14']);
  });

  it('clamps to the month end (31 → 28/29/30)', () => {
    const rule = monthly({ startOn: d('2027-01-31'), monthDay: 31 });
    expect(nextOccurrences(rule, { from: d('2027-01-01'), count: 4 })).toEqual([
      '2027-01-31',
      '2027-02-28',
      '2027-03-31',
      '2027-04-30',
    ]);
    expect(
      nextOccurrences(monthly({ startOn: d('2028-02-01'), monthDay: 30 }), { from: d('2028-02-01'), count: 1 }),
    ).toEqual(['2028-02-29']);
  });

  it('steps every `interval` months anchored at startOn', () => {
    const rule = monthly({ startOn: d('2026-01-05'), monthDay: 5, interval: 3 });
    expect(nextOccurrences(rule, { from: d('2026-02-01'), count: 3 })).toEqual([
      '2026-04-05',
      '2026-07-05',
      '2026-10-05',
    ]);
    expect(nextOccurrences(rule, { from: d('2026-04-06'), count: 1 })).toEqual(['2026-07-05']);
    expect(nextOccurrences(rule, { from: d('2026-07-05'), count: 1 })).toEqual(['2026-07-05']);
    expect(nextOccurrences(rule, { from: d('2026-05-01'), count: 1 })).toEqual(['2026-07-05']);
  });

  it('honours end-after counted from startOn', () => {
    const rule = monthly({ startOn: d('2026-10-15'), end: { type: 'after', count: 3 } });
    // Occurrences: 14 Nov, 14 Des, 14 Jan.
    expect(nextOccurrences(rule, { from: d('2026-12-01') })).toEqual(['2026-12-14', '2027-01-14']);
    expect(nextOccurrences(rule, { from: d('2027-01-15') })).toEqual([]);
    expect(nextOccurrences(rule, { from: d('2026-01-01'), count: 2 })).toEqual(['2026-11-14', '2026-12-14']);
  });

  it('returns nothing for count 0 and caps unbounded rules', () => {
    expect(nextOccurrences(monthly(), { from: d('2026-01-01'), count: 0 })).toEqual([]);
    expect(nextOccurrences(monthly(), { from: d('2026-01-01') })).toHaveLength(MAX_OCCURRENCES);
    expect(nextOccurrences(monthly(), { from: d('2026-01-01'), count: 5000 })).toHaveLength(MAX_OCCURRENCES);
  });

  it('validates the rule', () => {
    expect(() => nextOccurrences(monthly({ interval: 0 }), { from: d('2026-01-01') })).toThrow(InvalidRecurrenceError);
  });

  it('throws past year 9999', () => {
    const rule = monthly({ startOn: d('9999-11-14') });
    expect(() => nextOccurrences(rule, { from: d('9999-11-01'), count: 3 })).toThrow(InvalidLocalDateError);
  });

  it('handles years before 100', () => {
    const rule = monthly({ startOn: d('0004-02-01'), monthDay: 29 });
    expect(nextOccurrences(rule, { from: d('0004-01-01'), count: 1 })).toEqual(['0004-02-29']);
  });
});

describe('nextOccurrences — weekly', () => {
  it('starts on the first matching weekday ≥ startOn', () => {
    // 2026-10-15 is a Thursday; next Monday 19 Okt.
    expect(nextOccurrences(weekly(), { from: d('2026-01-01'), count: 3 })).toEqual([
      '2026-10-19',
      '2026-10-26',
      '2026-11-02',
    ]);
    expect(nextOccurrences(weekly({ weekday: 4 }), { from: d('2026-01-01'), count: 1 })).toEqual(['2026-10-15']);
    expect(nextOccurrences(weekly({ weekday: 3 }), { from: d('2026-01-01'), count: 1 })).toEqual(['2026-10-21']);
    expect(nextOccurrences(weekly({ weekday: 7 }), { from: d('2026-01-01'), count: 1 })).toEqual(['2026-10-18']);
    expect(
      nextOccurrences(weekly({ weekday: 5, startOn: d('1969-12-29') }), { from: d('1960-01-01'), count: 1 }),
    ).toEqual(['1970-01-02']);
  });

  it('steps every `interval` weeks and skips to `from`', () => {
    const rule = weekly({ interval: 2 });
    expect(nextOccurrences(rule, { from: d('2026-10-20'), count: 2 })).toEqual(['2026-11-02', '2026-11-16']);
    expect(nextOccurrences(rule, { from: d('2026-11-02'), count: 1 })).toEqual(['2026-11-02']);
    expect(nextOccurrences(rule, { from: d('2026-11-03'), until: d('2026-11-30') })).toEqual([
      '2026-11-16',
      '2026-11-30',
    ]);
  });

  it('honours end-after', () => {
    const rule = weekly({ end: { type: 'after', count: 2 } });
    expect(nextOccurrences(rule, { from: d('2026-10-01') })).toEqual(['2026-10-19', '2026-10-26']);
    expect(nextOccurrences(rule, { from: d('2026-10-20') })).toEqual(['2026-10-26']);
  });
});

describe('nextOccurrences — yearly', () => {
  it('repeats startOn month/day', () => {
    expect(nextOccurrences(yearly(), { from: d('2026-10-15'), count: 2 })).toEqual(['2027-10-05', '2028-10-05']);
    expect(nextOccurrences(yearly(), { from: d('2025-01-01'), count: 1 })).toEqual(['2025-10-05']);
    expect(nextOccurrences(yearly({ interval: 2 }), { from: d('2026-01-01'), count: 1 })).toEqual(['2027-10-05']);
  });

  it('maps 29 Feb to 28 Feb in non-leap years', () => {
    const rule = yearly({ startOn: d('2024-02-29') });
    expect(nextOccurrences(rule, { from: d('2024-01-01'), count: 5 })).toEqual([
      '2024-02-29',
      '2025-02-28',
      '2026-02-28',
      '2027-02-28',
      '2028-02-29',
    ]);
    expect(
      nextOccurrences(yearly({ startOn: d('2096-02-29'), interval: 4 }), { from: d('2097-01-01'), count: 2 }),
    ).toEqual(['2100-02-28', '2104-02-29']);
  });
});

describe('zonedInstant', () => {
  it('resolves wall-clock time in a fixed-offset zone', () => {
    expect(zonedInstant(d('2026-10-17'), '09:00', 'Asia/Jakarta').toISOString()).toBe('2026-10-17T02:00:00.000Z');
    expect(zonedInstant(d('2026-10-17'), '23:59', 'Asia/Jakarta').toISOString()).toBe('2026-10-17T16:59:00.000Z');
    expect(zonedInstant(d('2026-10-17'), '00:00', 'UTC').toISOString()).toBe('2026-10-17T00:00:00.000Z');
    expect(zonedInstant(d('2026-10-17'), '09:30', 'Asia/Kolkata').toISOString()).toBe('2026-10-17T04:00:00.000Z');
    expect(zonedInstant(d('2026-10-17'), '09:00', 'America/New_York').toISOString()).toBe('2026-10-17T13:00:00.000Z');
  });

  it('is DST-safe (Europe/Berlin)', () => {
    expect(zonedInstant(d('2026-07-01'), '09:00', 'Europe/Berlin').toISOString()).toBe('2026-07-01T07:00:00.000Z');
    expect(zonedInstant(d('2026-12-01'), '09:00', 'Europe/Berlin').toISOString()).toBe('2026-12-01T08:00:00.000Z');
    // DST starts 29 Mar 2026 at 02:00 → 03:00; 02:30 does not exist and maps to 03:30 CEST.
    expect(zonedInstant(d('2026-03-29'), '02:30', 'Europe/Berlin').toISOString()).toBe('2026-03-29T01:30:00.000Z');
    expect(zonedInstant(d('2026-03-29'), '09:00', 'Europe/Berlin').toISOString()).toBe('2026-03-29T07:00:00.000Z');
    // DST ends 25 Okt 2026 at 03:00 → 02:00; 02:30 happens twice and maps to the later (CET) one.
    expect(zonedInstant(d('2026-10-25'), '02:30', 'Europe/Berlin').toISOString()).toBe('2026-10-25T01:30:00.000Z');
    expect(zonedInstant(d('2026-10-25'), '01:30', 'Europe/Berlin').toISOString()).toBe('2026-10-24T23:30:00.000Z');
  });

  it('rejects malformed times', () => {
    for (const time of ['9:00', '24:00', '19:60', '09:00:00', 'x09:00', '09:00x', '']) {
      expect(() => zonedInstant(d('2026-10-17'), time, 'UTC')).toThrow(`Invalid time: ${time}`);
    }
    expect(zonedInstant(d('2026-10-17'), '20:59', 'UTC').toISOString()).toBe('2026-10-17T20:59:00.000Z');
    expect(zonedInstant(d('2026-10-17'), '19:09', 'UTC').toISOString()).toBe('2026-10-17T19:09:00.000Z');
  });
});

describe('reminderAt', () => {
  it('golden: Netflix 18 Okt H-1 → 17 Okt 09.00 WIB', () => {
    expect(reminderAt(d('2026-10-18'), 1, 'Asia/Jakarta').toISOString()).toBe('2026-10-17T02:00:00.000Z');
  });

  it('supports same-day and multi-day offsets', () => {
    expect(reminderAt(d('2026-10-18'), 0, 'Asia/Jakarta').toISOString()).toBe('2026-10-18T02:00:00.000Z');
    // Another time of day (Settings › Notifikasi).
    expect(reminderAt(d('2026-10-18'), 1, 'Asia/Jakarta', '19:30').toISOString()).toBe('2026-10-17T12:30:00.000Z');
    expect(reminderAt(d('2026-11-01'), 3, 'Europe/Berlin').toISOString()).toBe('2026-10-29T08:00:00.000Z');
  });
});
