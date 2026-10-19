// SPDX-License-Identifier: AGPL-3.0-only
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { insertUser, pgError, PGLITE_HOOK_TIMEOUT, startMigrated, type TestDatabase } from '../test/pglite.ts';
import { createRecentItems, RECENT_ITEMS_KEPT, type RecentItemsRepository } from './recent-items.ts';

let test: TestDatabase;
let recent: RecentItemsRepository;
let clock: number;
let alice: string;
let bob: string;

const asApp = <T>(fn: () => Promise<T>) => test.as('wf_app', fn);
const at = (minutes: number) => new Date(Date.UTC(2026, 9, 15, 8, minutes));

beforeAll(async () => {
  test = await startMigrated();
  recent = createRecentItems(test.db, { now: () => at(clock++) });
}, PGLITE_HOOK_TIMEOUT);

afterAll(async () => {
  await test.close();
});

beforeEach(async () => {
  clock = 0;
  await test.query('DELETE FROM users');
  alice = await insertUser(test, 'alice@example.test');
  bob = await insertUser(test, 'bob@example.test');
});

describe('recent items', () => {
  it('lists the newest first and moves a touched item to the top', async () => {
    await asApp(() => recent.touch(alice, 'page', '/transaksi'));
    await asApp(() => recent.touch(alice, 'account', 'acc-1'));
    await asApp(() => recent.touch(alice, 'page', '/transaksi'));
    expect(await asApp(() => recent.list(alice))).toEqual([
      { kind: 'page', ref: '/transaksi', openedAt: at(2) },
      { kind: 'account', ref: 'acc-1', openedAt: at(1) },
    ]);
    expect(await asApp(() => recent.list(alice, 1))).toEqual([{ kind: 'page', ref: '/transaksi', openedAt: at(2) }]);
  });

  it(`keeps only the newest ${RECENT_ITEMS_KEPT} per user`, async () => {
    await asApp(() => recent.touch(bob, 'page', '/bob'));
    for (let i = 0; i < RECENT_ITEMS_KEPT + 2; i++) await asApp(() => recent.touch(alice, 'tag', `tag-${i}`));
    const rows = await test.query<{ ref: string }>('SELECT ref FROM recent_items WHERE user_id = $1 ORDER BY ref', [
      alice,
    ]);
    expect(rows).toHaveLength(RECENT_ITEMS_KEPT);
    expect(rows.map((row) => row.ref)).not.toContain('tag-0');
    expect(rows.map((row) => row.ref)).not.toContain('tag-1');
    expect(await asApp(() => recent.list(alice, 100))).toHaveLength(RECENT_ITEMS_KEPT);
    // Another user's items are neither listed nor trimmed.
    expect(await asApp(() => recent.list(bob))).toEqual([{ kind: 'page', ref: '/bob', openedAt: at(0) }]);
  });

  it('uses the current time by default and rejects an empty ref', async () => {
    const live = createRecentItems(test.db);
    const before = Date.now();
    await asApp(() => live.touch(alice, 'goal', 'g-1'));
    const [item] = await asApp(() => live.list(alice));
    expect(item?.openedAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
    await expect(asApp(() => live.touch(alice, 'page', ''))).rejects.toMatchObject(pgError(/recent_items_ref_check/));
  });

  it('is not writable by the worker', async () => {
    await expect(test.as('wf_worker', () => recent.touch(alice, 'page', '/x'))).rejects.toMatchObject(
      pgError(/permission denied/),
    );
  });
});
