// SPDX-License-Identifier: AGPL-3.0-only
import type { LocalDate } from '@wf/domain/period';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { insertUser, PGLITE_HOOK_TIMEOUT, startMigrated, type TestDatabase } from '../test/pglite.ts';
import { withUser } from './db.ts';
import { DEFAULT_NOTIFICATION_SETTINGS, type NotificationSettings } from './notification-settings.ts';
import {
  createNotifications,
  createNotificationSettings,
  insertNotificationIn,
  type NewNotification,
  type NotificationsRepository,
} from './notifications.ts';

let test: TestDatabase;
let repo: NotificationsRepository;
let alice: string;
let bob: string;
// 20 Okt 2026 10.00 WIB.
const NOW = new Date('2026-10-20T03:00:00Z');

const asApp = <T>(fn: () => Promise<T>) => test.as('wf_app', fn);

beforeAll(async () => {
  test = await startMigrated();
  repo = createNotifications(test.db, { now: () => NOW });
}, PGLITE_HOOK_TIMEOUT);

afterAll(async () => {
  await test.close();
});

beforeEach(async () => {
  await test.query('DELETE FROM users');
  alice = await insertUser(test, 'alice@example.test');
  bob = await insertUser(test, 'bob@example.test');
});

const reminder = (ref: string, name: string): NewNotification => ({
  type: 'bill_reminder',
  category: 'budget_bills',
  titleKey: 'notification_bill_reminder_title',
  bodyKey: 'notification_bill_reminder_body',
  params: { name, amountMinor: '186000', currency: 'IDR', dueDate: '2026-10-18' },
  action: { href: '/subscriptions' },
  ref,
});

/** Inserts as the worker, then backdates `created_at` to `createdAt`. */
async function seed(userId: string, input: NewNotification, createdAt: string): Promise<string> {
  const { id } = await test.as('wf_worker', () =>
    withUser(test.db, userId, (tx) => insertNotificationIn(tx, userId, input)),
  );
  await test.query('UPDATE notifications SET created_at = $2 WHERE id = $1', [id, createdAt]);
  return id;
}

describe('insertNotificationIn', () => {
  it('inserts once per ref and returns the existing id afterwards', async () => {
    const first = await test.as('wf_worker', () =>
      withUser(test.db, alice, (tx) => insertNotificationIn(tx, alice, reminder('rem.1', 'Netflix'))),
    );
    const again = await test.as('wf_worker', () =>
      withUser(test.db, alice, (tx) => insertNotificationIn(tx, alice, reminder('rem.1', 'Spotify'))),
    );
    expect(first.created).toBe(true);
    expect(again).toEqual({ id: first.id, created: false });
    const minimal = await test.as('wf_worker', () =>
      withUser(test.db, alice, (tx) =>
        insertNotificationIn(tx, alice, {
          type: 'system',
          category: 'system',
          titleKey: 't',
          bodyKey: 'b',
          ref: 'sys.1',
        }),
      ),
    );
    const rows = await test.query<{ params: unknown; action: unknown }>(
      'SELECT params, action FROM notifications WHERE id = $1',
      [minimal.id],
    );
    expect(rows).toEqual([{ params: {}, action: null }]);
  });
  it('queues an email for the kinds the user wants by email, without amounts in privacy mode', async () => {
    const lowBalance = (ref: string): NewNotification => ({
      type: 'low_balance',
      category: 'budget_bills',
      titleKey: 'notification_low_balance_title',
      bodyKey: 'notification_low_balance_body',
      params: { account: 'GoPay', balance: { amountMinor: '412000', currency: 'IDR' }, count: 2 },
      action: { href: '/accounts' },
      ref,
    });
    const insert = (userId: string, input: NewNotification) =>
      test.as('wf_worker', () => withUser(test.db, userId, (tx) => insertNotificationIn(tx, userId, input)));
    const outbox = (userId: string) =>
      test.query<{ payload: unknown }>('SELECT payload FROM notification_outbox WHERE user_id = $1', [userId]);
    // By default only bill reminders are emailed, and those queue their own email.
    await insert(alice, lowBalance('low.1'));
    await insert(alice, reminder('rem.e', 'Netflix'));
    expect(await outbox(alice)).toEqual([]);

    await test.query(
      `INSERT INTO user_preferences (user_id, hide_balances, notif) VALUES
         ($1, false, '{"groups": {"balance": {"email": true}}}'),
         ($2, true, '{"groups": {"balance": {"email": true}, "system": {"email": true}}}')`,
      [alice, bob],
    );
    await insert(alice, lowBalance('low.2'));
    expect(await outbox(alice)).toEqual([
      {
        payload: {
          kind: 'notification',
          titleKey: 'notification_low_balance_title',
          bodyKey: 'notification_low_balance_body',
          params: { account: 'GoPay', balance: { amountMinor: '412000', currency: 'IDR' }, count: 2 },
          path: '/accounts',
        },
      },
    ]);
    // Inserting it again queues nothing more.
    await insert(alice, lowBalance('low.2'));
    expect(await outbox(alice)).toHaveLength(1);
    await insert(bob, lowBalance('low.3'));
    await insert(bob, { type: 'system', category: 'system', titleKey: 't', bodyKey: 'b', ref: 'sys.e' });
    expect(await outbox(bob)).toEqual([
      { payload: expect.objectContaining({ params: { account: 'GoPay', balance: null, count: 2 } }) as unknown },
      { payload: { kind: 'notification', titleKey: 't', bodyKey: 'b', params: {}, path: null } },
    ]);
  });

  it('defaults to the real clock', async () => {
    await seed(alice, reminder('rem.now', 'Now'), new Date().toISOString());
    expect((await asApp(() => createNotifications(test.db).counts(alice))).total).toBe(1);
  });
});

describe('notifications repository', () => {
  it('lists the last 30 days newest first with filters, search, and a cursor', async () => {
    const netflix = await seed(alice, reminder('rem.n', 'Netflix'), '2026-10-19T02:00:00Z');
    const spotify = await seed(alice, reminder('rem.s', 'Spotify Family'), '2026-10-18T02:00:00Z');
    const closed = await seed(
      alice,
      {
        type: 'period_closed',
        category: 'system',
        titleKey: 'notification_period_closed_title',
        bodyKey: 'notification_period_closed_body',
        params: { label: '2026-09' },
        ref: 'close.sep',
      },
      '2026-10-01T00:00:00Z',
    );
    // 20 Sep 23.00 WIB is outside the default range (21 Sep – 20 Okt); 21 Sep 00.30 WIB is inside.
    await seed(alice, reminder('rem.old', 'Old'), '2026-09-20T16:00:00Z');
    const edge = await seed(alice, reminder('rem.edge', 'Edge'), '2026-09-20T17:30:00Z');
    await seed(bob, reminder('rem.bob', 'Netflix'), '2026-10-19T02:00:00Z');
    await asApp(() => repo.markRead(alice, { ids: [spotify] }));

    const all = await asApp(() => repo.list(alice));
    expect(all.items.map((item) => item.id)).toEqual([netflix, spotify, closed, edge]);
    expect(all.nextCursor).toBeNull();
    expect(all.items[0]).toMatchObject({
      type: 'bill_reminder',
      category: 'budget_bills',
      titleKey: 'notification_bill_reminder_title',
      action: { href: '/subscriptions' },
      params: { name: 'Netflix', amountMinor: '186000' },
      readAt: null,
    });
    expect(all.items[1]?.readAt).toEqual(NOW);

    const ids = async (filter: Parameters<NotificationsRepository['list']>[1]) =>
      (await asApp(() => repo.list(alice, filter))).items.map((item) => item.id);
    expect(await ids({ filter: 'unread' })).toEqual([netflix, closed, edge]);
    expect(await ids({ filter: 'all', type: 'period_closed' })).toEqual([closed]);
    expect(await ids({ category: 'budget_bills', search: '  spotify   FAM ' })).toEqual([spotify]);
    expect(await ids({ search: 'amountMinor' })).toEqual([]);
    expect(await ids({ search: '100%' })).toEqual([]);
    expect(await ids({ from: '2026-10-18' as LocalDate, to: '2026-10-18' as LocalDate })).toEqual([spotify]);
    expect(await ids({ from: '2026-09-01' as LocalDate })).toHaveLength(5);

    const page1 = await asApp(() => repo.list(alice, { limit: 2 }));
    expect(page1.items.map((item) => item.id)).toEqual([netflix, spotify]);
    expect(page1.nextCursor).toBe(spotify);
    const page2 = await asApp(() => repo.list(alice, { limit: 2, before: page1.nextCursor as string }));
    expect(page2.items.map((item) => item.id)).toEqual([closed, edge]);
    expect(page2.nextCursor).toBeNull();
    expect(await ids({ limit: 0 })).toEqual([netflix]);
  });

  it('counts totals, unread per category, and per type', async () => {
    await seed(alice, reminder('rem.n', 'Netflix'), '2026-10-19T02:00:00Z');
    const read = await seed(alice, reminder('rem.s', 'Spotify'), '2026-10-18T02:00:00Z');
    await seed(
      alice,
      { type: 'system', category: 'system', titleKey: 't', bodyKey: 'b', ref: 'sys' },
      '2026-10-10T02:00:00Z',
    );
    await seed(alice, reminder('rem.old', 'Old'), '2026-08-01T02:00:00Z');
    await asApp(() => repo.markRead(alice, { ids: [read] }));

    const counts = await asApp(() => repo.counts(alice));
    expect(counts.total).toBe(3);
    expect(counts.unread).toBe(2);
    expect(counts.unreadByCategory).toEqual({ budget_bills: 1, system: 1 });
    expect(counts.byType.bill_reminder).toBe(2);
    expect(counts.byType.system).toBe(1);
    expect(counts.byType.low_balance).toBe(0);
    expect((await asApp(() => repo.counts(alice, { from: '2026-08-01' as LocalDate }))).total).toBe(4);
    expect((await asApp(() => repo.counts(bob))).total).toBe(0);

    // Kinds hidden in Settings › Notifikasi are neither counted nor listed.
    await test.query(
      `INSERT INTO user_preferences (user_id, notif) VALUES ($1, '{"groups": {"bills": {"inApp": false}}}')`,
      [alice],
    );
    expect(await asApp(() => repo.counts(alice))).toMatchObject({ total: 1, unread: 1 });
    expect((await asApp(() => repo.list(alice))).items.map((item) => item.type)).toEqual(['system']);
  });

  it('marks given, all, or one category read and touches only unread rows', async () => {
    const a = await seed(alice, reminder('rem.a', 'A'), '2026-10-19T02:00:00Z');
    await seed(alice, reminder('rem.b', 'B'), '2026-10-19T02:00:00Z');
    await seed(
      alice,
      { type: 'system', category: 'system', titleKey: 't', bodyKey: 'b', ref: 's' },
      '2026-10-19T02:00:00Z',
    );
    const bobs = await seed(bob, reminder('rem.x', 'X'), '2026-10-19T02:00:00Z');

    expect(await asApp(() => repo.markRead(alice, { ids: [] }))).toEqual({ updated: 0 });
    expect(await asApp(() => repo.markRead(alice, { ids: [a, bobs] }))).toEqual({ updated: 1 });
    expect(await asApp(() => repo.markRead(alice, { ids: [a] }))).toEqual({ updated: 0 });
    expect(await asApp(() => repo.markRead(alice, { all: true, category: 'system' }))).toEqual({ updated: 1 });
    expect(await asApp(() => repo.markRead(alice, { all: true }))).toEqual({ updated: 1 });
    expect((await asApp(() => repo.counts(alice))).unread).toBe(0);
    expect((await asApp(() => repo.counts(bob))).unread).toBe(1);
  });

  it('finds the next reminder still to fire', async () => {
    expect(await asApp(() => repo.nextReminder(alice))).toBeNull();
    const [account] = await test.query<{ id: string }>(
      `INSERT INTO accounts (user_id, type, provider_name, display_name, currency, opening_date, color)
       VALUES ($1, 'bank', 'BCA', 'BCA', 'IDR', '2026-01-01', 'blue') RETURNING id`,
      [alice],
    );
    const [sub] = await test.query<{ id: string }>(
      `INSERT INTO subscriptions (user_id, name, price_minor, currency, cycle, next_billing_date, pay_from_account_id, started_on)
       VALUES ($1, 'Netflix', 186000, 'IDR', 'monthly', '2026-10-25', $2, '2025-01-25') RETURNING id`,
      [alice, account?.id],
    );
    const [rec] = await test.query<{ id: string }>(
      `INSERT INTO recurrences (user_id, template, freq, start_on, month_day)
       VALUES ($1, '{"type":"expense","description":"Kos"}', 'monthly', '2026-01-28', 28) RETURNING id`,
      [alice],
    );
    const [bare] = await test.query<{ id: string }>(
      `INSERT INTO recurrences (user_id, template, freq, start_on, month_day)
       VALUES ($1, '{"type":"expense"}', 'monthly', '2026-01-28', 28) RETURNING id`,
      [alice],
    );
    const occurrence = async (
      type: string,
      sourceId: string | undefined,
      due: string,
      remindAt: string | null,
      extra = '',
    ) => {
      const [row] = await test.query<{ id: string }>(
        `INSERT INTO scheduled_occurrences (user_id, source_type, source_id, due_date, expected_minor, currency, remind_at ${extra === '' ? '' : ', reminded_at'})
         VALUES ($1, $2::occurrence_source, $3, $4, 186000, 'IDR', $5 ${extra === '' ? '' : `, '${extra}'`}) RETURNING id`,
        [alice, type, sourceId, due, remindAt],
      );
      return row?.id as string;
    };
    await occurrence('subscription', sub?.id, '2026-10-19', '2026-10-18T02:00:00Z'); // past
    await occurrence('subscription', sub?.id, '2026-10-21', '2026-10-20T02:30:00Z', '2026-10-20T02:30:00Z'); // sent
    await occurrence('subscription', sub?.id, '2026-11-25', null); // no reminder
    await occurrence('goal_plan', sub?.id, '2026-10-22', '2026-10-20T04:00:00Z');
    const kos = await occurrence('recurrence', rec?.id, '2026-10-28', '2026-10-27T02:00:00Z');
    const netflix = await occurrence('subscription', sub?.id, '2026-10-25', '2026-10-22T02:00:00Z');

    expect(await asApp(() => repo.nextReminder(alice))).toEqual({
      occurrenceId: netflix,
      sourceType: 'subscription',
      sourceId: sub?.id,
      name: 'Netflix',
      dueDate: '2026-10-25',
      remindAt: new Date('2026-10-22T02:00:00Z'),
      expectedMinor: 186_000n,
      currency: 'IDR',
    });
    await test.query(`UPDATE scheduled_occurrences SET status = 'skipped' WHERE id = $1`, [netflix]);
    expect(await asApp(() => repo.nextReminder(alice))).toMatchObject({ occurrenceId: kos, name: 'Kos' });
    await test.query(`UPDATE scheduled_occurrences SET status = 'skipped' WHERE id = $1`, [kos]);
    const unnamed = await occurrence('recurrence', bare?.id, '2026-10-28', '2026-10-27T02:00:00Z');
    expect(await asApp(() => repo.nextReminder(alice))).toMatchObject({ occurrenceId: unnamed, name: '' });
    expect(await asApp(() => repo.nextReminder(bob))).toBeNull();
  });
});

const changed = (patch: Partial<NotificationSettings>): NotificationSettings => ({
  ...DEFAULT_NOTIFICATION_SETTINGS,
  ...patch,
});

describe('createNotificationSettings', () => {
  /** 15 Okt 2026 10.00 WIB. */
  const AT = new Date('2026-10-15T03:00:00Z');
  const settingsRepo = () => createNotificationSettings(test.db, { now: () => AT });

  async function occurrence(due: string, remindAt: string | null, status = 'scheduled', reminded = false) {
    const [row] = await test.query<{ id: string }>(
      `INSERT INTO scheduled_occurrences (user_id, source_type, source_id, due_date, expected_minor, currency, status, remind_at, reminded_at)
       VALUES ($1, 'subscription', gen_random_uuid(), $2, 186000, 'IDR', $3::occurrence_status, $4, $5) RETURNING id`,
      [alice, due, status, remindAt, reminded ? remindAt : null],
    );
    return row?.id as string;
  }
  const remindAt = async (id: string) =>
    (await test.query<{ at: Date | null }>('SELECT remind_at AS at FROM scheduled_occurrences WHERE id = $1', [id]))[0]
      ?.at;

  it('reads the defaults before the first save, and saves every setting keeping other keys', async () => {
    expect(await asApp(() => settingsRepo().get(alice))).toEqual(DEFAULT_NOTIFICATION_SETTINGS);
    await test.query(`INSERT INTO user_preferences (user_id, notif) VALUES ($1, '{"other": 1}')`, [alice]);
    const settings = changed({
      email: false,
      groups: { ...DEFAULT_NOTIFICATION_SETTINGS.groups, detected: { inApp: false, email: true } },
    });
    expect(await asApp(() => settingsRepo().update(alice, settings))).toEqual({ settings, movedReminders: 0 });
    expect(await asApp(() => settingsRepo().get(alice))).toEqual(settings);
    const [stored] = await test.query<{ notif: Record<string, unknown> }>(
      'SELECT notif FROM user_preferences WHERE user_id = $1',
      [alice],
    );
    expect(stored?.notif).toMatchObject({ other: 1, email: false, reminderTime: '09:00' });
  });

  it('moves the reminders not sent yet to a new time on their day', async () => {
    const netflix = await occurrence('2026-10-18', '2026-10-17T02:00:00Z');
    const sent = await occurrence('2026-10-16', '2026-10-15T02:00:00Z', 'scheduled', true);
    const past = await occurrence('2026-10-16', '2026-10-15T01:00:00Z');
    const done = await occurrence('2026-10-25', '2026-10-24T02:00:00Z', 'skipped');
    const none = await occurrence('2026-10-26', null);
    // Today at 09.30 would already have passed at 10.00: that one keeps its time.
    const today = await occurrence('2026-10-16', '2026-10-15T03:30:00Z');
    const result = await asApp(() => settingsRepo().update(alice, changed({ reminderTime: '07:00' })));
    expect(result.movedReminders).toBe(1);
    expect(await remindAt(netflix)).toEqual(new Date('2026-10-17T00:00:00Z'));
    expect(await remindAt(today)).toEqual(new Date('2026-10-15T03:30:00Z'));
    expect(await remindAt(sent)).toEqual(new Date('2026-10-15T02:00:00Z'));
    expect(await remindAt(past)).toEqual(new Date('2026-10-15T01:00:00Z'));
    expect(await remindAt(done)).toEqual(new Date('2026-10-24T02:00:00Z'));
    expect(await remindAt(none)).toBeNull();
    // Saving the same time again moves nothing.
    expect((await asApp(() => settingsRepo().update(alice, changed({ reminderTime: '07:00' })))).movedReminders).toBe(
      0,
    );
  });

  it('uses the real clock by default', async () => {
    await expect(asApp(() => createNotificationSettings(test.db).get(alice))).resolves.toEqual(
      DEFAULT_NOTIFICATION_SETTINGS,
    );
    const later = await occurrence('2099-01-02', '2099-01-01T02:00:00Z');
    await asApp(() => createNotificationSettings(test.db).update(alice, changed({ reminderTime: '20:00' })));
    expect(await remindAt(later)).toEqual(new Date('2099-01-01T13:00:00Z'));
  });
});
