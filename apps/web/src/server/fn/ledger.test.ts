// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeSession } from '../../../test/fixtures.ts';
import { call, requestContext, validatorOf } from '../../../test/server-fn.ts';
import { getReferenceRate, listAccounts, listCategories, listTags } from './ledger.ts';

const fake = vi.hoisted(() => {
  const ledgerError = (code: string) => Object.assign(new Error(code), { code });
  return {
    ledgerError,
    accounts: { list: vi.fn(() => Promise.resolve({ baseCurrency: 'IDR', accounts: [], availableMinor: 0n })) },
    categories: { list: vi.fn(() => Promise.resolve([])) },
    tags: { list: vi.fn(() => Promise.resolve([{ id: 't', slug: 'dana-darurat', usageCount: 2, aliases: [] }])) },
    fxRates: { referenceRate: vi.fn(() => Promise.resolve(null)) },
  };
});

// vi.mock factories run before imports; they load the shared helper themselves.
vi.mock('@tanstack/react-start', async () => (await import('../../../test/server-fn.ts')).serverFnModule());
vi.mock('../runtime.ts', () => ({
  services: () =>
    Promise.resolve({
      accounts: fake.accounts,
      categories: fake.categories,
      tags: fake.tags,
      fxRates: fake.fxRates,
      now: () => new Date('2026-10-18T09:00:00Z'),
    }),
}));

const USER_ID = fakeSession().user.id;
const signedIn = () => requestContext(fakeSession());
const signedOut = () => requestContext(null);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ledger reads', () => {
  it('lists the session user’s accounts, categories, and tags', async () => {
    expect(await call(listAccounts, { context: signedIn(), data: {} })).toEqual({
      ok: true,
      value: { baseCurrency: 'IDR', accounts: [], availableMinor: 0n },
    });
    expect(fake.accounts.list).toHaveBeenLastCalledWith(USER_ID, {});
    await call(listAccounts, { context: signedIn(), data: { status: 'archived' } });
    expect(fake.accounts.list).toHaveBeenLastCalledWith(USER_ID, { status: 'archived' });

    expect(await call(listCategories, { context: signedIn(), data: {} })).toEqual({ ok: true, value: [] });
    expect(fake.categories.list).toHaveBeenLastCalledWith(USER_ID, { includeArchived: false });
    await call(listCategories, { context: signedIn(), data: { includeArchived: true } });
    expect(fake.categories.list).toHaveBeenLastCalledWith(USER_ID, { includeArchived: true });

    expect(await call(listTags, { context: signedIn(), data: {} })).toMatchObject({ ok: true });
    expect(fake.tags.list).toHaveBeenLastCalledWith(USER_ID, {});
    await call(listTags, { context: signedIn(), data: { query: 'dana' } });
    expect(fake.tags.list).toHaveBeenLastCalledWith(USER_ID, { query: 'dana' });
  });

  it('resolves the reference rate for the session user', async () => {
    expect(await call(getReferenceRate, { context: signedIn(), data: { base: 'USD', quote: 'IDR' } })).toEqual({
      ok: true,
      value: null,
    });
    expect(fake.fxRates.referenceRate).toHaveBeenCalledWith(USER_ID, 'USD', 'IDR');
  });

  it('turns ledger errors into expected results', async () => {
    fake.accounts.list.mockRejectedValueOnce(fake.ledgerError('FX_RATE_MISSING'));
    expect(await call(listAccounts, { context: signedIn(), data: {} })).toEqual({
      ok: false,
      code: 'FX_RATE_MISSING',
    });
  });

  it('refuses signed-out requests', async () => {
    for (const fn of [listAccounts, listCategories, listTags]) {
      expect(await call(fn, { context: signedOut(), data: {} })).toEqual({ ok: false, code: 'UNAUTHENTICATED' });
    }
    expect(await call(getReferenceRate, { context: signedOut(), data: { base: 'USD', quote: 'IDR' } })).toEqual({
      ok: false,
      code: 'UNAUTHENTICATED',
    });
    expect(fake.accounts.list).not.toHaveBeenCalled();
  });

  it('validates input with Zod schemas', () => {
    expect(validatorOf(listAccounts).safeParse({ status: 'deleted' }).success).toBe(false);
    expect(validatorOf(listTags).safeParse({ query: 'x'.repeat(65) }).success).toBe(false);
    expect(validatorOf(getReferenceRate).safeParse({ base: 'usd', quote: 'IDR' }).success).toBe(false);
    expect(validatorOf(getReferenceRate).safeParse({ base: 'USD', quote: 'IDR' }).success).toBe(true);
  });
});
