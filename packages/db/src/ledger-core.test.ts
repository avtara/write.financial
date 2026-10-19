// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from 'node:crypto';
import { decryptText } from '@wf/crypto/cipher';
import { generateDek } from '@wf/crypto/envelope';
import { FX_DIFFERENCE_CATEGORY } from '@wf/domain/categories';
import type { LocalDate } from '@wf/domain/period';
import type { BuiltInCategoryKey } from '@wf/domain/categories';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { insertUser, pgError, PGLITE_HOOK_TIMEOUT, startMigrated, type TestDatabase } from '../test/pglite.ts';
import { firstRow, withUser, type Transaction } from './db.ts';
import { createFxRates } from './fx-rates.ts';
import {
  builtInCategoryIn,
  checkCategoryIn,
  localDateOf,
  NOTE_PURPOSE,
  recordTransactionIn,
  resolveTagsIn,
  valuationIn,
  type TransactionDraft,
} from './ledger-core.ts';

let test: TestDatabase;
let alice: string;
let bob: string;
let ids: Record<'bca' | 'jago' | 'gotrade' | 'dbs' | 'old' | 'bobs', string>;

const dek = generateDek();
const NOW = new Date('2026-10-15T10:00:00Z');
const day = (value: string) => value as LocalDate;

/** Runs `fn` as wf_app in Alice's (or `userId`'s) user transaction. */
const inUser = <T>(fn: (tx: Transaction) => Promise<T>, userId = alice) =>
  test.as('wf_app', () => withUser(test.db, userId, fn));

async function insertAccount(userId: string, name: string, currency: string, status = 'active'): Promise<string> {
  const rows = await test.query<{ id: string }>(
    `INSERT INTO accounts (user_id, type, provider_name, display_name, currency, opening_date, color, status, archived_at)
     VALUES ($1, 'bank', $2, $2::text, $3, '2026-09-30', 'blue', $4::account_status,
             CASE WHEN $4::text = 'archived' THEN now() END) RETURNING id`,
    [userId, name, currency, status],
  );
  return firstRow(rows, 'accounts').id;
}

const expense = (overrides: Partial<TransactionDraft> = {}): TransactionDraft =>
  ({
    type: 'expense',
    clientId: randomUUID(),
    occurredAt: new Date('2026-10-14T17:30:00Z'),
    accountId: ids.bca,
    amountMinor: 85_000n,
    categoryId: null,
    ...overrides,
  }) as TransactionDraft;

const transfer = (overrides: Partial<TransactionDraft> = {}): TransactionDraft =>
  ({
    type: 'transfer',
    clientId: randomUUID(),
    occurredAt: new Date('2026-10-14T12:30:00Z'),
    fromAccountId: ids.bca,
    toAccountId: ids.gotrade,
    sentMinor: 3_000_000n,
    receivedMinor: 18_210n,
    ...overrides,
  }) as TransactionDraft;

beforeAll(async () => {
  test = await startMigrated();
}, PGLITE_HOOK_TIMEOUT);

afterAll(async () => {
  await test.close();
});

beforeEach(async () => {
  await test.query('DELETE FROM users');
  await test.query('DELETE FROM fx_rates');
  alice = await insertUser(test, 'alice@example.test');
  bob = await insertUser(test, 'bob@example.test');
  ids = {
    bca: await insertAccount(alice, 'BCA', 'IDR'),
    jago: await insertAccount(alice, 'Jago', 'IDR'),
    gotrade: await insertAccount(alice, 'Gotrade', 'USD'),
    dbs: await insertAccount(alice, 'DBS', 'SGD'),
    old: await insertAccount(alice, 'Old', 'IDR', 'archived'),
    bobs: await insertAccount(bob, 'Bob', 'IDR'),
  };
});

describe('localDateOf', () => {
  it('is the calendar date in the user time zone', () => {
    expect(localDateOf(new Date('2026-10-14T17:30:00Z'), 'Asia/Jakarta')).toBe('2026-10-15');
    expect(localDateOf(new Date('2026-10-14T17:30:00Z'), 'UTC')).toBe('2026-10-14');
  });
});

describe('valuationIn', () => {
  it('needs no rate for the base currency and resolves the others, falling back to a later rate', async () => {
    expect(await inUser((tx) => valuationIn(tx, 'IDR', ['IDR', 'IDR']))).toEqual({ baseCurrency: 'IDR', rates: [] });
    await test.as('wf_app', () =>
      createFxRates(test.db).upsertManual(alice, {
        base: 'USD',
        quote: 'IDR',
        rate: '16350',
        asOf: day('2026-10-15'),
      }),
    );
    const valuation = await inUser((tx) => valuationIn(tx, 'IDR', ['USD'], day('2026-10-01')));
    expect(valuation.rates).toMatchObject([{ base: 'USD', quote: 'IDR', rate: '16350' }]);
    await expect(inUser((tx) => valuationIn(tx, 'IDR', ['SGD']))).rejects.toMatchObject({ code: 'FX_RATE_MISSING' });
  });
});

describe('builtInCategoryIn / checkCategoryIn', () => {
  it('creates a built-in category once and finds it afterwards', async () => {
    const first = await inUser((tx) => builtInCategoryIn(tx, alice, FX_DIFFERENCE_CATEGORY));
    const second = await inUser((tx) => builtInCategoryIn(tx, alice, FX_DIFFERENCE_CATEGORY));
    expect(second).toBe(first);
    expect(await test.query('SELECT kind, "group", name, is_system FROM categories')).toEqual([
      { kind: 'fee', group: 'financial', name: 'system:fx_difference', is_system: true },
    ]);
    await expect(
      inUser((tx) => builtInCategoryIn(tx, alice, 'system:nope' as BuiltInCategoryKey)),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('checks existence, archive state, and kind', async () => {
    const food = await inUser((tx) => builtInCategoryIn(tx, alice, 'system:food'));
    const salary = await inUser((tx) => builtInCategoryIn(tx, alice, 'system:salary'));
    const fee = await inUser((tx) => builtInCategoryIn(tx, alice, 'system:bank_fee'));
    await inUser((tx) => checkCategoryIn(tx, food, 'expense'));
    await inUser((tx) => checkCategoryIn(tx, fee, 'expense'));
    await inUser((tx) => checkCategoryIn(tx, salary, 'income'));
    await expect(inUser((tx) => checkCategoryIn(tx, salary, 'expense'))).rejects.toMatchObject({
      code: 'CATEGORY_KIND_MISMATCH',
    });
    await expect(inUser((tx) => checkCategoryIn(tx, food, 'income'))).rejects.toMatchObject({
      code: 'CATEGORY_KIND_MISMATCH',
    });
    await test.query('UPDATE categories SET archived_at = now() WHERE id = $1', [food]);
    await expect(inUser((tx) => checkCategoryIn(tx, food, 'expense'))).rejects.toMatchObject({
      code: 'INVALID_CATEGORY',
    });
    // Bob cannot use Alice's category.
    await expect(inUser((tx) => checkCategoryIn(tx, salary, 'income'), bob)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('resolveTagsIn', () => {
  it('normalizes, de-duplicates, follows aliases, and creates missing tags', async () => {
    expect(await inUser((tx) => resolveTagsIn(tx, alice, []))).toEqual([]);
    const [darurat] = await inUser((tx) => resolveTagsIn(tx, alice, ['#Dana Darurat']));
    await test.query(`INSERT INTO tag_aliases (user_id, tag_id, slug) VALUES ($1, $2, 'darurat')`, [alice, darurat]);
    const resolved = await inUser((tx) => resolveTagsIn(tx, alice, ['dana-darurat', 'darurat', 'DCA', 'dca']));
    expect(resolved).toHaveLength(2);
    expect(resolved[0]).toBe(darurat);
    expect(await inUser((tx) => resolveTagsIn(tx, alice, ['darurat']))).toEqual([darurat]);
  });

  it('rejects unusable and too many tags', async () => {
    await expect(inUser((tx) => resolveTagsIn(tx, alice, ['#']))).rejects.toMatchObject({ code: 'INVALID_TAG' });
    await expect(inUser((tx) => resolveTagsIn(tx, alice, ['a', 'b', 'c', 'd', 'e', 'f']))).rejects.toMatchObject({
      code: 'TOO_MANY_TAGS',
    });
  });
});

describe('recordTransactionIn', () => {
  it('records an expense with category, tags, and an encrypted note, idempotently', async () => {
    const food = await inUser((tx) => builtInCategoryIn(tx, alice, 'system:food'));
    const draft = expense({
      categoryId: food,
      merchant: '  Warteg Bahari ',
      description: ' ',
      note: 'makan siang',
      tags: ['makan', '#Kantor'],
      source: 'quick',
    });
    const first = await inUser((tx) => recordTransactionIn(tx, alice, draft, dek, NOW));
    expect(first).toMatchObject({ created: true, fxDifference: null });
    expect(await inUser((tx) => recordTransactionIn(tx, alice, draft, dek, NOW))).toEqual({
      id: first.id,
      created: false,
      fxDifference: null,
    });

    const [row] = await test.query<{
      type: string;
      local_date: string;
      merchant: string;
      description: string | null;
      note_enc: Uint8Array;
      source: string;
    }>('SELECT type, local_date::text, merchant, description, note_enc, source FROM transactions');
    expect(row).toMatchObject({
      type: 'expense',
      local_date: '2026-10-15',
      merchant: 'Warteg Bahari',
      description: null,
      source: 'quick',
    });
    expect(decryptText(dek, row?.note_enc as Uint8Array, { userId: alice, purpose: NOTE_PURPOSE })).toBe('makan siang');
    expect(await test.query('SELECT amount_minor::text, amount_base_minor::text, role FROM postings')).toEqual([
      { amount_minor: '-85000', amount_base_minor: '-85000', role: 'principal' },
    ]);
    expect(await test.query('SELECT count(*)::int AS n FROM transaction_tags')).toEqual([{ n: 2 }]);
    expect(await test.query(`SELECT action, meta FROM activity_log WHERE entity = 'transaction'`)).toEqual([
      { action: 'created', meta: { source: 'quick' } },
    ]);
  });

  it('records income and needs the DEK for a note', async () => {
    await inUser((tx) =>
      recordTransactionIn(tx, alice, { ...expense(), type: 'income', note: '  ' } as TransactionDraft, null, NOW),
    );
    expect(await test.query('SELECT type, note_enc FROM transactions')).toEqual([{ type: 'income', note_enc: null }]);
    await expect(inUser((tx) => recordTransactionIn(tx, alice, expense({ note: 'x' }), null, NOW))).rejects.toThrow(
      TypeError,
    );
  });

  it('rejects other users’ or archived accounts, bad amounts, and missing rates', async () => {
    await expect(
      inUser((tx) => recordTransactionIn(tx, alice, expense({ accountId: ids.bobs }), null, NOW)),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      inUser((tx) => recordTransactionIn(tx, alice, expense({ accountId: ids.old }), null, NOW)),
    ).rejects.toMatchObject({ code: 'ACCOUNT_ARCHIVED' });
    await expect(
      inUser((tx) => recordTransactionIn(tx, alice, expense({ amountMinor: 0n }), null, NOW)),
    ).rejects.toMatchObject({ code: 'INVALID_TRANSACTION' });
    await expect(
      inUser((tx) => recordTransactionIn(tx, alice, expense({ accountId: ids.gotrade }), null, NOW)),
    ).rejects.toMatchObject({ code: 'FX_RATE_MISSING' });
  });

  it('records the design IDR → USD transfer with the FX difference to "Selisih kurs"', async () => {
    await test.as('wf_worker', () =>
      createFxRates(test.db).upsertGlobal([
        {
          base: 'USD',
          quote: 'IDR',
          rate: '16350.0275',
          provider: 'frankfurter',
          rateType: 'bi_transaction',
          asOf: day('2026-10-15'),
        },
      ]),
    );
    const fee = await inUser((tx) => builtInCategoryIn(tx, alice, 'system:platform_fee'));
    const result = await inUser((tx) =>
      recordTransactionIn(tx, alice, transfer({ fee: { minor: 2_500n, categoryId: fee } }), null, NOW),
    );
    expect(result.fxDifference?.differenceBaseMinor).toBe(-22_660n);
    const lines = await test.query<{ role: string; amount_minor: string; amount_base_minor: string; name: string }>(
      `SELECT p.role, p.amount_minor::text, p.amount_base_minor::text, c.name
       FROM postings p LEFT JOIN categories c ON c.id = p.category_id ORDER BY p.role, p.amount_minor`,
    );
    expect(lines).toEqual([
      { role: 'principal', amount_minor: '-3000000', amount_base_minor: '-3000000', name: null },
      { role: 'principal', amount_minor: '18210', amount_base_minor: '2977340', name: null },
      { role: 'fee', amount_minor: '-2500', amount_base_minor: '-2500', name: 'system:platform_fee' },
      { role: 'fx_diff', amount_minor: '0', amount_base_minor: '-22660', name: FX_DIFFERENCE_CATEGORY },
    ]);
    expect(
      await test.query(
        `SELECT reference_rate::text, rate_base, rate_quote, rate_source, rate_as_of::text, fx_diff_base_minor::text
         FROM transfer_meta`,
      ),
    ).toEqual([
      {
        reference_rate: '16350.02750000',
        rate_base: 'USD',
        rate_quote: 'IDR',
        rate_source: 'frankfurter',
        rate_as_of: '2026-10-15',
        fx_diff_base_minor: '-22660',
      },
    ]);
  });

  it('uses a manual rate, falls back to a later reference, and needs one across currencies', async () => {
    const manual = await inUser((tx) =>
      recordTransactionIn(
        tx,
        alice,
        transfer({ manualRate: { base: 'USD', quote: 'IDR', rate: '16474.4645799' } }),
        null,
        NOW,
      ),
    );
    expect(manual.fxDifference?.differenceBaseMinor).toBe(0n);
    expect(await test.query(`SELECT rate_source, rate_as_of::text FROM transfer_meta`)).toEqual([
      { rate_source: 'manual', rate_as_of: '2026-10-14' },
    ]);
    await expect(inUser((tx) => recordTransactionIn(tx, alice, transfer(), null, NOW))).rejects.toMatchObject({
      code: 'FX_RATE_MISSING',
    });
    // Only a rate dated after the transfer exists: it is used.
    await test.as('wf_app', () =>
      createFxRates(test.db).upsertManual(alice, {
        base: 'USD',
        quote: 'IDR',
        rate: '16350',
        asOf: day('2026-10-20'),
      }),
    );
    const later = await inUser((tx) => recordTransactionIn(tx, alice, transfer(), null, NOW));
    expect(later.fxDifference?.differenceBaseMinor).toBe(-22_665n);
  });

  it('values legs outside the base currency with their own rates', async () => {
    const fx = createFxRates(test.db);
    await test.as('wf_app', async () => {
      await fx.upsertManual(alice, { base: 'USD', quote: 'IDR', rate: '16350', asOf: day('2026-10-01') });
      await fx.upsertManual(alice, { base: 'SGD', quote: 'IDR', rate: '12500', asOf: day('2026-10-01') });
      await fx.upsertManual(alice, { base: 'USD', quote: 'SGD', rate: '1.35', asOf: day('2026-10-01') });
    });
    const result = await inUser((tx) =>
      recordTransactionIn(
        tx,
        alice,
        transfer({ fromAccountId: ids.gotrade, toAccountId: ids.dbs, sentMinor: 10_000n, receivedMinor: 13_000n }),
        null,
        NOW,
      ),
    );
    expect(result.fxDifference?.differenceBaseMinor).toBe(-62_500n);
    expect(
      await test.query(`SELECT currency, amount_base_minor::text FROM postings WHERE role = 'principal' ORDER BY 1`),
    ).toEqual([
      { currency: 'SGD', amount_base_minor: '1625000' },
      { currency: 'USD', amount_base_minor: '-1635000' },
    ]);
  });

  it('moves money between same-currency accounts without an FX category', async () => {
    await inUser((tx) =>
      recordTransactionIn(
        tx,
        alice,
        transfer({ toAccountId: ids.jago, sentMinor: 500_000n, receivedMinor: 500_000n }),
        null,
        NOW,
      ),
    );
    expect(await test.query('SELECT count(*)::int AS n FROM categories')).toEqual([{ n: 0 }]);
    expect(await test.query('SELECT reference_rate, rate_source FROM transfer_meta')).toEqual([
      { reference_rate: null, rate_source: null },
    ]);
    await expect(
      inUser((tx) => recordTransactionIn(tx, alice, transfer({ toAccountId: ids.bca }), null, NOW)),
    ).rejects.toMatchObject({ code: 'INVALID_TRANSACTION' });
    await expect(
      inUser((tx) => recordTransactionIn(tx, alice, transfer({ toAccountId: ids.jago, receivedMinor: 1n }), null, NOW)),
    ).rejects.toMatchObject({ code: 'INVALID_TRANSACTION' });
  });

  it('enforces at most five tags in the database and keeps the worker out', async () => {
    const { id } = await inUser((tx) =>
      recordTransactionIn(tx, alice, expense({ tags: ['a', 'b', 'c', 'd', 'e'] }), null, NOW),
    );
    const [tag] = await test.query<{ id: string }>(`INSERT INTO tags (user_id, slug) VALUES ($1, 'f') RETURNING id`, [
      alice,
    ]);
    await expect(
      test.query('INSERT INTO transaction_tags (user_id, transaction_id, tag_id) VALUES ($1, $2, $3)', [
        alice,
        id,
        tag?.id,
      ]),
    ).rejects.toThrow(/at most 5 tags/);
    await expect(
      test.as('wf_worker', () =>
        withUser(test.db, alice, (tx) => recordTransactionIn(tx, alice, expense(), null, NOW)),
      ),
    ).rejects.toMatchObject(pgError(/permission denied/));
  });
});
