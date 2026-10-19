// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What ⌘K search (FR-S4) answers, shared by the server sources (`server/search.ts`) and the palette's result groups
 * (`components/command-palette/result-groups.tsx`). A new module adds its results by adding a kind to
 * {@link SearchHits} and {@link SEARCH_KINDS}; the types then require a server source and a client group for it.
 */
import type { RecentItemKind } from '@wf/db/recent-items';
import type { CategoryGroup, CategoryKind } from '@wf/domain/categories';
import type { AccountType } from '@wf/domain/ledger';
import type { LocalDate } from '@wf/domain/period';
import type { TransactionType } from '@wf/domain/transactions';

/** Enough of a category to show its name in the reader's language (`categoryName`). */
export interface CategoryRef {
  readonly name: string;
  readonly builtInKey: string | null;
}

export interface TransactionHit {
  readonly id: string;
  readonly type: TransactionType;
  readonly localDate: LocalDate;
  /** "Merchant — description", or whichever of the two exists; `null` when the transaction has neither. */
  readonly title: string | null;
  /** Signed principal on the (source) account, in `currency`. */
  readonly amountMinor: bigint;
  readonly currency: string;
  readonly category: CategoryRef | null;
  readonly accountId: string;
  readonly accountName: string;
  /** Transfers: the destination account. */
  readonly toAccountName: string | null;
}

export interface AccountHit {
  readonly id: string;
  readonly displayName: string;
  readonly providerName: string;
  readonly type: AccountType;
  readonly currency: string;
  readonly balanceMinor: bigint;
  readonly archived: boolean;
}

export interface CategoryHit extends CategoryRef {
  readonly id: string;
  readonly kind: CategoryKind;
  readonly group: CategoryGroup;
  readonly archived: boolean;
}

export interface TagHit {
  readonly id: string;
  readonly slug: string;
  readonly usageCount: number;
}

/** One hit type per result group. */
export interface SearchHits {
  readonly transactions: TransactionHit;
  readonly accounts: AccountHit;
  readonly categories: CategoryHit;
  readonly tags: TagHit;
}

export type SearchKind = keyof SearchHits;

/** The groups in the order the palette lists them. */
export const SEARCH_KINDS = ['transactions', 'accounts', 'categories', 'tags'] as const satisfies readonly SearchKind[];

export interface SearchGroup<K extends SearchKind> {
  /** The first matches, at most the per-group limit. */
  readonly hits: SearchHits[K][];
  /** Every match, shown next to the heading ("Transaksi · 2"). */
  readonly total: number;
}

export type SearchResults = { readonly [K in SearchKind]: SearchGroup<K> };

/** A hit together with its group. */
export type HitEntry = { readonly [K in SearchKind]: { readonly kind: K; readonly hit: SearchHits[K] } }[SearchKind];

/** An entry of "Baru dibuka": a hit of one of the groups, or a page path. */
export type RecentEntry = HitEntry | { readonly kind: 'page'; readonly path: string };

/** The `recent_items` kinds of entities (all but `page`), as the palette remembers them. */
export const RECENT_ENTITY_KINDS = [
  'transaction',
  'account',
  'category',
  'tag',
  'goal',
] as const satisfies readonly Exclude<RecentItemKind, 'page'>[];

export type RecentEntityKind = (typeof RECENT_ENTITY_KINDS)[number];

/** What `touchRecent` remembers: an entity by id, or a page by path. */
export type RecentTouch =
  { readonly kind: 'page'; readonly ref: string } | { readonly kind: RecentEntityKind; readonly ref: string };

/** The longest query the palette sends. */
export const SEARCH_QUERY_MAX = 100;

/** Lowercase, without diacritics, so "kafe" finds "Kafé". */
function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/** The words of a query; `#`, `-`, and `_` separate words like spaces ("#dana-darurat" → dana, darurat). */
export function searchWords(query: string): string[] {
  return fold(query)
    .split(/[\s#_-]+/)
    .filter((word) => word !== '');
}

/** Whether every word of `query` appears in one of `texts`. A query without words matches everything. */
export function matchesQuery(query: string, texts: readonly string[]): boolean {
  const haystack = searchWords(texts.join(' ')).join(' ');
  return searchWords(query).every((word) => haystack.includes(word));
}
