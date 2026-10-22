// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The `/transactions` URL (FR-L1–L3): every filter, the view, and the sort live in typed search params, so a filtered
 * table is a shareable link and other pages can link into it (`{ category: id }` from Settings › Kategori,
 * `{ account: id }` from Rekening & dompet, `{ tx: id }` from ⌘K). Lists are comma-separated (`?account=a,b`), so a
 * single id is just the id. Invalid params are dropped (`.catch`), never an error page.
 *
 * The server functions take the {@link TRANSACTIONS_QUERY} part, which resolves `period`/`range` to dates itself.
 */
import { TRANSACTION_SOURCES } from '@wf/domain/transactions';
import { countDays, parseLocalDate, type LocalDate, type YearMonth } from '@wf/domain/period';
import { normalizeTagSlug } from '@wf/domain/tags';
import * as z from 'zod';

export const TRANSACTION_VIEWS = ['day', 'category', 'flat'] as const;
export type TransactionView = (typeof TRANSACTION_VIEWS)[number];

/** The types the page lists and filters by (FR-L3 "Jenis"). */
export const LISTED_TYPES = ['expense', 'income', 'transfer'] as const;

export const TRANSACTION_SORTS = ['date_desc', 'date_asc', 'amount_desc', 'amount_asc'] as const;
export type TransactionSort = (typeof TRANSACTION_SORTS)[number];

/** Longest custom range, in days. */
export const MAX_RANGE_DAYS = 1830;
/** Most values a list param keeps. */
const MAX_LIST = 50;

const isLocalDate = (value: string): boolean => {
  try {
    parseLocalDate(value);
    return true;
  } catch {
    return false;
  }
};

/** A period label `YYYY-MM` (also the Overview's `?period=`). */
export const yearMonthParam = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
  .transform((value) => value as YearMonth);

/** `2026-09-14..2026-10-13` (inclusive, start ≤ end, at most `maxDays` days). */
export function rangeParam(maxDays: number) {
  return z.string().refine((value) => {
    const [from, to, ...rest] = value.split('..');
    return (
      rest.length === 0 &&
      from !== undefined &&
      to !== undefined &&
      isLocalDate(from) &&
      isLocalDate(to) &&
      from <= to &&
      countDays(from as LocalDate, to as LocalDate) <= maxDays
    );
  }, 'Expected YYYY-MM-DD..YYYY-MM-DD');
}

/** A comma-separated list whose every value passes `item` (at most {@link MAX_LIST}). */
function listParam(item: z.ZodType<string>) {
  return z.string().refine((value) => {
    const parts = value.split(',');
    return parts.length <= MAX_LIST && parts.every((part) => item.safeParse(part).success);
  }, 'Invalid list');
}

const tagSlug = z.string().refine((value) => normalizeTagSlug(value) === value, 'Expected a tag slug');
const amount = z.int().nonnegative().max(Number.MAX_SAFE_INTEGER);

/** What selects the rows: period or range, filters, search, sort. Shared by the URL and the server functions. */
const QUERY_SHAPE = {
  /** Period label `YYYY-MM` (FR-P1); without `period` and `range`, the current period. */
  period: yearMonthParam.optional(),
  /** Custom range (FR-S7); wins over `period`. */
  range: rangeParam(MAX_RANGE_DAYS).optional(),
  type: listParam(z.enum(LISTED_TYPES)).optional(),
  category: listParam(z.uuid()).optional(),
  uncategorized: z.boolean().optional(),
  account: listParam(z.uuid()).optional(),
  tag: listParam(tagSlug).optional(),
  /** With `tag`: any (default) or all of them. */
  tagMode: z.enum(['any', 'all']).optional(),
  /** Amount range in base-currency minor units (inclusive). */
  min: amount.optional(),
  max: amount.optional(),
  attachment: z.boolean().optional(),
  source: listParam(z.enum(TRANSACTION_SOURCES)).optional(),
  currency: listParam(z.string().regex(/^[A-Z]{3}$/)).optional(),
  /** Search: words over merchant, description, and note; `#slug` tokens filter by tag. */
  q: z.string().trim().max(100).optional(),
  sort: z.enum(TRANSACTION_SORTS).optional(),
};

/** The server functions' query (strict). */
export const TRANSACTIONS_QUERY = z.object(QUERY_SHAPE);
export type TransactionsQuery = z.infer<typeof TRANSACTIONS_QUERY>;

/** The page URL: the query plus view and the open detail; every invalid param is dropped. */
export const TRANSACTIONS_SEARCH = z.object({
  ...(Object.fromEntries(
    Object.entries(QUERY_SHAPE).map(([key, schema]) => [key, (schema as z.ZodType).catch(undefined)]),
  ) as { [K in keyof typeof QUERY_SHAPE]: z.ZodCatch<(typeof QUERY_SHAPE)[K]> }),
  view: z.enum(TRANSACTION_VIEWS).optional().catch(undefined),
  /** The transaction open in the detail panel. */
  tx: z.uuid().optional().catch(undefined),
});
export type TransactionsSearch = z.infer<typeof TRANSACTIONS_SEARCH>;

/** The values of a list param (`undefined` → none). */
export function listValues(value: string | undefined): string[] {
  return value === undefined || value === '' ? [] : value.split(',');
}

/** The list param for `values` (`undefined` when empty, so the key leaves the URL). */
export function listParamOf(values: readonly string[]): string | undefined {
  return values.length === 0 ? undefined : values.join(',');
}

/** `range` as dates. */
export function rangeOf(range: string): { from: LocalDate; to: LocalDate } {
  const [from = '', to = ''] = range.split('..');
  return { from: parseLocalDate(from), to: parseLocalDate(to) };
}

/** The `range` param for dates. */
export function rangeParamOf(from: LocalDate, to: LocalDate): string {
  return `${from}..${to}`;
}

/** Query keys that select the dates or the order, not a filter. */
const NOT_FILTER_KEYS: readonly string[] = ['period', 'range', 'sort', 'tagMode'];

/**
 * Just the query part of the page's search (what the server functions take): not the view, the open detail, or the
 * layout's `?settings=`.
 */
export function queryOf(search: TransactionsSearch): TransactionsQuery {
  return Object.fromEntries(Object.entries(search).filter(([key, value]) => value !== undefined && key in QUERY_SHAPE));
}

/** Whether any filter beyond the date and the sort is set ("Hapus semua filter"); `tagMode` alone is none. */
export function hasFilters(query: TransactionsQuery): boolean {
  return Object.entries(query).some(
    ([key, value]) => !NOT_FILTER_KEYS.includes(key) && value !== undefined && value !== '',
  );
}
