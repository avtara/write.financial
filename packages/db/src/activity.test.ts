// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { insertUser, pgError, PGLITE_HOOK_TIMEOUT, startMigrated, type TestDatabase } from '../test/pglite.ts';
import { createActivity, logActivity } from './activity.ts';
import { withUser } from './db.ts';

let test: TestDatabase;
let alice: string;
let bob: string;

beforeAll(async () => {
  test = await startMigrated();
}, PGLITE_HOOK_TIMEOUT);

afterAll(async () => {
  await test.close();
});

beforeEach(async () => {
  await test.query('DELETE FROM users');
  alice = await insertUser(test, 'alice@example.test');
  bob = await insertUser(test, 'bob@example.test');
});

describe('activity', () => {
  it('appends entries per entity and lists them oldest first, per user', async () => {
    const entity = randomUUID();
    const other = randomUUID();
    await test.as('wf_app', async () => {
      await withUser(test.db, alice, async (tx) => {
        await logActivity(tx, alice, 'transaction', [], 'created');
        await logActivity(tx, alice, 'transaction', [entity, other], 'created', { source: 'quick' });
      });
      await withUser(test.db, alice, (tx) => logActivity(tx, alice, 'transaction', [entity], 'deleted'));
    });
    const activity = createActivity(test.db);
    const entries = await test.as('wf_app', () => activity.list(alice, 'transaction', entity));
    expect(entries.map(({ action, meta }) => ({ action, meta }))).toEqual([
      { action: 'created', meta: { source: 'quick' } },
      { action: 'deleted', meta: {} },
    ]);
    expect(entries[0]?.at).toBeInstanceOf(Date);
    expect(await test.as('wf_app', () => activity.list(bob, 'transaction', entity))).toEqual([]);
    expect(await test.as('wf_app', () => activity.list(alice, 'account', entity))).toEqual([]);
  });

  it('is append-only for the app and closed to the worker', async () => {
    await test.as('wf_app', () => withUser(test.db, alice, (tx) => logActivity(tx, alice, 'tag', [alice], 'merged')));
    await expect(
      test.as('wf_app', () => withUser(test.db, alice, (tx) => tx.execute('DELETE FROM activity_log'))),
    ).rejects.toMatchObject(pgError(/permission denied/));
    await expect(test.as('wf_worker', () => createActivity(test.db).list(alice, 'tag', alice))).rejects.toMatchObject(
      pgError(/permission denied/),
    );
  });
});
