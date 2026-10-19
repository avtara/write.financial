// SPDX-License-Identifier: AGPL-3.0-only
import type { AccountView } from '@wf/db/accounts';
import type { CategoryView } from '@wf/db/categories';
import { LedgerError } from '@wf/db/ledger-errors';
import type { RecentItem } from '@wf/db/recent-items';
import type { TagView } from '@wf/db/tags';
import type { TransactionRow } from '@wf/db/transaction-query';
import type { PostingView, TransactionDetail } from '@wf/db/transactions';
import type { LocalDate } from '@wf/domain/period';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GROUP_LIMIT, recentFor, RECENT_LIMIT, searchFor, type SearchServices } from './search.ts';

const USER = 'user-1';
const day = (date: string) => date as LocalDate;

const account = (id: string, displayName: string, extra: Partial<AccountView> = {}) =>
  ({
    id,
    displayName,
    providerName: 'Bank Central Asia',
    type: 'bank',
    currency: 'IDR',
    balanceMinor: 1_000_000n,
    archivedAt: null,
    ...extra,
  }) as AccountView;

const ACCOUNTS = [
  account('acc-old', 'BCA Lama', { archivedAt: new Date('2026-01-01') }),
  account('acc-bca', 'BCA Tahapan'),
  account('acc-gopay', 'GoPay', { providerName: 'Gojek', type: 'ewallet' }),
];

const category = (id: string, name: string, extra: Partial<CategoryView> = {}) =>
  ({ id, name, builtInKey: null, kind: 'expense', group: 'wants', archivedAt: null, ...extra }) as CategoryView;

const CATEGORIES = [
  category('cat-old', 'Kopi lama', { archivedAt: new Date('2026-01-01') }),
  category('cat-food', 'system:food', { builtInKey: 'system:food', group: 'needs' }),
  category('cat-coffee', 'Kopi'),
];

const TAGS: TagView[] = [
  { id: 'tag-trip', slug: 'liburan-bali', usageCount: 3, aliases: [] },
  { id: 'tag-fund', slug: 'dana-darurat', usageCount: 1, aliases: ['darurat'] },
];

const row = (id: string, extra: Partial<TransactionRow> = {}) =>
  ({
    id,
    type: 'expense',
    localDate: day('2026-10-14'),
    merchant: 'Shopee',
    description: 'Rak buku 5 susun',
    categoryId: 'cat-food',
    accountId: 'acc-bca',
    toAccountId: null,
    amountMinor: -250_000n,
    currency: 'IDR',
    ...extra,
  }) as TransactionRow;

const posting = (accountId: string, amountMinor: bigint, role: PostingView['role'] = 'principal') =>
  ({ accountId, amountMinor, currency: 'IDR', role }) as PostingView;

const detail = (id: string, extra: Partial<TransactionDetail> = {}) =>
  ({
    id,
    type: 'expense',
    localDate: day('2026-10-12'),
    merchant: null,
    description: 'Makan siang',
    categoryId: 'cat-missing',
    deletedAt: null,
    postings: [posting('acc-gopay', -45_000n)],
    ...extra,
  }) as TransactionDetail;

const DETAILS: Record<string, TransactionDetail> = {
  'tx-lunch': detail('tx-lunch'),
  'tx-move': detail('tx-move', {
    type: 'transfer',
    merchant: 'Tarik',
    description: 'Tarik',
    categoryId: null,
    postings: [posting('acc-bca', -500_000n), posting('acc-gopay', 500_000n), posting('acc-bca', -2_500n, 'fee')],
  }),
  'tx-gone': detail('tx-gone', { deletedAt: new Date('2026-10-13') }),
  'tx-empty': detail('tx-empty', { postings: [] }),
};

function fakeServices() {
  return {
    accounts: {
      list: vi.fn(() =>
        Promise.resolve({ baseCurrency: 'IDR', accounts: ACCOUNTS, availableMinor: 0n, missingRates: [] }),
      ),
    },
    categories: { list: vi.fn(() => Promise.resolve(CATEGORIES)) },
    tags: {
      list: vi.fn((_user: string, { query }: { query?: string } = {}) =>
        Promise.resolve(query === undefined ? TAGS : TAGS.filter((tag) => tag.slug.includes(query))),
      ),
    },
    transactionQuery: {
      list: vi.fn(() =>
        Promise.resolve({
          rows: [
            row('tx-shopee'),
            row('tx-transfer', {
              type: 'transfer',
              merchant: null,
              description: null,
              categoryId: null,
              toAccountId: 'acc-gopay',
            }),
            row('tx-unknown', { merchant: 'Kopi', description: 'Kopi', accountId: 'acc-missing', categoryId: null }),
          ],
          total: 9,
        }),
      ),
    },
    transactions: {
      get: vi.fn((_user: string, id: string) => {
        const found = DETAILS[id];
        if (id === 'tx-broken') return Promise.reject(new Error('database down'));
        return found === undefined ? Promise.reject(new LedgerError('NOT_FOUND')) : Promise.resolve(found);
      }),
    },
    recentItems: { list: vi.fn((): Promise<RecentItem[]> => Promise.resolve([])) },
  };
}

let fake: ReturnType<typeof fakeServices>;
const services = () => fake as unknown as SearchServices;
const recent = (kind: RecentItem['kind'], ref: string): RecentItem => ({ kind, ref, openedAt: new Date() });

beforeEach(() => {
  fake = fakeServices();
});

describe('searchFor', () => {
  it('answers every group with the first hits and the total', async () => {
    const results = await searchFor(services(), USER, 'kopi', 2);
    expect(fake.transactionQuery.list).toHaveBeenCalledWith(USER, { search: 'kopi' }, { limit: 2 });
    expect(results.transactions).toEqual({
      total: 9,
      hits: [
        {
          id: 'tx-shopee',
          type: 'expense',
          localDate: '2026-10-14',
          title: 'Shopee — Rak buku 5 susun',
          amountMinor: -250_000n,
          currency: 'IDR',
          category: { name: 'system:food', builtInKey: 'system:food' },
          accountId: 'acc-bca',
          accountName: 'BCA Tahapan',
          toAccountName: null,
        },
        expect.objectContaining({ id: 'tx-transfer', title: null, category: null, toAccountName: 'GoPay' }),
        expect.objectContaining({ id: 'tx-unknown', title: 'Kopi', accountName: '' }),
      ],
    });
    // Archived categories come last.
    expect(results.categories).toEqual({
      total: 2,
      hits: [
        { id: 'cat-coffee', name: 'Kopi', builtInKey: null, kind: 'expense', group: 'wants', archived: false },
        expect.objectContaining({ id: 'cat-old', archived: true }),
      ],
    });
    expect(results.accounts).toEqual({ total: 0, hits: [] });
    expect(results.tags).toEqual({ total: 0, hits: [] });
    // The accounts and categories were loaded once for all groups.
    expect(fake.accounts.list).toHaveBeenCalledTimes(1);
    expect(fake.accounts.list).toHaveBeenCalledWith(USER, { status: 'all' });
    expect(fake.categories.list).toHaveBeenCalledTimes(1);
    expect(fake.categories.list).toHaveBeenCalledWith(USER, { includeArchived: true });
  });

  it('matches accounts by name or provider, active ones first, and built-in categories by their shown name', async () => {
    const results = await searchFor(services(), USER, 'bca');
    expect(fake.transactionQuery.list).toHaveBeenCalledWith(USER, { search: 'bca' }, { limit: GROUP_LIMIT });
    expect(results.accounts.hits.map((hit) => [hit.id, hit.archived])).toEqual([
      ['acc-bca', false],
      ['acc-old', true],
    ]);
    expect(results.accounts.hits[0]).toEqual({
      id: 'acc-bca',
      displayName: 'BCA Tahapan',
      providerName: 'Bank Central Asia',
      type: 'bank',
      currency: 'IDR',
      balanceMinor: 1_000_000n,
      archived: false,
    });
    expect((await searchFor(services(), USER, 'gojek')).accounts.hits.map((hit) => hit.id)).toEqual(['acc-gopay']);
    expect((await searchFor(services(), USER, 'makan')).categories.hits.map((hit) => hit.id)).toEqual(['cat-food']);
  });

  it('finds tags through the repository query', async () => {
    const results = await searchFor(services(), USER, 'dana');
    expect(fake.tags.list).toHaveBeenCalledWith(USER, { query: 'dana' });
    expect(results.tags).toEqual({ total: 1, hits: [{ id: 'tag-fund', slug: 'dana-darurat', usageCount: 1 }] });
  });
});

describe('recentFor', () => {
  it('resolves the remembered items newest first and leaves out what is gone', async () => {
    fake.recentItems.list.mockResolvedValue([
      recent('transaction', 'tx-lunch'),
      recent('page', '/'),
      recent('account', 'acc-gopay'),
      recent('transaction', 'tx-gone'),
      recent('transaction', 'tx-missing'),
      recent('transaction', 'tx-empty'),
      recent('category', 'cat-coffee'),
      recent('tag', 'tag-trip'),
      recent('goal', 'goal-1'),
      recent('account', 'acc-deleted'),
      recent('transaction', 'tx-move'),
    ]);
    const entries = await recentFor(services(), USER);
    expect(fake.recentItems.list).toHaveBeenCalledWith(USER, RECENT_LIMIT);
    expect(entries).toHaveLength(6);
    expect(entries).toMatchObject([
      {
        kind: 'transactions',
        hit: {
          id: 'tx-lunch',
          type: 'expense',
          localDate: '2026-10-12',
          title: 'Makan siang',
          amountMinor: -45_000n,
          currency: 'IDR',
          category: null,
          accountId: 'acc-gopay',
          accountName: 'GoPay',
          toAccountName: null,
        },
      },
      { kind: 'page', path: '/' },
      { kind: 'accounts', hit: { id: 'acc-gopay', displayName: 'GoPay' } },
      { kind: 'categories', hit: { id: 'cat-coffee', name: 'Kopi' } },
      { kind: 'tags', hit: { id: 'tag-trip', slug: 'liburan-bali', usageCount: 3 } },
      {
        kind: 'transactions',
        hit: {
          id: 'tx-move',
          type: 'transfer',
          title: 'Tarik',
          amountMinor: -500_000n,
          accountName: 'BCA Tahapan',
          toAccountName: 'GoPay',
        },
      },
    ]);
    expect(fake.tags.list).toHaveBeenCalledWith(USER);
  });

  it('skips sources without remembered items', async () => {
    fake.recentItems.list.mockResolvedValue([recent('page', '/')]);
    expect(await recentFor(services(), USER, 3)).toEqual([{ kind: 'page', path: '/' }]);
    expect(fake.recentItems.list).toHaveBeenCalledWith(USER, 3);
    expect(fake.transactions.get).not.toHaveBeenCalled();
    expect(fake.accounts.list).not.toHaveBeenCalled();
  });

  it('a transfer without its incoming leg has no destination', async () => {
    DETAILS['tx-half'] = detail('tx-half', { type: 'transfer', postings: [posting('acc-bca', -1n)] });
    fake.recentItems.list.mockResolvedValue([recent('transaction', 'tx-half')]);
    const entries = await recentFor(services(), USER);
    expect(entries).toHaveLength(1);
    expect(entries).toMatchObject([{ kind: 'transactions', hit: { id: 'tx-half', toAccountName: null } }]);
  });

  it('passes unexpected failures on', async () => {
    fake.recentItems.list.mockResolvedValue([recent('transaction', 'tx-broken')]);
    await expect(recentFor(services(), USER)).rejects.toThrow('database down');
  });
});
