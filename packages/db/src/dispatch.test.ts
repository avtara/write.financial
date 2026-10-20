// SPDX-License-Identifier: AGPL-3.0-only
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { insertUser, pgError, PGLITE_HOOK_TIMEOUT, startMigrated, type TestDatabase } from '../test/pglite.ts';
import { createDispatch, type Dispatch } from './dispatch.ts';

let test: TestDatabase;
let dispatch: Dispatch;
let ayu: string;
let budi: string;

/** 18 Okt 2026, 09.30 WIB. */
const NOW = new Date('2026-10-18T02:30:00Z');

const asWorker = <T>(fn: () => Promise<T>) => test.as('wf_worker', fn);

async function one(text: string, params: unknown[]): Promise<string> {
  const [row] = await test.query<{ id: string }>(text, params);
  return row?.id as string;
}

/** A Netflix subscription of `userId` paid from a fresh account. */
async function subscription(userId: string): Promise<string> {
  const account = await one(
    `INSERT INTO accounts (user_id, type, provider_name, display_name, currency, opening_date, color)
     VALUES ($1, 'bank', 'BCA', 'BCA', 'IDR', '2026-01-01', 'blue') RETURNING id`,
    [userId],
  );
  return one(
    `INSERT INTO subscriptions (user_id, name, price_minor, currency, cycle, next_billing_date, pay_from_account_id, started_on)
     VALUES ($1, 'Netflix', 186000, 'IDR', 'monthly', '2026-10-18', $2, '2025-01-18') RETURNING id`,
    [userId, account],
  );
}

/** An occurrence due on `due` with its reminder at `remindAt` (`null` = none). */
const occurrence = (
  userId: string,
  sourceId: string,
  due: string,
  remindAt: string | null,
  extra: { status?: string; remindedAt?: string } = {},
) =>
  one(
    `INSERT INTO scheduled_occurrences (user_id, source_type, source_id, due_date, expected_minor, currency, status, remind_at, reminded_at)
     VALUES ($1, 'subscription', $2, $3, 186000, 'IDR', $4::occurrence_status, $5, $6) RETURNING id`,
    [userId, sourceId, due, extra.status ?? 'scheduled', remindAt, extra.remindedAt ?? null],
  );

/** A notification of `userId` with one email row due at `sendAt`. */
async function email(
  userId: string,
  ref: string,
  sendAt: string,
  extra: { attempts?: number; sentAt?: string } = {},
): Promise<string> {
  const notification = await one(
    `INSERT INTO notifications (user_id, type, category, title_key, body_key, ref)
     VALUES ($1, 'bill_reminder', 'budget_bills', 't', 'b', $2) RETURNING id`,
    [userId, ref],
  );
  return one(
    `INSERT INTO notification_outbox (user_id, notification_id, payload, send_at, attempts, sent_at)
     VALUES ($1, $2, '{}', $3, $4, $5) RETURNING id`,
    [userId, notification, sendAt, extra.attempts ?? 0, extra.sentAt ?? null],
  );
}

beforeAll(async () => {
  test = await startMigrated();
  dispatch = createDispatch(test.db);
}, PGLITE_HOOK_TIMEOUT);

afterAll(async () => {
  await test.close();
});

beforeEach(async () => {
  await test.query('DELETE FROM users');
  ayu = await insertUser(test, 'ayu@example.test');
  budi = await insertUser(test, 'budi@example.test');
  await test.query(`UPDATE users SET timezone = 'Europe/London' WHERE id = $1`, [budi]);
});

describe('users', () => {
  it('lists every user not scheduled for deletion with their time zone, by id', async () => {
    const leaving = await insertUser(test, 'leaving@example.test');
    await test.query('UPDATE users SET deletion_requested_at = now() WHERE id = $1', [leaving]);
    expect(await asWorker(() => dispatch.users())).toEqual(
      [
        { userId: ayu, timeZone: 'Asia/Jakarta' },
        { userId: budi, timeZone: 'Europe/London' },
      ].sort((a, b) => (a.userId < b.userId ? -1 : 1)),
    );
  });
});

describe('dueReminders', () => {
  it("finds every user's due, unsent reminders oldest first, up to the limit", async () => {
    const ayuSub = await subscription(ayu);
    const budiSub = await subscription(budi);
    const ayuDue = await occurrence(ayu, ayuSub, '2026-10-18', '2026-10-17T02:00:00Z');
    const budiDue = await occurrence(budi, budiSub, '2026-10-19', '2026-10-18T02:30:00Z', { status: 'due_review' });
    await occurrence(ayu, ayuSub, '2026-10-20', '2026-10-19T02:00:00Z');
    await occurrence(ayu, ayuSub, '2026-10-17', '2026-10-16T02:00:00Z', { remindedAt: '2026-10-16T02:00:00Z' });
    await occurrence(budi, budiSub, '2026-10-15', '2026-10-14T08:00:00Z', { status: 'unconfirmed' });
    await occurrence(budi, budiSub, '2026-10-18', null);

    expect(await asWorker(() => dispatch.dueReminders(NOW, 10))).toEqual([
      { userId: ayu, occurrenceId: ayuDue },
      { userId: budi, occurrenceId: budiDue },
    ]);
    expect(await asWorker(() => dispatch.dueReminders(NOW, 1))).toEqual([{ userId: ayu, occurrenceId: ayuDue }]);
    expect(await asWorker(() => dispatch.dueReminders(new Date('2026-10-17T01:59:59Z'), 10))).toEqual([]);
  });

  it('is the only way the worker sees occurrences without a user scope', async () => {
    const ayuSub = await subscription(ayu);
    await occurrence(ayu, ayuSub, '2026-10-18', '2026-10-17T02:00:00Z');
    expect(await asWorker(() => test.query('SELECT id FROM scheduled_occurrences'))).toEqual([]);
    expect(await asWorker(() => dispatch.dueReminders(NOW, 10))).toHaveLength(1);
  });
});

describe('pendingOutbox', () => {
  it("finds every user's due, unsent emails with fewer than 5 attempts oldest first, up to the limit", async () => {
    const first = await email(ayu, 'a1', '2026-10-17T02:00:00Z');
    const second = await email(budi, 'b1', '2026-10-18T02:00:00Z', { attempts: 4 });
    await email(ayu, 'a2', '2026-10-17T01:00:00Z', { attempts: 5 });
    await email(ayu, 'a3', '2026-10-16T02:00:00Z', { sentAt: '2026-10-16T02:00:05Z' });
    await email(budi, 'b2', '2026-10-18T02:31:00Z');

    expect(await asWorker(() => dispatch.pendingOutbox(NOW, 10))).toEqual([
      { userId: ayu, outboxId: first },
      { userId: budi, outboxId: second },
    ]);
    expect(await asWorker(() => dispatch.pendingOutbox(NOW, 1))).toEqual([{ userId: ayu, outboxId: first }]);
    expect(await asWorker(() => test.query('SELECT id FROM notification_outbox'))).toEqual([]);
  });
});

describe('permissions', () => {
  it.each(['wf_app', 'wf_auth', 'wf_readonly_ops'] as const)('runs for wf_worker only, not %s', async (role) => {
    await expect(test.as(role, () => dispatch.users())).rejects.toMatchObject(
      pgError(/permission denied for function wf_worker_users/),
    );
    await expect(test.as(role, () => dispatch.dueReminders(NOW, 1))).rejects.toMatchObject(
      pgError(/permission denied for function wf_due_reminders/),
    );
    await expect(test.as(role, () => dispatch.pendingOutbox(NOW, 1))).rejects.toMatchObject(
      pgError(/permission denied for function wf_pending_outbox/),
    );
  });
});
