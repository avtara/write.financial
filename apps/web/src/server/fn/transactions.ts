// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Server functions of the Transactions page (FR-L1–L6): the page data for a period or range with its filters (summary
 * cards, daily spending, day/category/account groups, the first rows), more rows, a transaction's detail, editing,
 * duplicating, splitting, bulk changes, attachments, the table preferences, and the nav badge count. The user always
 * comes from the session; the repositories enforce ownership (RLS) and the ledger rules (closed periods, splits).
 */
import { createServerFn } from '@tanstack/react-start';
import { LedgerError } from '@wf/db/ledger-errors';
import type { TransactionDetail } from '@wf/db/transactions';
import type { RecordResult } from '@wf/db/ledger-core';
import type { PeriodView } from '@wf/db/periods';
import type {
  AccountGroup,
  CategoryGroup,
  DayGroup,
  TransactionFilter,
  TransactionRow,
  TransactionSummary,
} from '@wf/db/transaction-query';
import { rangeSummary, type RangeSummary } from '@wf/domain/dashboard';
import type { LocalDate } from '@wf/domain/period';
import type { TransactionSource } from '@wf/domain/transactions';
import { ImageRejectedError, MAX_IMAGE_BYTES, prepareImageUpload } from '@wf/integrations/image';
import * as z from 'zod';
import { TABLE_PREFS, tablePrefsOf, type TablePrefs } from '../../lib/transaction-columns.ts';
import {
  listValues,
  rangeOf,
  TRANSACTIONS_QUERY,
  type LISTED_TYPES,
  type TransactionsQuery,
} from '../../lib/transactions-search.ts';
import { attempt, requireSession, UploadRejectedError, type Result } from '../access.ts';
import type { RequestContext } from '../request-middleware.ts';
import { services, type Services } from '../runtime.ts';
import { defined, RECORD_TRANSACTION_INPUT } from './transactions-write.ts';
import { MAX_IMAGES, MAX_SPLIT_PARTS, PAGE_SIZE } from '../../lib/transaction-limits.ts';

const IDS = z.array(z.uuid()).min(1).max(200);
const PDF_SIGNATURE = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"

/** Rows plus, when exactly one account is filtered, its balance right after each row ("Saldo berjalan"). */
export interface TransactionRowsPage {
  readonly rows: TransactionRow[];
  /** Matching rows across all pages. */
  readonly total: number;
  /** Row id → balance of the filtered account after it (account currency); `null` unless one account is filtered. */
  readonly balances: Record<string, bigint> | null;
}

export interface TransactionsView {
  readonly today: LocalDate;
  /** The dates the query covers (inclusive). */
  readonly from: LocalDate;
  readonly to: LocalDate;
  /** The period shown (`?period=` or the current one); `null` for a custom `?range=`. */
  readonly period: PeriodView | null;
  /** The current period and every period row, newest first (date presets, "melintasi N periode"). */
  readonly periods: PeriodView[];
  readonly rangeSummary: RangeSummary;
  readonly summary: TransactionSummary;
  /** By day, newest first (group subtotals). */
  readonly days: DayGroup[];
  /** By category, largest first (group % and subtotals). */
  readonly categories: CategoryGroup[];
  /** Per account (filter counts, "di N rekening"). */
  readonly accounts: AccountGroup[];
  /** The first {@link PAGE_SIZE} rows in the query's sort. */
  readonly page: TransactionRowsPage;
  /** Live transactions in `from`–`to` before any other filter ("0 dari 128 transaksi"). */
  readonly unfilteredCount: number;
  /** Whether the user has any live transaction at all (first-run empty state). */
  readonly hasTransactions: boolean;
  readonly prefs: TablePrefs;
}

function forUser<T>(
  context: Pick<RequestContext, 'session'>,
  action: (userId: string, services: Services) => Promise<T>,
): Promise<Result<T>> {
  return services().then((all) =>
    attempt(async () => {
      const { user } = await requireSession(context.session, {}, all.now());
      return action(user.id, all);
    }),
  );
}

/** The repository filter of `query` within `from`–`to`. */
function filterOf(query: TransactionsQuery, from: LocalDate, to: LocalDate): TransactionFilter {
  const filter: { -readonly [K in keyof TransactionFilter]: TransactionFilter[K] } = { from, to };
  const types = listValues(query.type) as (typeof LISTED_TYPES)[number][];
  if (types.length > 0) filter.types = types;
  const categoryIds = listValues(query.category);
  if (categoryIds.length > 0) filter.categoryIds = categoryIds;
  if (query.uncategorized !== undefined) filter.uncategorized = query.uncategorized;
  const accountIds = listValues(query.account);
  if (accountIds.length > 0) filter.accountIds = accountIds;
  const tags = listValues(query.tag);
  if (tags.length > 0) {
    filter.tags = tags;
    filter.tagMode = query.tagMode ?? 'any';
  }
  if (query.min !== undefined) filter.minAmountMinor = BigInt(query.min);
  if (query.max !== undefined) filter.maxAmountMinor = BigInt(query.max);
  if (query.attachment !== undefined) filter.hasAttachment = query.attachment;
  const sources = listValues(query.source) as TransactionSource[];
  if (sources.length > 0) filter.sources = sources;
  const currencies = listValues(query.currency);
  if (currencies.length > 0) filter.currencies = currencies;
  if (query.q !== undefined && query.q !== '') filter.search = query.q;
  return filter;
}

/** The dates `query` covers: its range, its period, or the current period. */
async function resolveDates(userId: string, { periods }: Services, query: TransactionsQuery) {
  const overview = await periods.list(userId);
  const all = [overview.current, ...overview.periods.filter((period) => period.id !== overview.current.id)];
  if (query.range !== undefined) {
    const { from, to } = rangeOf(query.range);
    return { today: overview.today, from, to, period: null, periods: all };
  }
  const period = all.find((candidate) => candidate.label === query.period) ?? overview.current;
  return { today: overview.today, from: period.start, to: period.end, period, periods: all };
}

async function rowsPage(
  userId: string,
  { transactionQuery }: Services,
  query: TransactionsQuery,
  filter: TransactionFilter,
  offset: number,
): Promise<TransactionRowsPage> {
  const { rows, total } = await transactionQuery.list(userId, filter, {
    sort: query.sort ?? 'date_desc',
    limit: PAGE_SIZE,
    offset,
  });
  const accountIds = filter.accountIds ?? [];
  const balances =
    accountIds.length === 1 && accountIds[0] !== undefined
      ? await transactionQuery.balancesAfter(
          userId,
          accountIds[0],
          rows.map((row) => row.id),
        )
      : null;
  return { rows, total, balances };
}

/** FR-L1/L2: everything the page shows for `query`. */
export const getTransactionsView = createServerFn({ method: 'GET' })
  .validator(TRANSACTIONS_QUERY)
  .handler(({ context, data }): Promise<Result<TransactionsView>> =>
    forUser(context, async (userId, all) => {
      const { transactionQuery, preferences } = all;
      const dates = await resolveDates(userId, all, data);
      const filter = filterOf(data, dates.from, dates.to);
      const [summary, days, categories, accounts, page, unfiltered, ever, stored] = await Promise.all([
        transactionQuery.summary(userId, filter),
        transactionQuery.groupByDay(userId, filter),
        transactionQuery.groupByCategory(userId, filter),
        transactionQuery.groupByAccount(userId, filter),
        rowsPage(userId, all, data, filter, 0),
        transactionQuery.list(userId, { from: dates.from, to: dates.to }, { limit: 1 }),
        transactionQuery.list(userId, {}, { limit: 1 }),
        preferences.get(userId),
      ]);
      return {
        ...dates,
        rangeSummary: rangeSummary({ from: dates.from, to: dates.to }, dates.periods),
        summary,
        days,
        categories,
        accounts,
        page,
        unfilteredCount: unfiltered.total,
        hasTransactions: ever.total > 0,
        prefs: tablePrefsOf(stored.tablePrefs['transactions']),
      };
    }),
  );

/** FR-L2 infinite load: the rows from `offset` on. */
export const listTransactionRows = createServerFn({ method: 'GET' })
  .validator(TRANSACTIONS_QUERY.extend({ offset: z.int().min(0).max(1_000_000) }))
  .handler(({ context, data }): Promise<Result<TransactionRowsPage>> =>
    forUser(context, async (userId, all) => {
      const { offset, ...query } = data;
      const { from, to } = await resolveDates(userId, all, query);
      return rowsPage(userId, all, query, filterOf(query, from, to), offset);
    }),
  );

/** FR-L4: one transaction (deleted ones too, with `deletedAt`) with postings, tags, attachments, and activity. */
export const getTransactionDetail = createServerFn({ method: 'GET' })
  .validator(z.object({ id: z.uuid() }))
  .handler(({ context, data }): Promise<Result<TransactionDetail>> =>
    forUser(context, (userId, { transactions }) => transactions.get(userId, data.id)),
  );

/**
 * FR-L4 inline edit: replaces the transaction with the form's input. Its source is kept, and so is its merchant
 * unless the input sets one (the form has no merchant field).
 */
export const updateTransaction = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.uuid(), input: RECORD_TRANSACTION_INPUT }))
  .handler(({ context, data }): Promise<Result<TransactionDetail>> =>
    forUser(context, async (userId, { transactions }) => {
      const before = await transactions.get(userId, data.id);
      return transactions.update(userId, data.id, {
        merchant: before.merchant,
        ...defined(data.input),
        source: before.source,
      });
    }),
  );

/**
 * FR-L6 "Duplikat": records the Duplicate sheet's input (prefilled from `id`, dated now, no attachments) as a new
 * transaction linked to `id`; idempotent per `input.clientId`.
 */
export const duplicateTransaction = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.uuid(), input: RECORD_TRANSACTION_INPUT }))
  .handler(({ context, data }): Promise<Result<RecordResult>> =>
    forUser(context, async (userId, { transactions }) => {
      await transactions.get(userId, data.id);
      return transactions.create(userId, { ...defined(data.input), duplicatedFromId: data.id });
    }),
  );

/** FR-L5: replaces an expense/income with parts adding up to its amount (Undo: {@link unsplitTransaction}). */
export const splitTransaction = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      id: z.uuid(),
      clientId: z.uuid(),
      parts: z
        .array(
          z.object({
            amountMinor: z.bigint().positive(),
            categoryId: z.uuid().nullable(),
            description: z.string().max(200).nullable().optional(),
          }),
        )
        .min(2)
        .max(MAX_SPLIT_PARTS),
    }),
  )
  .handler(({ context, data }): Promise<Result<{ partIds: string[] }>> =>
    forUser(context, (userId, { transactions }) =>
      transactions.split(userId, data.id, { clientId: data.clientId, parts: data.parts.map(defined) }),
    ),
  );

/** Undo of {@link splitTransaction}: the original comes back, the parts go. */
export const unsplitTransaction = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.uuid() }))
  .handler(({ context, data }): Promise<Result<{ partIds: string[] }>> =>
    forUser(context, (userId, { transactions }) => transactions.unsplit(userId, data.id)),
  );

/** FR-L3 "Ubah kategori" (`null` = uncategorized). */
export const bulkSetCategory = createServerFn({ method: 'POST' })
  .validator(z.object({ ids: IDS, categoryId: z.uuid().nullable() }))
  .handler(({ context, data }): Promise<Result<{ updated: string[] }>> =>
    forUser(context, (userId, { transactions }) => transactions.bulkSetCategory(userId, data.ids, data.categoryId)),
  );

/** FR-L3 "Pindah rekening" (same currency only). */
export const bulkMoveAccount = createServerFn({ method: 'POST' })
  .validator(z.object({ ids: IDS, accountId: z.uuid() }))
  .handler(({ context, data }): Promise<Result<{ updated: string[] }>> =>
    forUser(context, (userId, { transactions }) => transactions.bulkMoveAccount(userId, data.ids, data.accountId)),
  );

/** FR-L3 "Tambah tag" (slug or `#Name`; created when new). */
export const bulkAddTag = createServerFn({ method: 'POST' })
  .validator(z.object({ ids: IDS, tag: z.string().trim().min(1).max(64) }))
  .handler(({ context, data }): Promise<Result<{ updated: string[] }>> =>
    forUser(context, (userId, { transactions }) => transactions.bulkAddTag(userId, data.ids, data.tag)),
  );

/** `ATTACHMENT_LIMIT`: the transaction already has {@link MAX_IMAGES} images. */
class AttachmentLimitError extends Error {
  readonly code = 'ATTACHMENT_LIMIT';

  constructor() {
    super('Too many attachments');
  }
}

const UPLOAD = z.object({
  transactionId: z.uuid(),
  kind: z.enum(['receipt', 'image']),
  file: z.instanceof(File),
});

/**
 * FR-L4 attachments: `kind=receipt` replaces the receipt ("Struk"), `kind=image` adds one of at most
 * {@link MAX_IMAGES} ("Gambar lain"). Images go through the image pipeline (type from magic bytes, re-encoded
 * without metadata, with a thumbnail); a receipt may also be a PDF (≤ 2 MB, `%PDF-` signature, stored as is and
 * only ever served as a download). Stored encrypted in the attachments bucket; the replaced receipt's objects are
 * deleted only once the new one is saved, and the new objects are deleted again when saving it fails.
 */
export const addAttachment = createServerFn({ method: 'POST' })
  .validator(z.instanceof(FormData))
  .handler(({ context, data }): Promise<Result<{ id: string }>> =>
    forUser(context, async (userId, { transactions, attachmentStore }) => {
      const { transactionId, kind, file } = UPLOAD.parse(Object.fromEntries(data));
      const detail = await transactions.get(userId, transactionId);
      if (detail.deletedAt !== null) throw new LedgerError('NOT_FOUND', 'No such transaction');
      const images = detail.attachments.filter((attachment) => attachment.kind === 'image');
      if (kind === 'image' && images.length >= MAX_IMAGES) throw new AttachmentLimitError();
      if (file.size > MAX_IMAGE_BYTES) throw new UploadRejectedError('too-large');
      const bytes = new Uint8Array(await file.arrayBuffer());
      let stored: { objectKey: string; thumbnailKey: string | null; mime: string; size: number; sha256: string };
      if (kind === 'receipt' && PDF_SIGNATURE.every((byte, index) => bytes[index] === byte)) {
        const put = await attachmentStore.put(userId, bytes, 'application/pdf');
        stored = {
          objectKey: put.key,
          thumbnailKey: null,
          mime: 'application/pdf',
          size: put.size,
          sha256: put.sha256,
        };
      } else {
        let prepared;
        try {
          prepared = await prepareImageUpload(bytes);
        } catch (error) {
          if (error instanceof ImageRejectedError) throw new UploadRejectedError(error.reason);
          throw error;
        }
        const image = await attachmentStore.put(userId, prepared.image.bytes, prepared.image.mime);
        const thumbnail = await attachmentStore.put(userId, prepared.thumbnail.bytes, prepared.thumbnail.mime);
        stored = {
          objectKey: image.key,
          thumbnailKey: thumbnail.key,
          mime: prepared.image.mime,
          size: image.size,
          sha256: image.sha256,
        };
      }
      let id: string;
      try {
        ({ id } = await transactions.addAttachment(userId, transactionId, {
          bucket: 'attachments',
          ...stored,
          kind,
          name: file.name.trim().slice(0, 200) || null,
        }));
      } catch (error) {
        const keys = stored.thumbnailKey === null ? [stored.objectKey] : [stored.objectKey, stored.thumbnailKey];
        await Promise.all(keys.map((key) => attachmentStore.delete(userId, key)));
        throw error;
      }
      if (kind === 'receipt') {
        for (const old of detail.attachments.filter((attachment) => attachment.kind === 'receipt')) {
          const { objectKeys } = await transactions.removeAttachment(userId, old.id);
          await Promise.all(objectKeys.map((key) => attachmentStore.delete(userId, key)));
        }
      }
      return { id };
    }),
  );

/** FR-L4 "Hapus" in the lightbox: removes the attachment and its stored objects (unless a split part shares them). */
export const removeAttachment = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.uuid() }))
  .handler(({ context, data }): Promise<Result<null>> =>
    forUser(context, async (userId, { transactions, attachmentStore }) => {
      const { objectKeys } = await transactions.removeAttachment(userId, data.id);
      await Promise.all(objectKeys.map((key) => attachmentStore.delete(userId, key)));
      return null;
    }),
  );

/** FR-L2 "Atur kolom": saves the column order/visibility and density. */
export const saveTablePrefs = createServerFn({ method: 'POST' })
  .validator(TABLE_PREFS)
  .handler(({ context, data }): Promise<Result<TablePrefs>> =>
    forUser(context, async (userId, { preferences }) => {
      const { tablePrefs } = await preferences.get(userId);
      const saved = await preferences.update(userId, { tablePrefs: { ...tablePrefs, transactions: data } });
      return tablePrefsOf(saved.tablePrefs['transactions']);
    }),
  );

/** The nav badge ("Transaksi 128"): live transactions in the current period. */
export const countPeriodTransactions = createServerFn({ method: 'GET' }).handler(
  ({ context }): Promise<Result<number>> =>
    forUser(context, async (userId, { periods, transactionQuery }) => {
      const { current } = await periods.list(userId);
      const { total } = await transactionQuery.list(userId, { from: current.start, to: current.end }, { limit: 1 });
      return total;
    }),
);
