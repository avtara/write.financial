// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from 'node:crypto';
import { generateDek } from '@wf/crypto/envelope';
import type { BuiltInCategoryKey } from '@wf/domain/categories';
import type { LocalDate } from '@wf/domain/period';
import type { AutoRuleDefinition } from '@wf/domain/rules';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { insertUser, PGLITE_HOOK_TIMEOUT, startMigrated, type TestDatabase } from '../test/pglite.ts';
import { createAccounts } from './accounts.ts';
import { createAutoRules, recordCategoryCorrectionIn, type AutoRulesRepository } from './auto-rules.ts';
import { createRuleBackfillProposals, previewBackfillIn } from './rule-backfill.ts';
import { createCategories } from './categories.ts';
import { withUser } from './db.ts';
import { builtInCategoryIn, recordTransactionIn, type TransactionDraft } from './ledger-core.ts';
import { createTransactions, type TransactionsRepository } from './transactions.ts';

let clock = new Date('2026-10-15T09:00:00+07:00');
const NOW = new Date('2026-10-15T09:00:00+07:00');
const TODAY = '2026-10-15' as LocalDate;
const dek = generateDek();

let test: TestDatabase;
let rules: AutoRulesRepository;
let transactions: TransactionsRepository;
let alice: string;
let bob: string;
let aliceAccount: string;
let aliceOther: string;
let bobAccount: string;
let food: string;
let transport: string;
let salary: string;
let bobFood: string;

beforeAll(async () => {
  test = await startMigrated();
  rules = createAutoRules(test.db, { now: () => clock });
  transactions = createTransactions(test.db, { getDek: () => Promise.resolve(dek), now: () => clock });
}, PGLITE_HOOK_TIMEOUT);

afterAll(async () => {
  await test.close();
});

const asApp = <T>(fn: () => Promise<T>) => test.as('wf_app', fn);

const builtIn = (user: string, key: BuiltInCategoryKey) =>
  asApp(() => withUser(test.db, user, (tx) => builtInCategoryIn(tx, user, key)));

beforeEach(async () => {
  clock = NOW;
  await test.query('DELETE FROM users');
  alice = await insertUser(test, 'alice@example.test');
  bob = await insertUser(test, 'bob@example.test');
  const accounts = createAccounts(test.db);
  const base = { type: 'bank', providerName: 'Bank', currency: 'IDR', color: 'blue' } as const;
  const opening = { openingBalanceMinor: 10_000_000n, openingDate: '2026-09-30' as LocalDate };
  aliceAccount = (await asApp(() => accounts.create(alice, { ...base, ...opening, displayName: 'BCA' }))).id;
  aliceOther = (await asApp(() => accounts.create(alice, { ...base, ...opening, displayName: 'Jago' }))).id;
  bobAccount = (await asApp(() => accounts.create(bob, { ...base, ...opening, displayName: 'Jago' }))).id;
  await createCategories(test.db, { getDek: () => Promise.resolve(dek) })
    .list(alice)
    .then(() => createCategories(test.db, { getDek: () => Promise.resolve(dek) }).list(bob));
  food = await builtIn(alice, 'system:food');
  transport = await builtIn(alice, 'system:transport');
  salary = await builtIn(alice, 'system:salary');
  bobFood = await builtIn(bob, 'system:food');
  await builtIn(bob, 'system:transport');
});

const draft = (
  accountId: string,
  options: {
    description?: string;
    categoryId?: string | null;
    amountMinor?: bigint;
    occurredAt?: Date;
    type?: 'expense' | 'income';
    tags?: readonly string[];
  } = {},
): TransactionDraft => ({
  type: options.type ?? 'expense',
  clientId: randomUUID(),
  occurredAt: options.occurredAt ?? NOW,
  accountId,
  amountMinor: options.amountMinor ?? 25_000n,
  categoryId: options.categoryId === undefined ? food : options.categoryId,
  description: options.description ?? 'Kopi Kenangan',
  ...(options.tags === undefined ? {} : { tags: options.tags }),
});

const record = async (user: string, input: TransactionDraft) =>
  (await asApp(() => withUser(test.db, user, (tx) => recordTransactionIn(tx, user, input, null, NOW)))).id;

/** Applies proposals exactly as the dialog does: the preview's rule scope and version plus each row's version. */
const applyItems = (
  preview: { readonly ruleIds: readonly string[]; readonly version: string },
  proposals: readonly { readonly transactionId: string; readonly version: string }[],
) =>
  rules.applyBackfill(alice, {
    ruleIds: preview.ruleIds,
    version: preview.version,
    items: proposals.map((proposal) => ({ transactionId: proposal.transactionId, version: proposal.version })),
  });

const changeCategory = (user: string, id: string, categoryId: string, occurredAt = NOW) =>
  asApp(() =>
    transactions.update(user, id, {
      type: 'expense',
      clientId: randomUUID(),
      occurredAt,
      accountId: user === alice ? aliceAccount : bobAccount,
      amountMinor: 25_000n,
      categoryId,
      description: 'Kopi Kenangan',
    }),
  );

const definition = (overrides: Partial<AutoRuleDefinition> = {}): AutoRuleDefinition => ({
  name: 'Kopi',
  enabled: true,
  conditions: [{ field: 'description', op: 'containsAny', values: ['kopi'] }],
  actions: [{ type: 'setCategory', categoryId: transport }],
  ...overrides,
});

/** The app-role equivalent of the worker/queue proposal build, used to exercise the apply path. */
const previewOf = (userId: string, ruleIds?: readonly string[]) =>
  asApp(() => withUser(test.db, userId, (tx) => previewBackfillIn(tx, userId, ruleIds)));

const categoryOf = async (id: string) =>
  (await test.query<{ category_id: string | null }>('SELECT category_id FROM transactions WHERE id = $1', [id]))[0]
    ?.category_id ?? null;

const tagsOf = async (id: string) =>
  (
    await test.query<{ slug: string }>(
      `SELECT t.slug FROM transaction_tags tt JOIN tags t ON t.id = tt.tag_id WHERE tt.transaction_id = $1
       ORDER BY t.slug`,
      [id],
    )
  ).map((row) => row.slug);

describe('crud and order', () => {
  it('appends, reorders, updates, enables, lists, and removes rules', async () => {
    const first = await asApp(() => rules.create(alice, { input: definition() }));
    const second = await asApp(() =>
      rules.create(alice, {
        input: definition({ name: 'Transport', conditions: [{ field: 'weekday', op: 'oneOf', values: [4] }] }),
      }),
    );
    expect([first.position, second.position]).toEqual([0, 1]);
    expect((await asApp(() => rules.list(alice))).map((rule) => rule.name)).toEqual(['Kopi', 'Transport']);

    await asApp(() => rules.reorder(alice, [second.id, first.id]));
    expect((await asApp(() => rules.list(alice))).map((rule) => [rule.name, rule.position])).toEqual([
      ['Transport', 0],
      ['Kopi', 1],
    ]);
    await expect(asApp(() => rules.reorder(alice, [second.id]))).rejects.toMatchObject({ code: 'INVALID_RULE' });
    await expect(asApp(() => rules.reorder(alice, [second.id, second.id]))).rejects.toMatchObject({
      code: 'INVALID_RULE',
    });

    const disabled = await asApp(() => rules.setEnabled(alice, second.id, false));
    expect(disabled.enabled).toBe(false);
    expect((await asApp(() => rules.list(alice, { enabledOnly: true }))).map((rule) => rule.id)).toEqual([first.id]);

    const updated = await asApp(() => rules.update(alice, second.id, definition({ name: 'Pagi', enabled: false })));
    expect(updated).toMatchObject({ name: 'Pagi', enabled: false, position: 0 });
    await asApp(() => rules.remove(alice, second.id));
    expect((await asApp(() => rules.list(alice))).map((rule) => rule.id)).toEqual([first.id]);
    await expect(asApp(() => rules.remove(alice, second.id))).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      asApp(() => rules.update(alice, '0192a6c4-0000-7000-8000-000000000000', definition())),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('refuses malformed definitions and categories that are not the user’s', async () => {
    await expect(asApp(() => rules.create(alice, { input: definition({ name: '  ' }) }))).rejects.toMatchObject({
      code: 'INVALID_RULE',
    });
    await expect(
      asApp(() =>
        rules.create(alice, {
          input: definition({ actions: [{ type: 'setCategory', categoryId: '0192a6c4-0000-7000-8000-0000000000ff' }] }),
        }),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_RULE' });
    const bobFood = await builtIn(bob, 'system:food');
    await expect(
      asApp(() =>
        rules.create(alice, { input: definition({ actions: [{ type: 'setCategory', categoryId: bobFood }] }) }),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_RULE' });
  });
});

describe('suggestions from manual corrections', () => {
  const corrected = async (count: number) => {
    const ids: string[] = [];
    for (let index = 0; index < count; index += 1) {
      const id = await record(alice, draft(aliceAccount, { description: `Kopi Kenangan ${index}` }));
      await changeCategory(alice, id, transport);
      ids.push(id);
    }
    return ids;
  };

  it('needs four distinct corrected transactions, not three or repeated edits of one row', async () => {
    await corrected(3);
    expect(await asApp(() => rules.suggestions(alice))).toEqual([]);
    const fourth = await record(alice, draft(aliceAccount, { description: 'Kopi Kenangan 3' }));
    await changeCategory(alice, fourth, transport);
    const [suggestion] = await asApp(() => rules.suggestions(alice));
    expect(suggestion).toMatchObject({
      pattern: 'kopi kenangan',
      label: 'Kopi Kenangan',
      fromCategoryId: food,
      toCategoryId: transport,
      count: 4,
    });
    // Changing the same row again adds evidence but never counts as another corrected transaction.
    await changeCategory(alice, fourth, food);
    await changeCategory(alice, fourth, transport);
    expect((await asApp(() => rules.suggestions(alice)))[0]?.count).toBe(4);
  });

  it('is per user, durable when ignored, and disappears when a rule is saved from it', async () => {
    for (let index = 0; index < 4; index += 1) {
      const id = await record(alice, draft(aliceAccount));
      await changeCategory(alice, id, transport);
    }
    expect(await asApp(() => rules.suggestions(bob))).toEqual([]);
    const [suggestion] = await asApp(() => rules.suggestions(alice));
    if (suggestion === undefined) throw new Error('no suggestion');
    await asApp(() => rules.dismissSuggestion(alice, suggestion.key));
    expect(await asApp(() => rules.suggestions(alice))).toEqual([]);
    expect(await asApp(() => rules.suggestions(bob))).toEqual([]);
    await expect(asApp(() => rules.dismissSuggestion(alice, 'unknown-key'))).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });

    const other = await asApp(() => rules.create(alice, { input: definition({ name: 'Kopi lain' }) }));
    await asApp(() => rules.remove(alice, other.id));
    // A fresh suggestion (a new dismissal key is not needed: the old one still hides it).
    expect(await asApp(() => rules.suggestions(alice))).toEqual([]);
  });

  it('dismisses a suggestion when its rule is created from it', async () => {
    for (let index = 0; index < 4; index += 1) {
      const id = await record(alice, draft(aliceAccount));
      await changeCategory(alice, id, transport);
    }
    const [suggestion] = await asApp(() => rules.suggestions(alice));
    if (suggestion === undefined) throw new Error('no suggestion');
    const created = await asApp(() =>
      rules.create(alice, {
        input: definition({
          name: 'Kopi Kenangan',
          conditions: [{ field: 'description', op: 'containsAny', values: ['Kopi Kenangan'] }],
        }),
        suggestionKey: suggestion.key,
      }),
    );
    expect(await asApp(() => rules.suggestions(alice))).toEqual([]);
    expect((await asApp(() => rules.list(alice))).map((rule) => rule.id)).toEqual([created.id]);
  });

  it('ignores automated changes: backfill and record creation never record correction evidence', async () => {
    const id = await record(alice, draft(aliceAccount));
    await asApp(() => rules.create(alice, { input: definition() }));
    const preview = await asApp(() => previewOf(alice));
    const proposal = preview.proposals.find((entry) => entry.transactionId === id);
    if (proposal === undefined) throw new Error('no proposal');
    await asApp(() =>
      rules.applyBackfill(alice, {
        ruleIds: preview.ruleIds,
        version: preview.version,
        items: [{ transactionId: id, version: proposal.version }],
      }),
    );
    expect(await asApp(() => rules.suggestions(alice))).toEqual([]);
    const [evidence] = await test.query<{ n: number }>('SELECT count(*)::int AS n FROM auto_rule_corrections');
    expect(evidence?.n).toBe(0);
  });

  it('stores no evidence without both categories, for the same category, or for an unusable description', async () => {
    const id = await record(alice, draft(aliceAccount, { description: '12345' }));
    await asApp(() =>
      withUser(test.db, alice, async (tx) => {
        await recordCategoryCorrectionIn(tx, alice, {
          transactionId: id,
          description: '12345',
          merchant: null,
          fromCategoryId: food,
          toCategoryId: transport,
        });
        await recordCategoryCorrectionIn(tx, alice, {
          transactionId: id,
          description: 'Kopi',
          merchant: null,
          fromCategoryId: null,
          toCategoryId: transport,
        });
        await recordCategoryCorrectionIn(tx, alice, {
          transactionId: id,
          description: 'Kopi',
          merchant: null,
          fromCategoryId: food,
          toCategoryId: food,
        });
        await recordCategoryCorrectionIn(tx, alice, {
          transactionId: id,
          description: 'Kopi',
          merchant: null,
          fromCategoryId: food,
          toCategoryId: transport,
        });
        await recordCategoryCorrectionIn(tx, alice, {
          transactionId: id,
          description: 'Kopi',
          merchant: null,
          fromCategoryId: food,
          toCategoryId: transport,
        });
      }),
    );
    const [row] = await test.query<{ n: number }>('SELECT count(*)::int AS n FROM auto_rule_corrections');
    expect(row?.n).toBe(1);
  });
});

describe('editor preview', () => {
  it('explains the trial and counts the current period’s matching transactions', async () => {
    await test.query(
      `INSERT INTO periods (user_id, label, start_date, end_date, days)
       VALUES ($1, '2026-10', '2026-10-01', '2026-10-31', 31)`,
      [alice],
    );
    const gojek = await record(alice, draft(aliceAccount, { description: 'Gojek ke kantor', occurredAt: NOW }));
    await record(
      alice,
      draft(aliceAccount, { description: 'Kopi pagi', occurredAt: new Date('2026-10-16T09:00:00+07:00') }),
    );
    await test.query(
      `WITH inserted AS (
         INSERT INTO transactions
           (user_id, type, occurred_at, local_date, description, category_id, source, client_id, confirmed_by_user_at)
         SELECT $1, 'expense', '2026-10-15T02:00:00Z'::timestamptz, '2026-10-15'::date, 'Gojek ' || g, $2, 'manual', uuidv7(), now()
         FROM generate_series(1, 12) AS g
         RETURNING id
       )
       INSERT INTO postings (user_id, transaction_id, account_id, amount_minor, currency, amount_base_minor, role)
       SELECT $1, id, $3, -25000, 'IDR', -25000, 'principal' FROM inserted`,
      [alice, food, aliceAccount],
    );
    await test.query(
      `INSERT INTO transactions (user_id, type, occurred_at, local_date, description, category_id, source, client_id, confirmed_by_user_at)
       VALUES ($1, 'income', '2026-10-15T02:00:00Z', '2026-10-15', 'Gojek masuk', NULL, 'manual', uuidv7(), now())`,
      [alice],
    );
    const preview = await asApp(() =>
      rules.preview(
        alice,
        {
          name: 'Pagi ke kantor',
          enabled: true,
          conditions: [
            { field: 'description', op: 'containsAny', values: ['gojek', 'krl'] },
            { field: 'weekday', op: 'oneOf', values: [4] },
            { field: 'time', op: 'before', minute: 600 },
            { field: 'account', op: 'oneOf', values: [aliceAccount] },
            { field: 'direction', op: 'oneOf', values: ['expense'] },
          ],
          actions: [{ type: 'setCategory', categoryId: transport }],
        },
        {
          description: 'Gojek ke kantor',
          date: TODAY,
          time: '09:30',
          accountId: aliceAccount,
          direction: 'expense',
          subscription: false,
        },
      ),
    );
    expect(preview.trial.rules[0]?.matched).toBe(true);
    expect(preview.trial.rules[0]?.reasons.map((reason) => [reason.field, reason.matched])).toEqual([
      ['description', true],
      ['weekday', true],
      ['time', true],
      ['account', true],
      ['direction', true],
    ]);
    expect(preview.period).toMatchObject({ label: '2026-10', total: 15, matched: 13 });
    expect(preview.period.samples).toHaveLength(10);
    expect(preview.period.samples.some((sample) => sample.id === gojek)).toBe(false);
  });

  it('uses the occurrence link for the period preview’s subscription condition and ignores an import time', async () => {
    await test.query(
      `INSERT INTO periods (user_id, label, start_date, end_date, days)
       VALUES ($1, '2026-10', '2026-10-01', '2026-10-31', 31)`,
      [alice],
    );
    const subscriptionId = await record(alice, draft(aliceAccount, { description: 'Netflix' }));
    await test.query(
      `INSERT INTO scheduled_occurrences
         (user_id, source_type, source_id, due_date, expected_minor, currency, status, transaction_id)
       VALUES ($1, 'subscription', $2, '2026-10-15', 25000, 'IDR', 'confirmed', $3)`,
      [alice, '0192a6c4-0000-7000-8000-0000000000bb', subscriptionId],
    );
    const imported = await record(alice, draft(aliceAccount, { description: 'Impor pagi' }));
    await test.query(`UPDATE transactions SET source = 'import' WHERE id = $1`, [imported]);
    const subscription = await asApp(() =>
      rules.preview(
        alice,
        {
          name: 'Langganan',
          enabled: true,
          conditions: [{ field: 'subscription', op: 'isRegistered' }],
          actions: [{ type: 'setCategory', categoryId: transport }],
        },
        { description: 'Netflix', date: TODAY, time: null, accountId: null, direction: 'expense', subscription: true },
      ),
    );
    expect(subscription.period.matched).toBe(1);
    expect(subscription.period.samples.find((sample) => sample.id === subscriptionId)?.matched).toBe(true);
    expect(subscription.period.samples.some((sample) => !sample.matched && sample.reasons.length > 0)).toBe(true);
    const morning = await asApp(() =>
      rules.preview(
        alice,
        {
          name: 'Pagi',
          enabled: true,
          conditions: [{ field: 'time', op: 'before', minute: 600 }],
          actions: [{ type: 'setCategory', categoryId: transport }],
        },
        {
          description: 'Impor pagi',
          date: TODAY,
          time: null,
          accountId: null,
          direction: 'expense',
          subscription: false,
        },
      ),
    );
    expect(morning.period.samples.find((sample) => sample.id === imported)?.matched).toBe(false);
  });

  it('has an empty period when none covers today', async () => {
    const preview = await asApp(() =>
      rules.preview(alice, definition(), {
        description: 'Kopi',
        date: TODAY,
        time: null,
        accountId: null,
        direction: 'expense',
        subscription: false,
      }),
    );
    expect(preview.period).toEqual({ label: null, total: 0, matched: 0, samples: [], truncated: false });
    expect(preview.trial.rules[0]?.reasons[0]).toEqual({
      field: 'description',
      matched: true,
      values: ['kopi'],
      hit: 'kopi',
    });
  });
});

const postingsOf = async (transactionId: string) =>
  test.query<{ amount_minor: string; account_id: string; role: string }>(
    'SELECT amount_minor, account_id, role FROM postings WHERE transaction_id = $1 ORDER BY role, amount_minor',
    [transactionId],
  );

describe('backfill', () => {
  const setup = async (options: { description?: string; tags?: readonly string[] } = {}) => {
    await asApp(() =>
      rules.create(alice, {
        input: definition({
          actions: [
            { type: 'setCategory', categoryId: transport },
            { type: 'addTag', tag: 'kantor' },
          ],
        }),
      }),
    );
    await asApp(() =>
      rules.create(alice, {
        input: definition({
          name: 'Pagi',
          conditions: [{ field: 'time', op: 'before', minute: 600 }],
          actions: [{ type: 'addTag', tag: 'pagi' }],
        }),
      }),
    );
    return record(
      alice,
      draft(aliceAccount, {
        description: options.description ?? 'Kopi Kenangan',
        ...(options.tags === undefined ? {} : { tags: options.tags }),
      }),
    );
  };

  it('builds proposals without writing, then applies only what was selected', async () => {
    const id = await setup();
    const before = await postingsOf(id);
    const [storedBefore] = await test.query<{ updated_at: Date }>('SELECT updated_at FROM transactions WHERE id = $1', [
      id,
    ]);
    const preview = await asApp(() => previewOf(alice));
    const proposal = preview.proposals.find((entry) => entry.transactionId === id);
    expect(proposal).toMatchObject({
      currentCategoryId: food,
      proposedCategoryId: transport,
      currentTags: [],
      proposedTags: ['kantor', 'pagi'],
      ruleName: 'Kopi',
      noop: false,
      blocked: null,
    });
    expect(preview.totals).toMatchObject({ matched: 1, changes: 1, noops: 0, blocked: 0 });
    expect(await categoryOf(id)).toBe(food);
    expect(await tagsOf(id)).toEqual([]);
    expect(await postingsOf(id)).toEqual(before);

    if (proposal === undefined) throw new Error('no proposal');
    clock = new Date(NOW.getTime() + 60_000);
    const result = await asApp(() =>
      rules.applyBackfill(alice, {
        ruleIds: preview.ruleIds,
        version: preview.version,
        items: [{ transactionId: id, version: proposal.version }],
      }),
    );
    expect(result).toEqual({ applied: [id], skipped: [], rulesChanged: false });
    expect(await categoryOf(id)).toBe(transport);
    expect(await tagsOf(id)).toEqual(['kantor', 'pagi']);
    expect(await postingsOf(id)).toEqual(before);
    const [storedAfter] = await test.query<{ updated_at: Date }>('SELECT updated_at FROM transactions WHERE id = $1', [
      id,
    ]);
    expect(storedAfter?.updated_at.getTime()).not.toBe(storedBefore?.updated_at.getTime());

    // A repeated confirmation is stale: the row changed, so nothing is overwritten again.
    const repeated = await asApp(() =>
      rules.applyBackfill(alice, {
        ruleIds: preview.ruleIds,
        version: preview.version,
        items: [{ transactionId: id, version: proposal.version }],
      }),
    );
    expect(repeated).toEqual({ applied: [], skipped: [{ transactionId: id, reason: 'stale' }], rulesChanged: false });
    expect(await asApp(() => previewOf(alice))).toMatchObject({
      totals: { matched: 1, changes: 0, noops: 1 },
    });
  });

  it('keeps existing tags and the first matching category, and reports a no-op as such', async () => {
    const id = await setup({ tags: ['lain'] });
    const preview = await asApp(() => previewOf(alice));
    const proposal = preview.proposals.find((entry) => entry.transactionId === id);
    expect(proposal?.proposedTags).toEqual(['lain', 'kantor', 'pagi']);
    if (proposal === undefined) throw new Error('no proposal');
    await asApp(() =>
      rules.applyBackfill(alice, {
        ruleIds: preview.ruleIds,
        version: preview.version,
        items: [{ transactionId: id, version: proposal.version }],
      }),
    );
    expect(await tagsOf(id)).toEqual(['kantor', 'lain', 'pagi']);
    expect(await categoryOf(id)).toBe(transport);

    // Nothing left to change: the next preview reports the row as an actual no-op.
    const second = await asApp(() => previewOf(alice));
    const noop = second.proposals.find((entry) => entry.transactionId === id);
    expect(noop).toMatchObject({ noop: true, blocked: null, currentCategoryId: transport });
    expect(second.totals).toMatchObject({ matched: 1, changes: 0, noops: 1, blocked: 0 });
    if (noop === undefined) throw new Error('no no-op proposal');
    expect(await applyItems(second, [noop])).toEqual({
      applied: [],
      skipped: [{ transactionId: id, reason: 'noop' }],
      rulesChanged: false,
    });
  });

  it('never overwrites a row that changed after the preview (stale) or another user’s row', async () => {
    const id = await setup();
    const preview = await asApp(() => previewOf(alice));
    const proposal = preview.proposals.find((entry) => entry.transactionId === id);
    if (proposal === undefined) throw new Error('no proposal');
    await changeCategory(alice, id, food);
    expect(
      await asApp(() =>
        rules.applyBackfill(alice, {
          ruleIds: preview.ruleIds,
          version: preview.version,
          items: [{ transactionId: id, version: proposal.version }],
        }),
      ),
    ).toEqual({ applied: [], skipped: [{ transactionId: id, reason: 'stale' }], rulesChanged: false });
    expect(await categoryOf(id)).toBe(food);

    const bobId = await record(bob, draft(bobAccount, { categoryId: bobFood }));
    expect(
      await asApp(() =>
        rules.applyBackfill(alice, {
          ruleIds: preview.ruleIds,
          version: preview.version,
          items: [{ transactionId: bobId, version: 'forged' }],
        }),
      ),
    ).toEqual({ applied: [], skipped: [{ transactionId: bobId, reason: 'not_found' }], rulesChanged: false });
  });

  it('blocks a closed period and a rule category that does not fit the direction', async () => {
    const id = await setup();
    await test.query(
      `INSERT INTO periods (user_id, label, start_date, end_date, days, status, closed_at)
       VALUES ($1, '2026-10', '2026-10-01', '2026-10-31', 31, 'closed', now())`,
      [alice],
    );
    const preview = await asApp(() => previewOf(alice));
    expect(preview.proposals.find((entry) => entry.transactionId === id)).toMatchObject({
      blocked: 'closed_period',
      noop: false,
    });
    expect(preview.totals).toMatchObject({ matched: 1, changes: 0, blocked: 1 });
    const proposal = preview.proposals[0];
    if (proposal === undefined) throw new Error('no proposal');
    expect(
      await asApp(() =>
        rules.applyBackfill(alice, {
          ruleIds: preview.ruleIds,
          version: preview.version,
          items: [{ transactionId: id, version: proposal.version }],
        }),
      ),
    ).toEqual({ applied: [], skipped: [{ transactionId: id, reason: 'blocked' }], rulesChanged: false });
    expect(await categoryOf(id)).toBe(food);

    await test.query('DELETE FROM periods');
    for (const rule of await asApp(() => rules.list(alice))) await asApp(() => rules.remove(alice, rule.id));
    const incomeRule = await asApp(() =>
      rules.create(alice, {
        input: definition({
          name: 'Gaji',
          conditions: [{ field: 'description', op: 'containsAny', values: ['gaji'] }],
        }),
      }),
    );
    const incomeId = await record(
      alice,
      draft(aliceAccount, { description: 'Gaji', type: 'income', categoryId: salary, amountMinor: 100_000n }),
    );
    const incomePreview = await asApp(() => previewOf(alice, [incomeRule.id]));
    const income = incomePreview.proposals.find((entry) => entry.transactionId === incomeId);
    expect(income).toMatchObject({ blocked: 'category_unavailable', noop: false });
  });

  it('blocks more than five tags instead of dropping rule tags', async () => {
    await asApp(() =>
      rules.create(alice, {
        input: definition({
          actions: [
            { type: 'addTag', tag: 'a' },
            { type: 'addTag', tag: 'b' },
          ],
        }),
      }),
    );
    const id = await record(alice, draft(aliceAccount, { tags: ['c', 'd', 'e', 'f'] }));
    const preview = await asApp(() => previewOf(alice));
    expect(preview.proposals.find((entry) => entry.transactionId === id)).toMatchObject({
      blocked: 'tag_limit',
      currentTags: ['c', 'd', 'e', 'f'],
      proposedTags: ['c', 'd', 'e', 'f'],
    });
  });

  it('applies only the selected rows and ignores disabled rules', async () => {
    const first = await setup();
    const second = await record(alice, draft(aliceAccount, { description: 'Kopi kedua' }));
    const disabled = await asApp(() => rules.list(alice));
    const rule = disabled[0];
    if (rule === undefined) throw new Error('no rule');
    await asApp(() => rules.setEnabled(alice, rule.id, false));
    const preview = await asApp(() => previewOf(alice));
    // The remaining "Pagi" rule still matches by time and adds its tag, but the disabled rule adds nothing.
    const proposal = preview.proposals.find((entry) => entry.transactionId === first);
    if (proposal === undefined) throw new Error('no proposal');
    expect(proposal).toMatchObject({ ruleName: 'Pagi', proposedCategoryId: food, proposedTags: ['pagi'] });
    const result = await applyItems(preview, [proposal]);
    expect(result.applied).toEqual([first]);
    expect(await categoryOf(first)).toBe(food);
    expect(await tagsOf(first)).toEqual(['pagi']);
    expect(await categoryOf(second)).toBe(food);
  });

  it('has nothing to propose without enabled rules and refuses more than 500 selections', async () => {
    expect(await asApp(() => previewOf(alice))).toMatchObject({
      proposals: [],
      totals: { matched: 0, changes: 0, noops: 0, blocked: 0 },
      truncated: false,
    });
    await expect(
      asApp(() =>
        rules.applyBackfill(alice, {
          ruleIds: ['0192a6c4-0000-7000-8000-000000000001'],
          version: 'version',
          items: Array.from({ length: 501 }, () => ({
            transactionId: '0192a6c4-0000-7000-8000-000000000000',
            version: 'version',
          })),
        }),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_RULE' });
  });

  it('limits the preview to the scan size and says so', async () => {
    await asApp(() => rules.create(alice, { input: definition() }));
    await test.query(
      `INSERT INTO transactions
         (user_id, type, occurred_at, local_date, description, category_id, source, client_id, confirmed_by_user_at)
       SELECT $1, 'expense', now(), '2026-10-15'::date, 'Kopi ' || g, $2, 'manual', uuidv7(), now()
       FROM generate_series(1, 2001) AS g`,
      [alice, food],
    );
    const preview = await asApp(() => previewOf(alice));
    expect(preview.truncated).toBe(true);
    expect(preview.proposals).toHaveLength(2000);
  }, 120_000);
});

describe('backfill income', () => {
  it('applies an income rule with an income category', async () => {
    await asApp(() =>
      rules.create(alice, {
        input: definition({
          name: 'Gaji',
          conditions: [{ field: 'description', op: 'containsAny', values: ['gaji'] }],
          actions: [{ type: 'setCategory', categoryId: salary }],
        }),
      }),
    );
    const id = await record(
      alice,
      draft(aliceAccount, { description: 'Gaji', type: 'income', categoryId: salary, amountMinor: 100_000n }),
    );
    await test.query('UPDATE transactions SET category_id = NULL WHERE id = $1', [id]);
    const preview = await asApp(() => previewOf(alice));
    const proposal = preview.proposals.find((entry) => entry.transactionId === id);
    if (proposal === undefined) throw new Error('no proposal');
    expect(
      await asApp(() =>
        rules.applyBackfill(alice, {
          ruleIds: preview.ruleIds,
          version: preview.version,
          items: [{ transactionId: id, version: proposal.version }],
        }),
      ),
    ).toEqual({ applied: [id], skipped: [], rulesChanged: false });
    expect(await categoryOf(id)).toBe(salary);
  });
});

describe('review regressions', () => {
  it('keeps the preview rule scope when a higher rule would add an unseen category or tag', async () => {
    await asApp(() =>
      rules.create(alice, {
        input: definition({
          name: 'Atas',
          actions: [
            { type: 'setCategory', categoryId: food },
            { type: 'addTag', tag: 'dari-atas' },
          ],
        }),
      }),
    );
    const lower = await asApp(() =>
      rules.create(alice, {
        input: definition({
          name: 'Bawah',
          actions: [
            { type: 'setCategory', categoryId: transport },
            { type: 'addTag', tag: 'bawah' },
          ],
        }),
      }),
    );
    const id = await record(alice, draft(aliceAccount, { description: 'Kopi' }));
    const preview = await asApp(() => previewOf(alice, [lower.id]));
    const proposal = preview.proposals.find((entry) => entry.transactionId === id);
    expect(preview.ruleIds).toEqual([lower.id]);
    expect(proposal).toMatchObject({ proposedCategoryId: transport, proposedTags: ['bawah'] });
    if (proposal === undefined) throw new Error('no proposal');
    expect(await applyItems(preview, [proposal])).toEqual({ applied: [id], skipped: [], rulesChanged: false });
    expect(await categoryOf(id)).toBe(transport);
    expect(await tagsOf(id)).toEqual(['bawah']);
  });

  it('skips every selection when the rule version changed between preview and confirm', async () => {
    const rule = await asApp(() => rules.create(alice, { input: definition() }));
    const id = await record(alice, draft(aliceAccount));
    const preview = await asApp(() => previewOf(alice));
    const proposal = preview.proposals.find((entry) => entry.transactionId === id);
    if (proposal === undefined) throw new Error('no proposal');
    await asApp(() => rules.update(alice, rule.id, definition({ name: 'Berubah' })));
    expect(await applyItems(preview, [proposal])).toEqual({
      applied: [],
      skipped: [{ transactionId: id, reason: 'stale' }],
      rulesChanged: true,
    });
    expect(await categoryOf(id)).toBe(food);
  });

  it('keeps PostgreSQL microseconds in the row version and refuses an intervening edit', async () => {
    await asApp(() => rules.create(alice, { input: definition() }));
    const id = await record(alice, draft(aliceAccount));
    await test.query(`UPDATE transactions SET updated_at = '2026-10-15 09:00:00.123456+07' WHERE id = $1`, [id]);
    const preview = await asApp(() => previewOf(alice));
    const proposal = preview.proposals.find((entry) => entry.transactionId === id);
    if (proposal === undefined) throw new Error('no proposal');
    expect(proposal.version).toContain('.123456');
    await asApp(() => transactions.bulkSetCategory(alice, [id], null));
    expect(await applyItems(preview, [proposal])).toEqual({
      applied: [],
      skipped: [{ transactionId: id, reason: 'stale' }],
      rulesChanged: false,
    });
    expect(await categoryOf(id)).toBeNull();
  });

  it('derives the subscription condition from a confirmed occurrence link', async () => {
    await asApp(() =>
      rules.create(alice, {
        input: definition({
          name: 'Langganan',
          conditions: [{ field: 'subscription', op: 'isRegistered' }],
          actions: [{ type: 'setCategory', categoryId: transport }],
        }),
      }),
    );
    const id = await record(alice, draft(aliceAccount, { description: 'Netflix' }));
    await test.query(
      `INSERT INTO scheduled_occurrences
         (user_id, source_type, source_id, due_date, expected_minor, currency, status, transaction_id)
       VALUES ($1, 'subscription', $2, '2026-10-15', 25000, 'IDR', 'confirmed', $3)`,
      [alice, '0192a6c4-0000-7000-8000-0000000000aa', id],
    );
    const preview = await asApp(() => previewOf(alice));
    expect(preview.proposals.find((entry) => entry.transactionId === id)).toMatchObject({
      proposedCategoryId: transport,
    });
  });

  it('does not treat an import row’s synthetic 09:00 as a known time', async () => {
    await asApp(() =>
      rules.create(alice, {
        input: definition({ conditions: [{ field: 'time', op: 'before', minute: 600 }] }),
      }),
    );
    const id = await record(alice, draft(aliceAccount));
    await test.query(`UPDATE transactions SET source = 'import' WHERE id = $1`, [id]);
    expect((await asApp(() => previewOf(alice))).proposals.find((entry) => entry.transactionId === id)).toBeUndefined();
  });

  it('refuses a forged selection of a transfer', async () => {
    await asApp(() => rules.create(alice, { input: definition() }));
    const transferId = (
      await asApp(() =>
        withUser(test.db, alice, (tx) =>
          recordTransactionIn(
            tx,
            alice,
            {
              type: 'transfer',
              clientId: randomUUID(),
              occurredAt: NOW,
              fromAccountId: aliceAccount,
              toAccountId: aliceOther,
              sentMinor: 10_000n,
              receivedMinor: 10_000n,
            },
            null,
            NOW,
          ),
        ),
      )
    ).id;
    const [row] = await test.query<{ v: string }>('SELECT updated_at::text AS v FROM transactions WHERE id = $1', [
      transferId,
    ]);
    const preview = await asApp(() => previewOf(alice));
    expect(
      await asApp(() =>
        rules.applyBackfill(alice, {
          ruleIds: preview.ruleIds,
          version: preview.version,
          items: [{ transactionId: transferId, version: row?.v ?? '' }],
        }),
      ),
    ).toEqual({ applied: [], skipped: [{ transactionId: transferId, reason: 'blocked' }], rulesChanged: false });
  });
  it('deletes correction evidence with a physically deleted category', async () => {
    const id = await record(alice, draft(aliceAccount, { categoryId: null }));
    await asApp(() =>
      withUser(test.db, alice, (tx) =>
        recordCategoryCorrectionIn(tx, alice, {
          transactionId: id,
          description: 'Kopi',
          merchant: null,
          fromCategoryId: food,
          toCategoryId: transport,
        }),
      ),
    );
    await test.query('DELETE FROM categories WHERE id = $1', [transport]);
    expect(await test.query('SELECT 1 FROM auto_rule_corrections')).toEqual([]);
    await test.query('DELETE FROM categories WHERE id = $1', [food]);
  });
});

describe('repository edges', () => {
  it('exposes the same read-only preview through the worker repository', async () => {
    await asApp(() => rules.create(alice, { input: definition() }));
    const id = await record(alice, draft(aliceAccount));
    const preview = await asApp(() => createRuleBackfillProposals(test.db).preview(alice));
    expect(preview.proposals.map((proposal) => proposal.transactionId)).toEqual([id]);
  });

  it('maps a malformed definition’s unexpected error and a missing rule on enable/update', async () => {
    await expect(
      asApp(() =>
        rules.preview(
          alice,
          { ...definition(), conditions: [null as never] },
          { description: 'Kopi', date: TODAY, time: null, accountId: null, direction: 'expense', subscription: false },
        ),
      ),
    ).rejects.toThrow(TypeError);
    await expect(
      asApp(() => rules.setEnabled(alice, '0192a6c4-0000-7000-8000-000000000000', false)),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('uses the default clock when none is given', async () => {
    const defaulted = createAutoRules(test.db);
    const created = await asApp(() => defaulted.create(alice, { input: definition({ name: 'Jam sekarang' }) }));
    const disabled = await asApp(() => defaulted.setEnabled(alice, created.id, false));
    expect(disabled.enabled).toBe(false);
    expect(disabled.updatedAt.getTime()).toBeGreaterThan(created.updatedAt.getTime() - 1);
  });

  it('hides a suggestion a saved rule already covers', async () => {
    for (let index = 0; index < 4; index += 1) {
      const id = await record(alice, draft(aliceAccount));
      await changeCategory(alice, id, transport);
    }
    expect((await asApp(() => rules.suggestions(alice)))[0]?.count).toBe(4);
    await asApp(() =>
      rules.create(alice, {
        input: definition({
          name: 'Sudah ada',
          conditions: [{ field: 'description', op: 'containsAny', values: ['tidak', 'kopi kenangan gula', 'kopi'] }],
        }),
      }),
    );
    expect(await asApp(() => rules.suggestions(alice))).toEqual([]);
  });

  it('has no description for a row with neither description nor merchant', async () => {
    await asApp(() =>
      rules.create(alice, {
        input: definition({ conditions: [{ field: 'time', op: 'before', minute: 600 }] }),
      }),
    );
    const id = await record(alice, { ...draft(aliceAccount), description: '   ' });
    const preview = await asApp(() => previewOf(alice));
    expect(preview.proposals.find((entry) => entry.transactionId === id)).toMatchObject({ description: null });
  });

  it('returns nothing without transactions (empty tag and account queries)', async () => {
    await asApp(() => rules.create(alice, { input: definition() }));
    expect(await asApp(() => previewOf(alice))).toMatchObject({
      proposals: [],
      totals: { matched: 0, changes: 0, noops: 0, blocked: 0 },
      truncated: false,
    });
  });

  it('de-duplicates the accounts of one transaction when a posting repeats an account', async () => {
    await asApp(() => rules.create(alice, { input: definition() }));
    const id = await record(alice, draft(aliceAccount));
    await test.query(
      `INSERT INTO postings (user_id, transaction_id, account_id, amount_minor, currency, amount_base_minor, role)
       VALUES ($1, $2, $3, 0, 'IDR', 0, 'tax'), ($1, $2, $4, 0, 'IDR', 0, 'tax')`,
      [alice, id, aliceAccount, aliceOther],
    );
    const preview = await asApp(() => previewOf(alice));
    expect(preview.proposals.find((entry) => entry.transactionId === id)).toMatchObject({ noop: false });
  });

  it('marks a card-managed transaction as blocked and skips it when selected directly', async () => {
    await asApp(() => rules.create(alice, { input: definition() }));
    const id = await record(alice, draft(aliceAccount));
    await test.query(
      `INSERT INTO card_payment_allocations (user_id, transaction_id, bucket, amount_minor)
       VALUES ($1, $2, 'spending', 25000)`,
      [alice, id],
    );
    const preview = await asApp(() => previewOf(alice));
    const managed = preview.proposals.find((entry) => entry.transactionId === id);
    expect(managed).toMatchObject({ blocked: 'managed' });
    if (managed === undefined) throw new Error('no proposal');
    expect(await applyItems(preview, [managed])).toEqual({
      applied: [],
      skipped: [{ transactionId: id, reason: 'blocked' }],
      rulesChanged: false,
    });
    expect(await categoryOf(id)).toBe(food);
  });

  it('treats an unmatched or no-op selection as a no-op and applies a category without touching tags', async () => {
    await asApp(() =>
      rules.create(alice, {
        input: definition({ conditions: [{ field: 'description', op: 'containsAny', values: ['tidak ada'] }] }),
      }),
    );
    const id = await record(alice, draft(aliceAccount, { tags: ['kopi'] }));
    const [rowVersion] = await test.query<{ v: string }>(
      'SELECT updated_at::text AS v FROM transactions WHERE id = $1',
      [id],
    );
    const unmatched = await asApp(() => previewOf(alice));
    expect(await applyItems(unmatched, [{ transactionId: id, version: rowVersion?.v ?? '' }])).toEqual({
      applied: [],
      skipped: [{ transactionId: id, reason: 'noop' }],
      rulesChanged: false,
    });
    expect(await tagsOf(id)).toEqual(['kopi']);

    await asApp(() => rules.create(alice, { input: definition({ name: 'Kategori saja' }) }));
    const preview = await asApp(() => previewOf(alice));
    const proposal = preview.proposals.find((entry) => entry.transactionId === id);
    if (proposal === undefined) throw new Error('no proposal');
    expect(await applyItems(preview, [proposal])).toEqual({ applied: [id], skipped: [], rulesChanged: false });
    expect(await categoryOf(id)).toBe(transport);
    expect(await tagsOf(id)).toEqual(['kopi']);
  });
});
