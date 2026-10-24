// SPDX-License-Identifier: AGPL-3.0-only
import { generateDek } from '@wf/crypto/envelope';
import { seedLedger } from '@wf/db/seed';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fakeDb, fakeDeps, fakePurgePort, type FakeDeps } from '../../test/fakes.ts';
import {
  insertUser,
  PGLITE_HOOK_TIMEOUT,
  startMigrated,
  type TestDatabase,
} from '../../../../packages/db/test/pglite.ts';
import { createAccountDeletionProcessor, DELETION_SCAN_LIMIT } from './account-deletion.ts';

const NOW = new Date('2026-10-19T03:40:00Z');
const USER = '0199f5d2-7c4e-7a3b-8c1d-2e3f4a5b6c7d';
const OTHER = '0199f5d2-7c4e-7a3b-8c1d-2e3f4a5b6c8e';
const job = (data: unknown) => ({ id: 'repeat:account-deletion-daily:1', data, attemptsMade: 0 });

describe('account-deletion processor (fakes)', () => {
  it('scans for due users, purges their blobs from both buckets before deleting each, and reports counts', async () => {
    const attachments = fakePurgePort();
    const avatars = fakePurgePort();
    const db = fakeDb();
    db.accountDeletion.due = async (...args) => {
      db.calls.push({ method: 'accountDeletion.due', args });
      return await Promise.resolve([USER, OTHER]);
    };
    db.accountDeletion.deleteUser = async (id: string) => {
      db.calls.push({ method: 'accountDeletion.deleteUser', args: [id] });
      return await Promise.resolve(id === USER);
    };
    const deps: FakeDeps = fakeDeps({ db, objects: { attachments, avatars } }, NOW);
    const process = createAccountDeletionProcessor(deps);
    expect(await process(job({}))).toEqual({ users: 2, deleted: 1, objects: 0 });
    expect(db.calls.map((call) => call.method)).toEqual([
      'accountDeletion.due',
      'accountDeletion.deleteUser',
      'accountDeletion.deleteUser',
    ]);
    expect(db.calls.at(0)?.args).toEqual([NOW, DELETION_SCAN_LIMIT]);
    // Blobs go before the database row, so a crash in between is repaired by the retry.
    expect(attachments.purged).toEqual([USER, OTHER]);
    expect(avatars.purged).toEqual([USER, OTHER]);
  });

  it('handles exactly the payload user on a retried job and never scans', async () => {
    const attachments = fakePurgePort();
    const avatars = fakePurgePort();
    const db = fakeDb();
    db.accountDeletion.deleteUser = async (id: string) => {
      db.calls.push({ method: 'accountDeletion.deleteUser', args: [id] });
      return await Promise.resolve(true);
    };
    const process = createAccountDeletionProcessor(fakeDeps({ db, objects: { attachments, avatars } }, NOW));
    expect(await process(job({ userId: USER }))).toEqual({ users: 1, deleted: 1, objects: 0 });
    expect(attachments.purged).toEqual([USER]);
    expect(avatars.purged).toEqual([USER]);
    expect(db.calls.map((call) => call.method)).toEqual(['accountDeletion.deleteUser']);
  });

  it('rejects a payload that is not a bare user id (or none), before touching anything', async () => {
    const db = fakeDb();
    const process = createAccountDeletionProcessor(fakeDeps({ db }, NOW));
    await expect(process(job({ userId: 'not-a-uuid' }))).rejects.toThrow(/uuid/i);
    await expect(process(job({ userId: USER, extra: 1 }))).rejects.toThrow(/Unrecognized key/);
    expect(db.calls).toEqual([]);
  });
});

describe('account-deletion processor (pglite)', { timeout: PGLITE_HOOK_TIMEOUT }, () => {
  let test: TestDatabase;

  beforeAll(async () => {
    test = await startMigrated();
  }, PGLITE_HOOK_TIMEOUT);

  afterAll(async () => {
    await test.close();
  });

  it('deletes a seeded user with every row they own, and purges the blob prefix of both buckets', async () => {
    const dek = generateDek();
    const userId = await insertUser(test, 'gone@example.test');
    await test.as('wf_app', () =>
      seedLedger(test.db, userId, { getDek: () => Promise.resolve(dek), now: () => new Date('2026-10-15T10:00:00Z') }),
    );
    // Some blob keys under the user's prefix, as the stores would hold them.
    await test.query(`INSERT INTO user_keys (user_id, dek_wrapped, kek_version) VALUES ($1, '\\x01', 1)`, [userId]);
    const count = async () => {
      const [row] = await test.query<{ n: string }>(`SELECT count(*)::int AS n FROM transactions WHERE user_id = $1`, [
        userId,
      ]);
      return Number(row?.n ?? 0);
    };
    expect(await count()).toBe(254);
    // Ten days ago: past the grace period by the server's clock.
    await test.query(`UPDATE users SET deletion_requested_at = now() - interval '10 days' WHERE id = $1`, [userId]);

    const attachments = fakePurgePort();
    const avatars = fakePurgePort();
    const { createAccountDeletion } = await import('@wf/db/account-deletion');
    const deletion = createAccountDeletion(test.db);
    const db = { ...fakeDb(), accountDeletion: { due: deletion.due, deleteUser: deletion.deleteUser } };
    const process = createAccountDeletionProcessor(fakeDeps({ db, objects: { attachments, avatars } }, new Date()));
    // Run as the worker role, exactly as production would (the fn is SECURITY DEFINER either way).
    const result = await test.as('wf_worker', () => process({ id: 'del', data: { userId }, attemptsMade: 0 }));
    expect(result).toEqual({ users: 1, deleted: 1, objects: 0 });
    expect(attachments.purged).toEqual([userId]);
    expect(avatars.purged).toEqual([userId]);
    expect(await count()).toBe(0);
    expect(await test.query(`SELECT count(*)::int AS n FROM users WHERE id = $1`, [userId])).toEqual([{ n: 0 }]);
    // The wrapped DEK row cascaded away: the user's ciphertext is crypto-shredded.
    expect(await test.query(`SELECT count(*)::int AS n FROM user_keys WHERE user_id = $1`, [userId])).toEqual([
      { n: 0 },
    ]);
    expect(await deletion.deleteUser(userId, new Date())).toBe(false);
    expect(await deletion.due(new Date(), 10)).toEqual([]);
  });
});
