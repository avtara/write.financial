// SPDX-License-Identifier: AGPL-3.0-only
import { addDays, parseLocalDate, type LocalDate } from '@wf/domain/period';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { fixtureGetDek, ledgerFixture, type LedgerFixture } from '../test/ledger-fixture.ts';
import { insertUser, PGLITE_HOOK_TIMEOUT, startMigrated, type TestDatabase } from '../test/pglite.ts';
import { createOccurrenceJobs, type OccurrenceJobs } from './occurrence-jobs.ts';
import {
  createSchedules,
  type RecurrenceInput,
  type SchedulesRepository,
  type SubscriptionInput,
} from './schedules.ts';

let test: TestDatabase;
let fx: LedgerFixture;
let schedules: SchedulesRepository;
let jobs: OccurrenceJobs;
/** The app's clock (schedules are created on 15 Okt 2026, 10.00 WIB unless a test moves it). */
let clock: Date;

const d = (value: string): LocalDate => parseLocalDate(value);
/** `HH:MM` local time in Asia/Jakarta on `date`. */
const wib = (date: string, time: string) => new Date(`${date}T${time}:00+07:00`);

const asApp = <T>(fn: () => Promise<T>) => test.as('wf_app', fn);
const asWorker = <T>(fn: () => Promise<T>) => test.as('wf_worker', fn);
const advance = (now: Date, userId = fx.userId) => asWorker(() => jobs.advance(userId, now));
const remind = (occurrenceId: string, now: Date, userId = fx.userId) =>
  asWorker(() => jobs.remind(userId, occurrenceId, now));

beforeAll(async () => {
  test = await startMigrated();
  schedules = createSchedules(test.db, { now: () => clock });
  jobs = createOccurrenceJobs(test.db, { getDek: fixtureGetDek });
}, PGLITE_HOOK_TIMEOUT);

afterAll(async () => {
  await test.close();
});

beforeEach(async () => {
  await test.query('DELETE FROM users');
  fx = await ledgerFixture(test, 'jobs@example.test');
  // A recorded expense, so the D14 snapshot covers real ledger rows.
  await fx.entry('expense', '2026-10-10', 50_000n, fx.category('system:food'));
  clock = wib('2026-10-15', '10:00');
});

const NETFLIX: Omit<SubscriptionInput, 'payFromAccountId' | 'categoryId'> = {
  name: 'Netflix',
  plan: 'Premium',
  priceMinor: 186_000n,
  currency: 'IDR',
  cycle: 'monthly',
  nextBillingDate: d('2026-10-18'),
  remindDaysBefore: 1,
  startedOn: d('2025-01-18'),
};

const subscribe = (input: Partial<SubscriptionInput> = {}) =>
  asApp(() =>
    schedules.createSubscription(fx.userId, {
      ...NETFLIX,
      payFromAccountId: fx.bca,
      categoryId: fx.category('system:subscriptions'),
      ...input,
    }),
  );

const schedule = (template: RecurrenceInput['template'], remindOffsetDays: number | null = 1) =>
  asApp(() =>
    schedules.createRecurrence(fx.userId, {
      template,
      freq: 'monthly',
      startOn: d('2026-10-18'),
      end: { type: 'never' },
      remindOffsetDays,
    }),
  );

interface OccurrenceRow {
  id: string;
  due_date: string;
  status: string;
  remind_at: Date | null;
  reminded_at: Date | null;
}

const occurrencesOf = (sourceId: string) =>
  test.query<OccurrenceRow>(
    `SELECT id, due_date::text, status::text, remind_at, reminded_at FROM scheduled_occurrences
     WHERE source_id = $1 ORDER BY due_date`,
    [sourceId],
  );

async function occurrenceOn(sourceId: string, due: string): Promise<OccurrenceRow> {
  const row = (await occurrencesOf(sourceId)).find((occurrence) => occurrence.due_date === due);
  if (row === undefined) throw new Error(`no occurrence on ${due}`);
  return row;
}

const notifications = (userId = fx.userId) =>
  test.query<{ type: string; ref: string; title_key: string; body_key: string; params: unknown; action: unknown }>(
    `SELECT type::text, ref, title_key, body_key, params, action FROM notifications WHERE user_id = $1 ORDER BY ref`,
    [userId],
  );

const outbox = (userId = fx.userId) =>
  test.query<{ notification_id: string; payload: unknown; send_at: Date; sent_at: Date | null; attempts: number }>(
    `SELECT notification_id, payload, send_at, sent_at, attempts FROM notification_outbox WHERE user_id = $1`,
    [userId],
  );

const reviewItems = () =>
  test.query<{ dedupe_key: string; reason: string; status: string; occurrence_id: string | null }>(
    `SELECT dedupe_key, reason::text, status::text, occurrence_id FROM review_items WHERE user_id = $1 ORDER BY dedupe_key`,
    [fx.userId],
  );

const LEDGER_TABLES = [
  'transactions',
  'postings',
  'transfer_meta',
  'balance_adjustments',
  'budget_versions',
  'budget_lines',
  'budget_period_overrides',
  'goals',
] as const;

/** Row count and content hash of every table D14 keeps out of the worker's reach. */
async function ledgerSnapshot(): Promise<Record<string, unknown>> {
  const snapshot: Record<string, unknown> = {};
  for (const table of LEDGER_TABLES) {
    const [row] = await test.query<{ n: number; h: string | null }>(
      `SELECT count(*)::int AS n, md5(string_agg(t::text, ',' ORDER BY t::text)) AS h FROM ${table} t`,
    );
    snapshot[table] = row;
  }
  return snapshot;
}

const preferences = (values: { hideBalances?: boolean; notif?: Record<string, unknown> }) =>
  test.query('INSERT INTO user_preferences (user_id, hide_balances, notif) VALUES ($1, $2, $3)', [
    fx.userId,
    values.hideBalances ?? false,
    values.notif ?? {},
  ]);

const NOTHING = { materialized: 0, due: 0, overdue: 0, notifications: 0 };

describe('advance', () => {
  it('moves the Netflix bill to review on its due date and marks it overdue the day after, once each', async () => {
    const netflix = await subscribe();
    const before = await ledgerSnapshot();

    expect(await advance(wib('2026-10-17', '08:59'))).toEqual(NOTHING);
    expect((await occurrenceOn(netflix.id, '2026-10-18')).status).toBe('scheduled');
    expect(await reviewItems()).toEqual([]);

    expect(await advance(wib('2026-10-18', '00:05'))).toEqual({
      materialized: 0,
      due: 1,
      overdue: 0,
      notifications: 1,
    });
    const bill = await occurrenceOn(netflix.id, '2026-10-18');
    expect(bill.status).toBe('due_review');
    expect(await reviewItems()).toEqual([
      { dedupe_key: `occ.${bill.id}`, reason: 'due_occurrence', status: 'pending', occurrence_id: bill.id },
    ]);
    expect(await notifications()).toEqual([
      {
        type: 'review_due',
        ref: `due.${bill.id}`,
        title_key: 'notification_review_due_title',
        body_key: 'notification_review_due_body',
        params: {
          name: 'Netflix',
          dueDate: '2026-10-18',
          amount: { amountMinor: '186000', currency: 'IDR' },
          account: 'BCA',
        },
        action: { href: '/review' },
      },
    ]);

    // A retry or a restart the same day changes nothing.
    expect(await advance(wib('2026-10-18', '00:06'))).toEqual(NOTHING);
    expect(await reviewItems()).toHaveLength(1);
    expect(await notifications()).toHaveLength(1);

    expect(await advance(wib('2026-10-19', '00:05'))).toEqual({
      materialized: 0,
      due: 0,
      overdue: 1,
      notifications: 1,
    });
    expect((await occurrenceOn(netflix.id, '2026-10-18')).status).toBe('unconfirmed');
    expect((await reviewItems()).map((item) => item.status)).toEqual(['pending']);
    const overdue = (await notifications()).find((row) => row.type === 'bill_overdue');
    expect(overdue).toEqual({
      type: 'bill_overdue',
      ref: `overdue.${bill.id}`,
      title_key: 'notification_bill_overdue_title',
      body_key: 'notification_bill_overdue_body',
      params: {
        name: 'Netflix',
        dueDate: '2026-10-18',
        amount: { amountMinor: '186000', currency: 'IDR' },
        account: 'BCA',
      },
      action: { href: '/review' },
    });
    expect(await advance(wib('2026-10-19', '12:00'))).toEqual(NOTHING);
    expect(await notifications()).toHaveLength(2);

    expect(await ledgerSnapshot()).toEqual(before);
  });

  it('announces a bill the worker missed (due while it was down) as overdue only', async () => {
    const netflix = await subscribe();
    expect(await advance(wib('2026-10-20', '00:05'))).toEqual({
      // 20 Okt + 90 days reaches 18 Jan.
      materialized: 1,
      due: 1,
      overdue: 1,
      notifications: 1,
    });
    const bill = await occurrenceOn(netflix.id, '2026-10-18');
    expect(bill.status).toBe('unconfirmed');
    expect((await notifications()).map((row) => row.ref)).toEqual([`overdue.${bill.id}`]);
    expect((await reviewItems()).map((item) => item.dedupe_key)).toEqual([`occ.${bill.id}`]);
  });

  it('materializes 90 days ahead with 09.00 WIB reminders, idempotently', async () => {
    const [row] = await test.query<{ id: string }>(
      `INSERT INTO subscriptions (user_id, name, price_minor, currency, cycle, next_billing_date, pay_from_account_id, remind_days_before, started_on)
       VALUES ($1, 'Spotify', 54990, 'IDR', 'monthly', '2026-10-18', $2, 1, '2025-01-18') RETURNING id`,
      [fx.userId, fx.bca],
    );
    const id = row?.id as string;
    // 17 Okt + 90 days = 15 Jan: 18 Okt, 18 Nov, 18 Des.
    expect(await advance(wib('2026-10-17', '00:05'))).toEqual({ ...NOTHING, materialized: 3 });
    expect((await occurrencesOf(id)).map(({ due_date, remind_at }) => [due_date, remind_at])).toEqual([
      ['2026-10-18', new Date('2026-10-17T02:00:00Z')],
      ['2026-11-18', new Date('2026-11-17T02:00:00Z')],
      ['2026-12-18', new Date('2026-12-17T02:00:00Z')],
    ]);
    expect(await advance(wib('2026-10-17', '00:05'))).toEqual(NOTHING);
  });

  it('names recurrences by description, merchant, category, or account, and leaves other users alone', async () => {
    const bills = fx.category('system:bills');
    const [category] = await test.query<{ name: string }>('SELECT name FROM categories WHERE id = $1', [bills]);
    const listrik = await schedule({
      type: 'expense',
      accountId: fx.bca,
      amountMinor: 350_000n,
      categoryId: bills,
      description: 'Listrik',
    });
    const pln = await schedule({
      type: 'expense',
      accountId: fx.bca,
      amountMinor: 100_000n,
      categoryId: bills,
      merchant: 'PLN',
    });
    const categoryOnly = await schedule({
      type: 'expense',
      accountId: fx.bca,
      amountMinor: 75_000n,
      categoryId: bills,
    });
    const salary = await schedule({ type: 'income', accountId: fx.jago, amountMinor: 9_000_000n, categoryId: null });
    const saving = await schedule({
      type: 'transfer',
      fromAccountId: fx.bca,
      toAccountId: fx.jago,
      sentMinor: 500_000n,
      receivedMinor: 500_000n,
    });
    const other = await insertUser(test, 'other@example.test');
    const before = await ledgerSnapshot();

    expect(await advance(wib('2026-10-18', '00:05'))).toEqual({ ...NOTHING, due: 5, notifications: 5 });
    const expected = [];
    for (const [view, name] of [
      [listrik, 'Listrik'],
      [pln, 'PLN'],
      [categoryOnly, category?.name],
      [salary, 'Jago'],
      [saving, 'BCA'],
    ] as const) {
      expected.push({ ref: `due.${(await occurrenceOn(view.id, '2026-10-18')).id}`, type: 'review_due', name });
    }
    expect(
      await test.query(
        `SELECT ref, type::text, params->>'name' AS name FROM notifications WHERE user_id = $1 ORDER BY ref`,
        [fx.userId],
      ),
    ).toEqual(expected.sort((a, b) => (a.ref < b.ref ? -1 : 1)));
    expect(await reviewItems()).toHaveLength(5);
    expect(await advance(wib('2026-10-18', '00:05'), other)).toEqual(NOTHING);
    expect(await ledgerSnapshot()).toEqual(before);
  });

  it('reminds of a free trial ending within its reminder days, once', async () => {
    const trial = await subscribe({
      name: 'Disney+',
      trial: { days: 7 },
      startedOn: d('2026-10-15'),
      remindDaysBefore: 3,
    });
    const [row] = await test.query<{ ends: string; first: string }>(
      'SELECT trial_ends_on::text AS ends, next_billing_date::text AS first FROM subscriptions WHERE id = $1',
      [trial.id],
    );
    const ends = d(row?.ends as string);
    expect(row?.first).toBe(addDays(ends, 1));

    expect(await advance(wib(addDays(ends, -4), '00:05'))).toEqual(NOTHING);
    expect(await advance(wib(addDays(ends, -3), '00:05'))).toEqual({ ...NOTHING, notifications: 1 });
    expect(await notifications()).toEqual([
      {
        type: 'trial_ending',
        ref: `trial.${trial.id}.${ends}`,
        title_key: 'notification_trial_ending_title',
        body_key: 'notification_trial_ending_body',
        params: {
          name: 'Disney+',
          trialEndsOn: ends,
          firstBill: addDays(ends, 1),
          amount: { amountMinor: '186000', currency: 'IDR' },
        },
        action: { href: '/subscriptions' },
      },
    ]);
    expect(await advance(wib(addDays(ends, -2), '00:05'))).toEqual(NOTHING);
    expect(await notifications()).toHaveLength(1);
  });

  it('reminds of billing resuming after a pause within its reminder days, once', async () => {
    const netflix = await subscribe();
    await asApp(() => schedules.pause(fx.userId, netflix.id, { months: 1 }, { remindDaysBefore: 3 }));
    const [row] = await test.query<{ until: string }>(
      'SELECT paused_until::text AS until FROM subscriptions WHERE id = $1',
      [netflix.id],
    );
    expect(row?.until).toBe('2026-11-18');

    const atNov14 = await advance(wib('2026-11-14', '00:05'));
    expect(atNov14.notifications).toBe(0);
    expect((await notifications()).filter((n) => n.type === 'pause_ending')).toEqual([]);
    expect((await advance(wib('2026-11-15', '00:05'))).notifications).toBe(1);
    expect((await notifications()).filter((n) => n.type === 'pause_ending')).toEqual([
      {
        type: 'pause_ending',
        ref: `pause.${netflix.id}.2026-11-18`,
        title_key: 'notification_pause_ending_title',
        body_key: 'notification_pause_ending_body',
        params: { name: 'Netflix', pausedUntil: '2026-11-18', amount: { amountMinor: '186000', currency: 'IDR' } },
        action: { href: '/subscriptions' },
      },
    ]);
    expect((await advance(wib('2026-11-16', '00:05'))).notifications).toBe(0);
  });
});

describe('remind', () => {
  it('reminds of Netflix at 09.00 WIB the day before, exactly once, with one email', async () => {
    const netflix = await subscribe();
    const bill = await occurrenceOn(netflix.id, '2026-10-18');
    expect(bill.remind_at).toEqual(wib('2026-10-17', '09:00'));
    const before = await ledgerSnapshot();

    expect(await remind(bill.id, wib('2026-10-17', '08:59'))).toEqual({ reminded: false, emailed: false });
    expect(await notifications()).toEqual([]);
    expect(await outbox()).toEqual([]);
    expect((await occurrenceOn(netflix.id, '2026-10-18')).reminded_at).toBeNull();

    const at = wib('2026-10-17', '09:00');
    expect(await remind(bill.id, at)).toEqual({ reminded: true, emailed: true });
    const rows = await notifications();
    expect(rows).toEqual([
      {
        type: 'bill_reminder',
        ref: `rem.${bill.id}`,
        title_key: 'notification_bill_reminder_title',
        body_key: 'notification_bill_reminder_body',
        params: {
          name: 'Netflix',
          dueDate: '2026-10-18',
          amount: { amountMinor: '186000', currency: 'IDR' },
          account: 'BCA',
          days: 1,
        },
        action: { href: '/subscriptions' },
      },
    ]);
    const [notification] = await test.query<{ id: string }>('SELECT id FROM notifications WHERE user_id = $1', [
      fx.userId,
    ]);
    expect(await outbox()).toEqual([
      {
        notification_id: notification?.id,
        payload: {
          kind: 'bill_reminder',
          name: 'Netflix',
          dueDate: '2026-10-18',
          amount: { amountMinor: '186000', currency: 'IDR' },
          path: '/subscriptions',
        },
        send_at: at,
        sent_at: null,
        attempts: 0,
      },
    ]);
    expect((await occurrenceOn(netflix.id, '2026-10-18')).reminded_at).toEqual(at);

    expect(await remind(bill.id, wib('2026-10-17', '09:01'))).toEqual({ reminded: false, emailed: false });
    expect(await notifications()).toHaveLength(1);
    expect(await outbox()).toHaveLength(1);
    expect(await ledgerSnapshot()).toEqual(before);
  });

  it('leaves amounts out of the email with privacy mode on', async () => {
    await preferences({ hideBalances: true });
    const netflix = await subscribe();
    const bill = await occurrenceOn(netflix.id, '2026-10-18');
    expect(await remind(bill.id, wib('2026-10-17', '09:00'))).toEqual({ reminded: true, emailed: true });
    const [row] = await outbox();
    expect(row?.payload).toEqual({
      kind: 'bill_reminder',
      name: 'Netflix',
      dueDate: '2026-10-18',
      amount: null,
      path: '/subscriptions',
    });
    // The in-app notification keeps the amount; the UI masks it.
    expect((await notifications())[0]?.params).toMatchObject({ amount: { amountMinor: '186000', currency: 'IDR' } });
  });

  it('queues no email with email notifications off, but still reminds in the app once', async () => {
    await preferences({ notif: { email: false } });
    const netflix = await subscribe();
    const bill = await occurrenceOn(netflix.id, '2026-10-18');
    const at = wib('2026-10-17', '09:00');
    expect(await remind(bill.id, at)).toEqual({ reminded: true, emailed: false });
    expect(await outbox()).toEqual([]);
    expect(await notifications()).toHaveLength(1);
    expect((await occurrenceOn(netflix.id, '2026-10-18')).reminded_at).toEqual(at);
    expect(await remind(bill.id, at)).toEqual({ reminded: false, emailed: false });
  });

  it('says "today" on the due date and for a reminder that fires late, and links recurrences to the calendar', async () => {
    const salary = await schedule(
      { type: 'income', accountId: fx.jago, amountMinor: 9_000_000n, categoryId: null, description: 'Gaji' },
      0,
    );
    const pay = await occurrenceOn(salary.id, '2026-10-18');
    expect(pay.remind_at).toEqual(wib('2026-10-18', '09:00'));
    expect(await remind(pay.id, wib('2026-10-18', '09:00'))).toEqual({ reminded: true, emailed: true });

    const netflix = await subscribe();
    const bill = await occurrenceOn(netflix.id, '2026-10-18');
    // The worker was down from 17 Okt to 19 Okt; the bill is already in review.
    await advance(wib('2026-10-18', '00:05'));
    expect(await remind(bill.id, wib('2026-10-19', '00:01'))).toEqual({ reminded: true, emailed: true });

    const rows = await notifications();
    const byRef = new Map(rows.map((row) => [row.ref, row]));
    expect(byRef.get(`rem.${pay.id}`)).toMatchObject({
      body_key: 'notification_bill_reminder_today_body',
      params: { name: 'Gaji', account: 'Jago', days: 0 },
      action: { href: '/calendar' },
    });
    expect(byRef.get(`rem.${bill.id}`)).toMatchObject({
      body_key: 'notification_bill_reminder_today_body',
      params: { name: 'Netflix', days: 0 },
    });
    expect(
      await test.query(`SELECT payload->>'path' AS path FROM notification_outbox WHERE user_id = $1 ORDER BY path`, [
        fx.userId,
      ]),
    ).toEqual([{ path: '/calendar' }, { path: '/subscriptions' }]);
  });

  it('does nothing for an unknown, unreminded, resolved, or other user’s occurrence', async () => {
    const quiet = await subscribe({ name: 'iCloud', remindDaysBefore: null });
    const silent = await occurrenceOn(quiet.id, '2026-10-18');
    expect(silent.remind_at).toBeNull();
    expect(await remind(silent.id, wib('2026-10-18', '09:00'))).toEqual({ reminded: false, emailed: false });

    const netflix = await subscribe();
    const bill = await occurrenceOn(netflix.id, '2026-10-18');
    await test.query(`UPDATE scheduled_occurrences SET status = 'skipped' WHERE id = $1`, [bill.id]);
    expect(await remind(bill.id, wib('2026-10-17', '09:00'))).toEqual({ reminded: false, emailed: false });
    await test.query(`UPDATE scheduled_occurrences SET status = 'unconfirmed' WHERE id = $1`, [bill.id]);
    expect(await remind(bill.id, wib('2026-10-19', '09:00'))).toEqual({ reminded: false, emailed: false });

    const next = await occurrenceOn(netflix.id, '2026-11-18');
    const other = await insertUser(test, 'other@example.test');
    expect(await remind(next.id, wib('2026-11-17', '09:00'), other)).toEqual({ reminded: false, emailed: false });
    expect(await remind('0199f5d2-7c4e-7a3b-8c1d-2e3f4a5b6c7d', wib('2026-11-17', '09:00'))).toEqual({
      reminded: false,
      emailed: false,
    });
    expect(await notifications()).toEqual([]);
    expect(await notifications(other)).toEqual([]);
    expect((await occurrenceOn(netflix.id, '2026-11-18')).reminded_at).toBeNull();
  });
});
