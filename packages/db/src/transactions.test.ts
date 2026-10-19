// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from 'node:crypto';
import type { BuiltInCategoryKey } from '@wf/domain/categories';
import type { LocalDate } from '@wf/domain/period';
import { DESIGN_SEED } from '@wf/domain/seed';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { testKeyring } from '../test/keys.ts';
import { insertUser, pgError, PGLITE_HOOK_TIMEOUT, startMigrated, type TestDatabase } from '../test/pglite.ts';
import { withUser } from './db.ts';
import { createFxRates } from './fx-rates.ts';
import { builtInCategoryIn, type EntryDraft, type TransferDraft } from './ledger-core.ts';
import { postings } from './schema.ts';
import {
  createTransactions,
  type AttachmentInput,
  type TransactionDetail,
  type TransactionsRepository,
} from './transactions.ts';
import { createUserKeys, type UserKeys } from './user-keys.ts';

let test: TestDatabase;
let keys: UserKeys;
let repo: TransactionsRepository;
let dekCalls: number;
let clock: number;
let alice: string;
let bob: string;
let bca: string;
let jago: string;
let gotrade: string;
let bobsBank: string;
let food: string;
let transport: string;
let salary: string;
let bankFee: string;

const NOW = Date.UTC(2026, 9, 15, 5, 0);
const asApp = <T>(fn: () => Promise<T>) => test.as('wf_app', fn);
const minutes = (n: number) => new Date(NOW + n * 60_000);

beforeAll(async () => {
  test = await startMigrated();
  keys = createUserKeys(test.db, testKeyring().keyring);
  repo = createTransactions(test.db, {
    getDek: (userId) => {
      dekCalls++;
      return keys.getOrCreateDek(userId);
    },
    now: () => minutes(clock++),
  });
}, PGLITE_HOOK_TIMEOUT);

afterAll(async () => {
  await test.close();
});

async function insertAccount(userId: string, key: string): Promise<string> {
  const seed = DESIGN_SEED.accounts.find((account) => account.key === key);
  const [row] = await test.query<{ id: string }>(
    `INSERT INTO accounts (user_id, type, provider_name, display_name, currency, opening_balance_minor, opening_date, color)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [
      userId,
      seed?.type,
      seed?.providerName,
      seed?.displayName,
      seed?.currency,
      seed?.openingBalanceMinor.toString(),
      seed?.openingDate,
      seed?.color,
    ],
  );
  return row?.id ?? '';
}

const category = (userId: string, key: BuiltInCategoryKey) =>
  asApp(() => withUser(test.db, userId, (tx) => builtInCategoryIn(tx, userId, key)));

beforeEach(async () => {
  dekCalls = 0;
  clock = 0;
  await test.query('DELETE FROM users');
  alice = await insertUser(test, 'alice@example.test');
  bob = await insertUser(test, 'bob@example.test');
  bca = await insertAccount(alice, 'bca');
  jago = await insertAccount(alice, 'jago');
  gotrade = await insertAccount(alice, 'gotrade');
  bobsBank = await insertAccount(bob, 'bca');
  food = await category(alice, 'system:food');
  transport = await category(alice, 'system:transport');
  salary = await category(alice, 'system:salary');
  bankFee = await category(alice, 'system:bank_fee');
  // The design's manual rate (Kurs manual): 1 USD = 16.350,0275 IDR.
  await asApp(() =>
    createFxRates(test.db).upsertManual(alice, {
      base: 'USD',
      quote: 'IDR',
      rate: '16350.0275',
      asOf: '2026-10-01' as LocalDate,
    }),
  );
});

const expense = (overrides: Partial<EntryDraft> = {}): EntryDraft => ({
  type: 'expense',
  clientId: randomUUID(),
  occurredAt: new Date('2026-10-12T12:30:00+07:00'),
  accountId: bca,
  amountMinor: 45_000n,
  categoryId: food,
  merchant: 'Kopi Kenangan',
  ...overrides,
});

const income = (overrides: Partial<EntryDraft> = {}): EntryDraft => ({
  type: 'income',
  clientId: randomUUID(),
  occurredAt: new Date('2026-10-01T09:00:00+07:00'),
  accountId: bca,
  amountMinor: 18_500_000n,
  categoryId: salary,
  description: 'Gaji Oktober',
  ...overrides,
});

/** The design transfer: Rp3.000.000 from BCA, US$182,10 received on Gotrade. */
const topUp = (overrides: Partial<TransferDraft> = {}): TransferDraft => ({
  type: 'transfer',
  clientId: randomUUID(),
  occurredAt: new Date('2026-10-10T09:00:00+07:00'),
  fromAccountId: bca,
  toAccountId: gotrade,
  sentMinor: 3_000_000n,
  receivedMinor: 18_210n,
  description: 'Top up Gotrade',
  ...overrides,
});

const feeTransfer = (): TransferDraft => ({
  type: 'transfer',
  clientId: randomUUID(),
  occurredAt: new Date('2026-10-05T10:00:00+07:00'),
  fromAccountId: bca,
  toAccountId: jago,
  sentMinor: 1_000_000n,
  receivedMinor: 1_000_000n,
  fee: { minor: 2_500n, categoryId: bankFee },
  tags: ['dana-darurat'],
});

const attachment = (overrides: Partial<AttachmentInput> = {}): AttachmentInput => ({
  bucket: 'wf-attachments',
  objectKey: `u/${alice}/${randomUUID()}`,
  mime: 'image/jpeg',
  size: 120_000,
  sha256: 'a'.repeat(64),
  kind: 'receipt',
  ...overrides,
});

const create = async (draft: EntryDraft | TransferDraft) => (await asApp(() => repo.create(alice, draft))).id;
const get = (id: string, userId = alice) => asApp(() => repo.get(userId, id));
/** Postings without their generated ids (`toEqual` ignores `undefined` properties). */
const lines = (detail: TransactionDetail) => detail.postings.map((line) => ({ ...line, id: undefined }));
const NOT_FOUND = { code: 'NOT_FOUND' };

describe('create and get', () => {
  it('records an expense with note and tags, replays its clientId, and reads it back', async () => {
    const draft = expense({ note: '  rapat tim  ', tags: ['#Kerja', 'kopi'], description: 'Kopi susu' });
    const first = await asApp(() => repo.create(alice, draft));
    expect(first).toEqual({ id: first.id, created: true, fxDifference: null });
    expect(await asApp(() => repo.create(alice, { ...draft, amountMinor: 1n }))).toEqual({
      id: first.id,
      created: false,
      fxDifference: null,
    });
    expect(await test.query('SELECT count(*)::int AS n FROM transactions')).toEqual([{ n: 1 }]);

    const detail = await get(first.id);
    expect(detail).toMatchObject({
      id: first.id,
      type: 'expense',
      occurredAt: draft.occurredAt,
      localDate: '2026-10-12',
      description: 'Kopi susu',
      merchant: 'Kopi Kenangan',
      note: 'rapat tim',
      categoryId: food,
      source: 'manual',
      splitParentId: null,
      duplicatedFromId: null,
      clientId: draft.clientId,
      deletedAt: null,
      tags: ['kerja', 'kopi'],
      transfer: null,
      attachments: [],
      activity: [{ action: 'created', meta: { source: 'manual' } }],
    });
    expect(lines(detail)).toEqual([
      {
        accountId: bca,
        amountMinor: -45_000n,
        currency: 'IDR',
        fxRateToBase: null,
        amountBaseMinor: -45_000n,
        role: 'principal',
        categoryId: null,
      },
    ]);

    const [stored] = await test.query<{ note_enc: Uint8Array }>('SELECT note_enc FROM transactions');
    expect(Buffer.from(stored?.note_enc ?? []).toString('latin1')).not.toContain('rapat tim');
  });

  it('records an income without touching the DEK when there is nothing to encrypt', async () => {
    const id = await create(income({ note: '   ' }));
    const detail = await get(id);
    expect(detail).toMatchObject({ type: 'income', note: null, categoryId: salary, tags: [] });
    expect(lines(detail)).toMatchObject([{ amountMinor: 18_500_000n, amountBaseMinor: 18_500_000n }]);
    await create(income());
    expect(dekCalls).toBe(0);
  });

  it('values a foreign-currency expense in the base currency', async () => {
    const detail = await get(await create(expense({ accountId: gotrade, amountMinor: 1_000n, categoryId: null })));
    expect(lines(detail)).toEqual([
      {
        accountId: gotrade,
        amountMinor: -1_000n,
        currency: 'USD',
        fxRateToBase: '16350.0275',
        amountBaseMinor: -163_500n,
        role: 'principal',
        categoryId: null,
      },
    ]);
  });

  it('records the design IDR → USD transfer with its FX difference', async () => {
    const result = await asApp(() => repo.create(alice, topUp()));
    expect(result.fxDifference).toEqual({
      expectedReceivedMinor: 18_349n,
      shortfallReceivedMinor: 139n,
      differenceBaseMinor: -22_660n,
    });
    const fxDifference = await category(alice, 'system:fx_difference');
    const detail = await get(result.id);
    expect(detail).toMatchObject({ type: 'transfer', categoryId: null, description: 'Top up Gotrade' });
    expect(lines(detail)).toEqual([
      {
        accountId: bca,
        amountMinor: -3_000_000n,
        currency: 'IDR',
        fxRateToBase: null,
        amountBaseMinor: -3_000_000n,
        role: 'principal',
        categoryId: null,
      },
      {
        accountId: gotrade,
        amountMinor: 18_210n,
        currency: 'USD',
        fxRateToBase: '16350.0275',
        amountBaseMinor: 2_977_340n,
        role: 'principal',
        categoryId: null,
      },
      {
        accountId: gotrade,
        amountMinor: 0n,
        currency: 'USD',
        fxRateToBase: null,
        amountBaseMinor: -22_660n,
        role: 'fx_diff',
        categoryId: fxDifference,
      },
    ]);
    expect(detail.transfer).toEqual({
      sentMinor: 3_000_000n,
      sentCurrency: 'IDR',
      receivedMinor: 18_210n,
      receivedCurrency: 'USD',
      referenceRate: '16350.0275',
      rateBase: 'USD',
      rateQuote: 'IDR',
      rateSource: 'manual',
      rateAsOf: '2026-10-01',
      fxDiffBaseMinor: -22_660n,
    });
  });

  it('records a transfer fee as its own posting', async () => {
    const detail = await get(await create(feeTransfer()));
    expect(lines(detail)).toEqual([
      expect.objectContaining({ accountId: bca, amountMinor: -1_000_000n, role: 'principal' }),
      expect.objectContaining({ accountId: jago, amountMinor: 1_000_000n, role: 'principal' }),
      expect.objectContaining({ accountId: bca, amountMinor: -2_500n, role: 'fee', categoryId: bankFee }),
    ]);
    expect(detail.transfer).toMatchObject({ referenceRate: null, rateSource: null, fxDiffBaseMinor: 0n });
    expect(detail.tags).toEqual(['dana-darurat']);
  });

  it('refuses invalid drafts and other users’ accounts', async () => {
    await expect(asApp(() => repo.create(alice, expense({ amountMinor: 0n })))).rejects.toMatchObject({
      code: 'INVALID_TRANSACTION',
    });
    await expect(asApp(() => repo.create(alice, expense({ categoryId: salary })))).rejects.toMatchObject({
      code: 'CATEGORY_KIND_MISMATCH',
    });
    await expect(asApp(() => repo.create(bob, expense()))).rejects.toMatchObject(NOT_FOUND);
    await expect(get(randomUUID())).rejects.toMatchObject(NOT_FOUND);
  });
});

describe('update', () => {
  it('replaces the transaction and logs which fields changed', async () => {
    const draft = expense({ tags: ['kopi'] });
    const id = await create(draft);
    const edited = expense({
      clientId: randomUUID(),
      amountMinor: 50_000n,
      description: 'Rapat',
      note: 'catatan',
      categoryId: transport,
      tags: ['kopi', 'kerja'],
    });
    clock = 100;
    const updated = await asApp(() => repo.update(alice, id, edited));
    expect(updated).toMatchObject({
      id,
      clientId: draft.clientId,
      description: 'Rapat',
      note: 'catatan',
      categoryId: transport,
      tags: ['kerja', 'kopi'],
      updatedAt: minutes(100),
    });
    expect(lines(updated)).toMatchObject([{ amountMinor: -50_000n }]);
    // Unchanged: nothing listed.
    await asApp(() => repo.update(alice, id, edited));
    // Into an income: the note is cleared, the merchant dropped.
    const asIncome = income({ amountMinor: 50_000n, description: 'Rapat', note: '', source: 'quick' });
    expect(await asApp(() => repo.update(alice, id, asIncome))).toMatchObject({ type: 'income', note: null });
    // Into a transfer (no note at all).
    const asTransfer = await asApp(() => repo.update(alice, id, { ...feeTransfer(), description: 'Rapat' }));
    expect(asTransfer).toMatchObject({ type: 'transfer', categoryId: null, transfer: { sentMinor: 1_000_000n } });
    expect(asTransfer.activity.map((entry) => [entry.action, entry.meta])).toEqual([
      ['created', { source: 'manual' }],
      ['updated', { fields: ['description', 'note', 'categoryId', 'amounts', 'tags'] }],
      ['updated', { fields: [] }],
      ['updated', { fields: ['type', 'occurredAt', 'merchant', 'note', 'categoryId', 'source', 'amounts', 'tags'] }],
      ['updated', { fields: ['type', 'occurredAt', 'categoryId', 'source', 'amounts', 'tags'] }],
    ]);
  });

  it('refuses deleted and invisible transactions', async () => {
    const id = await create(expense());
    await expect(
      asApp(() => repo.update(bob, id, expense({ accountId: bobsBank, categoryId: null }))),
    ).rejects.toMatchObject(NOT_FOUND);
    await asApp(() => repo.remove(alice, [id]));
    await expect(asApp(() => repo.update(alice, id, expense()))).rejects.toMatchObject(NOT_FOUND);
  });
});

describe('remove and restore', () => {
  it('soft-deletes and restores only the visible rows in the right state', async () => {
    const a = await create(expense());
    const b = await create(income());
    const bobs = (await asApp(() => repo.create(bob, expense({ accountId: bobsBank, categoryId: null })))).id;
    expect(await asApp(() => repo.remove(alice, []))).toEqual({ deleted: [] });
    clock = 100;
    expect((await asApp(() => repo.remove(alice, [a, bobs]))).deleted).toEqual([a]);
    expect(await asApp(() => repo.remove(alice, [a]))).toEqual({ deleted: [] });
    const deleted = await get(a);
    expect(deleted.deletedAt).toEqual(minutes(100));
    expect(await test.query('SELECT count(*)::int AS n FROM postings WHERE transaction_id = $1', [a])).toEqual([
      { n: 1 },
    ]);

    expect(await asApp(() => repo.restore(alice, [a, b, bobs]))).toEqual({ restored: [a] });
    expect(await asApp(() => repo.restore(bob, [a]))).toEqual({ restored: [] });
    const restored = await get(a);
    expect(restored.deletedAt).toBeNull();
    expect(restored.activity.map((entry) => entry.action)).toEqual(['created', 'deleted', 'restored']);
    expect((await get(bobs, bob)).deletedAt).toBeNull();
  });
});

describe('duplicate', () => {
  it('copies an expense with note, tags and category, dated now, without attachments', async () => {
    const id = await create(expense({ note: 'rapat tim', tags: ['kerja'], description: 'Kopi susu' }));
    await asApp(() => repo.addAttachment(alice, id, attachment()));
    const clientId = randomUUID();
    clock = 100;
    const copy = await asApp(() => repo.duplicate(alice, id, { clientId }));
    expect(copy.created).toBe(true);
    expect(await get(copy.id)).toMatchObject({
      type: 'expense',
      occurredAt: minutes(100),
      localDate: '2026-10-15',
      description: 'Kopi susu',
      merchant: 'Kopi Kenangan',
      note: 'rapat tim',
      categoryId: food,
      duplicatedFromId: id,
      clientId,
      tags: ['kerja'],
      attachments: [],
    });
    expect(await asApp(() => repo.duplicate(alice, id, { clientId }))).toEqual({
      id: copy.id,
      created: false,
      fxDifference: null,
    });
    expect((await get(id)).activity.map((entry) => [entry.action, entry.meta])).toEqual([
      ['created', { source: 'manual' }],
      ['updated', { fields: ['attachments'] }],
      ['duplicated', { copy: copy.id }],
    ]);
  });

  it('copies a transfer with its manual rate, and one with its fee', async () => {
    const original = await create(topUp());
    const copy = await asApp(() => repo.duplicate(alice, original, { clientId: randomUUID() }));
    expect(copy.fxDifference).toMatchObject({ differenceBaseMinor: -22_660n });
    expect((await get(copy.id)).transfer).toMatchObject({
      referenceRate: '16350.0275',
      rateSource: 'manual',
      rateAsOf: '2026-10-15',
      fxDiffBaseMinor: -22_660n,
    });

    const withFee = await create(feeTransfer());
    const feeCopy = await get((await asApp(() => repo.duplicate(alice, withFee, { clientId: randomUUID() }))).id);
    expect(lines(feeCopy)).toMatchObject([
      { amountMinor: -1_000_000n },
      { amountMinor: 1_000_000n },
      { amountMinor: -2_500n, role: 'fee', categoryId: bankFee },
    ]);
    expect(feeCopy).toMatchObject({ note: null, tags: ['dana-darurat'] });
  });

  it('refuses deleted rows and types it cannot copy', async () => {
    const id = await create(expense());
    await asApp(() => repo.remove(alice, [id]));
    await expect(asApp(() => repo.duplicate(alice, id, { clientId: randomUUID() }))).rejects.toMatchObject(NOT_FOUND);
    const [dividend] = await test.query<{ id: string }>(
      `INSERT INTO transactions (user_id, type, occurred_at, local_date, client_id, confirmed_by_user_at)
       VALUES ($1, 'dividend', now(), '2026-10-15', $2, now()) RETURNING id`,
      [alice, randomUUID()],
    );
    await expect(
      asApp(() => repo.duplicate(alice, dividend?.id ?? '', { clientId: randomUUID() })),
    ).rejects.toMatchObject({ code: 'INVALID_TRANSACTION' });
  });
});

describe('split', () => {
  it('replaces an expense with parts sharing its note, tags and attachments; replays; unsplits', async () => {
    const parent = await create(
      expense({ amountMinor: 150_000n, description: 'Makan siang', note: 'makan siang tim', tags: ['kerja'] }),
    );
    const receipt = attachment({ thumbnailKey: `u/${alice}/thumb` });
    await asApp(() => repo.addAttachment(alice, parent, receipt));
    const clientId = randomUUID();
    const parts = [
      { amountMinor: 100_000n, categoryId: food },
      { amountMinor: 50_000n, categoryId: transport, description: 'Ojek' },
    ];
    const { partIds } = await asApp(() => repo.split(alice, parent, { clientId, parts }));
    expect(partIds).toHaveLength(2);
    expect(await asApp(() => repo.split(alice, parent, { clientId, parts }))).toEqual({ partIds });

    const [first, second] = [await get(partIds[0] ?? ''), await get(partIds[1] ?? '')];
    const shared = {
      type: 'expense',
      occurredAt: new Date('2026-10-12T12:30:00+07:00'),
      merchant: 'Kopi Kenangan',
      note: 'makan siang tim',
      tags: ['kerja'],
      splitParentId: parent,
      attachments: [expect.objectContaining({ objectKey: receipt.objectKey, thumbnailKey: receipt.thumbnailKey })],
    };
    expect(first).toMatchObject({ ...shared, description: 'Makan siang', categoryId: food });
    expect(second).toMatchObject({ ...shared, description: 'Ojek', categoryId: transport });
    expect(lines(first)).toMatchObject([{ accountId: bca, amountMinor: -100_000n }]);
    expect(lines(second)).toMatchObject([{ accountId: bca, amountMinor: -50_000n }]);
    const parentDetail = await get(parent);
    expect(parentDetail.deletedAt).not.toBeNull();
    expect(parentDetail.activity.at(-1)).toMatchObject({ action: 'split', meta: { parts: partIds } });

    // Shared objects are only released by the last row referencing them.
    const firstAttachment = first.attachments[0]?.id ?? '';
    expect(await asApp(() => repo.removeAttachment(alice, firstAttachment))).toEqual({ objectKeys: [] });

    expect(await asApp(() => repo.unsplit(alice, parent))).toEqual({ partIds });
    expect((await get(parent)).deletedAt).toBeNull();
    expect((await get(partIds[0] ?? '')).deletedAt).not.toBeNull();
    await expect(asApp(() => repo.unsplit(alice, parent))).rejects.toMatchObject(NOT_FOUND);
  });

  it('checks the parts and the transaction type', async () => {
    const id = await create(income({ amountMinor: 1_000_000n }));
    const split = (parts: readonly { amountMinor: bigint; categoryId: string | null }[], target = id) =>
      asApp(() => repo.split(alice, target, { clientId: randomUUID(), parts }));
    await expect(
      split([
        { amountMinor: 600_000n, categoryId: salary },
        { amountMinor: 300_000n, categoryId: null },
      ]),
    ).rejects.toMatchObject({ code: 'SPLIT_MISMATCH', message: 'SPLIT_MISMATCH' });
    await expect(split([{ amountMinor: 1_000_000n, categoryId: salary }])).rejects.toMatchObject({
      code: 'INVALID_TRANSACTION',
    });
    await expect(
      split([
        { amountMinor: 600_000n, categoryId: food },
        { amountMinor: 400_000n, categoryId: null },
      ]),
    ).rejects.toMatchObject({ code: 'CATEGORY_KIND_MISMATCH' });
    const transfer = await create(feeTransfer());
    await expect(
      split(
        [
          { amountMinor: 500_000n, categoryId: null },
          { amountMinor: 500_000n, categoryId: null },
        ],
        transfer,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_TRANSACTION' });

    const { partIds } = await split([
      { amountMinor: 600_000n, categoryId: salary },
      { amountMinor: 400_000n, categoryId: null },
    ]);
    const part = await get(partIds[1] ?? '');
    expect(part).toMatchObject({ type: 'income', description: 'Gaji Oktober', categoryId: null, attachments: [] });
    expect(lines(part)).toMatchObject([{ amountMinor: 400_000n }]);
  });
});

describe('bulk edits', () => {
  it('sets the category of expenses, checking its kind', async () => {
    const a = await create(expense());
    const b = await create(expense({ categoryId: transport }));
    expect(await asApp(() => repo.bulkSetCategory(alice, [a, b], transport))).toEqual({ updated: [a] });
    expect((await get(a)).categoryId).toBe(transport);
    expect(await asApp(() => repo.bulkSetCategory(alice, [a, b], null))).toEqual({ updated: [a, b].toSorted() });
    expect((await get(b)).activity.at(-1)).toMatchObject({ meta: { fields: ['categoryId'], bulk: true } });
    await expect(asApp(() => repo.bulkSetCategory(alice, [a], salary))).rejects.toMatchObject({
      code: 'CATEGORY_KIND_MISMATCH',
    });
    const transfer = await create(feeTransfer());
    await expect(asApp(() => repo.bulkSetCategory(alice, [a, transfer], food))).rejects.toMatchObject({
      code: 'INVALID_TRANSACTION',
    });
    expect(await asApp(() => repo.bulkSetCategory(bob, [a], null))).toEqual({ updated: [] });
  });

  it('moves expenses and incomes to another account in the same currency', async () => {
    const a = await create(expense({ tags: ['kopi'] }));
    const b = await create(income());
    const onJago = await create(expense({ accountId: jago }));
    const { updated } = await asApp(() => repo.bulkMoveAccount(alice, [a, b, onJago], jago));
    expect(updated.toSorted()).toEqual([a, b].toSorted());
    expect(lines(await get(a))).toMatchObject([{ accountId: jago, amountMinor: -45_000n }]);
    expect(await get(b)).toMatchObject({ tags: [], activity: [{}, { meta: { fields: ['accountId'], bulk: true } }] });
    expect(lines(await get(b))).toMatchObject([{ accountId: jago, amountMinor: 18_500_000n }]);
    expect((await get(a)).tags).toEqual(['kopi']);

    await expect(asApp(() => repo.bulkMoveAccount(alice, [a], gotrade))).rejects.toMatchObject({
      code: 'INVALID_TRANSACTION',
    });
    const transfer = await create(feeTransfer());
    await expect(asApp(() => repo.bulkMoveAccount(alice, [transfer], bca))).rejects.toMatchObject({
      code: 'INVALID_TRANSACTION',
    });
    await expect(asApp(() => repo.bulkMoveAccount(alice, [a], bobsBank))).rejects.toMatchObject(NOT_FOUND);
  });

  it('adds a tag to rows that lack it, refusing a sixth tag', async () => {
    const a = await create(expense({ tags: ['kopi'] }));
    const b = await create(feeTransfer());
    expect(await asApp(() => repo.bulkAddTag(alice, [a, b], '#Kopi'))).toEqual({ updated: [b] });
    expect((await get(b)).tags).toEqual(['dana-darurat', 'kopi']);
    expect(await asApp(() => repo.bulkAddTag(alice, [a, b], 'kopi'))).toEqual({ updated: [] });
    const full = await create(expense({ tags: ['t1', 't2', 't3', 't4', 't5'] }));
    await expect(asApp(() => repo.bulkAddTag(alice, [a, full], 'kerja'))).rejects.toMatchObject({
      code: 'TOO_MANY_TAGS',
    });
    expect((await get(a)).tags).toEqual(['kopi']);
    await expect(asApp(() => repo.bulkAddTag(alice, [a], '!!'))).rejects.toMatchObject({ code: 'INVALID_TAG' });
  });
});

describe('attachments', () => {
  it('stores the name encrypted and returns unreferenced keys on removal', async () => {
    const id = await create(expense());
    const named = attachment({ name: ' struk-kopi.jpg ', thumbnailKey: `u/${alice}/t1` });
    const first = await asApp(() => repo.addAttachment(alice, id, named));
    const second = await asApp(() => repo.addAttachment(alice, id, attachment({ name: '  ', kind: 'document' })));
    const [stored] = await test.query<{ name_enc: Uint8Array }>('SELECT name_enc FROM attachments WHERE id = $1', [
      first.id,
    ]);
    expect(Buffer.from(stored?.name_enc ?? []).toString('latin1')).not.toContain('struk-kopi');

    expect((await get(id)).attachments).toEqual([
      {
        id: first.id,
        mime: 'image/jpeg',
        size: 120_000,
        kind: 'receipt',
        objectKey: named.objectKey,
        thumbnailKey: named.thumbnailKey,
        name: 'struk-kopi.jpg',
        createdAt: expect.any(Date) as Date,
      },
      expect.objectContaining({ id: second.id, kind: 'document', thumbnailKey: null, name: null }),
    ]);
    expect(await asApp(() => repo.removeAttachment(alice, first.id))).toEqual({
      objectKeys: [named.objectKey, named.thumbnailKey],
    });
    await expect(asApp(() => repo.removeAttachment(alice, first.id))).rejects.toMatchObject(NOT_FOUND);
    await expect(asApp(() => repo.removeAttachment(bob, second.id))).rejects.toMatchObject(NOT_FOUND);
    expect((await asApp(() => repo.removeAttachment(alice, second.id))).objectKeys).toHaveLength(1);
  });

  it('refuses deleted and invisible transactions', async () => {
    const id = await create(expense());
    await expect(asApp(() => repo.addAttachment(bob, id, attachment()))).rejects.toMatchObject(NOT_FOUND);
    await asApp(() => repo.remove(alice, [id]));
    await expect(asApp(() => repo.addAttachment(alice, id, attachment()))).rejects.toMatchObject(NOT_FOUND);
  });
});

describe('isolation and roles', () => {
  it('hides another user’s transactions from every method', async () => {
    const id = await create(expense());
    await expect(get(id, bob)).rejects.toMatchObject(NOT_FOUND);
    expect(await asApp(() => repo.remove(bob, [id]))).toEqual({ deleted: [] });
    await expect(asApp(() => repo.duplicate(bob, id, { clientId: randomUUID() }))).rejects.toMatchObject(NOT_FOUND);
    await expect(
      asApp(() =>
        repo.split(bob, id, {
          clientId: randomUUID(),
          parts: [
            { amountMinor: 1n, categoryId: null },
            { amountMinor: 44_999n, categoryId: null },
          ],
        }),
      ),
    ).rejects.toMatchObject(NOT_FOUND);
    expect(await asApp(() => repo.bulkAddTag(bob, [id], 'kopi'))).toEqual({ updated: [] });
    expect((await get(id)).deletedAt).toBeNull();
  });

  it('does not let the worker insert transactions or postings', async () => {
    const id = await create(expense());
    const dek = await asApp(() => keys.getOrCreateDek(alice));
    const worker = createTransactions(test.db, { getDek: () => Promise.resolve(dek) });
    await expect(test.as('wf_worker', () => worker.create(alice, expense()))).rejects.toMatchObject(
      pgError(/permission denied for table transactions/),
    );
    await expect(
      test.as('wf_worker', () =>
        withUser(test.db, alice, (tx) =>
          tx.insert(postings).values({
            userId: alice,
            transactionId: id,
            accountId: bca,
            amountMinor: 1n,
            currency: 'IDR',
            amountBaseMinor: 1n,
          }),
        ),
      ),
    ).rejects.toMatchObject(pgError(/permission denied for table postings/));
  });
});
