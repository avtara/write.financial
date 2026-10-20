// SPDX-License-Identifier: AGPL-3.0-only
import { parseLocalDate } from '@wf/domain/period';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { insertUser, pgError, PGLITE_HOOK_TIMEOUT, startMigrated, type TestDatabase } from '../test/pglite.ts';
import { withUser } from './db.ts';
import { createOutbox, deliveryPreferencesIn, insertOutboxIn, type Outbox, type OutboxPayload } from './outbox.ts';

let test: TestDatabase;
let outbox: Outbox;
let ayu: string;
let budi: string;

/** 17 Okt 2026, 09.00 WIB. */
const NOW = new Date('2026-10-17T02:00:00Z');

const PAYLOAD: OutboxPayload = {
  kind: 'bill_reminder',
  name: 'Netflix',
  dueDate: parseLocalDate('2026-10-18'),
  amount: { amountMinor: '186000', currency: 'IDR' },
  path: '/subscriptions',
};

const asWorker = <T>(fn: () => Promise<T>) => test.as('wf_worker', fn);

async function notification(userId: string, ref: string): Promise<string> {
  const [row] = await test.query<{ id: string }>(
    `INSERT INTO notifications (user_id, type, category, title_key, body_key, ref)
     VALUES ($1, 'bill_reminder', 'budget_bills', 't', 'b', $2) RETURNING id`,
    [userId, ref],
  );
  return row?.id as string;
}

/** Queues `PAYLOAD` for a new notification of `userId` as the worker; returns the outbox id. */
async function queued(userId: string, ref = 'rem.1'): Promise<string> {
  const notificationId = await notification(userId, ref);
  expect(
    await asWorker(() => withUser(test.db, userId, (tx) => insertOutboxIn(tx, userId, notificationId, PAYLOAD, NOW))),
  ).toBe(true);
  const [row] = await test.query<{ id: string }>('SELECT id FROM notification_outbox WHERE notification_id = $1', [
    notificationId,
  ]);
  return row?.id as string;
}

const stored = async (id: string) =>
  (
    await test.query<{ sent_at: Date | null; attempts: number; last_error: string | null }>(
      'SELECT sent_at, attempts, last_error FROM notification_outbox WHERE id = $1',
      [id],
    )
  )[0];

beforeAll(async () => {
  test = await startMigrated();
  outbox = createOutbox(test.db);
}, PGLITE_HOOK_TIMEOUT);

afterAll(async () => {
  await test.close();
});

beforeEach(async () => {
  await test.query('DELETE FROM users');
  await test.query(`UPDATE instance_settings SET instance_name = 'write.financial'`);
  ayu = await insertUser(test, 'ayu@example.test');
  budi = await insertUser(test, 'budi@example.test');
});

describe('insertOutboxIn', () => {
  it('queues one email per notification, due at the given time', async () => {
    const notificationId = await notification(ayu, 'rem.1');
    const insert = () =>
      asWorker(() => withUser(test.db, ayu, (tx) => insertOutboxIn(tx, ayu, notificationId, PAYLOAD, NOW)));
    expect(await insert()).toBe(true);
    expect(await insert()).toBe(false);
    expect(
      await test.query('SELECT channel::text, payload, send_at, attempts FROM notification_outbox WHERE user_id = $1', [
        ayu,
      ]),
    ).toEqual([{ channel: 'email', payload: PAYLOAD, send_at: NOW, attempts: 0 }]);
  });
});

describe('deliveryPreferencesIn', () => {
  const preferencesOf = (userId: string) =>
    asWorker(() => withUser(test.db, userId, (tx) => deliveryPreferencesIn(tx, userId)));

  it('defaults to email with amounts when the user has no preferences row', async () => {
    expect(await preferencesOf(ayu)).toEqual({ email: true, hideBalances: false });
  });

  it('follows notif.email and privacy mode', async () => {
    await test.query(
      `INSERT INTO user_preferences (user_id, hide_balances, notif) VALUES ($1, true, '{"email": false}'), ($2, false, '{"email": true}')`,
      [ayu, budi],
    );
    expect(await preferencesOf(ayu)).toEqual({ email: false, hideBalances: true });
    expect(await preferencesOf(budi)).toEqual({ email: true, hideBalances: false });
  });
});

describe('get', () => {
  it('returns the recipient, locale, instance name, and payload', async () => {
    const id = await queued(ayu);
    await test.query(`UPDATE users SET name = 'Ayu Lestari', nickname = 'Ayu', locale = 'en' WHERE id = $1`, [ayu]);
    await test.query(`UPDATE instance_settings SET instance_name = 'Uang Keluarga'`);
    expect(await asWorker(() => outbox.get(ayu, id))).toEqual({
      to: 'ayu@example.test',
      locale: 'en',
      recipientName: 'Ayu',
      instanceName: 'Uang Keluarga',
      payload: PAYLOAD,
      sentAt: null,
    });
  });

  it('falls back to the name and the product name', async () => {
    const id = await queued(budi);
    await test.query('DELETE FROM instance_settings');
    try {
      expect(await asWorker(() => outbox.get(budi, id))).toMatchObject({
        recipientName: 'budi@example.test',
        locale: 'id',
        instanceName: 'write.financial',
      });
    } finally {
      await test.query('INSERT INTO instance_settings DEFAULT VALUES');
    }
  });

  it("returns null for another user's row or a purged one", async () => {
    const id = await queued(ayu);
    expect(await asWorker(() => outbox.get(budi, id))).toBeNull();
    await test.query('DELETE FROM notifications WHERE user_id = $1', [ayu]);
    expect(await asWorker(() => outbox.get(ayu, id))).toBeNull();
  });
});

describe('markSent', () => {
  it('marks a row delivered once', async () => {
    const id = await queued(ayu);
    const sentAt = new Date('2026-10-17T02:00:05Z');
    expect(await asWorker(() => outbox.markSent(ayu, id, sentAt))).toBe(true);
    expect(await asWorker(() => outbox.markSent(ayu, id, new Date('2026-10-17T02:01:00Z')))).toBe(false);
    expect((await asWorker(() => outbox.get(ayu, id)))?.sentAt).toEqual(sentAt);
  });

  it("cannot mark another user's row", async () => {
    const id = await queued(ayu);
    expect(await asWorker(() => outbox.markSent(budi, id, NOW))).toBe(false);
    expect((await stored(id))?.sent_at).toBeNull();
  });
});

describe('markFailed', () => {
  it('counts attempts and keeps the latest error, truncated to 500 characters', async () => {
    const id = await queued(ayu);
    await asWorker(() => outbox.markFailed(ayu, id, 'connect ECONNREFUSED'));
    expect(await stored(id)).toEqual({ sent_at: null, attempts: 1, last_error: 'connect ECONNREFUSED' });
    await asWorker(() => outbox.markFailed(ayu, id, 'x'.repeat(600)));
    expect(await stored(id)).toEqual({ sent_at: null, attempts: 2, last_error: 'x'.repeat(500) });
  });

  it("leaves another user's row alone", async () => {
    const id = await queued(ayu);
    await asWorker(() => outbox.markFailed(budi, id, 'boom'));
    expect(await stored(id)).toEqual({ sent_at: null, attempts: 0, last_error: null });
  });
});

describe('permissions', () => {
  it('gives wf_app no access to the outbox', async () => {
    const id = await queued(ayu);
    await expect(test.as('wf_app', () => outbox.get(ayu, id))).rejects.toMatchObject(
      pgError(/permission denied for table notification_outbox/),
    );
  });
});
