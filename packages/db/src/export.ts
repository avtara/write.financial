// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Ekspor semua data" (FR-A11, FR-ST5): the user's rows from every user-owned table that carries data they
 * entered or that was recorded for them, as JSON (per-table arrays) and as a CSV of the main ledger
 * (transactions with their account, category, and tag names). Runs as `wf_app` inside the user's RLS scope, so
 * no other user's row can ever be read here.
 *
 * Export choices (documented per FR-A11's "all data"):
 * - Auth secrets never leave the database: `sessions`, `accounts_auth`, `verifications`, `two_factors`,
 *   `passkeys`, `user_keys` (the wrapped DEK), and `security_events` (keyed IP hashes — the user reads this
 *   history in the app) are not exported at all.
 * - Ciphertext columns (`*_enc`, `bytea`: a transaction's note, a draft's or review item's payload, an
 *   attachment's name or OCR text, a market key) are stripped: exporting them would only hand back bytes that
 *   need the DEK an export must not contain. What they hold is readable in the app instead.
 * - Derived/internal state is skipped: `recent_items`, `review_items` (queued work), `notification_outbox`
 *   (email queue), `market_api_logs` (30-day request log, already exported per feature by its own CSV), and
 *   `market_provider_state` (built-in source cache).
 * - Rows are capped per table ({@link MAX_ROWS_PER_TABLE}, the newest kept by the table's natural order) with
 *   `truncated` flags in the header, so one request cannot build an unbounded response.
 */
import { asc, count, desc, eq, getTableColumns, sql } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import { firstRow, withUser, type Database, type Transaction } from './db.ts';
import {
  accounts,
  activityLog,
  allocationTargets,
  assetCategories,
  assets,
  attachments,
  balanceAdjustments,
  budgetAlertDismissals,
  budgetLines,
  budgetPeriodOverrides,
  budgetVersions,
  cardPaymentAllocations,
  categories,
  debtInstallments,
  debts,
  detectedRecurring,
  drafts,
  fxRates,
  goalContributionPlans,
  goalFundingSources,
  goalSnapshots,
  goals,
  investmentTrades,
  marketCredentials,
  notifications,
  periods,
  portfolioSnapshots,
  postings,
  receivablePayments,
  receivables,
  recurrences,
  reports,
  scheduledOccurrences,
  subscriptions,
  tagAliases,
  tags,
  transactionTags,
  transactions,
  transferMeta,
  userPreferences,
  userQuotes,
  users,
} from './schema.ts';

/** Most rows of one table an export keeps (the newest, by the table's natural order); larger data is cut. */
export const MAX_ROWS_PER_TABLE = 50_000;

/** A user's profile as the export states it: the non-sensitive columns only. */
export interface ExportedUser {
  readonly name: string;
  readonly nickname: string | null;
  readonly image: string | null;
  readonly locale: string;
  readonly timezone: string;
  readonly baseCurrency: string;
  readonly twoFactorEnabled: boolean;
  readonly onboardingCompletedAt: Date | null;
  readonly createdAt: Date;
  readonly deletionRequestedAt: Date | null;
}

/** One export: the header and, per table, the rows (each still carries its `user_id`, the owner's own). */
export interface DataExport {
  readonly exportedAt: Date;
  /** The profile of the user the export belongs to. */
  readonly user: ExportedUser;
  /** Tables whose rows hit the cap and so were cut to the newest {@link MAX_ROWS_PER_TABLE}. */
  readonly truncated: readonly string[];
  readonly preferences: object[];
  readonly accounts: object[];
  readonly categories: object[];
  readonly tags: object[];
  readonly tagAliases: object[];
  readonly transactions: object[];
  readonly transactionTags: object[];
  readonly postings: object[];
  readonly transferMeta: object[];
  readonly balanceAdjustments: object[];
  readonly drafts: object[];
  readonly fxRates: object[];
  readonly periods: object[];
  readonly budgetVersions: object[];
  readonly budgetLines: object[];
  readonly budgetPeriodOverrides: object[];
  readonly budgetAlertDismissals: object[];
  readonly goals: object[];
  readonly goalFundingSources: object[];
  readonly goalContributionPlans: object[];
  readonly goalSnapshots: object[];
  readonly recurrences: object[];
  readonly subscriptions: object[];
  readonly scheduledOccurrences: object[];
  readonly detectedRecurring: object[];
  readonly notifications: object[];
  readonly debts: object[];
  readonly debtInstallments: object[];
  readonly cardPaymentAllocations: object[];
  readonly receivables: object[];
  readonly receivablePayments: object[];
  readonly assetCategories: object[];
  readonly assets: object[];
  readonly allocationTargets: object[];
  readonly investmentTrades: object[];
  readonly portfolioSnapshots: object[];
  readonly userQuotes: object[];
  readonly marketCredentials: object[];
  readonly attachments: object[];
  readonly activityLog: object[];
  readonly reports: object[];
}

type ExportTables = Omit<DataExport, 'exportedAt' | 'user' | 'truncated'>;

/** The user's main ledger with the names behind the ids, as the CSV source rows. */
export interface LedgerRow {
  readonly id: string;
  readonly occurredAt: Date;
  readonly type: string;
  readonly description: string | null;
  readonly merchant: string | null;
  /** Principal posting amount, signed, as decimal text (bigint columns come back as text). */
  readonly amountMinor: string;
  readonly currency: string;
  readonly account: string | null;
  readonly category: string | null;
  /** Comma-joined tag slugs. */
  readonly tags: string | null;
  readonly deletedAt: Date | null;
}

export interface DataExporter {
  /** Every exported table of `userId`, with {@link DataExport.user} filled from the profile. */
  collect: (userId: string, options?: { readonly now?: Date; readonly maxRows?: number }) => Promise<DataExport>;
  /** The main ledger with names joined, oldest first, as the CSV source rows. */
  ledgerRows: (userId: string, options?: { readonly maxRows?: number }) => Promise<LedgerRow[]>;
}

/**
 * One exported table, with the column its rows keep their natural order by (an `id` where the table has one,
 * otherwise a key column such as a snapshot date) — also what "the newest rows" of the cap means. Every exported
 * table is user-owned, so its TypeScript type carries the `userId` column.
 */
interface TableSpec {
  readonly name: keyof ExportTables;
  readonly table: PgTable & { readonly userId: PgColumn };
  readonly order: PgColumn;
}

const TABLES: readonly TableSpec[] = [
  { name: 'preferences', table: userPreferences, order: userPreferences.userId },
  { name: 'accounts', table: accounts, order: accounts.id },
  { name: 'categories', table: categories, order: categories.id },
  { name: 'tags', table: tags, order: tags.id },
  { name: 'tagAliases', table: tagAliases, order: tagAliases.id },
  { name: 'transactions', table: transactions, order: transactions.id },
  { name: 'transactionTags', table: transactionTags, order: transactionTags.transactionId },
  { name: 'postings', table: postings, order: postings.id },
  { name: 'transferMeta', table: transferMeta, order: transferMeta.transactionId },
  { name: 'balanceAdjustments', table: balanceAdjustments, order: balanceAdjustments.id },
  { name: 'drafts', table: drafts, order: drafts.id },
  { name: 'fxRates', table: fxRates, order: fxRates.id },
  { name: 'periods', table: periods, order: periods.id },
  { name: 'budgetVersions', table: budgetVersions, order: budgetVersions.id },
  { name: 'budgetLines', table: budgetLines, order: budgetLines.id },
  { name: 'budgetPeriodOverrides', table: budgetPeriodOverrides, order: budgetPeriodOverrides.id },
  { name: 'budgetAlertDismissals', table: budgetAlertDismissals, order: budgetAlertDismissals.periodId },
  { name: 'goals', table: goals, order: goals.id },
  { name: 'goalFundingSources', table: goalFundingSources, order: goalFundingSources.id },
  { name: 'goalContributionPlans', table: goalContributionPlans, order: goalContributionPlans.id },
  { name: 'goalSnapshots', table: goalSnapshots, order: goalSnapshots.snapshotDate },
  { name: 'recurrences', table: recurrences, order: recurrences.id },
  { name: 'subscriptions', table: subscriptions, order: subscriptions.id },
  { name: 'scheduledOccurrences', table: scheduledOccurrences, order: scheduledOccurrences.id },
  { name: 'detectedRecurring', table: detectedRecurring, order: detectedRecurring.id },
  { name: 'notifications', table: notifications, order: notifications.id },
  { name: 'debts', table: debts, order: debts.id },
  { name: 'debtInstallments', table: debtInstallments, order: debtInstallments.id },
  { name: 'cardPaymentAllocations', table: cardPaymentAllocations, order: cardPaymentAllocations.id },
  { name: 'receivables', table: receivables, order: receivables.id },
  { name: 'receivablePayments', table: receivablePayments, order: receivablePayments.id },
  { name: 'assetCategories', table: assetCategories, order: assetCategories.id },
  { name: 'assets', table: assets, order: assets.id },
  { name: 'allocationTargets', table: allocationTargets, order: allocationTargets.assetClass },
  { name: 'investmentTrades', table: investmentTrades, order: investmentTrades.id },
  { name: 'portfolioSnapshots', table: portfolioSnapshots, order: portfolioSnapshots.snapshotDate },
  { name: 'userQuotes', table: userQuotes, order: userQuotes.bucketTs },
  // The key itself never leaves: the bytea filter below drops `api_key_enc` and keeps only state columns.
  { name: 'marketCredentials', table: marketCredentials, order: marketCredentials.id },
  { name: 'attachments', table: attachments, order: attachments.id },
  { name: 'activityLog', table: activityLog, order: activityLog.id },
  { name: 'reports', table: reports, order: reports.id },
];

const PROFILE_COLUMNS = {
  name: users.name,
  nickname: users.nickname,
  image: users.image,
  locale: users.locale,
  timezone: users.timezone,
  baseCurrency: users.baseCurrency,
  twoFactorEnabled: users.twoFactorEnabled,
  onboardingCompletedAt: users.onboardingCompletedAt,
  createdAt: users.createdAt,
  deletionRequestedAt: users.deletionRequestedAt,
} as const;

const columnsOf = (table: PgTable) => getTableColumns(table) as Record<string, PgColumn>;

/** Column objects of `table` without the ciphertext ones: no `bytea` column leaves the database in an export. */
function exportedColumns(table: PgTable): Record<string, PgColumn> {
  return Object.fromEntries(Object.entries(columnsOf(table)).filter(([, column]) => column.columnType !== 'PgBytea'));
}

export function createExport(db: Database): DataExporter {
  /** One table's rows, oldest first, at most `maxRows` of them (the newest kept; `truncated` then says so). */
  const rowsOf = async (
    tx: Transaction,
    userId: string,
    spec: TableSpec,
    maxRows: number,
  ): Promise<{ rows: object[]; truncated: boolean }> => {
    const columns = exportedColumns(spec.table);
    const where = eq(spec.table.userId, userId);
    const total = firstRow(await tx.select({ n: count() }).from(spec.table).where(where), spec.name).n;
    if (total <= maxRows) {
      return {
        rows: await tx.select(columns).from(spec.table).where(where).orderBy(asc(spec.order)),
        truncated: false,
      };
    }
    // Over the cap: keep the newest `maxRows` (descending order, then flip back to oldest first).
    const newest = await tx.select(columns).from(spec.table).where(where).orderBy(desc(spec.order)).limit(maxRows);
    return { rows: newest.reverse(), truncated: true };
  };

  return {
    collect: (userId, { now = new Date(), maxRows = MAX_ROWS_PER_TABLE } = {}) =>
      withUser(db, userId, async (tx) => {
        const row = firstRow(await tx.select(PROFILE_COLUMNS).from(users).where(eq(users.id, userId)), 'exported user');
        const user: ExportedUser = { ...row, twoFactorEnabled: row.twoFactorEnabled === true };
        const truncated: string[] = [];
        const tables: Partial<Record<keyof ExportTables, object[]>> = {};
        for (const spec of TABLES) {
          const { rows, truncated: cut } = await rowsOf(tx, userId, spec, maxRows);
          tables[spec.name] = rows;
          if (cut) truncated.push(spec.name);
        }
        return { exportedAt: now, user, truncated, ...tables } as DataExport;
      }),

    ledgerRows: (userId, { maxRows = MAX_ROWS_PER_TABLE } = {}) =>
      withUser(db, userId, async (tx) => {
        // The principal posting of each transaction — for a transfer the source leg, the negative amount
        // (`distinct on` + ascending amount keeps the most negative posting of the two principal legs); RLS
        // already scopes `postings` to this user's rows. One row per transaction, so the joins below cannot
        // duplicate one.
        const principal = tx
          .selectDistinctOn([postings.transactionId], {
            transactionId: postings.transactionId,
            amountMinor: postings.amountMinor,
            currency: postings.currency,
            accountId: postings.accountId,
          })
          .from(postings)
          .where(eq(postings.role, 'principal'))
          .orderBy(postings.transactionId, postings.amountMinor)
          .as('principal');
        const total = firstRow(
          await tx.select({ n: count() }).from(transactions).where(eq(transactions.userId, userId)),
          'ledger rows',
        ).n;
        const capped = total > maxRows;
        const query = tx
          .select({
            id: transactions.id,
            occurredAt: transactions.occurredAt,
            type: sql<string>`${transactions.type}::text`,
            description: transactions.description,
            merchant: transactions.merchant,
            amountMinor: sql<string>`coalesce(${principal.amountMinor}, 0)::text`,
            currency: sql<string>`coalesce(${principal.currency}, ${accounts.currency})`,
            account: accounts.displayName,
            category: categories.name,
            tags: sql<
              string | null
            >`(select string_agg(${tags.slug}, ',') from ${transactionTags} join ${tags} on ${tags.id} = ${transactionTags.tagId} where ${transactionTags.transactionId} = ${transactions.id})`,
            deletedAt: transactions.deletedAt,
          })
          .from(transactions)
          .leftJoin(principal, eq(principal.transactionId, transactions.id))
          .leftJoin(accounts, eq(accounts.id, principal.accountId))
          .leftJoin(categories, eq(categories.id, transactions.categoryId))
          .where(eq(transactions.userId, userId))
          .orderBy(
            capped ? desc(transactions.occurredAt) : asc(transactions.occurredAt),
            capped ? desc(transactions.id) : asc(transactions.id),
          );
        // Over the cap: keep the newest `maxRows` (descending, then flip back to oldest first). Uncapped: every
        // row (a LIMIT of the transaction count would be wrong the day the joins ever fan out).
        const rows = await (capped ? query.limit(maxRows) : query);
        return capped ? rows.reverse() : rows;
      }),
  };
}

const CSV_HEADER = [
  'id',
  'occurred_at',
  'type',
  'description',
  'merchant',
  'amount_minor',
  'currency',
  'account',
  'category',
  'tags',
  'deleted_at',
] as const;

/** The property of {@link LedgerRow} each CSV header column comes from. */
const CSV_COLUMNS = [
  'id',
  'occurredAt',
  'type',
  'description',
  'merchant',
  'amountMinor',
  'currency',
  'account',
  'category',
  'tags',
  'deletedAt',
] as const;

/** RFC 4180: a field with a quote, comma, or newline is wrapped in quotes and its quotes are doubled. */
const csvField = (value: string): string => (/["\r\n,]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value);

const csvCell = (row: LedgerRow, property: (typeof CSV_COLUMNS)[number]): string => {
  const value = row[property];
  if (value === null) return '';
  if (value instanceof Date) return value.toISOString();
  return csvField(value);
};

/** The ledger rows as a CSV document (RFC 4180: CRLF, quoted where needed, English header). */
export function transactionsCsv(rows: readonly LedgerRow[]): string {
  return [
    CSV_HEADER.join(','),
    ...rows.map((row) => CSV_COLUMNS.map((property) => csvCell(row, property)).join(',')),
  ].join('\r\n');
}
