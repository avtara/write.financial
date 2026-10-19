// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from 'node:crypto';
import type { Dek } from '@wf/crypto/envelope';
import { FX_DIFFERENCE_CATEGORY, type BuiltInCategoryKey } from '@wf/domain/categories';
import type { LocalDate } from '@wf/domain/period';
import { DESIGN_SEED } from '@wf/domain/seed';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testKeyring } from '../test/keys.ts';
import { insertUser, pgError, PGLITE_HOOK_TIMEOUT, startMigrated, type TestDatabase } from '../test/pglite.ts';
import { withUser } from './db.ts';
import { builtInCategoryIn, recordTransactionIn, type TransactionDraft } from './ledger-core.ts';
import { accounts, transactions } from './schema.ts';
import {
  categoryTotalsIn,
  createTransactionQuery,
  dayTotalsIn,
  type TransactionFilter,
  type TransactionListOptions,
  type TransactionQueryRepository,
} from './transaction-query.ts';
import { createUserKeys } from './user-keys.ts';

const NOW = new Date('2026-10-16T12:00:00+07:00');
const at = (day: number, time: string) => new Date(`2026-10-${String(day).padStart(2, '0')}T${time}:00+07:00`);

let test: TestDatabase;
let query: TransactionQueryRepository;
let dekCalls = 0;
let alice: string;
let bob: string;
let avtara: string;
/** Alice's fixture: name → transaction id, and back. */
const tx: Record<string, string> = {};
const nameOf = new Map<string, string>();
const account: Record<string, string> = {};
const category: Partial<Record<BuiltInCategoryKey, string>> = {};
let fxLossMinor = 0n;
let bobAccount = '';

const asApp = <T>(fn: () => Promise<T>) => test.as('wf_app', fn);

async function insertAccounts(userId: string, rows: readonly { key: string; currency: string }[]) {
  const inserted = await withUser(test.db, userId, (t) =>
    t
      .insert(accounts)
      .values(
        rows.map((row) => ({
          userId,
          type: 'bank' as const,
          providerName: row.key,
          displayName: row.key,
          currency: row.currency,
          openingDate: '2026-09-30' as LocalDate,
          color: 'blue',
        })),
      )
      .returning({ id: accounts.id, key: accounts.displayName }),
  );
  return Object.fromEntries(inserted.map((row) => [row.key, row.id]));
}

async function seedAlice(dek: Dek) {
  Object.assign(
    account,
    await insertAccounts(alice, [
      { key: 'bca', currency: 'IDR' },
      { key: 'gopay', currency: 'IDR' },
      { key: 'gotrade', currency: 'USD' },
    ]),
  );
  await withUser(test.db, alice, async (t) => {
    for (const key of ['system:food', 'system:transport', 'system:salary', 'system:bank_fee'] as const) {
      category[key] = await builtInCategoryIn(t, alice, key);
    }
    const food = category['system:food'] ?? '';
    const entry = (
      draft: Omit<Extract<TransactionDraft, { type: 'expense' | 'income' }>, 'clientId'>,
    ): TransactionDraft => ({ clientId: randomUUID(), ...draft });
    const drafts: Record<string, TransactionDraft> = {
      t1: entry({
        type: 'expense',
        occurredAt: at(1, '10:00'),
        accountId: account.bca ?? '',
        amountMinor: 50_000n,
        categoryId: food,
        merchant: 'Warteg Bahari',
        description: 'Makan siang',
        note: 'traktir Budi',
        tags: ['makan'],
      }),
      t2: entry({
        type: 'expense',
        occurredAt: at(1, '19:00'),
        accountId: account.gopay ?? '',
        amountMinor: 25_000n,
        categoryId: category['system:transport'] ?? '',
        merchant: 'Gojek',
        tags: ['kantor', 'makan'],
      }),
      t3: entry({
        type: 'income',
        occurredAt: at(2, '09:00'),
        accountId: account.bca ?? '',
        amountMinor: 10_000_000n,
        categoryId: category['system:salary'] ?? '',
        description: 'Gaji Oktober',
        tags: ['kantor'],
        source: 'import',
      }),
      t4: {
        type: 'transfer',
        clientId: randomUUID(),
        occurredAt: at(3, '08:00'),
        fromAccountId: account.bca ?? '',
        toAccountId: account.gopay ?? '',
        sentMinor: 200_000n,
        receivedMinor: 200_000n,
        fee: { minor: 2_500n, categoryId: category['system:bank_fee'] ?? '' },
        description: 'Top up GoPay',
      },
      // The FX golden: Rp3.000.000 → US$182,10 at 16350.0275.
      t5: {
        type: 'transfer',
        clientId: randomUUID(),
        occurredAt: at(4, '09:00'),
        fromAccountId: account.bca ?? '',
        toAccountId: account.gotrade ?? '',
        sentMinor: 3_000_000n,
        receivedMinor: 18_210n,
        manualRate: { base: 'USD', quote: 'IDR', rate: '16350.0275' },
        description: 'Ke Gotrade',
      },
      t6: entry({
        type: 'expense',
        occurredAt: at(4, '15:00'),
        accountId: account.gotrade ?? '',
        amountMinor: 1_000n,
        categoryId: food,
        merchant: 'Starbucks',
      }),
      t7: entry({
        type: 'expense',
        occurredAt: at(5, '12:00'),
        accountId: account.bca ?? '',
        amountMinor: 75_000n,
        categoryId: null,
        merchant: 'Tokopedia',
        description: 'Rak buku 50%_off',
        tags: ['liburan-bali'],
      }),
      t8: entry({
        type: 'expense',
        occurredAt: at(5, '13:00'),
        accountId: account.bca ?? '',
        amountMinor: 30_000n,
        categoryId: food,
        merchant: 'Warteg Bahari',
      }),
      t9: entry({
        type: 'expense',
        occurredAt: at(6, '18:00'),
        accountId: account.bca ?? '',
        amountMinor: 40_000n,
        categoryId: food,
        merchant: 'Indomaret',
        note: 'Belanja bulanan, mampir WARTEG',
        tags: ['dapur'],
      }),
    };
    for (const [name, draft] of Object.entries(drafts)) {
      const result = await recordTransactionIn(t, alice, draft, dek, NOW);
      tx[name] = result.id;
      nameOf.set(result.id, name);
      if (name === 't5') fxLossMinor = result.fxDifference?.differenceBaseMinor ?? 0n;
    }
  });
  await withUser(test.db, alice, async (t) => {
    await t.execute(sql`UPDATE transactions SET deleted_at = now() WHERE id = ${tx.t8}`);
    await t.execute(
      sql`INSERT INTO attachments (user_id, transaction_id, bucket, object_key, mime, size, sha256, kind)
          VALUES (${alice}, ${tx.t7}, 'wf', 'u/x/y', 'image/jpeg', 10, ${'a'.repeat(64)}, 'receipt')`,
    );
    // "masak" was merged into "dapur".
    await t.execute(
      sql`INSERT INTO tag_aliases (user_id, tag_id, slug) SELECT user_id, id, 'masak' FROM tags WHERE slug = 'dapur'`,
    );
  });
}

async function seedBob() {
  const { bca } = await insertAccounts(bob, [{ key: 'bca', currency: 'IDR' }]);
  bobAccount = bca ?? '';
  await withUser(test.db, bob, async (t) => {
    await recordTransactionIn(
      t,
      bob,
      {
        type: 'expense',
        clientId: randomUUID(),
        occurredAt: at(1, '12:00'),
        accountId: bobAccount,
        amountMinor: 99_000n,
        categoryId: await builtInCategoryIn(t, bob, 'system:food'),
        merchant: 'Warteg Bahari',
        tags: ['makan'],
      },
      null,
      NOW,
    );
  });
}

async function seedDesign() {
  const inserted = await withUser(test.db, avtara, (t) =>
    t
      .insert(accounts)
      .values(
        DESIGN_SEED.accounts.map(({ key, openingDate, ...row }) => ({
          ...row,
          userId: avtara,
          providerName: `${row.providerName} ${key}`,
          openingDate: openingDate as LocalDate,
        })),
      )
      .returning({ id: accounts.id, providerName: accounts.providerName }),
  );
  const accountId = new Map(inserted.map((row) => [row.providerName.split(' ').at(-1), row.id]));
  await withUser(test.db, avtara, async (t) => {
    for (const seed of DESIGN_SEED.transactions) {
      const common = { clientId: randomUUID(), occurredAt: new Date(seed.occurredAt), tags: seed.tags };
      const draft: TransactionDraft =
        seed.kind === 'transfer'
          ? {
              ...common,
              type: 'transfer',
              fromAccountId: accountId.get(seed.fromAccountKey) ?? '',
              toAccountId: accountId.get(seed.toAccountKey) ?? '',
              sentMinor: seed.sentMinor,
              receivedMinor: seed.receivedMinor,
              description: seed.description,
            }
          : {
              ...common,
              type: seed.kind,
              accountId: accountId.get(seed.accountKey) ?? '',
              amountMinor: seed.amountMinor,
              categoryId: await builtInCategoryIn(t, avtara, seed.categoryKey),
              merchant: seed.merchant,
              description: seed.description,
            };
      await recordTransactionIn(t, avtara, draft, null, NOW);
    }
  });
}

beforeAll(async () => {
  test = await startMigrated();
  const keys = createUserKeys(test.db, testKeyring().keyring);
  query = createTransactionQuery(test.db, {
    getDek: (userId) => {
      dekCalls += 1;
      return keys.getOrCreateDek(userId);
    },
  });
  alice = await insertUser(test, 'alice@example.test');
  bob = await insertUser(test, 'bob@example.test');
  avtara = await insertUser(test, 'avtara@example.test');
  await test.query(
    `INSERT INTO fx_rates (base, quote, rate, provider, rate_type, as_of)
     VALUES ('USD', 'IDR', '16350', 'frankfurter', 'bi_transaction', '2026-10-15')`,
  );
  await asApp(async () => {
    await seedAlice(await keys.getOrCreateDek(alice));
    await seedBob();
    await seedDesign();
  });
}, 4 * PGLITE_HOOK_TIMEOUT);

afterAll(async () => {
  await test.close();
});

async function names(filter: TransactionFilter, options?: TransactionListOptions, userId = alice) {
  const page = await asApp(() => query.list(userId, filter, options));
  return page.rows.map((row) => nameOf.get(row.id) ?? row.id);
}

/** Alice's live transactions, newest first. */
const ALL = ['t9', 't7', 't6', 't5', 't4', 't3', 't2', 't1'];

describe('list', () => {
  it('golden: the FX difference of the fixture transfer is −Rp22.660', () => {
    expect(fxLossMinor).toBe(-22_660n);
  });

  it('lists live transactions newest first with their details', async () => {
    const page = await asApp(() => query.list(alice, {}));
    expect(page.total).toBe(8);
    expect(page.rows.map((row) => nameOf.get(row.id))).toEqual(ALL);
    const byName = new Map(page.rows.map((row) => [nameOf.get(row.id), row]));
    expect(byName.get('t1')).toEqual({
      id: tx.t1,
      type: 'expense',
      occurredAt: at(1, '10:00'),
      localDate: '2026-10-01',
      merchant: 'Warteg Bahari',
      description: 'Makan siang',
      categoryId: category['system:food'],
      accountId: account.bca,
      toAccountId: null,
      amountMinor: -50_000n,
      currency: 'IDR',
      receivedMinor: null,
      receivedCurrency: null,
      amountBaseMinor: -50_000n,
      feeMinor: null,
      fxDiffBaseMinor: null,
      tags: ['makan'],
      hasAttachment: false,
      hasNote: true,
      source: 'manual',
      splitParentId: null,
    });
    expect(byName.get('t2')).toMatchObject({ tags: ['kantor', 'makan'], hasNote: false });
    expect(byName.get('t3')).toMatchObject({ amountMinor: 10_000_000n, source: 'import', tags: ['kantor'] });
    expect(byName.get('t4')).toMatchObject({
      type: 'transfer',
      accountId: account.bca,
      toAccountId: account.gopay,
      amountMinor: -200_000n,
      receivedMinor: 200_000n,
      receivedCurrency: 'IDR',
      amountBaseMinor: -200_000n,
      feeMinor: 2_500n,
      fxDiffBaseMinor: 0n,
      categoryId: null,
      tags: [],
    });
    expect(byName.get('t5')).toMatchObject({
      accountId: account.bca,
      toAccountId: account.gotrade,
      amountMinor: -3_000_000n,
      currency: 'IDR',
      receivedMinor: 18_210n,
      receivedCurrency: 'USD',
      feeMinor: null,
      fxDiffBaseMinor: -22_660n,
    });
    expect(byName.get('t6')).toMatchObject({ amountMinor: -1_000n, currency: 'USD', amountBaseMinor: -163_500n });
    expect(byName.get('t7')).toMatchObject({ categoryId: null, hasAttachment: true });
  });

  it('sorts by date or by |base amount| and paginates with the total', async () => {
    expect(await names({}, { sort: 'date_asc' })).toEqual([...ALL].reverse());
    expect(await names({}, { sort: 'amount_desc' })).toEqual(['t3', 't5', 't4', 't6', 't7', 't1', 't9', 't2']);
    expect(await names({}, { sort: 'amount_asc' })).toEqual(['t2', 't9', 't1', 't7', 't6', 't4', 't5', 't3']);
    const page = await asApp(() => query.list(alice, {}, { sort: 'date_desc', limit: 2, offset: 2 }));
    expect(page.rows.map((row) => nameOf.get(row.id))).toEqual(['t6', 't5']);
    expect(page.total).toBe(8);
    expect(await names({}, { limit: 0, offset: -5 })).toEqual(['t9']);
    expect(await names({}, { limit: 1000 })).toEqual(ALL);
    expect(await asApp(() => query.list(alice, {}, { offset: 50 }))).toEqual({ rows: [], total: 8 });
  });

  it('filters by date range, type, source, attachment, and currency', async () => {
    expect(await names({ from: '2026-10-04' as LocalDate, to: '2026-10-05' as LocalDate })).toEqual(['t7', 't6', 't5']);
    expect(await names({ types: ['transfer'] })).toEqual(['t5', 't4']);
    expect(await names({ types: ['income', 'transfer'] })).toEqual(['t5', 't4', 't3']);
    expect(await names({ sources: ['import'] })).toEqual(['t3']);
    expect(await names({ hasAttachment: true })).toEqual(['t7']);
    expect(await names({ hasAttachment: false })).toEqual(ALL.filter((name) => name !== 't7'));
    expect(await names({ currencies: ['USD'] })).toEqual(['t6', 't5']);
    expect(await names({ types: [], currencies: [], sources: [], accountIds: [], categoryIds: [], tags: [] })).toEqual(
      ALL,
    );
  });

  it('filters by category (incl. fee postings) and uncategorized, OR-ed', async () => {
    expect(await names({ categoryIds: [category['system:food'] ?? ''] })).toEqual(['t9', 't6', 't1']);
    expect(await names({ categoryIds: [category['system:bank_fee'] ?? ''] })).toEqual(['t4']);
    expect(await names({ uncategorized: true })).toEqual(['t7']);
    expect(await names({ uncategorized: false })).toEqual(ALL);
    expect(await names({ categoryIds: [category['system:transport'] ?? ''], uncategorized: true })).toEqual([
      't7',
      't2',
    ]);
  });

  it('filters by account on either side of a transfer', async () => {
    expect(await names({ accountIds: [account.gopay ?? ''] })).toEqual(['t4', 't2']);
    expect(await names({ accountIds: [account.gotrade ?? ''] })).toEqual(['t6', 't5']);
  });

  it('filters by |principal amount in the base currency|, inclusive', async () => {
    expect(await names({ minAmountMinor: 50_000n, maxAmountMinor: 200_000n })).toEqual(['t7', 't6', 't4', 't1']);
    expect(await names({ minAmountMinor: 3_000_000n })).toEqual(['t5', 't3']);
    expect(await names({ maxAmountMinor: 40_000n })).toEqual(['t9', 't2']);
  });

  it('filters by tags with any/all, resolving aliases and normalizing input', async () => {
    expect(await names({ tags: ['kantor'] })).toEqual(['t3', 't2']);
    expect(await names({ tags: ['makan', '#Kantor'], tagMode: 'any' })).toEqual(['t3', 't2', 't1']);
    expect(await names({ tags: ['makan', 'kantor'], tagMode: 'all' })).toEqual(['t2']);
    expect(await names({ tags: ['masak'] })).toEqual(['t9']);
    expect(await names({ tags: ['masak', 'liburan-bali'] })).toEqual(['t9', 't7']);
    expect(await names({ tags: ['nope'] })).toEqual([]);
    expect(await names({ tags: ['!!!'] })).toEqual([]);
    expect(await names({ tags: ['kantor', 'nope'] })).toEqual(['t3', 't2']);
    expect(await names({ tags: ['kantor', 'nope'], tagMode: 'all' })).toEqual([]);
  });

  it('searches merchant and description without decrypting when there are only #tags', async () => {
    const before = dekCalls;
    expect(await names({ search: '#kantor' })).toEqual(['t3', 't2']);
    expect(await names({ search: '  #  ' })).toEqual(ALL);
    expect(await names({ search: '#kantor #makan', tags: ['makan'] })).toEqual(['t2']);
    expect(await names({ search: '#nope' })).toEqual([]);
    expect(dekCalls).toBe(before);
    expect(await names({ search: 'GAJI' })).toEqual(['t3']);
    expect(await names({ search: 'gojek #kantor' })).toEqual(['t2']);
    expect(await names({ search: 'makan #kantor' })).toEqual([]);
    expect(dekCalls).toBe(before + 3);
  });

  it('searches encrypted notes, word by word together with merchant and description', async () => {
    expect(await names({ search: 'warteg' })).toEqual(['t9', 't1']);
    expect(await names({ search: 'budi' })).toEqual(['t1']);
    expect(await names({ search: 'traktir warteg' })).toEqual(['t1']);
    expect(await names({ search: 'warteg', from: '2026-10-02' as LocalDate })).toEqual(['t9']);
    expect(await names({ search: 'bulanan', tags: ['dapur'] })).toEqual(['t9']);
  });

  it('treats LIKE wildcards in search words literally', async () => {
    expect(await names({ search: '50%_off' })).toEqual(['t7']);
    expect(await names({ search: '%' })).toEqual(['t7']);
    expect(await names({ search: '60%' })).toEqual([]);
    expect(await names({ search: '_' })).toEqual(['t7']);
  });
});

describe('groupByDay', () => {
  it('subtotals In (income) and Out (expenses, fees, FX losses) per day, newest first; transfers count only', async () => {
    expect(await asApp(() => query.groupByDay(alice, {}))).toEqual([
      { date: '2026-10-06', inMinor: 0n, outMinor: 40_000n, count: 1 },
      { date: '2026-10-05', inMinor: 0n, outMinor: 75_000n, count: 1 },
      { date: '2026-10-04', inMinor: 0n, outMinor: 22_660n + 163_500n, count: 2 },
      { date: '2026-10-03', inMinor: 0n, outMinor: 2_500n, count: 1 },
      { date: '2026-10-02', inMinor: 10_000_000n, outMinor: 0n, count: 1 },
      { date: '2026-10-01', inMinor: 0n, outMinor: 75_000n, count: 2 },
    ]);
  });

  it('applies the filter', async () => {
    expect(await asApp(() => query.groupByDay(alice, { accountIds: [account.gopay ?? ''] }))).toEqual([
      { date: '2026-10-03', inMinor: 0n, outMinor: 2_500n, count: 1 },
      { date: '2026-10-01', inMinor: 0n, outMinor: 25_000n, count: 1 },
    ]);
    expect(await asApp(() => query.groupByDay(alice, { search: 'nothing-matches' }))).toEqual([]);
  });
});

describe('groupByCategory', () => {
  it('totals each kind by category, fees and FX losses under their posting category, with shares', async () => {
    const fx = await withUser(test.db, alice, (t) => builtInCategoryIn(t, alice, FX_DIFFERENCE_CATEGORY));
    expect(await asApp(() => query.groupByCategory(alice, {}))).toEqual([
      { categoryId: category['system:salary'], kind: 'income', totalMinor: 10_000_000n, count: 1, shareBps: 10_000 },
      { categoryId: category['system:food'], kind: 'expense', totalMinor: 253_500n, count: 3, shareBps: 6695 },
      { categoryId: null, kind: 'expense', totalMinor: 75_000n, count: 1, shareBps: 1981 },
      { categoryId: category['system:transport'], kind: 'expense', totalMinor: 25_000n, count: 1, shareBps: 660 },
      { categoryId: fx, kind: 'expense', totalMinor: 22_660n, count: 1, shareBps: 598 },
      { categoryId: category['system:bank_fee'], kind: 'expense', totalMinor: 2_500n, count: 1, shareBps: 66 },
    ]);
  });

  it('applies the filter', async () => {
    expect(await asApp(() => query.groupByCategory(alice, { types: ['transfer'] }))).toEqual([
      expect.objectContaining({ kind: 'expense', totalMinor: 22_660n, shareBps: 9006 }),
      { categoryId: category['system:bank_fee'], kind: 'expense', totalMinor: 2_500n, count: 1, shareBps: 994 },
    ]);
  });
});

describe('in-transaction aggregates (budgets, dashboard)', () => {
  it('categoryTotalsIn and dayTotalsIn match groupByCategory and groupByDay', async () => {
    const filter = { from: '2026-10-02' as LocalDate, to: '2026-10-04' as LocalDate };
    const [categories, days] = await asApp(() =>
      withUser(
        test.db,
        alice,
        async (t) => [await categoryTotalsIn(t, alice, filter), await dayTotalsIn(t, alice, filter)] as const,
      ),
    );
    expect(categories).toEqual(await asApp(() => query.groupByCategory(alice, filter)));
    expect(days).toEqual(await asApp(() => query.groupByDay(alice, filter)));
    expect(days.map((day) => day.date)).toEqual(['2026-10-04', '2026-10-03', '2026-10-02']);
  });
});

describe('summary', () => {
  it('gives In/Out/Transfer and a zero-filled daily spend series over the data', async () => {
    expect(await asApp(() => query.summary(alice, {}))).toEqual({
      inMinor: 10_000_000n,
      outMinor: 378_660n,
      transferMinor: 3_200_000n,
      inCount: 1,
      outCount: 5,
      transferCount: 2,
      dailySpend: [
        { date: '2026-10-01', outMinor: 75_000n },
        { date: '2026-10-02', outMinor: 0n },
        { date: '2026-10-03', outMinor: 2_500n },
        { date: '2026-10-04', outMinor: 186_160n },
        { date: '2026-10-05', outMinor: 75_000n },
        { date: '2026-10-06', outMinor: 40_000n },
      ],
      averageDailySpendMinor: 63_110n,
    });
  });

  it('spans the requested range, flooring the average', async () => {
    const summary = await asApp(() =>
      query.summary(alice, { from: '2026-09-30' as LocalDate, to: '2026-10-10' as LocalDate }),
    );
    expect(summary.dailySpend).toHaveLength(11);
    expect(summary.dailySpend[0]).toEqual({ date: '2026-09-30', outMinor: 0n });
    expect(summary.dailySpend.at(-1)).toEqual({ date: '2026-10-10', outMinor: 0n });
    // 378.660 / 11 = 34.423,6…
    expect(summary.averageDailySpendMinor).toBe(34_423n);
  });

  it('has no days without data and without a complete range', async () => {
    const empty = {
      inMinor: 0n,
      outMinor: 0n,
      transferMinor: 0n,
      inCount: 0,
      outCount: 0,
      transferCount: 0,
      dailySpend: [],
      averageDailySpendMinor: 0n,
    };
    expect(await asApp(() => query.summary(alice, { types: ['income'], from: '2026-10-03' as LocalDate }))).toEqual(
      empty,
    );
    expect(await asApp(() => query.summary(alice, { tags: ['nope'] }))).toEqual(empty);
    const ranged = await asApp(() =>
      query.summary(alice, { tags: ['nope'], from: '2026-10-01' as LocalDate, to: '2026-10-02' as LocalDate }),
    );
    expect(ranged.dailySpend).toEqual([
      { date: '2026-10-01', outMinor: 0n },
      { date: '2026-10-02', outMinor: 0n },
    ]);
    expect(ranged.averageDailySpendMinor).toBe(0n);
  });
});

describe('golden: the full DESIGN_SEED (128 transactions, 1–15 Okt 2026)', () => {
  it('summary: In Rp26.000.000, Out Rp16.500.000, 3 transfers of Rp9.500.000', async () => {
    const summary = await asApp(() => query.summary(avtara, {}));
    expect(summary).toMatchObject({
      inMinor: 26_000_000n,
      outMinor: 16_500_000n,
      transferMinor: 9_500_000n,
      inCount: 4,
      outCount: 121,
      transferCount: 3,
      averageDailySpendMinor: 1_100_000n,
    });
    expect(summary.dailySpend.map((day) => day.date)).toEqual(
      Array.from({ length: 15 }, (_, i) => `2026-10-${String(i + 1).padStart(2, '0')}`),
    );
    expect(summary.dailySpend.reduce((sum, day) => sum + day.outMinor, 0n)).toBe(16_500_000n);
    const page = await asApp(() => query.list(avtara, {}, { limit: 200 }));
    expect(page.total).toBe(128);
    expect(page.rows).toHaveLength(128);
  });

  it('per-category expense totals match the budget cards', async () => {
    const names = new Map(
      (
        await test.query<{ id: string; name: string }>('SELECT id, name FROM categories WHERE user_id = $1', [avtara])
      ).map((row) => [row.id, row.name]),
    );
    const groups = await asApp(() => query.groupByCategory(avtara, {}));
    const expenses = groups.filter((group) => group.kind === 'expense');
    expect(expenses.map((group) => [names.get(group.categoryId ?? ''), group.totalMinor, group.count])).toEqual([
      ['system:rent', 4_500_000n, 1],
      ['system:food', 3_200_000n, 18],
      ['system:shopping', 2_400_000n, 2],
      ['system:entertainment', 2_100_000n, 39],
      ['system:transport', 1_400_000n, 49],
      ['system:bills', 1_300_000n, 6],
      ['system:subscriptions', 900_000n, 4],
      ['system:hobby', 700_000n, 2],
    ]);
    expect(groups.filter((group) => group.kind === 'income').reduce((sum, group) => sum + group.totalMinor, 0n)).toBe(
      26_000_000n,
    );
  });
});

describe('isolation', () => {
  it("never shows another user's rows", async () => {
    const bobPage = await asApp(() => query.list(bob, {}));
    expect(bobPage.total).toBe(1);
    expect(bobPage.rows[0]).toMatchObject({ merchant: 'Warteg Bahari', amountMinor: -99_000n, tags: ['makan'] });
    expect(await names({ accountIds: [bobAccount] })).toEqual([]);
    expect(await names({ search: 'warteg' })).toEqual(['t9', 't1']);
    expect(await asApp(() => query.summary(bob, {}))).toMatchObject({ outMinor: 99_000n, outCount: 1 });
  });

  it('lets the worker read the page but not write the rows it reads', async () => {
    expect(await test.as('wf_worker', () => query.summary(alice, {}))).toMatchObject({ outMinor: 378_660n });
    expect((await test.as('wf_worker', () => query.list(alice, { hasAttachment: true }))).total).toBe(1);
    await expect(
      test.as('wf_worker', () =>
        withUser(test.db, alice, (t) =>
          t
            .update(transactions)
            .set({ merchant: 'x' })
            .where(eq(transactions.id, tx.t1 ?? '')),
        ),
      ),
    ).rejects.toMatchObject(pgError(/permission denied/));
  });
});
