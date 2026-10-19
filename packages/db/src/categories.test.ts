// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from 'node:crypto';
import { BUILT_IN_CATEGORIES, type BuiltInCategoryKey } from '@wf/domain/categories';
import { parseLocalDate } from '@wf/domain/period';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { insertUser, pgError, PGLITE_HOOK_TIMEOUT, startMigrated, type TestDatabase } from '../test/pglite.ts';
import { createAccounts } from './accounts.ts';
import { createActivity } from './activity.ts';
import { createCategories, type CategoriesRepository, type CategoryInput, type CategoryView } from './categories.ts';
import { withUser } from './db.ts';
import { builtInCategoryIn, recordTransactionIn, type TransactionDraft } from './ledger-core.ts';

const NOW = new Date('2026-10-15T10:00:00+07:00');

let test: TestDatabase;
let repo: CategoriesRepository;
let alice: string;
let bob: string;
let bca: string;
let jago: string;

beforeAll(async () => {
  test = await startMigrated();
  repo = createCategories(test.db);
}, PGLITE_HOOK_TIMEOUT);

afterAll(async () => {
  await test.close();
});

const asApp = <T>(fn: () => Promise<T>) => test.as('wf_app', fn);

beforeEach(async () => {
  await test.query('DELETE FROM users');
  alice = await insertUser(test, 'alice@example.test');
  bob = await insertUser(test, 'bob@example.test');
  const accounts = createAccounts(test.db);
  const account = { type: 'bank', providerName: 'Bank', currency: 'IDR', color: 'blue' } as const;
  const opening = { openingBalanceMinor: 10_000_000n, openingDate: parseLocalDate('2026-09-30') };
  bca = (await asApp(() => accounts.create(alice, { ...account, ...opening, displayName: 'BCA' }))).id;
  jago = (await asApp(() => accounts.create(alice, { ...account, ...opening, displayName: 'Jago' }))).id;
});

const builtIn = (user: string, key: BuiltInCategoryKey) =>
  asApp(() => withUser(test.db, user, (tx) => builtInCategoryIn(tx, user, key)));

const record = async (draft: TransactionDraft) =>
  (await asApp(() => withUser(test.db, alice, (tx) => recordTransactionIn(tx, alice, draft, null, NOW)))).id;

const spend = (categoryId: string | null, amountMinor = 10_000n) =>
  record({
    type: 'expense',
    clientId: randomUUID(),
    occurredAt: NOW,
    accountId: bca,
    amountMinor,
    categoryId,
  });

const transferWithFee = (feeCategoryId: string) =>
  record({
    type: 'transfer',
    clientId: randomUUID(),
    occurredAt: NOW,
    fromAccountId: bca,
    toAccountId: jago,
    sentMinor: 100_000n,
    receivedMinor: 100_000n,
    fee: { minor: 2_500n, categoryId: feeCategoryId },
  });

const softDelete = (transactionId: string) =>
  test.query('UPDATE transactions SET deleted_at = now() WHERE id = $1', [transactionId]);

const input = (overrides: Partial<CategoryInput> = {}): CategoryInput => ({
  kind: 'expense',
  group: 'wants',
  name: 'Kopi',
  icon: 'coffee',
  color: 'amber',
  ...overrides,
});

const find = (views: readonly CategoryView[], name: string) => views.find((view) => view.name === name);

describe('built-ins', () => {
  it('lists the catalog in kind, group, and catalog order', async () => {
    const views = await asApp(() => repo.list(alice));
    const order = (kind: string) => ['expense', 'income', 'fee'].indexOf(kind);
    const groups = ['needs', 'wants', 'financial', 'active', 'passive', 'other'];
    const expected = [...BUILT_IN_CATEGORIES].sort(
      (a, b) => order(a.kind) - order(b.kind) || groups.indexOf(a.group) - groups.indexOf(b.group),
    );
    expect(views.map((view) => view.builtInKey)).toEqual(expected.map((entry) => entry.key));
    expect(find(views, 'system:bank_fee')).toMatchObject({
      kind: 'fee',
      group: 'financial',
      isSystem: true,
      isFixed: false,
      icon: 'landmark',
      archivedAt: null,
      transactionCount: 0,
    });
    expect(find(views, 'system:rent')).toMatchObject({ isFixed: true, isSystem: false, sortOrder: 0 });
  });

  it('inserts only the missing entries and never re-creates a deleted built-in', async () => {
    await builtIn(alice, 'system:fx_difference');
    expect(await asApp(() => repo.ensureBuiltIns(alice))).toBe(BUILT_IN_CATEGORIES.length - 1);
    expect(await asApp(() => repo.ensureBuiltIns(alice))).toBe(0);
    const food = await builtIn(alice, 'system:food');
    await asApp(() => repo.remove(alice, food));
    expect(await asApp(() => repo.ensureBuiltIns(alice))).toBe(0);
    const views = await asApp(() => repo.list(alice));
    expect(views).toHaveLength(BUILT_IN_CATEGORIES.length - 1);
    expect(find(views, 'system:food')).toBeUndefined();
    expect(await asApp(() => repo.ensureBuiltIns(bob))).toBe(BUILT_IN_CATEGORIES.length);
  });

  it('counts transactions and fee postings per category', async () => {
    const food = await builtIn(alice, 'system:food');
    const bankFee = await builtIn(alice, 'system:bank_fee');
    await spend(food);
    await softDelete(await spend(food));
    await spend(null);
    await transferWithFee(bankFee);
    const views = await asApp(() => repo.list(alice));
    expect(find(views, 'system:food')?.transactionCount).toBe(1);
    expect(find(views, 'system:bank_fee')?.transactionCount).toBe(1);
  });
});

describe('create and update', () => {
  it('creates user categories after the group and maps duplicate names', async () => {
    await asApp(() => repo.list(alice));
    const coffee = await asApp(() => repo.create(alice, input({ name: '  Kopi  ', isFixed: true })));
    expect(coffee).toMatchObject({
      name: 'Kopi',
      builtInKey: null,
      kind: 'expense',
      group: 'wants',
      sortOrder: 11,
      isFixed: true,
      isSystem: false,
      transactionCount: 0,
    });
    const card = await asApp(() => repo.create(alice, input({ kind: 'fee', group: 'financial', name: 'Biaya kartu' })));
    expect(card).toMatchObject({ isFixed: false, isSystem: false, sortOrder: 16 });
    expect(
      await asApp(() => repo.create(alice, input({ kind: 'income', group: 'other', name: 'kopi' }))),
    ).toMatchObject({ sortOrder: 26 });
    await expect(asApp(() => repo.create(alice, input({ name: 'KOPI' })))).rejects.toMatchObject({
      code: 'CATEGORY_NAME_TAKEN',
    });
    await asApp(() => repo.remove(alice, coffee.id));
    expect(await asApp(() => repo.create(alice, input({ name: 'KOPI' })))).toMatchObject({ name: 'KOPI' });
    expect(await asApp(() => repo.create(bob, input()))).toMatchObject({ name: 'Kopi', sortOrder: 0 });
    const log = await asApp(() => createActivity(test.db).list(alice, 'category', coffee.id));
    expect(log.map((entry) => entry.action)).toEqual(['created', 'deleted']);
  });

  it.each<[string, Partial<CategoryInput>]>([
    ['an empty name', { name: '  ' }],
    ['a long name', { name: 'x'.repeat(25) }],
    ['the system prefix', { name: 'System:food' }],
    ['a group of another kind', { group: 'active' }],
  ])('rejects %s', async (_, overrides) => {
    await expect(asApp(() => repo.create(alice, input(overrides)))).rejects.toMatchObject({
      code: 'INVALID_CATEGORY',
    });
  });

  it('updates fields, keeps built-in names, and maps duplicate names', async () => {
    const coffee = await asApp(() => repo.create(alice, input()));
    await asApp(() => repo.create(alice, input({ name: 'Teh' })));
    expect(
      await asApp(() =>
        repo.update(alice, coffee.id, { name: ' Kopi susu ', icon: 'cup-soda', color: 'red', isFixed: true }),
      ),
    ).toMatchObject({ name: 'Kopi susu', icon: 'cup-soda', color: 'red', isFixed: true });
    await expect(asApp(() => repo.update(alice, coffee.id, { name: 'teh' }))).rejects.toMatchObject({
      code: 'CATEGORY_NAME_TAKEN',
    });
    await expect(asApp(() => repo.update(alice, coffee.id, { name: '' }))).rejects.toMatchObject({
      code: 'INVALID_CATEGORY',
    });
    expect(await asApp(() => repo.update(alice, coffee.id, {}))).toMatchObject({ name: 'Kopi susu' });

    const food = await builtIn(alice, 'system:food');
    await expect(asApp(() => repo.update(alice, food, { name: 'Makan' }))).rejects.toMatchObject({
      code: 'INVALID_CATEGORY',
    });
    expect(await asApp(() => repo.update(alice, food, { icon: 'soup' }))).toMatchObject({
      builtInKey: 'system:food',
      icon: 'soup',
    });
    await expect(asApp(() => repo.update(bob, food, { icon: 'x' }))).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const log = await asApp(() => createActivity(test.db).list(alice, 'category', coffee.id));
    expect(log.map((entry) => entry.meta)).toEqual([
      {},
      { fields: ['name', 'icon', 'color', 'isFixed'] },
      { fields: [] },
    ]);
  });

  it('cannot be written by the worker', async () => {
    await expect(test.as('wf_worker', () => repo.create(alice, input()))).rejects.toMatchObject(
      pgError(/permission denied/),
    );
  });
});

describe('category menu', () => {
  it('moves a category to another group of its kind', async () => {
    await asApp(() => repo.list(alice));
    const coffee = await asApp(() => repo.create(alice, input()));
    expect(await asApp(() => repo.move(alice, coffee.id, 'needs'))).toMatchObject({ group: 'needs', sortOrder: 5 });
    expect(await asApp(() => repo.move(alice, coffee.id, 'needs'))).toMatchObject({ group: 'needs', sortOrder: 5 });
    await expect(asApp(() => repo.move(alice, coffee.id, 'passive'))).rejects.toMatchObject({
      code: 'INVALID_CATEGORY',
    });
    const bankFee = await builtIn(alice, 'system:bank_fee');
    await expect(asApp(() => repo.move(alice, bankFee, 'needs'))).rejects.toMatchObject({ code: 'CATEGORY_SYSTEM' });
    await expect(asApp(() => repo.move(bob, coffee.id, 'wants'))).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('merges transactions and fee postings into the target', async () => {
    const food = await builtIn(alice, 'system:food');
    const snacks = (await asApp(() => repo.create(alice, input({ name: 'Jajan' })))).id;
    await spend(snacks);
    await spend(snacks);
    await softDelete(await spend(snacks));
    expect(await asApp(() => repo.merge(alice, snacks, food))).toEqual({ moved: 2 });
    const views = await asApp(() => repo.list(alice));
    expect(find(views, 'Jajan')).toBeUndefined();
    expect(find(views, 'system:food')?.transactionCount).toBe(2);
    expect(await test.query('SELECT DISTINCT category_id FROM transactions')).toEqual([{ category_id: food }]);
    for (const id of [snacks, food]) {
      const log = await asApp(() => createActivity(test.db).list(alice, 'category', id));
      expect(log.at(-1)).toMatchObject({ action: 'merged', meta: { from: snacks, into: food } });
    }

    const bankFee = await builtIn(alice, 'system:bank_fee');
    const cardFee = (await asApp(() => repo.create(alice, input({ kind: 'fee', group: 'financial', name: 'Kartu' }))))
      .id;
    await transferWithFee(cardFee);
    expect(await asApp(() => repo.merge(alice, cardFee, bankFee))).toEqual({ moved: 0 });
    expect(find(await asApp(() => repo.list(alice)), 'system:bank_fee')?.transactionCount).toBe(1);
  });

  it('refuses invalid merges', async () => {
    const food = await builtIn(alice, 'system:food');
    const salary = await builtIn(alice, 'system:salary');
    const bankFee = await builtIn(alice, 'system:bank_fee');
    const cardFee = (await asApp(() => repo.create(alice, input({ kind: 'fee', group: 'financial', name: 'Kartu' }))))
      .id;
    const cases: [string, string, string][] = [
      [food, food, 'INVALID_CATEGORY'],
      [food, salary, 'CATEGORY_KIND_MISMATCH'],
      [bankFee, cardFee, 'CATEGORY_SYSTEM'],
      [food, randomUUID(), 'NOT_FOUND'],
    ];
    for (const [source, target, code] of cases) {
      await expect(asApp(() => repo.merge(alice, source, target))).rejects.toMatchObject({ code });
    }
    await expect(asApp(() => repo.merge(bob, food, salary))).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('archives and unarchives', async () => {
    const food = await builtIn(alice, 'system:food');
    const archived = await asApp(() => repo.archive(alice, food));
    expect(archived.archivedAt).toBeInstanceOf(Date);
    expect(await asApp(() => repo.archive(alice, food))).toEqual(archived);
    expect(find(await asApp(() => repo.list(alice)), 'system:food')).toBeUndefined();
    expect(find(await asApp(() => repo.list(alice, { includeArchived: true })), 'system:food')).toEqual(archived);
    expect(await asApp(() => repo.unarchive(alice, food))).toMatchObject({ archivedAt: null });
    expect(await asApp(() => repo.unarchive(alice, food))).toMatchObject({ archivedAt: null });
    const log = await asApp(() => createActivity(test.db).list(alice, 'category', food));
    expect(log.map((entry) => entry.action)).toEqual(['archived', 'restored']);

    const bankFee = await builtIn(alice, 'system:bank_fee');
    await expect(asApp(() => repo.archive(alice, bankFee))).rejects.toMatchObject({ code: 'CATEGORY_SYSTEM' });
    await expect(asApp(() => repo.unarchive(bob, food))).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('deletes a category and leaves its transactions uncategorized (FR-K2)', async () => {
    const food = await builtIn(alice, 'system:food');
    const kept = await spend(food);
    await softDelete(await spend(food));
    expect(await asApp(() => repo.remove(alice, food))).toEqual({ uncategorized: 1 });
    expect(await test.query('SELECT id FROM transactions WHERE category_id IS NULL AND deleted_at IS NULL')).toEqual([
      { id: kept },
    ]);
    await expect(asApp(() => repo.remove(alice, food))).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const cardFee = (await asApp(() => repo.create(alice, input({ kind: 'fee', group: 'financial', name: 'Kartu' }))))
      .id;
    await transferWithFee(cardFee);
    expect(await asApp(() => repo.remove(alice, cardFee))).toEqual({ uncategorized: 0 });
    expect(await test.query("SELECT category_id FROM postings WHERE role = 'fee'")).toEqual([{ category_id: null }]);

    const bankFee = await builtIn(alice, 'system:bank_fee');
    await expect(asApp(() => repo.remove(alice, bankFee))).rejects.toMatchObject({ code: 'CATEGORY_SYSTEM' });
  });

  it('reorders within one kind and group', async () => {
    await asApp(() => repo.list(alice));
    const income = (await asApp(() => repo.list(alice))).filter((view) => view.group === 'active');
    const ids = income.map((view) => view.id).reverse();
    await asApp(() => repo.reorder(alice, ids));
    const after = (await asApp(() => repo.list(alice))).filter((view) => view.group === 'active');
    expect(after.map((view) => [view.id, view.sortOrder])).toEqual(ids.map((id, index) => [id, index]));

    await asApp(() => repo.reorder(alice, []));
    const food = await builtIn(alice, 'system:food');
    await expect(asApp(() => repo.reorder(alice, [...ids, food]))).rejects.toMatchObject({
      code: 'INVALID_CATEGORY',
    });
    await expect(asApp(() => repo.reorder(alice, [...ids, ids[0] as string]))).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(asApp(() => repo.reorder(bob, ids))).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
