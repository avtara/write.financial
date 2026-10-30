// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Read side of the Transactions page (FR-L1/L2): the filtered, sorted list, its By day and By category groupings, and
 * the In/Out/Transfer summary. Base-currency values come from `postings.amount_base_minor`; soft-deleted transactions
 * never appear. Notes are encrypted, so note search decrypts, on the server, the notes of the rows that match every
 * other filter (plan §4.6).
 */
import { decryptText } from '@wf/crypto/cipher';
import type { Dek } from '@wf/crypto/envelope';
import { addDays, type LocalDate } from '@wf/domain/period';
import { normalizeTagSlug } from '@wf/domain/tags';
import type { TransactionSource, TransactionType } from '@wf/domain/transactions';
import {
  and,
  asc,
  desc,
  eq,
  exists,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lte,
  ne,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { firstRow, withUser, type Database, type Transaction } from './db.ts';
import { NOTE_PURPOSE } from './ledger-core.ts';
import {
  accounts,
  attachments,
  balanceAdjustments,
  postings,
  tagAliases,
  tags,
  transactions,
  transactionTags,
  transferMeta,
} from './schema.ts';

/** Filters of the Transactions page; all given filters must match. Empty arrays mean "no filter". */
export interface TransactionFilter {
  /** Inclusive `local_date` range. */
  readonly from?: LocalDate;
  readonly to?: LocalDate;
  readonly types?: readonly ('expense' | 'income' | 'transfer')[];
  /** The transaction's category or the category of one of its fee / FX-difference postings. */
  readonly categoryIds?: readonly string[];
  /** Expenses and incomes without a category; OR-ed with `categoryIds` when both are given. */
  readonly uncategorized?: boolean;
  /** Any posting on one of these accounts (a transfer matches on both sides). */
  readonly accountIds?: readonly string[];
  /** Slugs or `#Names`; aliases of merged tags resolve to their tag. */
  readonly tags?: readonly string[];
  /** `any` (default): at least one of `tags`; `all`: every one of them. */
  readonly tagMode?: 'any' | 'all';
  /** Inclusive bounds on |principal amount in the base currency|. */
  readonly minAmountMinor?: bigint;
  readonly maxAmountMinor?: bigint;
  readonly hasAttachment?: boolean;
  readonly sources?: readonly TransactionSource[];
  /** Any posting in one of these currencies. */
  readonly currencies?: readonly string[];
  /**
   * FR-L2 `/`: every word must appear (case-insensitive) in the merchant, the description, or the note; `#tag`
   * tokens require every one of those tags.
   */
  readonly search?: string;
}

export type TransactionSort = 'date_desc' | 'date_asc' | 'amount_desc' | 'amount_asc';

export interface TransactionListOptions {
  readonly sort?: TransactionSort;
  /** Default 50, clamped to 1–200. */
  readonly limit?: number;
  readonly offset?: number;
}

export interface TransactionRow {
  readonly id: string;
  readonly type: TransactionType;
  readonly occurredAt: Date;
  readonly localDate: LocalDate;
  readonly merchant: string | null;
  readonly description: string | null;
  readonly categoryId: string | null;
  /** The account of the principal posting; for transfers the source account. */
  readonly accountId: string;
  /** Transfers: the destination account. */
  readonly toAccountId: string | null;
  /** Signed principal on `accountId` in `currency` (transfers: −sent). */
  readonly amountMinor: bigint;
  readonly currency: string;
  /** Transfers: the amount received, in `receivedCurrency`. */
  readonly receivedMinor: bigint | null;
  readonly receivedCurrency: string | null;
  /** `amountMinor` in the base currency, signed. */
  readonly amountBaseMinor: bigint;
  /** Its fee and tax, summed from their own transactions (positive, in `currency`); `null` when it has none. */
  readonly feeMinor: bigint | null;
  /** Transfers: the FX difference in the base currency (0 within one currency). */
  readonly fxDiffBaseMinor: bigint | null;
  /** Slugs, sorted. */
  readonly tags: string[];
  readonly hasAttachment: boolean;
  readonly hasNote: boolean;
  readonly source: TransactionSource;
  readonly splitParentId: string | null;
}

export interface TransactionPage {
  readonly rows: TransactionRow[];
  /** Matching rows across all pages. */
  readonly total: number;
}

/** Amounts are in the base currency. */
export interface DayGroup {
  readonly date: LocalDate;
  /** Income principal. */
  readonly inMinor: bigint;
  /** Expense principal + transfer fees + FX-difference losses. */
  readonly outMinor: bigint;
  /** Transactions on the day, transfers included. */
  readonly count: number;
}

export interface CategoryGroup {
  /** `null` = uncategorized. */
  readonly categoryId: string | null;
  readonly kind: 'expense' | 'income';
  /** Positive, in the base currency. */
  readonly totalMinor: bigint;
  readonly count: number;
  /** Share of `totalMinor` within its kind, in basis points (rounded). */
  readonly shareBps: number;
}

/** Amounts are in the base currency, with the In/Out semantics of {@link DayGroup}. */
export interface AccountGroup {
  readonly accountId: string;
  /** Transactions with a posting on the account (a transfer counts on both sides). */
  readonly count: number;
  /** Income principal on the account. */
  readonly inMinor: bigint;
  /** Expense principal + transfer fees + FX-difference losses on the account. */
  readonly outMinor: bigint;
}

/** FR-L1 cards; transfers are shown but not counted as In or Out. */
export interface TransactionSummary {
  readonly inMinor: bigint;
  readonly outMinor: bigint;
  /** Σ amounts sent by transfers, in the base currency. */
  readonly transferMinor: bigint;
  readonly inCount: number;
  readonly outCount: number;
  readonly transferCount: number;
  /** Every day from `from` to `to` (each defaulting to the first / last day with data), zero-filled. */
  readonly dailySpend: { readonly date: LocalDate; readonly outMinor: bigint }[];
  /** ⌊outMinor / days in `dailySpend`⌋; 0 without days. */
  readonly averageDailySpendMinor: bigint;
}

export interface TransactionQueryRepository {
  list: (userId: string, filter: TransactionFilter, options?: TransactionListOptions) => Promise<TransactionPage>;
  /** Newest day first. */
  groupByDay: (userId: string, filter: TransactionFilter) => Promise<DayGroup[]>;
  /** Largest total first; the expense side includes fee and FX-difference postings under their own category. */
  groupByCategory: (userId: string, filter: TransactionFilter) => Promise<CategoryGroup[]>;
  summary: (userId: string, filter: TransactionFilter) => Promise<TransactionSummary>;
  /** Most transactions first; every account with a posting of a matching transaction. */
  groupByAccount: (userId: string, filter: TransactionFilter) => Promise<AccountGroup[]>;
  /**
   * "Saldo berjalan": transaction id → the account's balance (account currency) right after it, i.e. the opening
   * balance + the account's postings of live transactions up to it (by `occurred_at`, then id) + the balance
   * adjustments created by then. Ids without a live posting on the account are left out.
   */
  balancesAfter: (
    userId: string,
    accountId: string,
    transactionIds: readonly string[],
  ) => Promise<Record<string, bigint>>;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/** Lines that count as In: the principal of an income or of a cash dividend (its tax is a fee line, so counted Out). */
export const isIn = sql`(${transactions.type} in ('income', 'dividend') and ${postings.role} = 'principal')`;
/**
 * Lines that count as Out: the principal of an expense or a receivable write-off (FR-U7, its principal moves no money:
 * amount 0, the written-off value in the base amount), fees, and FX-difference losses. Lending and repayments
 * (`receivable_out`/`receivable_in`) are neither In nor Out.
 */
export const isOut = sql`((${transactions.type} in ('expense', 'writeoff') and ${postings.role} = 'principal') or ${postings.role} = 'fee' or (${postings.role} = 'fx_diff' and ${postings.amountBaseMinor} < 0))`;
/** The sent leg of a transfer. */
const isSent = sql`(${transactions.type} = 'transfer' and ${postings.role} = 'principal' and ${postings.amountMinor} < 0)`;
const sumIn = sql`sum(case when ${isIn} then ${postings.amountBaseMinor} else 0 end)`;
const sumOut = sql`sum(case when ${isOut} then -${postings.amountBaseMinor} else 0 end)`;
const countOf = (type: TransactionType) =>
  sql<number>`(count(distinct ${transactions.id}) filter (where ${transactions.type} = ${type}))::int`;
/** |base amount of the principal posting on the transaction's account| (the source leg for transfers). */
const principalBase = sql`abs((select ${postings.amountBaseMinor} from ${postings} where ${postings.transactionId} = ${transactions.id} and ${postings.role} = 'principal' order by ${postings.amountMinor} limit 1))`;

interface NoteSearch {
  readonly words: readonly string[];
  readonly dek: Dek;
}

interface Search {
  /** `#tag` tokens. */
  readonly tags: readonly string[];
  /** `null` without words. */
  readonly notes: NoteSearch | null;
}

/** Splits `search` into lowercase words and `#tag` tokens; the DEK is loaded only when there are words. */
async function parseSearch(search: string | undefined, loadDek: () => Promise<Dek>): Promise<Search> {
  const tokens = (search ?? '').split(/\s+/).filter((token) => token !== '' && token !== '#');
  const words = tokens.filter((token) => !token.startsWith('#')).map((token) => token.toLowerCase());
  return {
    tags: tokens.filter((token) => token.startsWith('#')),
    notes: words.length === 0 ? null : { words, dek: await loadDek() },
  };
}

/** Tag ids for `inputs` in order (aliases resolved), `null` where no tag or alias has the slug. */
async function tagIdsIn(tx: Transaction, inputs: readonly string[]): Promise<(string | null)[]> {
  const slugs = inputs.map((input) => normalizeTagSlug(input) ?? '');
  const found = await tx
    .select({ slug: tags.slug, id: tags.id })
    .from(tags)
    .where(inArray(tags.slug, slugs))
    .union(
      tx
        .select({ slug: tagAliases.slug, id: tagAliases.tagId })
        .from(tagAliases)
        .where(inArray(tagAliases.slug, slugs)),
    );
  const bySlug = new Map(found.map((row) => [row.slug, row.id]));
  return slugs.map((slug) => bySlug.get(slug) ?? null);
}

/** The WHERE clause for `filter` (and the parsed search) inside the user's transaction. */
async function whereIn(tx: Transaction, userId: string, filter: TransactionFilter, search: Search): Promise<SQL> {
  const anyPosting = (condition: SQL) =>
    exists(
      tx
        .select({ one: sql`1` })
        .from(postings)
        .where(and(eq(postings.transactionId, transactions.id), condition)),
    );
  const conditions: (SQL | undefined)[] = [isNull(transactions.deletedAt)];
  if (filter.from !== undefined) conditions.push(gte(transactions.localDate, filter.from));
  if (filter.to !== undefined) conditions.push(lte(transactions.localDate, filter.to));
  if (filter.types?.length) conditions.push(inArray(transactions.type, [...filter.types]));
  const categoryIds = [...(filter.categoryIds ?? [])];
  if (categoryIds.length > 0 || filter.uncategorized === true) {
    conditions.push(
      or(
        inArray(transactions.categoryId, categoryIds),
        anyPosting(inArray(postings.categoryId, categoryIds)),
        filter.uncategorized === true
          ? and(ne(transactions.type, 'transfer'), isNull(transactions.categoryId))
          : undefined,
      ),
    );
  }
  if (filter.accountIds?.length) conditions.push(anyPosting(inArray(postings.accountId, [...filter.accountIds])));
  // Trades' cash legs (FR-I2) belong to Investments and to their platform's history: the page shows them only
  // when filtered by account, and their fee rows follow them.
  else
    conditions.push(
      and(
        ne(transactions.type, 'investment'),
        sql`not exists (select 1 from transactions parent where parent.id = ${transactions.parentTransactionId} and parent.type = 'investment')`,
      ),
    );
  if (filter.currencies?.length) conditions.push(anyPosting(inArray(postings.currency, [...filter.currencies])));
  if (filter.sources?.length) conditions.push(inArray(transactions.source, [...filter.sources]));
  if (filter.minAmountMinor !== undefined) conditions.push(sql`${principalBase} >= ${filter.minAmountMinor}`);
  if (filter.maxAmountMinor !== undefined) conditions.push(sql`${principalBase} <= ${filter.maxAmountMinor}`);
  if (filter.hasAttachment !== undefined) {
    const attached = exists(
      tx
        .select({ one: sql`1` })
        .from(attachments)
        .where(eq(attachments.transactionId, transactions.id)),
    );
    conditions.push(filter.hasAttachment ? attached : sql`not ${attached}`);
  }

  const filterTags = filter.tags ?? [];
  if (filterTags.length > 0 || search.tags.length > 0) {
    const ids = await tagIdsIn(tx, [...filterTags, ...search.tags]);
    const own = ids.slice(0, filterTags.length);
    // Each group needs one of its tags: `any` makes the filter tags one group; every `#tag` of the search is its own.
    const groups = filter.tagMode === 'all' ? own.map((id) => [id]) : [own].filter((group) => group.length > 0);
    groups.push(...ids.slice(filterTags.length).map((id) => [id]));
    for (const group of groups) {
      const known = group.filter((id): id is string => id !== null);
      conditions.push(
        exists(
          tx
            .select({ one: sql`1` })
            .from(transactionTags)
            .where(and(eq(transactionTags.transactionId, transactions.id), inArray(transactionTags.tagId, known))),
        ),
      );
    }
  }

  if (search.notes !== null) {
    const { words, dek } = search.notes;
    // Notes cannot be searched in SQL: decrypt those of the rows matching every other filter.
    const candidates = await tx
      .select({ id: transactions.id, noteEnc: sql<Uint8Array>`${transactions.noteEnc}` })
      .from(transactions)
      .where(and(...conditions, isNotNull(transactions.noteEnc)));
    const notes = candidates.map((row) => ({
      id: row.id,
      text: decryptText(dek, row.noteEnc, { userId, purpose: NOTE_PURPOSE }).toLowerCase(),
    }));
    for (const word of words) {
      const pattern = `%${word.replace(/[\\%_]/g, '\\$&')}%`;
      conditions.push(
        or(
          ilike(transactions.merchant, pattern),
          ilike(transactions.description, pattern),
          inArray(
            transactions.id,
            notes.filter((note) => note.text.includes(word)).map((note) => note.id),
          ),
        ),
      );
    }
  }
  return and(...conditions) as SQL;
}

const daysIn = (tx: Transaction, where: SQL) =>
  tx
    .select({
      date: transactions.localDate,
      inMinor: sumIn.mapWith(BigInt),
      outMinor: sumOut.mapWith(BigInt),
      transferMinor: sql`sum(case when ${isSent} then -${postings.amountBaseMinor} else 0 end)`.mapWith(BigInt),
      count: sql<number>`count(distinct ${transactions.id})::int`,
      inCount: countOf('income'),
      outCount: countOf('expense'),
      transferCount: countOf('transfer'),
    })
    .from(transactions)
    .innerJoin(postings, eq(postings.transactionId, transactions.id))
    .where(where)
    .groupBy(transactions.localDate)
    .orderBy(desc(transactions.localDate));

const dayGroupsIn = async (tx: Transaction, where: SQL): Promise<DayGroup[]> =>
  (await daysIn(tx, where)).map(({ date, inMinor, outMinor, count }) => ({ date, inMinor, outMinor, count }));

/** The category a line counts under: the transaction's for the principal, its own for fee and FX-difference lines. */
export const lineCategoryId = sql<
  string | null
>`case when ${postings.role} = 'principal' then ${transactions.categoryId} else ${postings.categoryId} end`;

const categoriesIn = (tx: Transaction, where: SQL): Promise<CategoryGroup[]> => {
  const categoryId = lineCategoryId;
  const kind = sql<'expense' | 'income'>`case when ${isIn} then 'income' else 'expense' end`;
  const total = sql`sum(case when ${isIn} then ${postings.amountBaseMinor} else -${postings.amountBaseMinor} end)`;
  return tx
    .select({
      categoryId,
      kind,
      totalMinor: total.mapWith(BigInt),
      count: sql<number>`count(distinct ${transactions.id})::int`,
      shareBps: sql<number>`coalesce(round(${total} * 10000 / nullif(sum(${total}) over (partition by ${kind}), 0)), 0)::int`,
    })
    .from(transactions)
    .innerJoin(postings, eq(postings.transactionId, transactions.id))
    .where(and(where, or(isIn, isOut)))
    .groupBy(categoryId, kind)
    .orderBy(desc(total), asc(kind), sql`${categoryId} nulls last`);
};

/** A {@link TransactionFilter} without `search` (which may need the DEK), for aggregates in other repositories. */
export type AggregateFilter = Omit<TransactionFilter, 'search'>;

const NO_SEARCH: Search = { tags: [], notes: null };

/** `groupByCategory` inside the caller's user transaction. */
export async function categoryTotalsIn(
  tx: Transaction,
  userId: string,
  filter: AggregateFilter,
): Promise<CategoryGroup[]> {
  return categoriesIn(tx, await whereIn(tx, userId, filter, NO_SEARCH));
}

/** `groupByDay` inside the caller's user transaction (newest day first). */
export async function dayTotalsIn(tx: Transaction, userId: string, filter: AggregateFilter): Promise<DayGroup[]> {
  return dayGroupsIn(tx, await whereIn(tx, userId, filter, NO_SEARCH));
}

export function createTransactionQuery(
  db: Database,
  { getDek }: { readonly getDek: (userId: string) => Promise<Dek> },
): TransactionQueryRepository {
  /** Runs `fn` in the user's transaction with the WHERE clause; the DEK is fetched first, only for note search. */
  const query = async <T>(
    userId: string,
    filter: TransactionFilter,
    fn: (tx: Transaction, where: SQL) => Promise<T>,
  ): Promise<T> => {
    const search = await parseSearch(filter.search, () => getDek(userId));
    return withUser(db, userId, async (tx) => fn(tx, await whereIn(tx, userId, filter, search)));
  };

  return {
    list: (userId, filter, { sort = 'date_desc', limit = DEFAULT_LIMIT, offset = 0 } = {}) =>
      query(userId, filter, async (tx, where) => {
        const principal = tx
          .select({
            accountId: postings.accountId,
            amountMinor: postings.amountMinor,
            currency: postings.currency,
            amountBaseMinor: postings.amountBaseMinor,
          })
          .from(postings)
          .where(and(eq(postings.transactionId, transactions.id), eq(postings.role, 'principal')))
          .orderBy(asc(postings.amountMinor))
          .limit(1)
          .as('principal');
        const amount = sql`abs(${principal.amountBaseMinor})`;
        const order = {
          date_desc: [desc(transactions.localDate), desc(transactions.occurredAt), desc(transactions.id)],
          date_asc: [asc(transactions.localDate), asc(transactions.occurredAt), asc(transactions.id)],
          amount_desc: [desc(amount), desc(transactions.occurredAt), desc(transactions.id)],
          amount_asc: [asc(amount), asc(transactions.occurredAt), asc(transactions.id)],
        }[sort];
        const rows = await tx
          .select({
            id: transactions.id,
            type: transactions.type,
            occurredAt: transactions.occurredAt,
            localDate: transactions.localDate,
            merchant: transactions.merchant,
            description: transactions.description,
            categoryId: transactions.categoryId,
            accountId: principal.accountId,
            toAccountId: sql<
              string | null
            >`(select ${postings.accountId} from ${postings} where ${postings.transactionId} = ${transactions.id} and ${transactions.type} = 'transfer' and ${postings.role} = 'principal' and ${postings.amountMinor} > 0 limit 1)`,
            amountMinor: principal.amountMinor,
            currency: principal.currency,
            receivedMinor: transferMeta.receivedMinor,
            receivedCurrency: transferMeta.receivedCurrency,
            amountBaseMinor: principal.amountBaseMinor,
            fee: sql<
              string | null
            >`(select (-sum(p.amount_minor))::text from postings p join transactions c on c.id = p.transaction_id where c.parent_transaction_id = ${transactions.id} and p.role = 'principal')`,
            fxDiffBaseMinor: transferMeta.fxDiffBaseMinor,
            hasAttachment: sql<boolean>`exists (select 1 from ${attachments} where ${attachments.transactionId} = ${transactions.id})`,
            hasNote: sql<boolean>`${transactions.noteEnc} is not null`,
            source: transactions.source,
            splitParentId: transactions.splitParentId,
          })
          .from(transactions)
          .innerJoinLateral(principal, sql`true`)
          .leftJoin(transferMeta, eq(transferMeta.transactionId, transactions.id))
          .where(where)
          .orderBy(...order)
          .limit(Math.min(Math.max(Math.trunc(limit), 1), MAX_LIMIT))
          .offset(Math.max(Math.trunc(offset), 0));
        const { total } = firstRow(
          await tx
            .select({ total: sql<number>`count(*)::int` })
            .from(transactions)
            .where(where),
          'count',
        );
        const tagRows = await tx
          .select({ transactionId: transactionTags.transactionId, slug: tags.slug })
          .from(transactionTags)
          .innerJoin(tags, eq(tags.id, transactionTags.tagId))
          .where(
            inArray(
              transactionTags.transactionId,
              rows.map((row) => row.id),
            ),
          )
          .orderBy(asc(tags.slug));
        return {
          rows: rows.map(({ fee, ...row }) => ({
            ...row,
            feeMinor: fee === null ? null : BigInt(fee),
            tags: tagRows.filter((tag) => tag.transactionId === row.id).map((tag) => tag.slug),
          })),
          total,
        };
      }),

    groupByDay: (userId, filter) => query(userId, filter, dayGroupsIn),

    groupByCategory: (userId, filter) => query(userId, filter, categoriesIn),

    summary: (userId, filter) =>
      query(userId, filter, async (tx, where) => {
        const days = await daysIn(tx, where);
        const sum = (pick: (day: (typeof days)[number]) => bigint) =>
          days.reduce((total, day) => total + pick(day), 0n);
        const count = (pick: (day: (typeof days)[number]) => number) =>
          days.reduce((total, day) => total + pick(day), 0);
        const outMinor = sum((day) => day.outMinor);
        const outByDate = new Map(days.map((day) => [day.date, day.outMinor]));
        const start = filter.from ?? days.at(-1)?.date;
        const end = filter.to ?? days[0]?.date;
        const dailySpend: { date: LocalDate; outMinor: bigint }[] = [];
        if (start !== undefined && end !== undefined) {
          for (let date = start; date <= end; date = addDays(date, 1)) {
            dailySpend.push({ date, outMinor: outByDate.get(date) ?? 0n });
          }
        }
        return {
          inMinor: sum((day) => day.inMinor),
          outMinor,
          transferMinor: sum((day) => day.transferMinor),
          inCount: count((day) => day.inCount),
          outCount: count((day) => day.outCount),
          transferCount: count((day) => day.transferCount),
          dailySpend,
          averageDailySpendMinor: dailySpend.length === 0 ? 0n : outMinor / BigInt(dailySpend.length),
        };
      }),

    groupByAccount: (userId, filter) =>
      query(userId, filter, (tx, where) => {
        const count = sql<number>`count(distinct ${transactions.id})::int`;
        return tx
          .select({
            accountId: postings.accountId,
            count,
            inMinor: sumIn.mapWith(BigInt),
            outMinor: sumOut.mapWith(BigInt),
          })
          .from(transactions)
          .innerJoin(postings, eq(postings.transactionId, transactions.id))
          .where(where)
          .groupBy(postings.accountId)
          .orderBy(desc(count), asc(postings.accountId));
      }),

    balancesAfter: async (userId, accountId, transactionIds) => {
      if (transactionIds.length === 0) return {};
      return withUser(db, userId, async (tx) => {
        const net = tx
          .select({
            id: transactions.id,
            occurredAt: transactions.occurredAt,
            netMinor: sql<string>`sum(${postings.amountMinor})`.as('net_minor'),
          })
          .from(postings)
          .innerJoin(transactions, and(eq(transactions.id, postings.transactionId), isNull(transactions.deletedAt)))
          .where(eq(postings.accountId, accountId))
          .groupBy(transactions.id)
          .as('net');
        const running = tx
          .select({
            id: net.id,
            balanceMinor:
              sql<string>`((select ${accounts.openingBalanceMinor} from ${accounts} where ${accounts.id} = ${accountId})
              + sum(${net.netMinor}) over (order by ${net.occurredAt}, ${net.id})
              + (select coalesce(sum(${balanceAdjustments.amountMinor}), 0) from ${balanceAdjustments}
                 where ${balanceAdjustments.accountId} = ${accountId} and ${balanceAdjustments.createdAt} <= ${net.occurredAt}))::text`.as(
                'balance_minor',
              ),
          })
          .from(net)
          .as('running');
        const rows = await tx
          .select({ id: running.id, balanceMinor: running.balanceMinor })
          .from(running)
          .where(inArray(running.id, [...transactionIds]));
        return Object.fromEntries(rows.map((row) => [row.id, BigInt(row.balanceMinor)]));
      });
    },
  };
}
