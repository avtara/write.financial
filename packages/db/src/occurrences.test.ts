// SPDX-License-Identifier: AGPL-3.0-only
import type { LocalDate } from '@wf/domain/period';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ledgerFixture, type LedgerFixture } from '../test/ledger-fixture.ts';
import { PGLITE_HOOK_TIMEOUT, startMigrated, type TestDatabase } from '../test/pglite.ts';
import { firstRow, withUser } from './db.ts';
import {
  decodeTemplate,
  encodeTemplate,
  MATERIALIZE_DAYS,
  materializeIn,
  pruneFutureIn,
  recordPastChargeIn,
  recurrenceDueDates,
  subscriptionDueDates,
  templateAmount,
  userClockIn,
  type RecurrenceTemplate,
  type ScheduleSource,
} from './occurrences.ts';
import { recurrences, subscriptions } from './schema.ts';

let test: TestDatabase;
let fx: LedgerFixture;

/** 15 Okt 2026, 10.00 WIB. */
const NOW = new Date('2026-10-15T03:00:00Z');
const d = (value: string) => value as LocalDate;

beforeAll(async () => {
  test = await startMigrated();
}, PGLITE_HOOK_TIMEOUT);

afterAll(async () => {
  await test.close();
});

beforeEach(async () => {
  await test.query('DELETE FROM users');
  fx = await ledgerFixture(test, 'occ@example.test');
});

const asApp = <T>(fn: () => Promise<T>) => test.as('wf_app', fn);
const materialize = (source?: ScheduleSource, role: 'wf_app' | 'wf_worker' = 'wf_app') =>
  test.as(role, () =>
    withUser(test.db, fx.userId, (tx) =>
      materializeIn(tx, fx.userId, source === undefined ? { now: NOW } : { now: NOW, source }),
    ),
  );

type SubscriptionInsert = typeof subscriptions.$inferInsert;

async function subscription(overrides: Partial<SubscriptionInsert> = {}): Promise<string> {
  const inserted = await test.db
    .insert(subscriptions)
    .values({
      userId: fx.userId,
      name: 'Netflix',
      priceMinor: 186_000n,
      currency: 'IDR',
      cycle: 'monthly',
      nextBillingDate: d('2026-10-18'),
      payFromAccountId: fx.bca,
      remindDaysBefore: 1,
      startedOn: d('2024-01-18'),
      ...overrides,
    })
    .returning({ id: subscriptions.id });
  return firstRow(inserted, 'subscriptions').id;
}

type RecurrenceInsert = typeof recurrences.$inferInsert;

async function recurrence(template: RecurrenceTemplate, overrides: Partial<RecurrenceInsert> = {}): Promise<string> {
  const inserted = await test.db
    .insert(recurrences)
    .values({
      userId: fx.userId,
      template: encodeTemplate(template),
      freq: 'monthly',
      startOn: d('2026-11-14'),
      monthDay: 14,
      ...overrides,
    })
    .returning({ id: recurrences.id });
  return firstRow(inserted, 'recurrences').id;
}

const rows = () =>
  test.query<{
    source_id: string;
    due_date: string;
    expected_minor: string;
    currency: string;
    status: string;
    remind_at: Date | null;
  }>(
    `SELECT source_id, to_char(due_date, 'YYYY-MM-DD') AS due_date, expected_minor::text, currency, status, remind_at
     FROM scheduled_occurrences ORDER BY source_id, due_date`,
  );
const dues = async (sourceId: string) =>
  (await rows()).filter((row) => row.source_id === sourceId).map((row) => row.due_date);

const salary = (): RecurrenceTemplate => ({
  type: 'expense',
  accountId: fx.bca,
  amountMinor: 3_500_000n,
  categoryId: fx.category('system:rent'),
});

describe('templates', () => {
  it('round-trips entries and transfers with bigints as strings', () => {
    const entry: RecurrenceTemplate = {
      type: 'income',
      accountId: 'a',
      amountMinor: 25_000_000n,
      categoryId: null,
      description: 'Gaji',
      merchant: 'PT Maju',
      tags: ['gaji'],
    };
    expect(encodeTemplate(entry)).toEqual({
      type: 'income',
      accountId: 'a',
      amountMinor: '25000000',
      categoryId: null,
      merchant: 'PT Maju',
      description: 'Gaji',
      tags: ['gaji'],
    });
    expect(decodeTemplate(encodeTemplate(entry))).toEqual(entry);
    expect(
      decodeTemplate(encodeTemplate({ type: 'expense', accountId: 'a', amountMinor: 1n, categoryId: 'c' })),
    ).toEqual({
      type: 'expense',
      accountId: 'a',
      amountMinor: 1n,
      categoryId: 'c',
      merchant: null,
      description: null,
      tags: [],
    });
    const transfer: RecurrenceTemplate = {
      type: 'transfer',
      fromAccountId: 'a',
      toAccountId: 'b',
      sentMinor: 2_000_000n,
      receivedMinor: 2_000_000n,
      fee: { minor: 2_500n, categoryId: 'f' },
      description: 'Sisihkan dana',
      tags: ['dana-darurat'],
    };
    expect(encodeTemplate(transfer)).toMatchObject({ sentMinor: '2000000', fee: { minor: '2500', categoryId: 'f' } });
    expect(decodeTemplate(encodeTemplate(transfer))).toEqual(transfer);
    const bare = decodeTemplate(
      encodeTemplate({ type: 'transfer', fromAccountId: 'a', toAccountId: 'b', sentMinor: 5n, receivedMinor: 5n }),
    );
    expect(bare).toEqual({
      type: 'transfer',
      fromAccountId: 'a',
      toAccountId: 'b',
      sentMinor: 5n,
      receivedMinor: 5n,
      fee: null,
      description: null,
      tags: [],
    });
    expect(templateAmount(bare)).toEqual({ accountId: 'a', amountMinor: 5n });
    expect(templateAmount(entry)).toEqual({ accountId: 'a', amountMinor: 25_000_000n });
  });
});

describe('due dates', () => {
  const base = {
    status: 'active' as const,
    freq: 'monthly' as const,
    interval: 1,
    startOn: d('2026-10-14'),
    weekday: null,
    monthDay: 14,
    endType: 'never' as const,
    endCount: null,
  };

  it('follows a recurrence rule and stops with it', () => {
    expect(recurrenceDueDates(base, d('2026-10-15'), d('2027-01-14'))).toEqual([
      '2026-11-14',
      '2026-12-14',
      '2027-01-14',
    ]);
    expect(recurrenceDueDates({ ...base, endType: 'after', endCount: 2 }, d('2026-10-01'), d('2027-01-14'))).toEqual([
      '2026-10-14',
      '2026-11-14',
    ]);
    expect(recurrenceDueDates({ ...base, status: 'stopped' }, d('2026-10-15'), d('2027-01-14'))).toEqual([]);
  });

  it('skips trial, pause, and cancelled bills', () => {
    const sub = {
      nextBillingDate: d('2026-10-18'),
      cycle: 'monthly' as const,
      trialEndsOn: null,
      status: 'active' as const,
      pausedOn: null,
      pausedUntil: null,
      cancelMode: null,
      endsOn: null,
    };
    const window = [d('2026-10-15'), d('2027-01-13')] as const;
    expect(subscriptionDueDates(sub, ...window)).toEqual(['2026-10-18', '2026-11-18', '2026-12-18']);
    expect(subscriptionDueDates({ ...sub, trialEndsOn: d('2026-10-31') }, ...window)).toEqual([
      '2026-11-18',
      '2026-12-18',
    ]);
    expect(
      subscriptionDueDates(
        { ...sub, status: 'paused', pausedOn: d('2026-10-15'), pausedUntil: d('2026-11-18') },
        ...window,
      ),
    ).toEqual(['2026-11-18', '2026-12-18']);
    expect(
      subscriptionDueDates(
        { ...sub, status: 'cancelled', cancelMode: 'after_next_bill', endsOn: d('2026-10-18') },
        ...window,
      ),
    ).toEqual(['2026-10-18']);
    expect(
      subscriptionDueDates({ ...sub, status: 'cancelled', cancelMode: 'now', endsOn: d('2026-10-15') }, ...window),
    ).toEqual([]);
  });
});

describe('userClockIn', () => {
  it('returns the user time zone and local date', async () => {
    await test.query(`UPDATE users SET timezone = 'America/New_York'`);
    const late = new Date('2026-10-16T02:00:00Z');
    await expect(asApp(() => withUser(test.db, fx.userId, (tx) => userClockIn(tx, fx.userId, late)))).resolves.toEqual({
      timeZone: 'America/New_York',
      today: '2026-10-15',
    });
  });
});

describe('materializeIn', () => {
  it('creates Netflix bills 90 days ahead with the H-1 09.00 reminder, idempotently', async () => {
    expect(MATERIALIZE_DAYS).toBe(90);
    const netflix = await subscription();
    await expect(materialize()).resolves.toEqual({ created: 3 });
    const stored = await rows();
    expect(stored.map((row) => [row.due_date, row.expected_minor, row.currency, row.status])).toEqual([
      ['2026-10-18', '186000', 'IDR', 'scheduled'],
      ['2026-11-18', '186000', 'IDR', 'scheduled'],
      ['2026-12-18', '186000', 'IDR', 'scheduled'],
    ]);
    expect(stored[0]?.remind_at).toEqual(new Date('2026-10-17T02:00:00Z'));
    expect(stored[0]?.source_id).toBe(netflix);
    await expect(materialize()).resolves.toEqual({ created: 0 });
    expect(await rows()).toEqual(stored);
  });

  it('keeps the overdue next bill and leaves reminders off where none apply', async () => {
    const icloud = await subscription({ name: 'iCloud+', nextBillingDate: d('2026-10-09'), priceMinor: 15_000n });
    const quiet = await subscription({ name: 'Spotify', remindDaysBefore: null });
    await materialize();
    const stored = await rows();
    expect(await dues(icloud)).toEqual(['2026-10-09', '2026-11-09', '2026-12-09', '2027-01-09']);
    expect(stored.find((row) => row.source_id === icloud && row.due_date === '2026-10-09')?.remind_at).toBeNull();
    expect(stored.find((row) => row.source_id === icloud && row.due_date === '2026-11-09')?.remind_at).toEqual(
      new Date('2026-11-08T02:00:00Z'),
    );
    expect(stored.filter((row) => row.source_id === quiet).map((row) => row.remind_at)).toEqual([null, null, null]);
  });

  it('materializes recurrences from their start, in the account currency, honoring stop and end counts', async () => {
    await test.query(`UPDATE accounts SET currency = 'USD' WHERE id = $1`, [fx.jago]);
    const rent = await recurrence(salary(), { remindOffsetDays: 1 });
    const weekly = await recurrence(
      {
        type: 'transfer',
        fromAccountId: fx.jago,
        toAccountId: fx.bca,
        sentMinor: 10_000n,
        receivedMinor: 163_500_000n,
      },
      { freq: 'weekly', weekday: 5, monthDay: null, startOn: d('2026-10-02'), endType: 'after', endCount: 4 },
    );
    const stopped = await recurrence(salary(), { status: 'stopped', stoppedAt: NOW });
    await expect(materialize()).resolves.toEqual({ created: 4 });
    const stored = await rows();
    expect(await dues(rent)).toEqual(['2026-11-14', '2026-12-14']);
    expect(stored.find((row) => row.source_id === rent)).toMatchObject({
      expected_minor: '3500000',
      currency: 'IDR',
      remind_at: new Date('2026-11-13T02:00:00Z'),
    });
    // 2, 9, 16, 23 Okt: the first two are past and count toward the four.
    expect(await dues(weekly)).toEqual(['2026-10-16', '2026-10-23']);
    expect(stored.find((row) => row.source_id === weekly)).toMatchObject({
      expected_minor: '10000',
      currency: 'USD',
      remind_at: null,
    });
    expect(await dues(stopped)).toEqual([]);
  });

  it('limits to one source and does nothing without schedules', async () => {
    await expect(materialize()).resolves.toEqual({ created: 0 });
    const netflix = await subscription();
    const rent = await recurrence(salary());
    await expect(materialize({ type: 'recurrence', id: rent })).resolves.toEqual({ created: 2 });
    expect(await dues(netflix)).toEqual([]);
    await expect(materialize({ type: 'subscription', id: netflix })).resolves.toEqual({ created: 3 });
    await expect(materialize({ type: 'subscription', id: rent })).resolves.toEqual({ created: 0 });
  });

  it('runs as wf_worker', async () => {
    await subscription();
    await recurrence(salary());
    await expect(materialize(undefined, 'wf_worker')).resolves.toEqual({ created: 5 });
  });
});

describe('pruneFutureIn', () => {
  it('deletes scheduled rows from a date and keeps rows in review', async () => {
    const netflix = await subscription();
    await materialize();
    await test.query(`UPDATE scheduled_occurrences SET status = 'due_review' WHERE due_date = '2026-12-18'`);
    const source = { type: 'subscription', id: netflix } as const;
    await expect(
      asApp(() => withUser(test.db, fx.userId, (tx) => pruneFutureIn(tx, fx.userId, source, d('2026-11-01')))),
    ).resolves.toBe(1);
    expect(await dues(netflix)).toEqual(['2026-10-18', '2026-12-18']);
  });
});

describe('recordPastChargeIn', () => {
  it('links a transaction as a confirmed occurrence once', async () => {
    const netflix = await subscription();
    const transactionId = await fx.entry('expense', '2026-09-18', 186_000n, fx.category('system:subscriptions'));
    const charge = {
      sourceType: 'subscription' as const,
      sourceId: netflix,
      dueDate: d('2026-09-18'),
      transactionId,
      amountMinor: 186_000n,
      currency: 'IDR',
    };
    const record = () => asApp(() => withUser(test.db, fx.userId, (tx) => recordPastChargeIn(tx, fx.userId, charge)));
    const first = await record();
    expect(first.created).toBe(true);
    await expect(record()).resolves.toEqual({ id: first.id, created: false });
    expect(await rows()).toEqual([expect.objectContaining({ due_date: '2026-09-18', status: 'confirmed' })]);
  });
});
