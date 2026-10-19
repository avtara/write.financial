// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The sources behind ⌘K (FR-S4): one per result group, each searching and resolving "Baru dibuka" entries of its
 * kind through the ledger repositories, for one user. The accounts, categories, and tags are loaded at most once
 * per call and shared by every source that needs their names.
 */
import type { AccountView } from '@wf/db/accounts';
import type { CategoryView } from '@wf/db/categories';
import { LedgerError } from '@wf/db/ledger-errors';
import type { RecentItemKind } from '@wf/db/recent-items';
import type { TagView } from '@wf/db/tags';
import type { TransactionDetail } from '@wf/db/transactions';
import { categoryName } from '../lib/ledger-labels.ts';
import {
  matchesQuery,
  SEARCH_KINDS,
  type AccountHit,
  type CategoryRef,
  type CategoryHit,
  type RecentEntry,
  type SearchHits,
  type SearchKind,
  type SearchResults,
  type TagHit,
  type TransactionHit,
} from '../lib/search.ts';
import type { Services } from './runtime.ts';

/** Hits per group. */
export const GROUP_LIMIT = 5;
/** Entries of "Baru dibuka". */
export const RECENT_LIMIT = 6;

export type SearchServices = Pick<
  Services,
  'accounts' | 'categories' | 'tags' | 'transactions' | 'transactionQuery' | 'recentItems'
>;

interface SourceContext {
  readonly services: SearchServices;
  readonly userId: string;
  readonly accounts: () => Promise<AccountView[]>;
  readonly categories: () => Promise<CategoryView[]>;
  readonly tags: () => Promise<TagView[]>;
}

interface SearchSource<H extends { readonly id: string }> {
  /** The `recent_items` kind its hits are remembered under. */
  readonly recentKind: RecentItemKind;
  readonly search: (context: SourceContext, query: string, limit: number) => Promise<{ hits: H[]; total: number }>;
  /** The hits for remembered ids; ids that no longer resolve (deleted, another user's) are left out. */
  readonly resolve: (context: SourceContext, ids: readonly string[]) => Promise<H[]>;
}

function once<T>(load: () => Promise<T>): () => Promise<T> {
  let loaded: Promise<T> | undefined;
  return () => (loaded ??= load());
}

function contextFor(services: SearchServices, userId: string): SourceContext {
  return {
    services,
    userId,
    accounts: once(async () => (await services.accounts.list(userId, { status: 'all' })).accounts),
    categories: once(() => services.categories.list(userId, { includeArchived: true })),
    tags: once(() => services.tags.list(userId)),
  };
}

/** The first `limit` of `matches`, and how many there are. */
function groupOf<H>(matches: readonly H[], limit: number): { hits: H[]; total: number } {
  return { hits: matches.slice(0, limit), total: matches.length };
}

/** Display names by id, for transaction hits. */
interface Names {
  readonly account: (id: string) => string;
  readonly category: (id: string | null) => CategoryRef | null;
}

async function names(context: SourceContext): Promise<Names> {
  const [accounts, categories] = await Promise.all([context.accounts(), context.categories()]);
  const account = new Map(accounts.map((row) => [row.id, row.displayName]));
  const category = new Map(categories.map((row) => [row.id, { name: row.name, builtInKey: row.builtInKey }]));
  return {
    account: (id: string) => account.get(id) ?? '',
    category: (id: string | null) => (id === null ? null : (category.get(id) ?? null)),
  };
}

/** "Shopee — Rak buku 5 susun": the merchant and the description, whichever exist. */
function titleOf({ merchant, description }: { merchant: string | null; description: string | null }): string | null {
  if (merchant !== null && description !== null && merchant !== description) return `${merchant} — ${description}`;
  return merchant ?? description;
}

/** The hit for a stored transaction: the principal postings are listed outgoing first. */
function detailHit(detail: TransactionDetail, lookup: Names): TransactionHit | null {
  const [from, to] = detail.postings.filter((posting) => posting.role === 'principal');
  if (from === undefined) return null;
  return {
    id: detail.id,
    type: detail.type,
    localDate: detail.localDate,
    title: titleOf(detail),
    amountMinor: from.amountMinor,
    currency: from.currency,
    category: lookup.category(detail.categoryId),
    accountId: from.accountId,
    accountName: lookup.account(from.accountId),
    toAccountName: detail.type === 'transfer' && to !== undefined ? lookup.account(to.accountId) : null,
  };
}

const transactions: SearchSource<TransactionHit> = {
  recentKind: 'transaction',
  search: async (context, query, limit) => {
    const [page, lookup] = await Promise.all([
      context.services.transactionQuery.list(context.userId, { search: query }, { limit }),
      names(context),
    ]);
    const hits = page.rows.map((row): TransactionHit => ({
      id: row.id,
      type: row.type,
      localDate: row.localDate,
      title: titleOf(row),
      amountMinor: row.amountMinor,
      currency: row.currency,
      category: lookup.category(row.categoryId),
      accountId: row.accountId,
      accountName: lookup.account(row.accountId),
      toAccountName: row.toAccountId === null ? null : lookup.account(row.toAccountId),
    }));
    return { hits, total: page.total };
  },
  resolve: async (context, ids) => {
    const lookup = await names(context);
    const details = await Promise.all(
      ids.map((id) =>
        context.services.transactions.get(context.userId, id).catch((error: unknown) => {
          if (error instanceof LedgerError && error.code === 'NOT_FOUND') return null;
          throw error;
        }),
      ),
    );
    return details.flatMap((detail) => {
      const hit = detail === null || detail.deletedAt !== null ? null : detailHit(detail, lookup);
      return hit === null ? [] : [hit];
    });
  },
};

const accountHit = (account: AccountView): AccountHit => ({
  id: account.id,
  displayName: account.displayName,
  providerName: account.providerName,
  type: account.type,
  currency: account.currency,
  balanceMinor: account.balanceMinor,
  archived: account.archivedAt !== null,
});

const accounts: SearchSource<AccountHit> = {
  recentKind: 'account',
  search: async (context, query, limit) => {
    const matches = (await context.accounts())
      .filter((account) => matchesQuery(query, [account.displayName, account.providerName]))
      // Active accounts first; the repository's order otherwise.
      .sort((a, b) => Number(a.archivedAt !== null) - Number(b.archivedAt !== null));
    return groupOf(matches.map(accountHit), limit);
  },
  resolve: async (context, ids) =>
    (await context.accounts()).filter((account) => ids.includes(account.id)).map(accountHit),
};

const categoryHit = (category: CategoryView): CategoryHit => ({
  id: category.id,
  name: category.name,
  builtInKey: category.builtInKey,
  kind: category.kind,
  group: category.group,
  archived: category.archivedAt !== null,
});

const categories: SearchSource<CategoryHit> = {
  recentKind: 'category',
  search: async (context, query, limit) => {
    // Built-in categories match on their name in the reader's language (the stored name is their key).
    const matches = (await context.categories())
      .filter((category) => matchesQuery(query, [categoryName(category)]))
      .sort((a, b) => Number(a.archivedAt !== null) - Number(b.archivedAt !== null));
    return groupOf(matches.map(categoryHit), limit);
  },
  resolve: async (context, ids) =>
    (await context.categories()).filter((category) => ids.includes(category.id)).map(categoryHit),
};

const tagHit = ({ id, slug, usageCount }: TagView): TagHit => ({ id, slug, usageCount });

const tags: SearchSource<TagHit> = {
  recentKind: 'tag',
  search: async (context, query, limit) =>
    groupOf((await context.services.tags.list(context.userId, { query })).map(tagHit), limit),
  resolve: async (context, ids) => (await context.tags()).filter((tag) => ids.includes(tag.id)).map(tagHit),
};

const SOURCES: { readonly [K in SearchKind]: SearchSource<SearchHits[K]> } = {
  transactions,
  accounts,
  categories,
  tags,
};

/** Every group's matches for `query`. */
export async function searchFor(
  services: SearchServices,
  userId: string,
  query: string,
  limit = GROUP_LIMIT,
): Promise<SearchResults> {
  const context = contextFor(services, userId);
  const groups = await Promise.all(
    SEARCH_KINDS.map(async (kind) => [kind, await SOURCES[kind].search(context, query, limit)] as const),
  );
  return Object.fromEntries(groups) as unknown as SearchResults;
}

/**
 * "Baru dibuka": the newest remembered items, newest first, with what the palette shows for them. Items whose
 * entity is gone, and kinds without a source yet (goals), are left out.
 */
export async function recentFor(
  services: SearchServices,
  userId: string,
  limit = RECENT_LIMIT,
): Promise<RecentEntry[]> {
  const context = contextFor(services, userId);
  const items = await services.recentItems.list(userId, limit);
  const resolved = new Map<string, RecentEntry>();
  await Promise.all(
    SEARCH_KINDS.map(async (kind) => {
      const source: SearchSource<SearchHits[SearchKind]> = SOURCES[kind];
      const ids = items.filter((item) => item.kind === source.recentKind).map((item) => item.ref);
      if (ids.length === 0) return;
      for (const hit of await source.resolve(context, ids)) {
        resolved.set(`${source.recentKind}:${hit.id}`, { kind, hit } as RecentEntry);
      }
    }),
  );
  return items.flatMap((item): RecentEntry[] => {
    if (item.kind === 'page') return [{ kind: 'page', path: item.ref }];
    const entry = resolved.get(`${item.kind}:${item.ref}`);
    return entry === undefined ? [] : [entry];
  });
}
