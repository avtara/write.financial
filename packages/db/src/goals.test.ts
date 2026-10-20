// SPDX-License-Identifier: AGPL-3.0-only
import type { YearMonth } from '@wf/domain/period';
import { DESIGN_SEED } from '@wf/domain/seed';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { insertUser, pgError, PGLITE_HOOK_TIMEOUT, startMigrated, type TestDatabase } from '../test/pglite.ts';
import { createGoals, type GoalInput, type GoalsRepository } from './goals.ts';

let test: TestDatabase;
let repo: GoalsRepository;
let alice: string;
let bob: string;

beforeAll(async () => {
  test = await startMigrated();
  repo = createGoals(test.db);
}, PGLITE_HOOK_TIMEOUT);

afterAll(async () => {
  await test.close();
});

beforeEach(async () => {
  await test.query('DELETE FROM users');
  alice = await insertUser(test, 'alice@example.test');
  bob = await insertUser(test, 'bob@example.test');
});

const asApp = <T>(fn: () => Promise<T>) => test.as('wf_app', fn);

const SEED_GOALS: GoalInput[] = DESIGN_SEED.goals.map((goal) => ({
  ...goal,
  deadlineMonth: goal.deadlineMonth as YearMonth | null,
}));

const input = (overrides: Partial<GoalInput> = {}): GoalInput => ({ ...(SEED_GOALS[0] as GoalInput), ...overrides });

describe('goals', () => {
  it('creates the seed goals in order with their tags', async () => {
    for (const goal of SEED_GOALS) await asApp(() => repo.create(alice, goal));
    const goals = await asApp(() => repo.list(alice));
    expect(
      goals.map(({ name, targetMinor, currency, deadlineMonth, tag, sortOrder, archivedAt }) => ({
        name,
        targetMinor,
        currency,
        deadlineMonth,
        tag,
        sortOrder,
        archivedAt,
      })),
    ).toEqual(
      SEED_GOALS.map((goal, index) => ({
        name: goal.name,
        targetMinor: goal.targetMinor,
        currency: goal.currency,
        deadlineMonth: goal.deadlineMonth,
        tag: goal.tag,
        sortOrder: index,
        archivedAt: null,
      })),
    );
    expect(await test.query("SELECT deadline_month::text FROM goals WHERE name = 'Dana Darurat'")).toEqual([
      { deadline_month: '2027-11-01' },
    ]);
    expect(await asApp(() => repo.list(bob))).toEqual([]);
  });

  it('trims the name, normalizes the tag, and works without a tag', async () => {
    const tagged = await asApp(() => repo.create(alice, input({ name: '  Umroh  ', tag: '#Dana Umroh' })));
    expect(tagged).toMatchObject({ name: 'Umroh', tag: 'dana-umroh', icon: 'shield', color: 'green', sortOrder: 0 });
    expect(tagged.id).toEqual(expect.any(String));
    const untagged = await asApp(() => repo.create(alice, input({ name: 'Laptop', tag: null, deadlineMonth: null })));
    expect(untagged).toMatchObject({ tag: null, deadlineMonth: null, sortOrder: 1 });
    await asApp(() => repo.create(alice, input({ name: 'Umroh 2', tag: 'dana-umroh' })));
    expect(await test.query('SELECT slug FROM tags')).toEqual([{ slug: 'dana-umroh' }]);
  });

  it.each<[string, Partial<GoalInput>]>([
    ['an empty name', { name: '   ' }],
    ['a long name', { name: 'x'.repeat(41) }],
    ['a zero target', { targetMinor: 0n }],
    ['a currency', { currency: 'idr' }],
    ['a deadline', { deadlineMonth: '2027-13' as YearMonth }],
  ])('rejects %s', async (_, overrides) => {
    await expect(asApp(() => repo.create(alice, input(overrides)))).rejects.toMatchObject({ code: 'INVALID_GOAL' });
  });

  it('rejects a tag without letters or digits', async () => {
    await expect(asApp(() => repo.create(alice, input({ tag: '#' })))).rejects.toMatchObject({ code: 'INVALID_TAG' });
  });

  it('keeps the "Simpan di" account: only an active account of the user', async () => {
    const account = async (userId: string, status: 'active' | 'archived') =>
      (
        await test.query<{ id: string }>(
          `INSERT INTO accounts (user_id, type, provider_name, display_name, currency, opening_date, color, status,
             archived_at)
           VALUES ($1, 'bank', 'Bank Jago', 'Bank Jago', 'IDR', '2026-10-15', 'orange', $2::account_status,
             CASE WHEN $2::account_status = 'archived' THEN now() END) RETURNING id`,
          [userId, status],
        )
      )[0]?.id ?? '';
    const jago = await account(alice, 'active');
    expect(await asApp(() => repo.create(alice, input({ accountId: jago })))).toMatchObject({ accountId: jago });
    expect(await asApp(() => repo.create(alice, input({ name: 'Laptop', tag: null })))).toMatchObject({
      accountId: null,
    });
    for (const other of [await account(bob, 'active'), await account(alice, 'archived')]) {
      await expect(asApp(() => repo.create(alice, input({ accountId: other })))).rejects.toMatchObject({
        code: 'INVALID_GOAL',
      });
    }
  });

  it('cannot be written by the worker', async () => {
    await expect(test.as('wf_worker', () => repo.create(alice, input({ tag: null })))).rejects.toMatchObject(
      pgError(/permission denied/),
    );
  });
});
