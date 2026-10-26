// SPDX-License-Identifier: AGPL-3.0-only
import { LedgerError } from '@wf/db/ledger-errors';
import { ImageRejectedError, MAX_IMAGE_BYTES } from '@wf/integrations/image';
import type * as ImageModule from '@wf/integrations/image';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeSession } from '../../../test/fixtures.ts';
import { call, requestContext, validatorOf } from '../../../test/server-fn.ts';
import { DEFAULT_TABLE_PREFS } from '../../lib/transaction-columns.ts';
import { MAX_IMAGES, MAX_SPLIT_PARTS, PAGE_SIZE } from '../../lib/transaction-limits.ts';
import {
  addAttachment,
  bulkAddTag,
  bulkMoveAccount,
  bulkSetCategory,
  countPeriodTransactions,
  duplicateTransaction,
  getTransactionDetail,
  getTransactionsView,
  listTransactionRows,
  removeAttachment,
  saveTablePrefs,
  splitTransaction,
  unsplitTransaction,
  updateTransaction,
} from './transactions.ts';

const fake = vi.hoisted(() => ({
  transactions: {
    get: vi.fn(),
    update: vi.fn(),
    create: vi.fn(),
    split: vi.fn(),
    unsplit: vi.fn(),
    bulkSetCategory: vi.fn(),
    bulkMoveAccount: vi.fn(),
    bulkAddTag: vi.fn(),
    addAttachment: vi.fn(),
    removeAttachment: vi.fn(),
  },
  transactionQuery: {
    list: vi.fn(),
    summary: vi.fn(),
    groupByDay: vi.fn(),
    groupByCategory: vi.fn(),
    groupByAccount: vi.fn(),
    balancesAfter: vi.fn(),
  },
  periods: { list: vi.fn() },
  preferences: { get: vi.fn(), update: vi.fn() },
  attachmentStore: { put: vi.fn(), delete: vi.fn() },
  prepareImageUpload: vi.fn(),
  prepareReceipt: vi.fn(),
}));

// vi.mock factories run before imports; they load the shared helper themselves.
vi.mock('@tanstack/react-start', async () => (await import('../../../test/server-fn.ts')).serverFnModule());
vi.mock('../runtime.ts', () => ({
  services: () => Promise.resolve({ ...fake, now: () => new Date('2026-10-15T12:40:00Z') }),
}));
vi.mock('@wf/integrations/image', async (importOriginal) => ({
  ...(await importOriginal<typeof ImageModule>()),
  prepareImageUpload: fake.prepareImageUpload,
}));
vi.mock('@wf/integrations/receipt', () => ({ prepareReceipt: fake.prepareReceipt }));

const USER_ID = fakeSession().user.id;
const ID = '0192a6c4-0000-7000-8000-0000000000b1';
const OTHER = '0192a6c4-0000-7000-8000-0000000000b2';
const CLIENT = '0192a6c4-0000-7000-8000-0000000000d1';
const CATEGORY = '0192a6c4-0000-7000-8000-0000000000e1';
const KEY = (n: number) => `u/${USER_ID}/0192a6c4-0000-7000-8000-00000000000${n}`;
const signedIn = () => requestContext(fakeSession());

const OCT = { id: 'p-oct', label: '2026-10', start: '2026-10-01', end: '2026-10-31' };
const SEP = { id: 'p-sep', label: '2026-09', start: '2026-09-01', end: '2026-09-30' };
const ROW = { id: ID };
const SUMMARY = { inMinor: 1n };
const DAYS = [{ date: '2026-10-15' }];
const CATEGORIES = [{ categoryId: null }];
const ACCOUNTS = [{ accountId: OTHER, count: 1, inMinor: 0n, outMinor: 5n }];

const EXPENSE = {
  type: 'expense',
  clientId: CLIENT,
  occurredAt: new Date('2026-10-15T05:00:00Z'),
  accountId: OTHER,
  amountMinor: 25_000n,
  categoryId: null,
} as const;

const detail = (overrides: object = {}) => ({
  id: ID,
  source: 'import',
  deletedAt: null,
  attachments: [],
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  fake.periods.list.mockResolvedValue({ today: '2026-10-15', current: OCT, periods: [OCT, SEP] });
  fake.transactionQuery.list.mockResolvedValue({ rows: [ROW], total: 7 });
  fake.transactionQuery.summary.mockResolvedValue(SUMMARY);
  fake.transactionQuery.groupByDay.mockResolvedValue(DAYS);
  fake.transactionQuery.groupByCategory.mockResolvedValue(CATEGORIES);
  fake.transactionQuery.groupByAccount.mockResolvedValue(ACCOUNTS);
  fake.transactionQuery.balancesAfter.mockResolvedValue({ [ID]: 42n });
  fake.preferences.get.mockResolvedValue({ tablePrefs: {} });
  fake.transactions.get.mockResolvedValue(detail());
  fake.attachmentStore.put.mockImplementation((_userId: string, bytes: Uint8Array) =>
    Promise.resolve({
      key: KEY(fake.attachmentStore.put.mock.calls.length),
      size: bytes.length,
      sha256: 'f'.repeat(64),
    }),
  );
  fake.attachmentStore.delete.mockResolvedValue(undefined);
});

describe('getTransactionsView', () => {
  it('gives the current period with every aggregate, the first page, and the default prefs', async () => {
    const result = await call(getTransactionsView, { context: signedIn(), data: {} });
    expect(result).toEqual({
      ok: true,
      value: {
        today: '2026-10-15',
        from: '2026-10-01',
        to: '2026-10-31',
        period: OCT,
        periods: [OCT, SEP],
        rangeSummary: { days: 31, periodCount: 1 },
        summary: SUMMARY,
        days: DAYS,
        categories: CATEGORIES,
        accounts: ACCOUNTS,
        page: { rows: [ROW], total: 7, balances: null },
        unfilteredCount: 7,
        hasTransactions: true,
        prefs: DEFAULT_TABLE_PREFS,
      },
    });
    const filter = { from: '2026-10-01', to: '2026-10-31' };
    for (const fn of ['summary', 'groupByDay', 'groupByCategory', 'groupByAccount'] as const) {
      expect(fake.transactionQuery[fn]).toHaveBeenCalledWith(USER_ID, filter);
    }
    expect(fake.transactionQuery.list).toHaveBeenCalledWith(USER_ID, filter, {
      sort: 'date_desc',
      limit: PAGE_SIZE,
      offset: 0,
    });
    expect(fake.transactionQuery.list).toHaveBeenCalledWith(USER_ID, filter, { limit: 1 });
    expect(fake.transactionQuery.list).toHaveBeenCalledWith(USER_ID, {}, { limit: 1 });
    expect(fake.transactionQuery.balancesAfter).not.toHaveBeenCalled();
  });

  it('tells a first run apart (no transaction at all)', async () => {
    fake.transactionQuery.list.mockResolvedValue({ rows: [], total: 0 });
    const result = await call<{ ok: true; value: Record<string, unknown> }>(getTransactionsView, {
      context: signedIn(),
      data: {},
    });
    expect(result.value).toMatchObject({ unfilteredCount: 0, hasTransactions: false });
  });

  it('turns every query param into the repository filter; one account adds running balances', async () => {
    fake.preferences.get.mockResolvedValue({
      tablePrefs: { transactions: { ...DEFAULT_TABLE_PREFS, density: 'compact' } },
    });
    const result = await call<{ ok: true; value: Record<string, unknown> }>(getTransactionsView, {
      context: signedIn(),
      data: {
        period: '2026-09',
        type: 'expense,transfer',
        category: CATEGORY,
        uncategorized: true,
        account: OTHER,
        tag: 'makan,kantor',
        min: 50_000,
        max: 100_000,
        attachment: false,
        source: 'manual,import',
        currency: 'IDR',
        q: 'warteg',
        sort: 'amount_desc',
      },
    });
    expect(result.value).toMatchObject({
      from: '2026-09-01',
      to: '2026-09-30',
      period: SEP,
      page: { rows: [ROW], total: 7, balances: { [ID]: 42n } },
      prefs: { density: 'compact' },
    });
    const filter = {
      from: '2026-09-01',
      to: '2026-09-30',
      types: ['expense', 'transfer'],
      categoryIds: [CATEGORY],
      uncategorized: true,
      accountIds: [OTHER],
      tags: ['makan', 'kantor'],
      tagMode: 'any',
      minAmountMinor: 50_000n,
      maxAmountMinor: 100_000n,
      hasAttachment: false,
      sources: ['manual', 'import'],
      currencies: ['IDR'],
      search: 'warteg',
    };
    expect(fake.transactionQuery.summary).toHaveBeenCalledWith(USER_ID, filter);
    expect(fake.transactionQuery.list).toHaveBeenCalledWith(USER_ID, filter, {
      sort: 'amount_desc',
      limit: PAGE_SIZE,
      offset: 0,
    });
    expect(fake.transactionQuery.list).toHaveBeenCalledWith(
      USER_ID,
      { from: '2026-09-01', to: '2026-09-30' },
      { limit: 1 },
    );
    expect(fake.transactionQuery.balancesAfter).toHaveBeenCalledWith(USER_ID, OTHER, [ID]);
  });

  it('covers a custom range (no period), all-tags mode, several accounts, an empty search, and an unknown period', async () => {
    const ranged = await call<{ ok: true; value: Record<string, unknown> }>(getTransactionsView, {
      context: signedIn(),
      data: { range: '2026-09-14..2026-10-13', tag: 'makan', tagMode: 'all', account: `${ID},${OTHER}`, q: '' },
    });
    expect(ranged.value).toMatchObject({
      from: '2026-09-14',
      to: '2026-10-13',
      period: null,
      rangeSummary: { days: 30, periodCount: 2 },
      page: { balances: null },
    });
    expect(fake.transactionQuery.summary).toHaveBeenCalledWith(USER_ID, {
      from: '2026-09-14',
      to: '2026-10-13',
      tags: ['makan'],
      tagMode: 'all',
      accountIds: [ID, OTHER],
    });
    const unknown = await call<{ ok: true; value: Record<string, unknown> }>(getTransactionsView, {
      context: signedIn(),
      data: { period: '2020-01' },
    });
    expect(unknown.value).toMatchObject({ period: OCT, from: '2026-10-01' });
  });

  it('keeps the current period first when it is not the newest row', async () => {
    const NOV = { ...OCT, id: 'p-nov', label: '2026-11' };
    fake.periods.list.mockResolvedValue({ today: '2026-10-15', current: OCT, periods: [NOV, OCT, SEP] });
    const result = await call<{ ok: true; value: { periods: unknown[] } }>(getTransactionsView, {
      context: signedIn(),
      data: {},
    });
    expect(result.value.periods).toEqual([OCT, NOV, SEP]);
  });

  it('needs a session and validates the query', async () => {
    expect(await call(getTransactionsView, { context: requestContext(null), data: {} })).toEqual({
      ok: false,
      code: 'UNAUTHENTICATED',
    });
    expect(validatorOf(getTransactionsView).safeParse({ type: 'investment' }).success).toBe(false);
  });
});

describe('listTransactionRows', () => {
  it('gives the page at `offset` for the same query', async () => {
    expect(
      await call(listTransactionRows, { context: signedIn(), data: { account: OTHER, offset: 100, sort: 'date_asc' } }),
    ).toEqual({ ok: true, value: { rows: [ROW], total: 7, balances: { [ID]: 42n } } });
    expect(fake.transactionQuery.list).toHaveBeenCalledWith(
      USER_ID,
      { from: '2026-10-01', to: '2026-10-31', accountIds: [OTHER] },
      { sort: 'date_asc', limit: PAGE_SIZE, offset: 100 },
    );
    expect(validatorOf(listTransactionRows).safeParse({ offset: -1 }).success).toBe(false);
  });
});

describe('getTransactionDetail', () => {
  it("gives the user's transaction", async () => {
    expect(await call(getTransactionDetail, { context: signedIn(), data: { id: ID } })).toEqual({
      ok: true,
      value: detail(),
    });
    expect(fake.transactions.get).toHaveBeenCalledWith(USER_ID, ID);
    fake.transactions.get.mockRejectedValueOnce(new LedgerError('NOT_FOUND'));
    expect(await call(getTransactionDetail, { context: signedIn(), data: { id: ID } })).toEqual({
      ok: false,
      code: 'NOT_FOUND',
    });
  });
});

describe('updateTransaction', () => {
  it('replaces the transaction with the input, keeping its source and, unless given, its merchant', async () => {
    fake.transactions.get.mockResolvedValue(detail({ merchant: 'Warteg' }));
    fake.transactions.update.mockResolvedValue(detail({ merchant: 'x' }));
    const input = { ...EXPENSE, merchant: 'x', source: 'manual', note: undefined };
    expect(await call(updateTransaction, { context: signedIn(), data: { id: ID, input } })).toMatchObject({ ok: true });
    expect(fake.transactions.update).toHaveBeenCalledWith(USER_ID, ID, { ...EXPENSE, merchant: 'x', source: 'import' });
    await call(updateTransaction, { context: signedIn(), data: { id: ID, input: EXPENSE } });
    expect(fake.transactions.update).toHaveBeenLastCalledWith(USER_ID, ID, {
      ...EXPENSE,
      merchant: 'Warteg',
      source: 'import',
    });
    await call(updateTransaction, { context: signedIn(), data: { id: ID, input: { ...EXPENSE, merchant: null } } });
    expect(fake.transactions.update).toHaveBeenLastCalledWith(USER_ID, ID, {
      ...EXPENSE,
      merchant: null,
      source: 'import',
    });
  });
});

describe('duplicateTransaction', () => {
  it('records the input as a copy of an existing transaction', async () => {
    fake.transactions.create.mockResolvedValue({ id: OTHER, created: true, fxDifference: null });
    expect(await call(duplicateTransaction, { context: signedIn(), data: { id: ID, input: EXPENSE } })).toEqual({
      ok: true,
      value: { id: OTHER, created: true, fxDifference: null },
    });
    expect(fake.transactions.create).toHaveBeenCalledWith(USER_ID, { ...EXPENSE, duplicatedFromId: ID });
    fake.transactions.get.mockRejectedValueOnce(new LedgerError('NOT_FOUND'));
    expect(await call(duplicateTransaction, { context: signedIn(), data: { id: OTHER, input: EXPENSE } })).toEqual({
      ok: false,
      code: 'NOT_FOUND',
    });
    expect(fake.transactions.create).toHaveBeenCalledTimes(1);
  });
});

describe('splitTransaction / unsplitTransaction', () => {
  it('splits into parts (2 to MAX_SPLIT_PARTS) and undoes it', async () => {
    fake.transactions.split.mockResolvedValue({ partIds: [ID, OTHER] });
    const parts = [
      { amountMinor: 10n, categoryId: CATEGORY, description: undefined },
      { amountMinor: 5n, categoryId: null, description: 'Ojek' },
    ];
    expect(await call(splitTransaction, { context: signedIn(), data: { id: ID, clientId: CLIENT, parts } })).toEqual({
      ok: true,
      value: { partIds: [ID, OTHER] },
    });
    expect(fake.transactions.split).toHaveBeenCalledWith(USER_ID, ID, {
      clientId: CLIENT,
      parts: [
        { amountMinor: 10n, categoryId: CATEGORY },
        { amountMinor: 5n, categoryId: null, description: 'Ojek' },
      ],
    });
    const validator = validatorOf(splitTransaction);
    const part = { amountMinor: 1n, categoryId: null };
    expect(validator.safeParse({ id: ID, clientId: CLIENT, parts: [part] }).success).toBe(false);
    expect(
      validator.safeParse({ id: ID, clientId: CLIENT, parts: Array.from({ length: MAX_SPLIT_PARTS + 1 }, () => part) })
        .success,
    ).toBe(false);
    expect(validator.safeParse({ id: ID, clientId: CLIENT, parts: [part, { ...part, amountMinor: 0n }] }).success).toBe(
      false,
    );

    fake.transactions.unsplit.mockResolvedValue({ partIds: [ID, OTHER] });
    expect(await call(unsplitTransaction, { context: signedIn(), data: { id: ID } })).toEqual({
      ok: true,
      value: { partIds: [ID, OTHER] },
    });
    expect(fake.transactions.unsplit).toHaveBeenCalledWith(USER_ID, ID);
  });
});

describe('bulk actions', () => {
  it('sets the category, moves the account, and adds a tag', async () => {
    fake.transactions.bulkSetCategory.mockResolvedValue({ updated: [ID] });
    fake.transactions.bulkMoveAccount.mockResolvedValue({ updated: [ID] });
    fake.transactions.bulkAddTag.mockResolvedValue({ updated: [ID] });
    const ids = [ID, OTHER];
    expect(await call(bulkSetCategory, { context: signedIn(), data: { ids, categoryId: null } })).toEqual({
      ok: true,
      value: { updated: [ID] },
    });
    expect(fake.transactions.bulkSetCategory).toHaveBeenCalledWith(USER_ID, ids, null);
    await call(bulkMoveAccount, { context: signedIn(), data: { ids, accountId: CATEGORY } });
    expect(fake.transactions.bulkMoveAccount).toHaveBeenCalledWith(USER_ID, ids, CATEGORY);
    await call(bulkAddTag, { context: signedIn(), data: { ids, tag: '#Liburan' } });
    expect(fake.transactions.bulkAddTag).toHaveBeenCalledWith(USER_ID, ids, '#Liburan');
    expect(validatorOf(bulkAddTag).safeParse({ ids: [], tag: 'x' }).success).toBe(false);
    expect(validatorOf(bulkAddTag).safeParse({ ids, tag: '  ' }).success).toBe(false);
  });
});

describe('addAttachment', () => {
  const form = (entries: Record<string, string | Blob>) => {
    const data = new FormData();
    for (const [key, value] of Object.entries(entries)) data.append(key, value);
    return data;
  };
  const file = (bytes: number[], name = 'struk.jpg') => new File([new Uint8Array(bytes)], name);
  const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31];
  const prepared = {
    image: { bytes: new Uint8Array([1, 2]), mime: 'image/webp' },
    thumbnail: { bytes: new Uint8Array([3]), mime: 'image/webp' },
  };
  const receipt = { id: OTHER, kind: 'receipt' };
  const add = (kind: string, upload: File) =>
    call(addAttachment, { context: signedIn(), data: form({ transactionId: ID, kind, file: upload }) });

  beforeEach(() => {
    fake.prepareImageUpload.mockResolvedValue(prepared);
    fake.prepareReceipt.mockResolvedValue({ bytes: new Uint8Array(PDF), mime: 'application/pdf', images: [] });
    fake.transactions.addAttachment.mockResolvedValue({ id: 'new' });
    fake.transactions.removeAttachment.mockResolvedValue({ objectKeys: [KEY(8), KEY(9)] });
  });

  it('stores an image with its thumbnail and keeps the receipt', async () => {
    fake.transactions.get.mockResolvedValue(detail({ attachments: [receipt, { id: 'i', kind: 'image' }] }));
    expect(await add('image', file([9, 9], '  foto.png '))).toEqual({ ok: true, value: { id: 'new' } });
    expect(fake.prepareImageUpload).toHaveBeenCalledWith(new Uint8Array([9, 9]));
    expect(fake.attachmentStore.put.mock.calls).toEqual([
      [USER_ID, prepared.image.bytes, 'image/webp'],
      [USER_ID, prepared.thumbnail.bytes, 'image/webp'],
    ]);
    expect(fake.transactions.addAttachment).toHaveBeenCalledWith(USER_ID, ID, {
      bucket: 'attachments',
      objectKey: KEY(1),
      thumbnailKey: KEY(2),
      mime: 'image/webp',
      size: 2,
      sha256: 'f'.repeat(64),
      kind: 'image',
      name: 'foto.png',
    });
    expect(fake.transactions.removeAttachment).not.toHaveBeenCalled();
  });

  it('retains the old receipt until replacement storage and row insertion have succeeded', async () => {
    fake.transactions.get.mockResolvedValue(detail({ attachments: [receipt, { id: 'i', kind: 'image' }] }));
    expect(await add('receipt', file(PDF, '   '))).toEqual({ ok: true, value: { id: 'new' } });
    expect(fake.prepareImageUpload).not.toHaveBeenCalled();
    expect(fake.attachmentStore.put).toHaveBeenCalledWith(USER_ID, new Uint8Array(PDF), 'application/pdf');
    expect(fake.transactions.addAttachment).toHaveBeenCalledWith(USER_ID, ID, {
      bucket: 'attachments',
      objectKey: KEY(1),
      thumbnailKey: null,
      mime: 'application/pdf',
      size: PDF.length,
      sha256: 'f'.repeat(64),
      kind: 'receipt',
      name: null,
    });
    expect(fake.transactions.removeAttachment).toHaveBeenCalledWith(USER_ID, OTHER);
    expect(fake.transactions.removeAttachment.mock.invocationCallOrder[0]).toBeGreaterThan(
      fake.transactions.addAttachment.mock.invocationCallOrder[0] ?? Infinity,
    );
    expect(fake.attachmentStore.delete.mock.calls).toEqual([
      [USER_ID, KEY(8)],
      [USER_ID, KEY(9)],
    ]);
  });

  it('keeps the old receipt when safe PDF or strict receipt format validation refuses the replacement', async () => {
    fake.transactions.get.mockResolvedValue(detail({ attachments: [receipt] }));
    fake.prepareReceipt.mockRejectedValueOnce(new ImageRejectedError('unsupported-type', 'webp'));
    expect(await add('receipt', file([1]))).toMatchObject({ ok: false, code: 'IMAGE_REJECTED' });
    expect(fake.transactions.removeAttachment).not.toHaveBeenCalled();
    expect(fake.attachmentStore.put).not.toHaveBeenCalled();
  });

  it('sends a PDF given as an image through the image pipeline', async () => {
    fake.prepareImageUpload.mockRejectedValueOnce(new ImageRejectedError('unsupported-type', 'pdf'));
    expect(await add('image', file(PDF))).toEqual({ ok: false, code: 'IMAGE_REJECTED', detail: 'unsupported-type' });
    expect(fake.attachmentStore.put).not.toHaveBeenCalled();
  });

  it('refuses a full set of images, a large file, and a deleted transaction before storing', async () => {
    const images = Array.from({ length: MAX_IMAGES }, (_, index) => ({ id: String(index), kind: 'image' }));
    fake.transactions.get.mockResolvedValueOnce(detail({ attachments: images }));
    expect(await add('image', file([1]))).toEqual({ ok: false, code: 'ATTACHMENT_LIMIT' });
    fake.transactions.get.mockResolvedValueOnce(detail({ attachments: images }));
    expect(await add('receipt', file(PDF))).toMatchObject({ ok: true });
    expect(await add('receipt', file(Array.from({ length: MAX_IMAGE_BYTES + 1 }, () => 0)))).toEqual({
      ok: false,
      code: 'IMAGE_REJECTED',
      detail: 'too-large',
    });
    fake.transactions.get.mockResolvedValueOnce(detail({ deletedAt: new Date() }));
    expect(await add('image', file([1]))).toEqual({ ok: false, code: 'NOT_FOUND' });
    expect(fake.attachmentStore.put).toHaveBeenCalledTimes(1);
  });

  it('rethrows pipeline crashes and deletes the stored objects when saving fails', async () => {
    fake.prepareImageUpload.mockRejectedValueOnce(new Error('libvips crashed'));
    await expect(add('image', file([1]))).rejects.toThrow('libvips crashed');

    fake.transactions.addAttachment.mockRejectedValueOnce(new LedgerError('NOT_FOUND'));
    expect(await add('image', file([1]))).toEqual({ ok: false, code: 'NOT_FOUND' });
    expect(fake.attachmentStore.delete.mock.calls).toEqual([
      [USER_ID, KEY(1)],
      [USER_ID, KEY(2)],
    ]);
    fake.transactions.addAttachment.mockRejectedValueOnce(new LedgerError('NOT_FOUND'));
    await add('receipt', file(PDF));
    expect(fake.attachmentStore.delete).toHaveBeenLastCalledWith(USER_ID, KEY(3));
    expect(fake.attachmentStore.delete).toHaveBeenCalledTimes(3);
  });

  it('validates the form', async () => {
    await expect(add('document', file([1]))).rejects.toThrow();
    await expect(
      call(addAttachment, { context: signedIn(), data: form({ transactionId: 'x', kind: 'image', file: file([1]) }) }),
    ).rejects.toThrow();
    await expect(
      call(addAttachment, { context: signedIn(), data: form({ transactionId: ID, kind: 'image', file: 'text' }) }),
    ).rejects.toThrow();
  });
});

describe('removeAttachment', () => {
  it('removes the attachment and the objects nothing else uses', async () => {
    fake.transactions.removeAttachment.mockResolvedValue({ objectKeys: [KEY(1)] });
    expect(await call(removeAttachment, { context: signedIn(), data: { id: ID } })).toEqual({ ok: true, value: null });
    expect(fake.transactions.removeAttachment).toHaveBeenCalledWith(USER_ID, ID);
    expect(fake.attachmentStore.delete).toHaveBeenCalledWith(USER_ID, KEY(1));
  });
});

describe('saveTablePrefs', () => {
  it("saves the prefs next to other tables' prefs", async () => {
    const prefs = { ...DEFAULT_TABLE_PREFS, density: 'compact' as const };
    fake.preferences.get.mockResolvedValue({ tablePrefs: { accounts: { x: 1 } } });
    fake.preferences.update.mockResolvedValue({ tablePrefs: { accounts: { x: 1 }, transactions: prefs } });
    expect(await call(saveTablePrefs, { context: signedIn(), data: prefs })).toEqual({ ok: true, value: prefs });
    expect(fake.preferences.update).toHaveBeenCalledWith(USER_ID, {
      tablePrefs: { accounts: { x: 1 }, transactions: prefs },
    });
  });
});

describe('countPeriodTransactions', () => {
  it('counts the live transactions of the current period', async () => {
    expect(await call(countPeriodTransactions, { context: signedIn() })).toEqual({ ok: true, value: 7 });
    expect(fake.transactionQuery.list).toHaveBeenCalledWith(
      USER_ID,
      { from: '2026-10-01', to: '2026-10-31' },
      { limit: 1 },
    );
  });
});
