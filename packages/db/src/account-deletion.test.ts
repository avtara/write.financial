// SPDX-License-Identifier: AGPL-3.0-only
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { insertUser, PGLITE_HOOK_TIMEOUT, pgError, startMigrated, type TestDatabase } from '../test/pglite.ts';
import { createAccountDeletion, GRACE_DAYS } from './account-deletion.ts';

let test: TestDatabase;
let userId: string;

const DAY = 24 * 60 * 60 * 1000;
/** Five days ago: a request "then" is still within the 7-day grace period now. */
const FIVE_DAYS_AGO = () => new Date(Date.now() - 5 * DAY);
/** Nine days ago: past the fn's `LEAST(p_now, now())` clock, since the grace period is over by the real clock. */
const NINE_DAYS_AGO = () => new Date(Date.now() - 9 * DAY);
const graceEnds = (requestedAt: Date) => new Date(requestedAt.getTime() + GRACE_DAYS * DAY);

/** A small ledger for the user: one account, one transaction with its posting, one session, and their DEK. */
async function seedRows(id: string): Promise<void> {
  await test.query(
    `INSERT INTO accounts (user_id, type, provider_name, display_name, currency, opening_balance_minor, opening_date, color)
     VALUES ($1, 'bank', 'BCA', 'Rekening', 'IDR', 1000, '2026-10-01', 'blue')`,
    [id],
  );
  await test.query(
    `INSERT INTO transactions (user_id, type, occurred_at, local_date, client_id, confirmed_by_user_at)
     VALUES ($1, 'expense', '2026-10-05T05:00:00Z', '2026-10-05', gen_random_uuid(), '2026-10-05T05:00:00Z')`,
    [id],
  );
  await test.query(
    `INSERT INTO postings (user_id, transaction_id, account_id, amount_minor, currency, amount_base_minor)
     SELECT $1, t.id, a.id, -25000, 'IDR', -25000 FROM transactions t, accounts a
     WHERE t.user_id = $1 AND a.user_id = $1 LIMIT 1`,
    [id],
  );
  await test.query(`INSERT INTO sessions (user_id, expires_at, token) VALUES ($1, '2027-01-01', 'tok')`, [id]);
  await test.query(`INSERT INTO user_keys (user_id, dek_wrapped, kek_version) VALUES ($1, '\\x01', 1)`, [id]);
}

const ownedRows = async (id: string) => {
  const [row] = await test.query<{ n: string }>(
    `SELECT (SELECT count(*) FROM accounts WHERE user_id = $1)
          + (SELECT count(*) FROM transactions WHERE user_id = $1)
          + (SELECT count(*) FROM postings WHERE user_id = $1)
          + (SELECT count(*) FROM sessions WHERE user_id = $1)
          + (SELECT count(*) FROM user_keys WHERE user_id = $1) AS n`,
    [id],
  );
  return Number(row?.n ?? 0);
};

beforeAll(async () => {
  test = await startMigrated();
}, PGLITE_HOOK_TIMEOUT);

afterAll(async () => {
  await test.close();
});

beforeEach(async () => {
  await test.query('DELETE FROM users');
  userId = await insertUser(test, 'leaving@example.test');
});

describe('request and cancel', { timeout: PGLITE_HOOK_TIMEOUT }, () => {
  it('sets the request timestamp as the user (wf_app RLS) and returns when the grace period ends', async () => {
    const deletion = createAccountDeletion(test.db);
    const requestedAt = FIVE_DAYS_AGO();
    const deleteAfter = await test.as('wf_app', () => deletion.request(userId, requestedAt));
    expect(deleteAfter).toEqual(graceEnds(requestedAt));
    expect(await test.query(`SELECT deletion_requested_at FROM users WHERE id = $1`, [userId])).toEqual([
      { deletion_requested_at: requestedAt },
    ]);
    // Re-requesting during the grace period keeps the original date (no extension, no restart).
    const again = await test.as('wf_app', () => deletion.request(userId, new Date(requestedAt.getTime() + 60_000)));
    expect(again).toEqual(deleteAfter);
    expect(await test.query(`SELECT deletion_requested_at FROM users WHERE id = $1`, [userId])).toEqual([
      { deletion_requested_at: requestedAt },
    ]);
  });

  it('refuses to report a grace period for a user that does not exist', async () => {
    const deletion = createAccountDeletion(test.db);
    const ghost = crypto.randomUUID();
    await expect(test.as('wf_app', () => deletion.request(ghost, FIVE_DAYS_AGO()))).rejects.toThrow(
      `user ${ghost} not found`,
    );
  });

  it('cancels a pending request and says whether one was pending at all', async () => {
    const deletion = createAccountDeletion(test.db);
    await test.as('wf_app', async () => {
      expect(await deletion.cancel(userId)).toBe(false);
    });
    await test.as('wf_app', () => deletion.request(userId, FIVE_DAYS_AGO()));
    await test.as('wf_app', async () => {
      expect(await deletion.cancel(userId)).toBe(true);
    });
    expect(await test.query(`SELECT deletion_requested_at FROM users WHERE id = $1`, [userId])).toEqual([
      { deletion_requested_at: null },
    ]);
  });
});

describe('the worker side', { timeout: PGLITE_HOOK_TIMEOUT }, () => {
  it('refuses wf_app and wf_worker the direct paths: no DELETE grant on users, no EXECUTE without the grant', async () => {
    await test.query(`UPDATE users SET deletion_requested_at = '2020-01-01' WHERE id = $1`, [userId]);
    await expect(
      test.as('wf_worker', () => test.db.execute(`delete from users where id = '${userId}'`)),
    ).rejects.toMatchObject(pgError(/permission denied for table users/));
    await expect(
      test.as('wf_app', () => test.db.execute(`select wf_account_delete_user('${userId}', now())`)),
    ).rejects.toMatchObject(pgError(/permission denied for function wf_account_delete_user/));
    await expect(
      test.as('wf_app', () => test.db.execute(`select * from wf_due_deletions(now(), 10)`)),
    ).rejects.toMatchObject(pgError(/permission denied for function wf_due_deletions/));
    expect(await test.query(`SELECT count(*)::int AS n FROM users`)).toEqual([{ n: 1 }]);
  });

  it('scans only users whose grace period has passed, capped, oldest request first', async () => {
    const deletion = createAccountDeletion(test.db);
    // A user still within the grace period is never due (a future p_now is no shortcut: the fn caps it at the
    // server's clock).
    await test.as('wf_app', () => deletion.request(userId, FIVE_DAYS_AGO()));
    const second = await insertUser(test, 'leaving-earlier@example.test');
    await test.as('wf_app', () => deletion.request(second, new Date(Date.now() - 10 * DAY)));
    const third = await insertUser(test, 'leaving-last-month@example.test');
    await test.as('wf_app', () => deletion.request(third, new Date(Date.now() - 9 * DAY)));
    expect(await test.as('wf_worker', () => deletion.due(FIVE_DAYS_AGO(), 10))).toEqual([]);
    const dueAt = new Date();
    expect(await test.as('wf_worker', () => deletion.due(dueAt, 10))).toEqual([second, third]);
    expect(await test.as('wf_worker', () => deletion.due(dueAt, 1))).toEqual([second]);
  });

  it('deletes the user with everything they own through the SECURITY DEFINER function, and nothing before due', async () => {
    const deletion = createAccountDeletion(test.db);
    await seedRows(userId);
    await test.as('wf_app', () => deletion.request(userId, NINE_DAYS_AGO()));
    expect(await ownedRows(userId)).toBe(5);
    // A user still in their grace period is not touched, so a retried early job is a harmless no-op.
    const early = await insertUser(test, 'leaving-soon@example.test');
    await test.as('wf_app', () => deletion.request(early, FIVE_DAYS_AGO()));
    expect(await test.as('wf_worker', () => deletion.deleteUser(early, new Date()))).toBe(false);
    expect(await ownedRows(early)).toBe(0);
    expect(await test.as('wf_worker', () => deletion.deleteUser(userId, new Date()))).toBe(true);
    expect(await test.query(`SELECT count(*)::int AS n FROM users WHERE id = $1`, [userId])).toEqual([{ n: 0 }]);
    expect(await ownedRows(userId)).toBe(0);
    // The wrapped DEK row went with the cascade: every `_enc` column of this user is now unreadable forever.
    expect(await test.query(`SELECT count(*)::int AS n FROM user_keys WHERE user_id = $1`, [userId])).toEqual([
      { n: 0 },
    ]);
    // Idempotent: a second run (a retried job) finds no user and deletes nothing.
    expect(await test.as('wf_worker', () => deletion.deleteUser(userId, new Date()))).toBe(false);
  });

  it('deletes the security events with their user (the append-only table allows the user cascade only)', async () => {
    const deletion = createAccountDeletion(test.db);
    await test.query(
      `INSERT INTO security_events (user_id, type, ip_hash, user_agent, meta) VALUES ($1, 'sign_in', null, 'ua', '{}')`,
      [userId],
    );
    await test.query(`UPDATE users SET deletion_requested_at = '2020-01-01' WHERE id = $1`, [userId]);
    expect(await test.as('wf_worker', () => deletion.deleteUser(userId, new Date()))).toBe(true);
    expect(await test.query(`SELECT count(*)::int AS n FROM security_events WHERE user_id = $1`, [userId])).toEqual([
      { n: 0 },
    ]);
  });
});
