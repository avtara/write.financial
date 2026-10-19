// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from 'node:crypto';
import type { LocalDate, PeriodStartDay, YearMonth } from '@wf/domain/period';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ledgerFixture, type LedgerFixture } from '../test/ledger-fixture.ts';
import { PGLITE_HOOK_TIMEOUT, startMigrated, type TestDatabase } from '../test/pglite.ts';
import { createBudgets } from './budgets.ts';
import { withUser } from './db.ts';
import { coveringIn, createPeriods } from './periods.ts';

let test: TestDatabase;
let ledger: LedgerFixture;
let userId: string;

const asApp = <T>(fn: () => Promise<T>) => test.as('wf_app', fn);
/** The repository at 12.00 WIB on `date`. */
const periodsAt = (date: string) => createPeriods(test.db, { now: () => new Date(`${date}T05:00:00Z`) });
const d = (value: string) => value as LocalDate;

beforeAll(async () => {
  test = await startMigrated();
}, PGLITE_HOOK_TIMEOUT);

afterAll(async () => {
  await test.close();
});

beforeEach(async () => {
  await test.query('DELETE FROM users');
  ledger = await ledgerFixture(test, 'avtara@example.test');
  userId = ledger.userId;
});

/** The user's period rows, oldest first. */
const rows = () =>
  test.query<{ label: string; start: string; end: string; days: number; kind: string; status: string }>(
    `SELECT label, start_date::text AS start, end_date::text AS end, days, kind, status FROM periods ORDER BY start_date`,
  );

const preferences = () =>
  test.query(`SELECT period_start_day AS day, period_mode AS mode FROM user_preferences WHERE user_id = $1`, [userId]);

describe('list', () => {
  it('materializes the period of today first, then every period up to today', async () => {
    const overview = await asApp(() => periodsAt('2026-10-15').list(userId));
    expect(overview).toMatchObject({ startDay: 1, mode: 'fixed_day', today: '2026-10-15' });
    expect(overview.periods).toEqual([
      {
        id: expect.any(String) as string,
        label: '2026-10',
        start: '2026-10-01',
        end: '2026-10-31',
        days: 31,
        kind: 'normal',
        status: 'open',
        closedAt: null,
      },
    ]);
    expect(overview.current).toEqual(overview.periods[0]);
    expect(overview.upcoming).toEqual([
      { kind: 'normal', label: '2026-11', start: '2026-11-01', end: '2026-11-30', days: 30 },
      { kind: 'normal', label: '2026-12', start: '2026-12-01', end: '2026-12-31', days: 31 },
    ]);

    const later = await asApp(() => periodsAt('2026-12-05').list(userId));
    expect(later.periods.map((period) => period.label)).toEqual(['2026-12', '2026-11', '2026-10']);
    expect(later.current.label).toBe('2026-12');
  });

  it('continues with a transition period after a start-day change for the next period', async () => {
    await asApp(() => periodsAt('2026-10-15').changeStartDay(userId, { day: 25, apply: 'next_period' }));
    const overview = await asApp(() => periodsAt('2026-10-20').list(userId));
    expect(overview.startDay).toBe(25);
    expect(overview.upcoming).toEqual([
      { kind: 'transition', label: '2026-11', start: '2026-11-01', end: '2026-11-24', days: 24 },
      { kind: 'normal', label: '2026-12', start: '2026-11-25', end: '2026-12-24', days: 30 },
    ]);
    await asApp(() => periodsAt('2026-11-30').list(userId));
    expect(await rows()).toEqual([
      { label: '2026-10', start: '2026-10-01', end: '2026-10-31', days: 31, kind: 'normal', status: 'open' },
      { label: '2026-11', start: '2026-11-01', end: '2026-11-24', days: 24, kind: 'transition', status: 'open' },
      { label: '2026-12', start: '2026-11-25', end: '2026-12-24', days: 30, kind: 'normal', status: 'open' },
    ]);
  });

  it('uses the current time by default', async () => {
    const { today, current } = await asApp(() => createPeriods(test.db).list(userId));
    expect(current.start <= today && today <= current.end).toBe(true);
  });
});

describe('get', () => {
  it('returns a row of the user and nothing else', async () => {
    const { current } = await asApp(() => periodsAt('2026-10-15').list(userId));
    expect(await asApp(() => periodsAt('2026-10-15').get(userId, current.id as string))).toEqual(current);
    await expect(asApp(() => periodsAt('2026-10-15').get(userId, randomUUID()))).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    const other = await ledgerFixture(test, 'other@example.test');
    await expect(asApp(() => periodsAt('2026-10-15').get(other.userId, current.id as string))).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('covering', () => {
  it('computes the periods before the first row and after the last one', async () => {
    const periods = periodsAt('2026-10-15');
    const all = await asApp(() => periods.covering(userId, { from: d('2026-08-20'), to: d('2026-12-10') }));
    expect(all.map(({ id, label, start, end }) => ({ row: id !== null, label, start, end }))).toEqual([
      { row: false, label: '2026-08', start: '2026-08-01', end: '2026-08-31' },
      { row: false, label: '2026-09', start: '2026-09-01', end: '2026-09-30' },
      { row: true, label: '2026-10', start: '2026-10-01', end: '2026-10-31' },
      { row: false, label: '2026-11', start: '2026-11-01', end: '2026-11-30' },
      { row: false, label: '2026-12', start: '2026-12-01', end: '2026-12-31' },
    ]);
    expect(all[0]).toMatchObject({ status: 'open', closedAt: null, kind: 'normal', days: 31 });

    // Entirely before the first row, and after the last row (November is skipped).
    expect(
      (await asApp(() => periods.covering(userId, { from: d('2026-09-05'), to: d('2026-09-06') }))).map(
        (period) => period.label,
      ),
    ).toEqual(['2026-09']);
    expect(
      (await asApp(() => periods.covering(userId, { from: d('2026-12-05'), to: d('2026-12-06') }))).map(
        (period) => period.start,
      ),
    ).toEqual(['2026-12-01']);
  });

  it('clips a computed period that would overlap the first row', async () => {
    await asApp(() => periodsAt('2026-10-15').changeStartDay(userId, { day: 15, apply: 'next_period' }));
    const periods = await asApp(() =>
      periodsAt('2026-10-15').covering(userId, { from: d('2026-09-20'), to: d('2026-10-05') }),
    );
    expect(periods).toEqual([
      {
        id: null,
        kind: 'normal',
        label: '2026-09',
        start: '2026-09-15',
        end: '2026-09-30',
        days: 16,
        status: 'open',
        closedAt: null,
      },
      expect.objectContaining({ label: '2026-10', start: '2026-10-01' }),
    ]);
  });

  it('computes every period without rows (coveringIn)', async () => {
    const periods = await asApp(() =>
      withUser(test.db, userId, (tx) =>
        coveringIn(tx, { from: d('2026-10-03'), to: d('2026-11-02') }, 1 as PeriodStartDay),
      ),
    );
    expect(periods.map(({ id, start, end }) => ({ id, start, end }))).toEqual([
      { id: null, start: '2026-10-01', end: '2026-10-31' },
      { id: null, start: '2026-11-01', end: '2026-11-30' },
    ]);
  });
});

describe('previewStartDay', () => {
  it('refuses a start day outside 1–28 and the current one', async () => {
    const periods = periodsAt('2026-10-15');
    for (const day of [0, 29, 1.5]) {
      await expect(asApp(() => periods.previewStartDay(userId, { day, apply: 'next_period' }))).rejects.toMatchObject({
        code: 'INVALID_PERIOD',
        message: 'The start day must be 1–28',
      });
    }
    await expect(asApp(() => periods.previewStartDay(userId, { day: 1, apply: 'recalculate' }))).rejects.toMatchObject({
      code: 'INVALID_PERIOD',
      message: 'The start day is unchanged',
    });
  });

  it('shows the transition period with its prorated budget and the payday, changing nothing', async () => {
    const salary = ledger.category('system:salary');
    await ledger.entry('income', '2026-09-01', 20_000_000n, salary);
    await ledger.entry('income', '2026-10-01', 20_000_000n, salary);
    await asApp(() =>
      createBudgets(test.db).saveVersion(userId, {
        effectiveFrom: '2026-10' as YearMonth,
        lines: [
          { categoryId: ledger.category('system:food'), limitMinor: 3_000_000n },
          { categoryId: ledger.category('system:rent'), limitMinor: 1_500_000n },
        ],
      }),
    );
    const preview = await asApp(() =>
      periodsAt('2026-10-15').previewStartDay(userId, { day: 25, apply: 'next_period' }),
    );
    expect(preview).toMatchObject({
      apply: 'next_period',
      fromDay: 1,
      toDay: 25,
      paydayDay: 1,
      current: { label: '2026-10', start: '2026-10-01', end: '2026-10-31' },
      periods: [
        { kind: 'normal', start: '2026-10-01', end: '2026-10-31' },
        { kind: 'transition', start: '2026-11-01', end: '2026-11-24' },
        { kind: 'normal', start: '2026-11-25', end: '2026-12-24' },
      ],
      transition: {
        period: { kind: 'transition', label: '2026-11', start: '2026-11-01', end: '2026-11-24', days: 24 },
        limitMinor: 4_500_000n,
        proratedMinor: 3_600_000n,
      },
      moved: { count: 0, largest: [] },
    });
    expect(await preferences()).toEqual([]);
  });

  it('recalculate: lists the transactions that change period, largest first', async () => {
    const food = ledger.category('system:food');
    const tokopedia = await ledger.entry('expense', '2026-09-26', 449_000n, food, { merchant: 'Tokopedia' });
    await ledger.entry('expense', '2026-09-27', 100_000n, food);
    await ledger.entry('expense', '2026-09-28', 50_000n, food);
    await ledger.entry('expense', '2026-09-29', 20_000n, food);
    await ledger.entry('expense', '2026-09-20', 900_000n, food);
    await ledger.entry('expense', '2026-10-10', 800_000n, food);
    const deleted = await ledger.entry('expense', '2026-09-30', 700_000n, food);
    await test.query(`UPDATE transactions SET deleted_at = now() WHERE id = $1`, [deleted]);

    const preview = await asApp(() =>
      periodsAt('2026-10-15').previewStartDay(userId, { day: 25, apply: 'recalculate' }),
    );
    expect(preview.paydayDay).toBeNull();
    expect(preview.periods).toEqual([
      { kind: 'normal', label: '2026-10', start: '2026-09-25', end: '2026-10-24', days: 30 },
      { kind: 'normal', label: '2026-11', start: '2026-10-25', end: '2026-11-24', days: 31 },
      { kind: 'normal', label: '2026-12', start: '2026-11-25', end: '2026-12-24', days: 30 },
    ]);
    expect(preview.transition).toBeNull();
    expect(preview.moved).toEqual({
      count: 4,
      largest: [
        { id: tokopedia, localDate: '2026-09-26', merchant: 'Tokopedia', description: null, amountMinor: 449_000n },
        expect.objectContaining({ localDate: '2026-09-27', amountMinor: 100_000n }),
        expect.objectContaining({ localDate: '2026-09-28', amountMinor: 50_000n }),
      ],
    });
  });

  it('recalculate to a later day starts with a transition', async () => {
    await ledger.entry('expense', '2026-10-02', 75_000n, ledger.category('system:food'));
    const preview = await asApp(() =>
      periodsAt('2026-10-15').previewStartDay(userId, { day: 5, apply: 'recalculate' }),
    );
    expect(preview.periods.map(({ kind, start, end }) => ({ kind, start, end }))).toEqual([
      { kind: 'transition', start: '2026-10-01', end: '2026-10-04' },
      { kind: 'normal', start: '2026-10-05', end: '2026-11-04' },
      { kind: 'normal', start: '2026-11-05', end: '2026-12-04' },
    ]);
    // No budget yet: nothing to prorate.
    expect(preview.transition).toMatchObject({ period: { days: 4 }, limitMinor: 0n, proratedMinor: 0n });
    expect(preview.moved).toMatchObject({ count: 1, largest: [{ localDate: '2026-10-02', amountMinor: 75_000n }] });
  });
});

describe('changeStartDay', () => {
  it('next period: stores the day and mode and drops rows still to come', async () => {
    await asApp(() => periodsAt('2026-10-15').list(userId));
    await test.query(
      `INSERT INTO periods (user_id, label, start_date, end_date, days, kind) VALUES ($1, '2026-11', '2026-11-01', '2026-11-30', 30, 'normal')`,
      [userId],
    );
    const preview = await asApp(() =>
      periodsAt('2026-10-15').changeStartDay(userId, { day: 25, apply: 'next_period', mode: 'follow_payday' }),
    );
    expect(preview).toMatchObject({ apply: 'next_period', fromDay: 1, toDay: 25 });
    expect((await rows()).map((row) => row.label)).toEqual(['2026-10']);
    expect(await preferences()).toEqual([{ day: 25, mode: 'follow_payday' }]);

    // Without a mode the stored one stays.
    await asApp(() => periodsAt('2026-10-15').changeStartDay(userId, { day: 10, apply: 'next_period' }));
    expect(await preferences()).toEqual([{ day: 10, mode: 'follow_payday' }]);
  });

  it('recalculate earlier: trims an open previous period', async () => {
    await asApp(() => periodsAt('2026-09-10').list(userId));
    const { current } = await asApp(() => periodsAt('2026-10-15').list(userId));
    await asApp(() => periodsAt('2026-10-15').changeStartDay(userId, { day: 25, apply: 'recalculate' }));
    expect(await rows()).toEqual([
      { label: '2026-09', start: '2026-09-01', end: '2026-09-24', days: 24, kind: 'normal', status: 'open' },
      { label: '2026-10', start: '2026-09-25', end: '2026-10-24', days: 30, kind: 'normal', status: 'open' },
    ]);
    expect((await asApp(() => periodsAt('2026-10-15').list(userId))).current.id).toBe(current.id);
    expect(await preferences()).toEqual([{ day: 25, mode: 'fixed_day' }]);
  });

  it('recalculate earlier: leaves a closed previous period as it is', async () => {
    const { current } = await asApp(() => periodsAt('2026-09-10').list(userId));
    await asApp(() => periodsAt('2026-10-15').lock(userId, current.id as string));
    await asApp(() => periodsAt('2026-10-15').changeStartDay(userId, { day: 25, apply: 'recalculate' }));
    expect(await rows()).toEqual([
      { label: '2026-09', start: '2026-09-01', end: '2026-09-30', days: 30, kind: 'normal', status: 'closed' },
      { label: '2026-10', start: '2026-09-25', end: '2026-10-24', days: 30, kind: 'normal', status: 'open' },
    ]);
    // The open row wins on the overlapping days.
    expect((await asApp(() => periodsAt('2026-10-15').list(userId))).current.start).toBe('2026-09-25');
  });

  it('recalculate earlier without a previous row only reshapes the current one', async () => {
    await asApp(() => periodsAt('2026-10-15').changeStartDay(userId, { day: 25, apply: 'recalculate' }));
    expect((await rows()).map(({ start, end }) => [start, end])).toEqual([['2026-09-25', '2026-10-24']]);
  });

  it('recalculate earlier: refuses to empty the previous period', async () => {
    await test.query(
      `INSERT INTO periods (user_id, label, start_date, end_date, days, kind) VALUES ($1, '2026-09', '2026-09-25', '2026-09-30', 6, 'transition')`,
      [userId],
    );
    await asApp(() => periodsAt('2026-10-15').list(userId));
    await expect(
      asApp(() => periodsAt('2026-10-15').changeStartDay(userId, { day: 25, apply: 'recalculate' })),
    ).rejects.toMatchObject({ code: 'INVALID_PERIOD', message: 'The previous period would become empty' });
    expect((await rows()).map(({ start, end }) => [start, end])).toEqual([
      ['2026-09-25', '2026-09-30'],
      ['2026-10-01', '2026-10-31'],
    ]);
    expect(await preferences()).toEqual([]);
  });

  it('recalculate later: the current row becomes the transition and the new period follows', async () => {
    await asApp(() => periodsAt('2026-10-15').changeStartDay(userId, { day: 5, apply: 'recalculate' }));
    expect(await rows()).toEqual([
      { label: '2026-10', start: '2026-10-01', end: '2026-10-04', days: 4, kind: 'transition', status: 'open' },
      { label: '2026-11', start: '2026-10-05', end: '2026-11-04', days: 31, kind: 'normal', status: 'open' },
    ]);
    expect((await asApp(() => periodsAt('2026-10-15').list(userId))).current.start).toBe('2026-10-05');
  });
});

describe('lock', () => {
  it('refuses a period that has not ended and an unknown one', async () => {
    const { current } = await asApp(() => periodsAt('2026-10-15').list(userId));
    await expect(asApp(() => periodsAt('2026-10-31').lock(userId, current.id as string))).rejects.toMatchObject({
      code: 'INVALID_PERIOD',
    });
    await expect(asApp(() => periodsAt('2026-10-15').lock(userId, randomUUID()))).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('closes an ended period once (as the worker) and materializes the periods up to today', async () => {
    const { current: september } = await asApp(() => periodsAt('2026-09-10').list(userId));
    const worker = <T>(fn: () => Promise<T>) => test.as('wf_worker', fn);
    expect(await worker(() => periodsAt('2026-10-15').lock(userId, september.id as string))).toEqual({ locked: true });
    expect(await worker(() => periodsAt('2026-10-16').lock(userId, september.id as string))).toEqual({
      locked: false,
    });
    const closed = await asApp(() => periodsAt('2026-10-15').get(userId, september.id as string));
    expect(closed).toMatchObject({ status: 'closed', closedAt: new Date('2026-10-15T05:00:00Z') });

    const { current: october } = await asApp(() => periodsAt('2026-10-15').list(userId));
    await asApp(() => periodsAt('2026-12-05').lock(userId, october.id as string));
    expect((await rows()).map((row) => `${row.label}:${row.status}`)).toEqual([
      '2026-09:closed',
      '2026-10:closed',
      '2026-11:open',
      '2026-12:open',
    ]);
  });
});
