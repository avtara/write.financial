// SPDX-License-Identifier: AGPL-3.0-only
import { ImageRejectedError } from '@wf/integrations/image';
import type * as ImageModule from '@wf/integrations/image';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeSession } from '../../../test/fixtures.ts';
import { call, requestContext, validatorOf } from '../../../test/server-fn.ts';
import {
  archiveAccount,
  createAccount,
  deleteAccount,
  getAccountDetail,
  reconcileAccount,
  reconcileAccounts,
  removeAccountLogo,
  reorderAccounts,
  restoreAccount,
  setAccountLogo,
  updateAccount,
} from './accounts.ts';

const fake = vi.hoisted(() => ({
  accounts: {
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    archive: vi.fn(),
    restore: vi.fn(),
    deletePermanently: vi.fn(),
    reorder: vi.fn(),
    reconcile: vi.fn(),
    flows: vi.fn(),
    series: vi.fn(),
  },
  categories: { list: vi.fn() },
  transactions: { create: vi.fn() },
  transactionQuery: { list: vi.fn() },
  attachmentStore: { delete: vi.fn() },
  logoStore: { put: vi.fn(), delete: vi.fn() },
  logger: { warn: vi.fn() },
  prepareImageUpload: vi.fn(),
}));

vi.mock('@tanstack/react-start', async () => (await import('../../../test/server-fn.ts')).serverFnModule());
vi.mock('../runtime.ts', () => ({
  services: () => Promise.resolve({ ...fake, now: () => new Date('2026-10-15T12:40:00Z') }),
}));
vi.mock('@wf/integrations/image', async (importOriginal) => ({
  ...(await importOriginal<typeof ImageModule>()),
  prepareImageUpload: fake.prepareImageUpload,
}));

const USER_ID = fakeSession().user.id;
const ID = '0192a6c4-0000-7000-8000-0000000000b1';
const OTHER = '0192a6c4-0000-7000-8000-0000000000b2';
const CLIENT = '0192a6c4-0000-7000-8000-0000000000d1';
const CATEGORY = '0192a6c4-0000-7000-8000-0000000000e1';
const LOGO = `u/${USER_ID}/0192a6c4-0000-7000-8000-0000000000c1`;
const signedIn = () => requestContext(fakeSession());
const ledgerError = (code: string) => Object.assign(new Error(code), { code });

const INPUT = {
  type: 'bank',
  providerName: 'SeaBank',
  displayName: 'SeaBank',
  currency: 'IDR',
  openingBalanceMinor: 1_500_000n,
  openingDate: '2026-10-15',
  color: 'blue',
  last4: '7710',
} as const;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('account writes', () => {
  it('creates and updates accounts of the session user, dropping undefined fields', async () => {
    fake.accounts.create.mockResolvedValue({ id: ID });
    expect(await call(createAccount, { context: signedIn(), data: INPUT })).toEqual({ ok: true, value: { id: ID } });
    expect(fake.accounts.create).toHaveBeenCalledWith(USER_ID, INPUT);

    fake.accounts.update.mockResolvedValue({ id: ID });
    await call(updateAccount, { context: signedIn(), data: { id: ID, patch: { displayName: 'Sea', last4: null } } });
    expect(fake.accounts.update).toHaveBeenCalledWith(USER_ID, ID, { displayName: 'Sea', last4: null });
  });

  it('restores, reorders, and reconciles for the session user', async () => {
    fake.accounts.restore.mockResolvedValue({ id: ID });
    await call(restoreAccount, { context: signedIn(), data: { id: ID } });
    expect(fake.accounts.restore).toHaveBeenCalledWith(USER_ID, ID);

    expect(await call(reorderAccounts, { context: signedIn(), data: { ids: [OTHER, ID] } })).toEqual({
      ok: true,
      value: null,
    });
    expect(fake.accounts.reorder).toHaveBeenCalledWith(USER_ID, [OTHER, ID]);

    const result = { differenceMinor: -15_000n, transactionId: null, adjustmentId: 'a' };
    fake.accounts.reconcile.mockResolvedValue(result);
    const correction = { id: ID, mode: 'correction', actualBalanceMinor: 42_795_000n } as const;
    expect(await call(reconcileAccount, { context: signedIn(), data: correction })).toEqual({
      ok: true,
      value: result,
    });
    expect(fake.accounts.reconcile).toHaveBeenCalledWith(USER_ID, ID, {
      mode: 'correction',
      actualBalanceMinor: 42_795_000n,
    });
  });

  it('reconciles several accounts as categorized transactions at one time', async () => {
    const at = new Date('2026-10-15T12:40:00Z');
    fake.accounts.reconcile.mockResolvedValueOnce({ differenceMinor: -14_500n });
    fake.accounts.reconcile.mockResolvedValueOnce({ differenceMinor: -38_000n });
    const items = [
      { id: ID, actualBalanceMinor: 71_500n, categoryId: CATEGORY, clientId: CLIENT },
      { id: OTHER, actualBalanceMinor: 312_000n, categoryId: null, clientId: CATEGORY },
    ];
    expect(await call(reconcileAccounts, { context: signedIn(), data: { occurredAt: at, items } })).toEqual({
      ok: true,
      value: [{ differenceMinor: -14_500n }, { differenceMinor: -38_000n }],
    });
    expect(fake.accounts.reconcile.mock.calls).toEqual([
      [
        USER_ID,
        ID,
        { mode: 'transaction', occurredAt: at, actualBalanceMinor: 71_500n, categoryId: CATEGORY, clientId: CLIENT },
      ],
      [
        USER_ID,
        OTHER,
        { mode: 'transaction', occurredAt: at, actualBalanceMinor: 312_000n, categoryId: null, clientId: CATEGORY },
      ],
    ]);
  });

  it('archives, with an optional transfer of a positive balance', async () => {
    fake.accounts.archive.mockResolvedValue({ id: ID, status: 'archived' });
    await call(archiveAccount, { context: signedIn(), data: { id: ID } });
    expect(fake.accounts.archive).toHaveBeenLastCalledWith(USER_ID, ID);
    expect(fake.transactions.create).not.toHaveBeenCalled();

    fake.accounts.get.mockImplementation((_user: string, id: string) =>
      Promise.resolve({ id, currency: 'IDR', balanceMinor: id === ID ? 42_810_000n : 8_125_000n }),
    );
    const transfer = { toAccountId: OTHER, clientId: CLIENT };
    await call(archiveAccount, { context: signedIn(), data: { id: ID, transfer } });
    expect(fake.transactions.create).toHaveBeenCalledWith(USER_ID, {
      type: 'transfer',
      clientId: CLIENT,
      occurredAt: new Date('2026-10-15T12:40:00Z'),
      fromAccountId: ID,
      toAccountId: OTHER,
      sentMinor: 42_810_000n,
      receivedMinor: 42_810_000n,
      source: 'manual',
    });
    expect(fake.accounts.archive).toHaveBeenLastCalledWith(USER_ID, ID);

    // Nothing to move: the transfer is skipped.
    fake.transactions.create.mockClear();
    fake.accounts.get.mockResolvedValue({ id: ID, currency: 'IDR', balanceMinor: 0n });
    await call(archiveAccount, { context: signedIn(), data: { id: ID, transfer } });
    expect(fake.transactions.create).not.toHaveBeenCalled();
  });

  it('refuses a balance transfer to another currency', async () => {
    fake.accounts.get.mockImplementation((_user: string, id: string) =>
      Promise.resolve({ id, currency: id === ID ? 'IDR' : 'USD', balanceMinor: 1n }),
    );
    const data = { id: ID, transfer: { toAccountId: OTHER, clientId: CLIENT } };
    expect(await call(archiveAccount, { context: signedIn(), data })).toEqual({ ok: false, code: 'INVALID_ACCOUNT' });
    expect(fake.accounts.archive).not.toHaveBeenCalled();
  });

  it('deletes permanently, then the attachment objects and the logo; storage failures are only logged', async () => {
    fake.accounts.get.mockResolvedValue({ logoKey: LOGO });
    fake.accounts.deletePermanently.mockResolvedValue({ deletedTransactions: 87, objectKeys: ['k1', 'k2'] });
    fake.attachmentStore.delete.mockResolvedValueOnce(undefined);
    const failure = new Error('s3 down');
    fake.attachmentStore.delete.mockRejectedValueOnce(failure);
    fake.logoStore.delete.mockResolvedValue(undefined);
    expect(await call(deleteAccount, { context: signedIn(), data: { id: ID } })).toEqual({
      ok: true,
      value: { deletedTransactions: 87 },
    });
    expect(fake.attachmentStore.delete.mock.calls).toEqual([
      [USER_ID, 'k1'],
      [USER_ID, 'k2'],
    ]);
    expect(fake.logoStore.delete).toHaveBeenCalledWith(USER_ID, LOGO);
    expect(fake.logger.warn).toHaveBeenCalledWith({ err: failure }, 'account object deletion failed');

    fake.accounts.get.mockResolvedValue({ logoKey: null });
    fake.accounts.deletePermanently.mockResolvedValue({ deletedTransactions: 0, objectKeys: [] });
    fake.logoStore.delete.mockClear();
    await call(deleteAccount, { context: signedIn(), data: { id: ID } });
    expect(fake.logoStore.delete).not.toHaveBeenCalled();
  });

  it('turns ledger errors into expected results and refuses signed-out requests', async () => {
    fake.accounts.update.mockRejectedValueOnce(ledgerError('ACCOUNT_LOCKED'));
    expect(await call(updateAccount, { context: signedIn(), data: { id: ID, patch: { currency: 'USD' } } })).toEqual({
      ok: false,
      code: 'ACCOUNT_LOCKED',
    });
    expect(await call(restoreAccount, { context: requestContext(null), data: { id: ID } })).toEqual({
      ok: false,
      code: 'UNAUTHENTICATED',
    });
    expect(fake.accounts.restore).not.toHaveBeenCalled();
  });
});

describe('getAccountDetail', () => {
  it('loads six months, this month’s flows, and the latest rows with their categories', async () => {
    fake.accounts.series.mockResolvedValue([{ month: '2026-10' }]);
    fake.accounts.flows.mockResolvedValue({ inflowMinor: 1n });
    fake.transactionQuery.list.mockResolvedValue({
      rows: [
        { id: 't1', categoryId: CATEGORY },
        { id: 't2', categoryId: null },
      ],
      total: 2,
    });
    fake.categories.list.mockResolvedValue([
      { id: CATEGORY, name: 'system:food', builtInKey: 'system:food', icon: 'utensils', color: 'orange', kind: 'x' },
      { id: OTHER, name: 'Other', builtInKey: null, icon: 'tag', color: 'blue', kind: 'x' },
    ]);
    expect(await call(getAccountDetail, { context: signedIn(), data: { id: ID } })).toEqual({
      ok: true,
      value: {
        today: '2026-10-15',
        series: [{ month: '2026-10' }],
        flows: { inflowMinor: 1n },
        recent: [
          { id: 't1', categoryId: CATEGORY },
          { id: 't2', categoryId: null },
        ],
        categories: [
          { id: CATEGORY, name: 'system:food', builtInKey: 'system:food', icon: 'utensils', color: 'orange' },
        ],
      },
    });
    expect(fake.accounts.series).toHaveBeenCalledWith(USER_ID, ID, { months: 6, end: '2026-10-15' });
    expect(fake.accounts.flows).toHaveBeenCalledWith(USER_ID, ID, { from: '2026-10-01', to: '2026-10-15' });
    expect(fake.transactionQuery.list).toHaveBeenCalledWith(
      USER_ID,
      { accountIds: [ID] },
      { sort: 'date_desc', limit: 5 },
    );
    expect(fake.categories.list).toHaveBeenCalledWith(USER_ID, { includeArchived: true });
  });

  it('skips the categories without rows, and uses the default time zone when the user has none', async () => {
    const session = fakeSession();
    const context = requestContext({ ...session, user: { ...session.user, timezone: null } });
    fake.accounts.series.mockResolvedValue([]);
    fake.accounts.flows.mockResolvedValue({});
    fake.transactionQuery.list.mockResolvedValue({ rows: [], total: 0 });
    expect(await call(getAccountDetail, { context, data: { id: ID } })).toMatchObject({
      ok: true,
      value: { today: '2026-10-15', categories: [] },
    });
    expect(fake.categories.list).not.toHaveBeenCalled();
  });
});

describe('account logos', () => {
  const form = (entries: Record<string, string | Blob>) => {
    const data = new FormData();
    for (const [key, value] of Object.entries(entries)) data.set(key, value);
    return data;
  };
  const png = () => new File([new Uint8Array([137, 80, 78, 71])], 'logo.png', { type: 'image/png' });

  it('stores the re-encoded thumbnail, links it, and deletes the previous logo', async () => {
    const thumbnail = { bytes: new Uint8Array([9]), mime: 'image/webp' };
    fake.accounts.get.mockResolvedValue({ logoKey: 'old' });
    fake.prepareImageUpload.mockResolvedValue({ image: {}, thumbnail });
    fake.logoStore.put.mockResolvedValue({ key: LOGO });
    fake.accounts.update.mockResolvedValue({ id: ID, logoKey: LOGO });
    expect(await call(setAccountLogo, { context: signedIn(), data: form({ id: ID, file: png() }) })).toEqual({
      ok: true,
      value: { id: ID, logoKey: LOGO },
    });
    expect(fake.prepareImageUpload).toHaveBeenCalledWith(new Uint8Array([137, 80, 78, 71]));
    expect(fake.logoStore.put).toHaveBeenCalledWith(USER_ID, thumbnail.bytes, 'image/webp');
    expect(fake.accounts.update).toHaveBeenCalledWith(USER_ID, ID, { logoKey: LOGO });
    expect(fake.logoStore.delete).toHaveBeenCalledWith(USER_ID, 'old');

    fake.accounts.get.mockResolvedValue({ logoKey: null });
    fake.logoStore.delete.mockClear();
    await call(setAccountLogo, { context: signedIn(), data: form({ id: ID, file: png() }) });
    expect(fake.logoStore.delete).not.toHaveBeenCalled();
  });

  it('checks the account before reading the image, and reports rejected images with their reason', async () => {
    fake.accounts.get.mockRejectedValueOnce(ledgerError('NOT_FOUND'));
    expect(await call(setAccountLogo, { context: signedIn(), data: form({ id: ID, file: png() }) })).toEqual({
      ok: false,
      code: 'NOT_FOUND',
    });
    expect(fake.prepareImageUpload).not.toHaveBeenCalled();

    fake.accounts.get.mockResolvedValue({ logoKey: null });
    fake.prepareImageUpload.mockRejectedValueOnce(new ImageRejectedError('unsupported-type', 'svg'));
    expect(await call(setAccountLogo, { context: signedIn(), data: form({ id: ID, file: png() }) })).toEqual({
      ok: false,
      code: 'IMAGE_REJECTED',
      detail: 'unsupported-type',
    });
    fake.prepareImageUpload.mockRejectedValueOnce(new Error('libvips crashed'));
    await expect(call(setAccountLogo, { context: signedIn(), data: form({ id: ID, file: png() }) })).rejects.toThrow(
      'libvips crashed',
    );
    expect(fake.logoStore.put).not.toHaveBeenCalled();
  });

  it('rejects form data without a valid id or file', async () => {
    await expect(call(setAccountLogo, { context: signedIn(), data: form({ id: 'x', file: png() }) })).rejects.toThrow();
    await expect(call(setAccountLogo, { context: signedIn(), data: form({ id: ID, file: 'text' }) })).rejects.toThrow();
  });

  it('removes the logo and its object', async () => {
    fake.accounts.get.mockResolvedValue({ logoKey: LOGO });
    fake.accounts.update.mockResolvedValue({ id: ID, logoKey: null });
    expect(await call(removeAccountLogo, { context: signedIn(), data: { id: ID } })).toEqual({
      ok: true,
      value: { id: ID, logoKey: null },
    });
    expect(fake.accounts.update).toHaveBeenCalledWith(USER_ID, ID, { logoKey: null });
    expect(fake.logoStore.delete).toHaveBeenCalledWith(USER_ID, LOGO);

    fake.accounts.get.mockResolvedValue({ logoKey: null });
    fake.logoStore.delete.mockClear();
    await call(removeAccountLogo, { context: signedIn(), data: { id: ID } });
    expect(fake.logoStore.delete).not.toHaveBeenCalled();
  });
});

describe('validators', () => {
  it('accepts the account fields and refuses bad ones', () => {
    const create = validatorOf(createAccount);
    expect(create.safeParse(INPUT).success).toBe(true);
    expect(
      create.safeParse({ ...INPUT, color: '#14b8a6', ccStatementDay: 20, lowBalanceThresholdMinor: 0n }).success,
    ).toBe(true);
    for (const bad of [
      { openingDate: '2026-02-30' },
      { openingDate: 'tomorrow' },
      { color: 'plaid' },
      { currency: 'idr' },
      { last4: '77' },
      { ccDueDay: 32 },
      { lowBalanceThresholdMinor: -1n },
      { displayName: ' ' },
      { type: 'loan' },
    ]) {
      expect(create.safeParse({ ...INPUT, ...bad }).success, JSON.stringify(Object.keys(bad))).toBe(false);
    }
    expect(validatorOf(updateAccount).safeParse({ id: ID, patch: {} }).success).toBe(true);
    expect(validatorOf(reorderAccounts).safeParse({ ids: ['x'] }).success).toBe(false);
    expect(validatorOf(setAccountLogo).safeParse({ id: ID }).success).toBe(false);
  });

  it('requires a category and client id only for transaction reconciliations', () => {
    const reconcile = validatorOf(reconcileAccount);
    expect(reconcile.safeParse({ id: ID, mode: 'correction', actualBalanceMinor: 1n }).success).toBe(true);
    expect(reconcile.safeParse({ id: ID, mode: 'transaction', actualBalanceMinor: 1n }).success).toBe(false);
    expect(
      reconcile.safeParse({
        id: ID,
        mode: 'transaction',
        actualBalanceMinor: 1n,
        categoryId: null,
        clientId: CLIENT,
        occurredAt: new Date(),
      }).success,
    ).toBe(true);
    expect(validatorOf(reconcileAccounts).safeParse({ occurredAt: new Date(), items: [] }).success).toBe(false);
  });
});
