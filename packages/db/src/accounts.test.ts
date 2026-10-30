// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from 'node:crypto';
import type { BuiltInCategoryKey } from '@wf/domain/categories';
import { parseLocalDate, type LocalDate } from '@wf/domain/period';
import { DESIGN_SEED, type SeedAccount } from '@wf/domain/seed';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { insertUser, pgError, PGLITE_HOOK_TIMEOUT, startMigrated, type TestDatabase } from '../test/pglite.ts';
import { createAccounts, type AccountInput, type AccountsRepository } from './accounts.ts';
import { createActivity } from './activity.ts';
import { withUser } from './db.ts';
import { builtInCategoryIn, recordTransactionIn, type TransactionDraft } from './ledger-core.ts';

const NOW = new Date('2026-10-15T10:00:00+07:00');
const at = (local: string) => new Date(`${local}+07:00`);
const day = (value: string) => parseLocalDate(value);

let test: TestDatabase;
let repo: AccountsRepository;
let clock: Date;
let alice: string;
let bob: string;

beforeAll(async () => {
  test = await startMigrated();
  repo = createAccounts(test.db, { now: () => clock });
}, PGLITE_HOOK_TIMEOUT);

afterAll(async () => {
  await test.close();
});

beforeEach(async () => {
  clock = NOW;
  await test.query('DELETE FROM users');
  await test.query('DELETE FROM fx_rates');
  alice = await insertUser(test, 'alice@example.test');
  bob = await insertUser(test, 'bob@example.test');
});

const asApp = <T>(fn: () => Promise<T>) => test.as('wf_app', fn);

function inputOf(account: SeedAccount): AccountInput {
  return {
    type: account.type,
    providerName: account.providerName,
    displayName: account.displayName,
    last4: account.last4,
    phoneMasked: account.phoneMasked,
    currency: account.currency,
    openingBalanceMinor: account.openingBalanceMinor,
    openingDate: day(account.openingDate),
    color: account.color,
    includeInAvailable: account.includeInAvailable,
  };
}

const seedAccount = (key: string): SeedAccount => {
  const account = DESIGN_SEED.accounts.find((candidate) => candidate.key === key);
  if (account === undefined) throw new Error(`no seed account ${key}`);
  return account;
};

const opening = (key: string): bigint => seedAccount(key).openingBalanceMinor;

const plain = (overrides: Partial<AccountInput> = {}): AccountInput => ({
  type: 'bank',
  providerName: 'Bank Test',
  displayName: 'Test',
  currency: 'IDR',
  openingBalanceMinor: 1_000_000n,
  openingDate: day('2026-07-31'),
  color: 'blue',
  ...overrides,
});

/** The six seed accounts counted in the available balance, keyed by seed key. */
async function createAvailable(user: string): Promise<Record<string, string>> {
  const ids: Record<string, string> = {};
  for (const account of DESIGN_SEED.accounts.filter((candidate) => candidate.includeInAvailable)) {
    ids[account.key] = (await asApp(() => repo.create(user, inputOf(account)))).id;
  }
  return ids;
}

const record = async (user: string, draft: TransactionDraft) =>
  (await asApp(() => withUser(test.db, user, (tx) => recordTransactionIn(tx, user, draft, null, NOW)))).id;

const category = (user: string, key: BuiltInCategoryKey) =>
  asApp(() => withUser(test.db, user, (tx) => builtInCategoryIn(tx, user, key)));

const expense = (accountId: string, amountMinor: bigint, occurredAt: Date, categoryId: string | null = null) =>
  ({ type: 'expense', clientId: randomUUID(), occurredAt, accountId, amountMinor, categoryId }) as const;

const income = (accountId: string, amountMinor: bigint, occurredAt: Date, categoryId: string | null = null) =>
  ({ type: 'income', clientId: randomUUID(), occurredAt, accountId, amountMinor, categoryId }) as const;

const softDelete = (transactionId: string) =>
  test.query('UPDATE transactions SET deleted_at = now() WHERE id = $1', [transactionId]);

const addUsdRate = () =>
  test.query(
    `INSERT INTO fx_rates (base, quote, rate, provider, rate_type, as_of) VALUES ('USD', 'IDR', '16350', 'test', 'blended', '2026-10-15')`,
  );

/** Seed balances: salary and rent on BCA, a transfer with a fee to Jago, and a soft-deleted GoPay expense. */
async function seedFlows(user: string, ids: Record<string, string>): Promise<void> {
  const bankFee = await category(user, 'system:bank_fee');
  await record(
    user,
    income(ids.bca as string, 18_500_000n, at('2026-10-01T08:00:00'), await category(user, 'system:salary')),
  );
  await record(
    user,
    expense(ids.bca as string, 4_500_000n, at('2026-10-01T09:15:00'), await category(user, 'system:rent')),
  );
  await record(user, {
    type: 'transfer',
    clientId: randomUUID(),
    occurredAt: at('2026-10-03T10:00:00'),
    fromAccountId: ids.bca as string,
    toAccountId: ids.jago as string,
    sentMinor: 500_000n,
    receivedMinor: 500_000n,
    fee: { minor: 6_500n, categoryId: bankFee },
  });
  await softDelete(await record(user, expense(ids.gopay as string, 100_000n, at('2026-10-02T12:00:00'))));
}

describe('list and get', () => {
  it('computes seed balances, counts, locks and the available balance', async () => {
    const ids = await createAvailable(alice);
    await seedFlows(alice, ids);
    const overview = await asApp(() => repo.list(alice));
    expect(overview.baseCurrency).toBe('IDR');
    expect(overview.missingRates).toEqual([]);
    expect(
      overview.accounts.map((account) => [
        account.displayName,
        account.balanceMinor,
        account.balanceBaseMinor,
        account.transactionCount,
        account.locked,
        account.sortOrder,
      ]),
    ).toEqual([
      // Salary 18.500.000 − rent 4.500.000 − transfer 500.000 − fee 6.500 on the opening balance (31 Aug).
      ['BCA Tahapan', opening('bca') + 13_493_500n, opening('bca') + 13_493_500n, 3, true, 0],
      ['Bank Jago', opening('jago') + 500_000n, opening('jago') + 500_000n, 1, true, 1],
      ['Mandiri', opening('mandiri'), opening('mandiri'), 0, false, 2],
      // The soft-deleted expense does not count.
      ['GoPay', opening('gopay'), opening('gopay'), 0, false, 3],
      ['OVO', opening('ovo'), opening('ovo'), 0, false, 4],
      ['Dompet (tunai)', opening('cash'), opening('cash'), 0, false, 5],
    ]);
    expect(overview.availableMinor).toBe(
      ['bca', 'jago', 'mandiri', 'gopay', 'ovo', 'cash'].reduce((total, key) => total + opening(key), 0n) + 13_993_500n,
    );
    expect(overview.accounts[0]).toMatchObject({
      providerName: 'Bank Central Asia',
      last4: '4821',
      status: 'active',
      openingDate: seedAccount('bca').openingDate,
    });
    expect(overview.accounts[0]).not.toHaveProperty('userId');
    expect(await asApp(() => repo.get(alice, ids.jago as string))).toMatchObject({
      balanceMinor: opening('jago') + 500_000n,
    });
  });

  it('values foreign accounts with the reference rate and reports missing rates', async () => {
    await asApp(() => repo.create(alice, plain({ displayName: 'Rupiah' })));
    // US$2.411,03 (the 30 Sep balance before the M2 seed moved the opening date back).
    const usd = await asApp(() =>
      repo.create(alice, {
        ...inputOf(seedAccount('gotrade')),
        openingBalanceMinor: 241_103n,
        includeInAvailable: true,
      }),
    );
    expect(usd).toMatchObject({ balanceMinor: 241_103n, balanceBaseMinor: null });
    expect(await asApp(() => repo.list(alice))).toMatchObject({ availableMinor: 1_000_000n, missingRates: ['USD'] });

    await asApp(() => repo.archive(alice, usd.id));
    expect(await asApp(() => repo.list(alice))).toMatchObject({ missingRates: [] });
    const archived = await asApp(() => repo.list(alice, { status: 'archived' }));
    expect(archived.accounts.map((account) => account.id)).toEqual([usd.id]);
    expect(archived.missingRates).toEqual(['USD']);

    await addUsdRate();
    await asApp(() => repo.restore(alice, usd.id));
    const all = await asApp(() => repo.list(alice, { status: 'all' }));
    // US$2.411,03 × 16.350 = Rp39.420.340,5 → Rp39.420.341.
    expect(all.accounts.find((account) => account.id === usd.id)?.balanceBaseMinor).toBe(39_420_341n);
    expect(all.availableMinor).toBe(40_420_341n);
    expect(all.missingRates).toEqual([]);
  });

  it("hides other users' accounts", async () => {
    const ids = await createAvailable(alice);
    expect((await asApp(() => repo.list(bob))).accounts).toEqual([]);
    await expect(asApp(() => repo.get(bob, ids.bca as string))).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('catalog providers', () => {
  it('persists a provider independently of balances and uploaded logos, and permits returning to manual entry', async () => {
    const created = await asApp(() =>
      repo.create(alice, plain({ providerName: 'BCA', catalogId: 'provider:bca', logoKey: 'custom-logo' })),
    );
    expect(await asApp(() => repo.get(alice, created.id))).toMatchObject({
      catalogId: 'provider:bca',
      openingBalanceMinor: 1_000_000n,
      balanceMinor: 1_000_000n,
      logoKey: 'custom-logo',
    });
    const renamed = await asApp(() => repo.update(alice, created.id, { displayName: 'Dana harian' }));
    expect(renamed.catalogId).toBe('provider:bca');
    await expect(asApp(() => repo.update(alice, created.id, { type: 'ewallet' }))).rejects.toMatchObject({
      code: 'INVALID_ACCOUNT',
    });
    const manual = await asApp(() =>
      repo.update(alice, created.id, { type: 'ewallet', providerName: 'Dompet sendiri', catalogId: null }),
    );
    expect(manual).toMatchObject({
      catalogId: null,
      type: 'ewallet',
      balanceMinor: 1_000_000n,
      logoKey: 'custom-logo',
    });
  });

  it('rejects unknown, wrong-kind, and incompatible provider references', async () => {
    for (const catalogId of ['missing', 'service:netflix', 'provider:gopay']) {
      await expect(asApp(() => repo.create(alice, plain({ catalogId })))).rejects.toMatchObject({
        code: 'INVALID_ACCOUNT',
      });
    }
    const card = await asApp(() => repo.create(alice, plain({ type: 'credit_card', catalogId: 'provider:bca' })));
    expect(card).toMatchObject({ type: 'credit_card', catalogId: 'provider:bca' });
  });
});

describe('create', () => {
  it('appends each account to the user order', async () => {
    const first = await asApp(() => repo.create(alice, plain({ displayName: 'First' })));
    expect(first).toMatchObject({ sortOrder: 0, locked: false, transactionCount: 0 });
    await asApp(() => repo.create(alice, plain({ displayName: 'Second' })));
    const third = await asApp(() => repo.create(alice, plain({ displayName: 'Third' })));
    expect(third.sortOrder).toBe(2);
    expect(
      (await asApp(() => createActivity(test.db).list(alice, 'account', third.id))).map((entry) => entry.action),
    ).toEqual(['created']);
  });

  it('trims names, ignores unknown keys, and links a parent account', async () => {
    const parent = await asApp(() => repo.create(alice, plain()));
    const smuggled = {
      ...plain({ displayName: '  Kantong  ', providerName: ' Jago ' }),
      userId: bob,
      status: 'archived',
    };
    const child = await asApp(() =>
      repo.create(alice, {
        ...smuggled,
        parentAccountId: parent.id,
        type: 'credit_card',
        ccLimitMinor: 0n,
        ccStatementDay: 1,
        ccDueDay: 31,
        last4: '0001',
      }),
    );
    expect(child).toMatchObject({
      displayName: 'Kantong',
      providerName: 'Jago',
      status: 'active',
      parentAccountId: parent.id,
      ccDueDay: 31,
    });
    expect(await test.query('SELECT DISTINCT user_id FROM accounts')).toEqual([{ user_id: alice }]);
  });

  it.each<[string, Partial<AccountInput>]>([
    ['currency', { currency: 'usd' }],
    ['empty name', { displayName: '   ' }],
    ['long name', { displayName: 'x'.repeat(41) }],
    ['provider', { providerName: ' ' }],
    ['opening date', { openingDate: '2026-02-30' as LocalDate }],
    ['last4', { last4: '12a4' }],
    ['statement day', { ccStatementDay: 0 }],
    ['due day', { ccDueDay: 32 }],
    ['fractional day', { ccDueDay: 1.5 }],
    ['credit limit', { ccLimitMinor: -1n }],
  ])('rejects an invalid %s', async (_, overrides) => {
    await expect(asApp(() => repo.create(alice, plain(overrides)))).rejects.toMatchObject({ code: 'INVALID_ACCOUNT' });
  });

  it("rejects a parent that is not the user's", async () => {
    const other = await asApp(() => repo.create(bob, plain()));
    await expect(asApp(() => repo.create(alice, plain({ parentAccountId: other.id })))).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('cannot be written by the worker', async () => {
    await expect(test.as('wf_worker', () => repo.create(alice, plain()))).rejects.toMatchObject(
      pgError(/permission denied/),
    );
  });
});

describe('update', () => {
  it('locks currency and opening balance once the account has transactions (FR-R3)', async () => {
    const account = await asApp(() => repo.create(alice, plain()));
    const changed = await asApp(() => repo.update(alice, account.id, { currency: 'SGD', openingBalanceMinor: 5n }));
    expect(changed).toMatchObject({ currency: 'SGD', openingBalanceMinor: 5n, locked: false });
    await asApp(() => repo.update(alice, account.id, { currency: 'IDR' }));
    await record(alice, expense(account.id, 1_000n, at('2026-10-02T08:00:00')));

    for (const patch of [{ currency: 'USD' }, { openingBalanceMinor: 1n }, { openingDate: day('2026-01-01') }]) {
      await expect(asApp(() => repo.update(alice, account.id, patch))).rejects.toMatchObject({
        code: 'ACCOUNT_LOCKED',
      });
    }
    const renamed = await asApp(() =>
      repo.update(alice, account.id, { currency: 'IDR', openingDate: day('2026-07-31'), displayName: ' Utama ' }),
    );
    expect(renamed).toMatchObject({ displayName: 'Utama', locked: true, transactionCount: 1, balanceMinor: -995n });
  });

  it('validates the patch and the parent', async () => {
    const account = await asApp(() => repo.create(alice, plain()));
    const other = await asApp(() => repo.create(alice, plain({ displayName: 'Other' })));
    await expect(asApp(() => repo.update(alice, account.id, { displayName: '' }))).rejects.toMatchObject({
      code: 'INVALID_ACCOUNT',
    });
    await expect(asApp(() => repo.update(alice, account.id, { parentAccountId: account.id }))).rejects.toMatchObject({
      code: 'INVALID_ACCOUNT',
    });
    expect(await asApp(() => repo.update(alice, account.id, { parentAccountId: other.id }))).toMatchObject({
      parentAccountId: other.id,
    });
    expect(await asApp(() => repo.update(alice, account.id, { parentAccountId: null }))).toMatchObject({
      parentAccountId: null,
    });
    const unchanged = await asApp(() => repo.update(alice, account.id, {}));
    expect(unchanged.updatedAt).toBeInstanceOf(Date);
    const log = await asApp(() => createActivity(test.db).list(alice, 'account', account.id));
    expect(log.map((entry) => [entry.action, entry.meta])).toEqual([
      ['created', {}],
      ['updated', { fields: ['parentAccountId'] }],
      ['updated', { fields: ['parentAccountId'] }],
      ['updated', { fields: [] }],
    ]);
  });

  it("refuses another user's account", async () => {
    const account = await asApp(() => repo.create(alice, plain()));
    await expect(asApp(() => repo.update(bob, account.id, { displayName: 'x' }))).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('archive and restore', () => {
  it('archives an account once, logging it (FR-R5)', async () => {
    const ids = await createAvailable(alice);
    expect(await asApp(() => repo.archive(alice, ids.bca as string))).toMatchObject({
      status: 'archived',
      archivedAt: NOW,
    });
    await expect(asApp(() => repo.archive(alice, randomUUID()))).rejects.toMatchObject({ code: 'NOT_FOUND' });

    clock = new Date('2026-10-16T00:00:00Z');
    expect(await asApp(() => repo.archive(alice, ids.bca as string))).toMatchObject({ archivedAt: NOW });
    const log = await asApp(() => createActivity(test.db).list(alice, 'account', ids.bca as string));
    expect(log.map((entry) => [entry.action, entry.meta])).toEqual([
      ['created', {}],
      ['archived', {}],
    ]);
  });

  it('restores an archived account', async () => {
    const first = await asApp(() => repo.create(alice, plain({ displayName: 'First' })));
    await asApp(() => repo.archive(alice, first.id));
    expect((await asApp(() => repo.get(alice, first.id))).archivedAt).toBeInstanceOf(Date);

    expect(await asApp(() => repo.restore(alice, first.id))).toMatchObject({ status: 'active', archivedAt: null });
    expect(await asApp(() => repo.restore(alice, first.id))).toMatchObject({ status: 'active' });
    await expect(asApp(() => repo.restore(bob, first.id))).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('deletePermanently', () => {
  it('deletes the account with its transactions and returns the attachment keys', async () => {
    const doomed = await asApp(() => repo.create(alice, plain({ displayName: 'Doomed' })));
    const keep = await asApp(() => repo.create(alice, plain({ displayName: 'Keep' })));
    const child = await asApp(() => repo.create(alice, plain({ displayName: 'Child', parentAccountId: doomed.id })));
    const spent = await record(alice, expense(doomed.id, 10_000n, at('2026-10-02T08:00:00')));
    const moved = await record(alice, {
      type: 'transfer',
      clientId: randomUUID(),
      occurredAt: at('2026-10-03T08:00:00'),
      fromAccountId: doomed.id,
      toAccountId: keep.id,
      sentMinor: 20_000n,
      receivedMinor: 20_000n,
    });
    await softDelete(await record(alice, expense(doomed.id, 5_000n, at('2026-10-04T08:00:00'))));
    await record(alice, income(keep.id, 1_000n, at('2026-10-05T08:00:00')));
    await asApp(() => repo.reconcile(alice, doomed.id, { mode: 'correction', actualBalanceMinor: 0n }));
    for (const [transactionId, key, thumbnail] of [
      [spent, 'u/a/1', 'u/a/1-thumb'],
      [moved, 'u/a/2', null],
    ] as const) {
      await test.query(
        `INSERT INTO attachments (user_id, transaction_id, bucket, object_key, thumbnail_key, mime, size, sha256, kind)
         VALUES ($1, $2, 'attachments', $3, $4, 'image/png', 10, repeat('a', 64), 'receipt')`,
        [alice, transactionId, key, thumbnail],
      );
    }

    await expect(asApp(() => repo.deletePermanently(alice, doomed.id))).rejects.toMatchObject({
      code: 'ACCOUNT_NOT_ARCHIVED',
    });
    await asApp(() => repo.archive(alice, doomed.id));
    const result = await asApp(() => repo.deletePermanently(alice, doomed.id));
    expect(result.deletedTransactions).toBe(3);
    expect(result.objectKeys.sort()).toEqual(['u/a/1', 'u/a/1-thumb', 'u/a/2']);

    await expect(asApp(() => repo.get(alice, doomed.id))).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await asApp(() => repo.get(alice, keep.id))).toMatchObject({
      balanceMinor: 1_001_000n,
      transactionCount: 1,
    });
    expect(await asApp(() => repo.get(alice, child.id))).toMatchObject({ parentAccountId: null });
    expect(await test.query('SELECT 1 FROM balance_adjustments')).toEqual([]);
    expect(await test.query('SELECT 1 FROM attachments')).toEqual([]);
  });

  it('deletes an archived account without transactions and hides other users', async () => {
    const account = await asApp(() => repo.create(alice, plain()));
    // A goal kept in the account ("Simpan di") loses the link, not the goal.
    await test.query(
      `INSERT INTO goals (user_id, name, icon, color, target_minor, currency, account_id)
       VALUES ($1, 'Dana Darurat', 'shield', 'green', 54000000, 'IDR', $2)`,
      [alice, account.id],
    );
    await expect(asApp(() => repo.deletePermanently(bob, account.id))).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await asApp(() => repo.archive(alice, account.id));
    expect(await asApp(() => repo.deletePermanently(alice, account.id))).toEqual({
      deletedTransactions: 0,
      objectKeys: [],
    });
    expect(await test.query('SELECT name, account_id FROM goals')).toEqual([
      { name: 'Dana Darurat', account_id: null },
    ]);
  });
});

describe('reorder', () => {
  it('sets the order of exactly the active accounts', async () => {
    const ids = await createAvailable(alice);
    await asApp(() => repo.archive(alice, ids.cash as string));
    const order = [ids.ovo, ids.gopay, ids.mandiri, ids.jago, ids.bca] as string[];
    await asApp(() => repo.reorder(alice, order));
    expect((await asApp(() => repo.list(alice))).accounts.map((account) => account.id)).toEqual(order);

    for (const bad of [order.slice(1), [...order, ids.cash as string], [...order.slice(1), ids.gopay as string]]) {
      await expect(asApp(() => repo.reorder(alice, bad))).rejects.toMatchObject({ code: 'NOT_FOUND' });
    }
    await expect(asApp(() => repo.reorder(bob, order))).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('reconcile (FR-R4)', () => {
  it('records the difference as a transaction or a correction', async () => {
    const account = await asApp(() =>
      repo.create(alice, { ...inputOf(seedAccount('cash')), openingBalanceMinor: 500_000n }),
    );
    const food = await category(alice, 'system:food');
    const cashback = await category(alice, 'system:cashback');

    const lower = await asApp(() =>
      repo.reconcile(alice, account.id, {
        mode: 'transaction',
        actualBalanceMinor: 450_000n,
        categoryId: food,
        clientId: randomUUID(),
        occurredAt: at('2026-10-15T09:00:00'),
      }),
    );
    expect(lower).toMatchObject({ differenceMinor: -50_000n, adjustmentId: null });
    const higher = await asApp(() =>
      repo.reconcile(alice, account.id, {
        mode: 'transaction',
        actualBalanceMinor: 470_000n,
        categoryId: cashback,
        clientId: randomUUID(),
        occurredAt: at('2026-10-15T09:30:00'),
        description: 'Selisih saldo',
      }),
    );
    expect(higher.differenceMinor).toBe(20_000n);
    expect(
      await test.query('SELECT id, type, category_id, description FROM transactions ORDER BY occurred_at'),
    ).toEqual([
      { id: lower.transactionId, type: 'expense', category_id: food, description: null },
      { id: higher.transactionId, type: 'income', category_id: cashback, description: 'Selisih saldo' },
    ]);

    const corrected = await asApp(() =>
      repo.reconcile(alice, account.id, { mode: 'correction', actualBalanceMinor: 400_000n }),
    );
    expect(corrected).toMatchObject({ differenceMinor: -70_000n, transactionId: null });
    const adjustments = 'SELECT id, amount_minor::text, actual_balance_minor::text FROM balance_adjustments';
    expect(await test.query(adjustments)).toEqual([
      { id: corrected.adjustmentId, amount_minor: '-70000', actual_balance_minor: '400000' },
    ]);
    expect(
      await asApp(() => repo.reconcile(alice, account.id, { mode: 'correction', actualBalanceMinor: 400_000n })),
    ).toEqual({ differenceMinor: 0n, transactionId: null, adjustmentId: null });

    expect(await asApp(() => repo.get(alice, account.id))).toMatchObject({
      balanceMinor: 400_000n,
      lastReconciledAt: NOW,
      transactionCount: 2,
    });
    const log = await asApp(() => createActivity(test.db).list(alice, 'account', account.id));
    expect(log.map((entry) => [entry.action, entry.meta])).toEqual([
      ['created', {}],
      ['reconciled', { mode: 'transaction', transactionId: lower.transactionId }],
      ['reconciled', { mode: 'transaction', transactionId: higher.transactionId }],
      ['reconciled', { mode: 'correction' }],
      ['reconciled', { mode: 'matched' }],
    ]);
  });

  it('refuses archived and foreign accounts', async () => {
    const account = await asApp(() => repo.create(alice, plain()));
    await expect(
      asApp(() => repo.reconcile(bob, account.id, { mode: 'correction', actualBalanceMinor: 0n })),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await asApp(() => repo.archive(alice, account.id));
    await expect(
      asApp(() => repo.reconcile(alice, account.id, { mode: 'correction', actualBalanceMinor: 0n })),
    ).rejects.toMatchObject({ code: 'ACCOUNT_ARCHIVED' });
  });
});

describe('flows and series', () => {
  it('sums inflow, outflow, and transfers in a date range', async () => {
    const ids = await createAvailable(alice);
    await seedFlows(alice, ids);
    const october = { from: day('2026-10-01'), to: day('2026-10-31') };
    expect(await asApp(() => repo.flows(alice, ids.bca as string, october))).toEqual({
      inflowMinor: 18_500_000n,
      outflowMinor: 4_506_500n,
      transferInMinor: 0n,
      transferOutMinor: 500_000n,
    });
    expect(await asApp(() => repo.flows(alice, ids.jago as string, october))).toEqual({
      inflowMinor: 0n,
      outflowMinor: 0n,
      transferInMinor: 500_000n,
      transferOutMinor: 0n,
    });
    expect(await asApp(() => repo.flows(alice, ids.gopay as string, october))).toMatchObject({ outflowMinor: 0n });
    expect(
      await asApp(() => repo.flows(alice, ids.bca as string, { from: day('2026-10-02'), to: day('2026-10-02') })),
    ).toEqual({ inflowMinor: 0n, outflowMinor: 0n, transferInMinor: 0n, transferOutMinor: 0n });
    await expect(asApp(() => repo.flows(bob, ids.bca as string, october))).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('builds monthly closing balances and flows', async () => {
    const account = await asApp(() => repo.create(alice, plain()));
    await record(alice, income(account.id, 300_000n, at('2026-08-10T08:00:00')));
    clock = new Date('2026-09-15T05:00:00Z');
    await asApp(() => repo.reconcile(alice, account.id, { mode: 'correction', actualBalanceMinor: 1_250_000n }));
    await record(alice, expense(account.id, 50_000n, at('2026-10-05T08:00:00')));
    await record(alice, expense(account.id, 10_000n, at('2026-10-20T08:00:00')));
    clock = new Date('2026-10-20T05:00:00Z');
    await asApp(() => repo.reconcile(alice, account.id, { mode: 'correction', actualBalanceMinor: 1_200_000n }));

    expect(await asApp(() => repo.series(alice, account.id, { months: 4, end: day('2026-10-15') }))).toEqual([
      { month: '2026-07', closingBalanceMinor: 1_000_000n, inflowMinor: 0n, outflowMinor: 0n },
      { month: '2026-08', closingBalanceMinor: 1_300_000n, inflowMinor: 300_000n, outflowMinor: 0n },
      { month: '2026-09', closingBalanceMinor: 1_250_000n, inflowMinor: 0n, outflowMinor: 0n },
      { month: '2026-10', closingBalanceMinor: 1_200_000n, inflowMinor: 0n, outflowMinor: 50_000n },
    ]);
    const year = await asApp(() => repo.series(alice, account.id, { months: 12, end: day('2026-10-31') }));
    expect(year.map((point) => point.month)).toEqual([
      '2025-11',
      '2025-12',
      '2026-01',
      '2026-02',
      '2026-03',
      '2026-04',
      '2026-05',
      '2026-06',
      '2026-07',
      '2026-08',
      '2026-09',
      '2026-10',
    ]);
    expect(year.at(-1)).toMatchObject({ closingBalanceMinor: 1_200_000n, outflowMinor: 60_000n });

    for (const months of [0, 1.5, 121]) {
      await expect(asApp(() => repo.series(alice, account.id, { months, end: day('2026-10-15') }))).rejects.toThrow(
        RangeError,
      );
    }
    await expect(
      asApp(() => repo.series(bob, account.id, { months: 1, end: day('2026-10-15') })),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
