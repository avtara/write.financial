// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Money accounts (FR-R1–R6): balances, the available balance, flags (cards), archive/restore,
 * permanent deletion, reconciliation, and the detail panel's flows and monthly series.
 *
 * Balance = opening balance + Σ postings of non-deleted transactions + Σ balance adjustments. An account is
 * `locked` (FR-R3: currency, opening balance and opening date fixed) while it has postings of non-deleted
 * transactions; soft-deleted ones (Undo window) do not lock it.
 */
import { getCatalogRecord, matchProvider } from '@wf/domain/catalog';
import type { FxRate } from '@wf/domain/fx';
import { availableBalance, type AccountType } from '@wf/domain/ledger';
import { parseLocalDate, type LocalDate, type YearMonth } from '@wf/domain/period';
import { toBase } from '@wf/domain/transactions';
import { and, asc, eq, inArray, isNull, lte, sql, type SQL } from 'drizzle-orm';
import { firstRow, withUser, type Database, type Transaction } from './db.ts';
import { logActivity } from './activity.ts';
import { referenceRateIn } from './fx-rates.ts';
import { localDateOf, recordTransactionIn, userContextIn } from './ledger-core.ts';
import { LedgerError } from './ledger-errors.ts';
import { assetValuesIn, holdingsValueByAccount } from './portfolio.ts';
import { accounts, attachments, balanceAdjustments, goals, postings, transactions } from './schema.ts';

const ACCOUNT_COLUMNS = {
  id: accounts.id,
  type: accounts.type,
  providerName: accounts.providerName,
  catalogId: accounts.catalogId,
  logoKey: accounts.logoKey,
  displayName: accounts.displayName,
  last4: accounts.last4,
  phoneMasked: accounts.phoneMasked,
  currency: accounts.currency,
  openingBalanceMinor: accounts.openingBalanceMinor,
  openingDate: accounts.openingDate,
  color: accounts.color,
  includeInAvailable: accounts.includeInAvailable,
  sortOrder: accounts.sortOrder,
  status: accounts.status,
  archivedAt: accounts.archivedAt,
  lowBalanceThresholdMinor: accounts.lowBalanceThresholdMinor,
  lastReconciledAt: accounts.lastReconciledAt,
  ccLimitMinor: accounts.ccLimitMinor,
  ccStatementDay: accounts.ccStatementDay,
  ccDueDay: accounts.ccDueDay,
  parentAccountId: accounts.parentAccountId,
  createdAt: accounts.createdAt,
  updatedAt: accounts.updatedAt,
};

/** Every column but `user_id`. */
export type AccountRow = Omit<typeof accounts.$inferSelect, 'userId'>;

/** An account with its ledger balance (an investment account's balance is its cash). */
export interface AccountBalanceView extends AccountRow {
  /** In the account currency. */
  readonly balanceMinor: bigint;
  /** The balance in the user's base currency; `null` when no rate is known for the account currency. */
  readonly balanceBaseMinor: bigint | null;
  /** FR-R3: the account has postings of non-deleted transactions. */
  readonly locked: boolean;
  /** Non-deleted transactions with a posting on the account. */
  readonly transactionCount: number;
}

export interface AccountView extends AccountBalanceView {
  /**
   * Investment accounts: Σ value of the holdings on the platform now, base currency (the platform is worth cash +
   * holdings); `null` for other accounts and when a holding has no rate to the base currency.
   */
  readonly holdingsValueBaseMinor: bigint | null;
}

export interface AccountsOverview {
  readonly baseCurrency: string;
  readonly accounts: AccountView[];
  /** Σ base-currency balances of active `include_in_available` accounts with a known rate. */
  readonly availableMinor: bigint;
  /** Currencies (sorted) of listed or available-counted accounts without a rate to the base currency. */
  readonly missingRates: string[];
}

export interface AccountInput {
  readonly type: AccountType;
  readonly providerName: string;
  readonly catalogId?: string | null;
  /** 1–40 characters after trimming. */
  readonly displayName: string;
  /** ISO 4217 code. */
  readonly currency: string;
  readonly openingBalanceMinor: bigint;
  readonly openingDate: LocalDate;
  readonly color: string;
  readonly logoKey?: string | null;
  /** Four digits. */
  readonly last4?: string | null;
  readonly phoneMasked?: string | null;
  readonly includeInAvailable?: boolean;
  readonly lowBalanceThresholdMinor?: bigint | null;
  readonly ccLimitMinor?: bigint | null;
  /** 1–31. */
  readonly ccStatementDay?: number | null;
  /** 1–31. */
  readonly ccDueDay?: number | null;
  readonly parentAccountId?: string | null;
}

export type AccountStatusFilter = 'active' | 'archived' | 'all';

/** FR-R4: (a) a categorized expense/income for the difference, or (c) a correction excluded from reports. */
export type ReconcileInput =
  | {
      readonly mode: 'transaction';
      readonly actualBalanceMinor: bigint;
      readonly categoryId: string | null;
      readonly clientId: string;
      readonly occurredAt: Date;
      readonly description?: string | null;
    }
  | { readonly mode: 'correction'; readonly actualBalanceMinor: bigint };

export interface ReconcileResult {
  /** Actual − recorded balance. */
  readonly differenceMinor: bigint;
  readonly transactionId: string | null;
  readonly adjustmentId: string | null;
}

/** Positive amounts in the account currency. */
export interface AccountFlows {
  readonly inflowMinor: bigint;
  readonly outflowMinor: bigint;
  readonly transferInMinor: bigint;
  readonly transferOutMinor: bigint;
}

export interface AccountSeriesPoint {
  readonly month: YearMonth;
  /** Balance at the end of the month (at `end` for the last month). */
  readonly closingBalanceMinor: bigint;
  readonly inflowMinor: bigint;
  readonly outflowMinor: bigint;
}

export interface AccountsRepository {
  list: (userId: string, options?: { readonly status?: AccountStatusFilter }) => Promise<AccountsOverview>;
  /** @throws {LedgerError} `NOT_FOUND` */
  get: (userId: string, id: string) => Promise<AccountView>;
  /** @throws {LedgerError} `INVALID_ACCOUNT`, `TOO_MANY_CARDS`, `NOT_FOUND` (parent account) */
  create: (userId: string, input: AccountInput) => Promise<AccountView>;
  /** @throws {LedgerError} `NOT_FOUND`, `INVALID_ACCOUNT`, `ACCOUNT_LOCKED`, `TOO_MANY_CARDS` */
  update: (userId: string, id: string, patch: Partial<AccountInput>) => Promise<AccountView>;
  /** FR-R5. Archiving an archived account changes nothing. @throws {LedgerError} `NOT_FOUND` */
  archive: (userId: string, id: string) => Promise<AccountView>;
  /** Makes the account active again. @throws {LedgerError} `NOT_FOUND` */
  restore: (userId: string, id: string) => Promise<AccountView>;
  /**
   * Deletes an archived account with every transaction that has a posting on it (including soft-deleted ones and
   * the other leg of transfers). Returns the attachment object keys for the caller to delete from storage.
   * @throws {LedgerError} `NOT_FOUND`, `ACCOUNT_NOT_ARCHIVED`
   */
  deletePermanently: (
    userId: string,
    id: string,
  ) => Promise<{ readonly deletedTransactions: number; readonly objectKeys: string[] }>;
  /** `ids` must be exactly the user's active accounts, in the new order. @throws {LedgerError} `NOT_FOUND` */
  reorder: (userId: string, ids: readonly string[]) => Promise<void>;
  /** FR-R4. @throws {LedgerError} `NOT_FOUND`, `ACCOUNT_ARCHIVED`, and those of recording a transaction */
  reconcile: (userId: string, id: string, input: ReconcileInput) => Promise<ReconcileResult>;
  /** In/out/transfer totals of non-deleted transactions dated `from`–`to`. @throws {LedgerError} `NOT_FOUND` */
  flows: (
    userId: string,
    id: string,
    range: { readonly from: LocalDate; readonly to: LocalDate },
  ) => Promise<AccountFlows>;
  /**
   * `months` (1–120) monthly points, oldest first, ending with `end`'s month. Adjustments count on their creation
   * date (user time zone).
   * @throws {LedgerError} `NOT_FOUND`
   */
  series: (
    userId: string,
    id: string,
    options: { readonly months: number; readonly end: LocalDate },
  ) => Promise<AccountSeriesPoint[]>;
}

export interface AccountsOptions {
  readonly now?: () => Date;
}

const CURRENCY = /^[A-Z]{3}$/;
const LAST4 = /^[0-9]{4}$/;
const DISPLAY_NAME_MAX = 40;
const MAX_SERIES_MONTHS = 120;

/** Fields of {@link AccountInput}; anything else smuggled into an input object is ignored. */
const INPUT_KEYS = [
  'type',
  'providerName',
  'catalogId',
  'displayName',
  'currency',
  'openingBalanceMinor',
  'openingDate',
  'color',
  'logoKey',
  'last4',
  'phoneMasked',
  'includeInAvailable',
  'lowBalanceThresholdMinor',
  'ccLimitMinor',
  'ccStatementDay',
  'ccDueDay',
  'parentAccountId',
] as const satisfies readonly (keyof AccountInput)[];

const LOCKED_KEYS = ['currency', 'openingBalanceMinor', 'openingDate'] as const;

function invalid(message: string): LedgerError {
  return new LedgerError('INVALID_ACCOUNT', message);
}

/** The known fields of `input`, validated and trimmed. */
function normalize(input: Partial<AccountInput>): Partial<AccountInput> {
  const values: Record<string, unknown> = {};
  for (const key of INPUT_KEYS) if (input[key] !== undefined) values[key] = input[key];
  const result = values as { -readonly [K in keyof AccountInput]?: AccountInput[K] };
  if (result.displayName !== undefined) {
    result.displayName = result.displayName.trim();
    if (result.displayName.length === 0 || result.displayName.length > DISPLAY_NAME_MAX) {
      throw invalid('The display name must have 1–40 characters');
    }
  }
  if (result.providerName !== undefined) {
    result.providerName = result.providerName.trim();
    if (result.providerName.length === 0) throw invalid('The provider name is empty');
  }
  if (result.currency !== undefined && !CURRENCY.test(result.currency)) throw invalid('Invalid currency code');
  if (result.openingDate !== undefined) {
    try {
      parseLocalDate(result.openingDate);
    } catch {
      throw invalid('Invalid opening date');
    }
  }
  if (result.last4 != null && !LAST4.test(result.last4)) throw invalid('last4 must be four digits');
  for (const day of [result.ccStatementDay, result.ccDueDay]) {
    if (day != null && (!Number.isInteger(day) || day < 1 || day > 31)) throw invalid('Invalid credit-card day');
  }
  if (result.ccLimitMinor != null && result.ccLimitMinor < 0n) throw invalid('The credit limit is negative');
  return result;
}

/** A custom account has no reference; a selected provider must support the account type. */
function checkCatalog(input: Pick<AccountInput, 'type' | 'catalogId'>): void {
  if (input.catalogId == null) return;
  const entry = getCatalogRecord(input.catalogId);
  if (entry?.kind !== 'provider' || !entry.accountTypes.includes(input.type)) {
    throw invalid('The catalog provider does not support this account type');
  }
}

/** A provider typed by hand that names exactly one catalog provider of this type ("BCA") gets its reference. */
function linkedCatalog(input: Pick<AccountInput, 'type' | 'providerName' | 'catalogId'>): string | null {
  return input.catalogId ?? matchProvider(input.providerName, input.type);
}

/** Postgres `sum`/`count` results as `bigint`. */
const bigintSql = (expression: SQL) => sql<bigint>`(${expression})::bigint`.mapWith(BigInt);

const IS_PRINCIPAL = sql`${postings.role} = 'principal'`;
const INFLOW = bigintSql(
  sql`coalesce(sum(${postings.amountMinor}) filter (where ${IS_PRINCIPAL} and ${transactions.type} in ('income', 'dividend')), 0)`,
);
const OUTFLOW = bigintSql(
  sql`coalesce(-sum(${postings.amountMinor}) filter (where (${IS_PRINCIPAL} and ${transactions.type} = 'expense') or ${postings.role} in ('fee', 'tax')), 0)`,
);
const LIVE_POSTINGS = and(eq(transactions.id, postings.transactionId), isNull(transactions.deletedAt));

export interface Views {
  readonly baseCurrency: string;
  readonly views: AccountBalanceView[];
  readonly missing: ReadonlySet<string>;
}

/**
 * Accounts matching `where` with balances (one aggregate query) and their base-currency values. Read-only, so the
 * worker's balance checks (`balance-checks.ts`) share it.
 */
export async function viewsIn(tx: Transaction, userId: string, where?: SQL): Promise<Views> {
  const posted = tx
    .select({
      accountId: postings.accountId,
      sumMinor: sql<string>`sum(${postings.amountMinor})`.as('posted_minor'),
      count: sql<string>`count(distinct ${postings.transactionId})`.as('posted_count'),
    })
    .from(postings)
    .innerJoin(transactions, LIVE_POSTINGS)
    .groupBy(postings.accountId)
    .as('posted');
  const adjusted = tx
    .select({
      accountId: balanceAdjustments.accountId,
      sumMinor: sql<string>`sum(${balanceAdjustments.amountMinor})`.as('adjusted_minor'),
    })
    .from(balanceAdjustments)
    .groupBy(balanceAdjustments.accountId)
    .as('adjusted');
  const rows = await tx
    .select({
      ...ACCOUNT_COLUMNS,
      balanceMinor: bigintSql(
        sql`${accounts.openingBalanceMinor} + coalesce(${posted.sumMinor}, 0) + coalesce(${adjusted.sumMinor}, 0)`,
      ),
      transactionCount: sql<number>`coalesce(${posted.count}, 0)::int`.mapWith(Number),
    })
    .from(accounts)
    .leftJoin(posted, eq(posted.accountId, accounts.id))
    .leftJoin(adjusted, eq(adjusted.accountId, accounts.id))
    .where(where)
    .orderBy(asc(accounts.sortOrder), asc(accounts.createdAt), asc(accounts.id));

  const { baseCurrency } = await userContextIn(tx, userId);
  const rates: FxRate[] = [];
  const missing = new Set<string>();
  for (const currency of new Set(rows.map((row) => row.currency))) {
    if (currency === baseCurrency) continue;
    const rate = await referenceRateIn(tx, currency, baseCurrency);
    if (rate === null) missing.add(currency);
    else rates.push(rate);
  }
  const views = rows.map((row) => ({
    ...row,
    balanceBaseMinor: missing.has(row.currency)
      ? null
      : toBase({ minor: row.balanceMinor, currency: row.currency }, { baseCurrency, rates }),
    locked: row.transactionCount > 0,
  }));
  return { baseCurrency, views, missing };
}

/** `views` with the value of the holdings on each investment account (`portfolio.assetValuesIn`) as of `now`. */
async function withHoldingsIn(
  tx: Transaction,
  userId: string,
  views: readonly AccountBalanceView[],
  now: Date,
): Promise<AccountView[]> {
  if (!views.some((view) => view.type === 'investment')) {
    return views.map((view) => ({ ...view, holdingsValueBaseMinor: null }));
  }
  const byAccount = holdingsValueByAccount(await assetValuesIn(tx, userId, now));
  return views.map((view) => ({
    ...view,
    holdingsValueBaseMinor: view.type === 'investment' ? (byAccount.get(view.id) ?? 0n) : null,
  }));
}

async function viewIn(tx: Transaction, userId: string, id: string, now: Date): Promise<AccountView> {
  const [view] = (await viewsIn(tx, userId, eq(accounts.id, id))).views;
  if (view === undefined) throw new LedgerError('NOT_FOUND', 'No such account');
  return firstRow(await withHoldingsIn(tx, userId, [view], now), 'accounts');
}

interface LockedAccount {
  readonly id: string;
  readonly status: 'active' | 'archived';
  readonly sortOrder: number;
}

/** Every account of the user, locked (`FOR UPDATE`) so card rules and sort order hold under concurrency. */
function lockAllIn(tx: Transaction): Promise<LockedAccount[]> {
  return tx
    .select({ id: accounts.id, status: accounts.status, sortOrder: accounts.sortOrder })
    .from(accounts)
    .orderBy(asc(accounts.sortOrder), asc(accounts.createdAt), asc(accounts.id))
    .for('update');
}

function findLocked(rows: readonly LockedAccount[], id: string): LockedAccount {
  const row = rows.find((candidate) => candidate.id === id);
  if (row === undefined) throw new LedgerError('NOT_FOUND', 'No such account');
  return row;
}

async function checkParentIn(tx: Transaction, parentId: string | null | undefined, selfId?: string): Promise<void> {
  if (parentId == null) return;
  if (parentId === selfId) throw invalid('An account cannot be its own parent');
  const [parent] = await tx.select({ id: accounts.id }).from(accounts).where(eq(accounts.id, parentId));
  if (parent === undefined) throw new LedgerError('NOT_FOUND', 'No such parent account');
}

/** The month `offset` months after `month` (may be negative). */
function shiftMonth(month: YearMonth, offset: number): YearMonth {
  const index = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1 + offset;
  return `${String(Math.floor(index / 12)).padStart(4, '0')}-${String((index % 12) + 1).padStart(2, '0')}` as YearMonth;
}

export function createAccounts(db: Database, options: AccountsOptions = {}): AccountsRepository {
  const now = options.now ?? (() => new Date());

  return {
    list: (userId, { status = 'active' } = {}) =>
      withUser(db, userId, async (tx) => {
        const { baseCurrency, views, missing } = await viewsIn(tx, userId);
        const counted = views.filter((view) => view.status === 'active' && view.includeInAvailable);
        const listed = status === 'all' ? views : views.filter((view) => view.status === status);
        const availableMinor = availableBalance(
          counted.flatMap((view) =>
            view.balanceBaseMinor === null
              ? []
              : [{ includeInAvailable: true, balanceBaseMinor: view.balanceBaseMinor }],
          ),
        );
        const missingRates = [...new Set([...listed, ...counted].map((view) => view.currency))]
          .filter((currency) => missing.has(currency))
          .sort();
        return {
          baseCurrency,
          accounts: await withHoldingsIn(tx, userId, listed, now()),
          availableMinor,
          missingRates,
        };
      }),

    get: (userId, id) => withUser(db, userId, (tx) => viewIn(tx, userId, id, now())),

    create: (userId, input) =>
      withUser(db, userId, async (tx) => {
        const normalized = normalize(input) as AccountInput;
        const values = { ...normalized, catalogId: linkedCatalog(normalized) };
        checkCatalog(values);
        await checkParentIn(tx, values.parentAccountId);
        const rows = await lockAllIn(tx);
        const sortOrder = rows.reduce((max, row) => Math.max(max, row.sortOrder + 1), 0);
        // `userId` last: an input smuggled past the type system cannot retarget the row.
        const { id } = firstRow(
          await tx
            .insert(accounts)
            .values({ ...values, sortOrder, userId })
            .returning({ id: accounts.id }),
          'accounts',
        );
        await logActivity(tx, userId, 'account', [id], 'created');
        return viewIn(tx, userId, id, now());
      }),

    update: (userId, id, patch) =>
      withUser(db, userId, async (tx) => {
        const patched = normalize(patch);
        findLocked(await lockAllIn(tx), id);
        const before = await viewIn(tx, userId, id, now());
        const relinks =
          patched.providerName !== undefined || patched.type !== undefined || patched.catalogId !== undefined;
        const values = relinks ? { ...patched, catalogId: linkedCatalog({ ...before, ...patched }) } : patched;
        checkCatalog({ ...before, ...values });
        if (before.locked && LOCKED_KEYS.some((key) => values[key] !== undefined && values[key] !== before[key])) {
          throw new LedgerError('ACCOUNT_LOCKED');
        }
        await checkParentIn(tx, values.parentAccountId, id);
        const fields = Object.keys(values);
        if (fields.length > 0) await tx.update(accounts).set(values).where(eq(accounts.id, id));
        await logActivity(tx, userId, 'account', [id], 'updated', { fields });
        return viewIn(tx, userId, id, now());
      }),

    archive: (userId, id) =>
      withUser(db, userId, async (tx) => {
        const current = findLocked(await lockAllIn(tx), id);
        if (current.status === 'archived') return viewIn(tx, userId, id, now());
        await tx.update(accounts).set({ status: 'archived', archivedAt: now() }).where(eq(accounts.id, id));
        await logActivity(tx, userId, 'account', [id], 'archived');
        return viewIn(tx, userId, id, now());
      }),

    restore: (userId, id) =>
      withUser(db, userId, async (tx) => {
        const current = findLocked(await lockAllIn(tx), id);
        if (current.status === 'active') return viewIn(tx, userId, id, now());
        await tx.update(accounts).set({ status: 'active', archivedAt: null }).where(eq(accounts.id, id));
        await logActivity(tx, userId, 'account', [id], 'restored');
        return viewIn(tx, userId, id, now());
      }),

    deletePermanently: (userId, id) =>
      withUser(db, userId, async (tx) => {
        const current = findLocked(await lockAllIn(tx), id);
        if (current.status !== 'archived') throw new LedgerError('ACCOUNT_NOT_ARCHIVED');
        const linked = await tx
          .selectDistinct({ id: postings.transactionId })
          .from(postings)
          .where(eq(postings.accountId, id));
        const ids = linked.map((row) => row.id);
        const objectKeys: string[] = [];
        let deletedTransactions = 0;
        if (ids.length > 0) {
          const files = await tx
            .select({ objectKey: attachments.objectKey, thumbnailKey: attachments.thumbnailKey })
            .from(attachments)
            .where(inArray(attachments.transactionId, ids));
          for (const file of files) {
            objectKeys.push(file.objectKey);
            if (file.thumbnailKey !== null) objectKeys.push(file.thumbnailKey);
          }
          const deleted = await tx
            .delete(transactions)
            .where(inArray(transactions.id, ids))
            .returning({ id: transactions.id });
          deletedTransactions = deleted.length;
        }
        await tx.update(accounts).set({ parentAccountId: null }).where(eq(accounts.parentAccountId, id));
        await tx.update(goals).set({ accountId: null }).where(eq(goals.accountId, id));
        await tx.delete(accounts).where(eq(accounts.id, id));
        return { deletedTransactions, objectKeys: [...new Set(objectKeys)] };
      }),

    reorder: (userId, ids) =>
      withUser(db, userId, async (tx) => {
        const active = (await lockAllIn(tx)).filter((row) => row.status === 'active').map((row) => row.id);
        const unique = new Set(ids);
        if (unique.size !== ids.length || ids.length !== active.length || active.some((id) => !unique.has(id))) {
          throw new LedgerError('NOT_FOUND', 'The ids are not exactly the active accounts');
        }
        for (const [index, id] of ids.entries()) {
          await tx.update(accounts).set({ sortOrder: index }).where(eq(accounts.id, id));
        }
      }),

    reconcile: (userId, id, input) =>
      withUser(db, userId, async (tx) => {
        const account = await viewIn(tx, userId, id, now());
        if (account.status === 'archived') throw new LedgerError('ACCOUNT_ARCHIVED');
        const at = now();
        const differenceMinor = input.actualBalanceMinor - account.balanceMinor;
        let transactionId: string | null = null;
        let adjustmentId: string | null = null;
        if (differenceMinor !== 0n && input.mode === 'transaction') {
          const recorded = await recordTransactionIn(
            tx,
            userId,
            {
              type: differenceMinor < 0n ? 'expense' : 'income',
              clientId: input.clientId,
              occurredAt: input.occurredAt,
              accountId: id,
              amountMinor: differenceMinor < 0n ? -differenceMinor : differenceMinor,
              categoryId: input.categoryId,
              description: input.description ?? null,
            },
            null,
            at,
          );
          transactionId = recorded.id;
        } else if (differenceMinor !== 0n) {
          adjustmentId = firstRow(
            await tx
              .insert(balanceAdjustments)
              .values({
                userId,
                accountId: id,
                amountMinor: differenceMinor,
                actualBalanceMinor: input.actualBalanceMinor,
                createdAt: at,
              })
              .returning({ id: balanceAdjustments.id }),
            'balance_adjustments',
          ).id;
        }
        await tx.update(accounts).set({ lastReconciledAt: at }).where(eq(accounts.id, id));
        await logActivity(tx, userId, 'account', [id], 'reconciled', {
          mode: differenceMinor === 0n ? 'matched' : input.mode,
          ...(transactionId === null ? {} : { transactionId }),
        });
        return { differenceMinor, transactionId, adjustmentId };
      }),

    flows: (userId, id, { from, to }) =>
      withUser(db, userId, async (tx) => {
        const [account] = await tx.select({ id: accounts.id }).from(accounts).where(eq(accounts.id, id));
        if (account === undefined) throw new LedgerError('NOT_FOUND', 'No such account');
        const transfer = (sign: SQL) =>
          bigintSql(
            sql`coalesce(sum(abs(${postings.amountMinor})) filter (where ${IS_PRINCIPAL} and ${transactions.type} = 'transfer' and ${sign}), 0)`,
          );
        const [row] = await tx
          .select({
            inflowMinor: INFLOW,
            outflowMinor: OUTFLOW,
            transferInMinor: transfer(sql`${postings.amountMinor} > 0`),
            transferOutMinor: transfer(sql`${postings.amountMinor} < 0`),
          })
          .from(postings)
          .innerJoin(transactions, LIVE_POSTINGS)
          .where(and(eq(postings.accountId, id), sql`${transactions.localDate} between ${from} and ${to}`));
        return row as AccountFlows;
      }),

    series: (userId, id, { months, end }) =>
      withUser(db, userId, async (tx) => {
        if (!Number.isInteger(months) || months < 1 || months > MAX_SERIES_MONTHS) {
          throw new RangeError(`months must be an integer from 1 to ${MAX_SERIES_MONTHS}`);
        }
        const [account] = await tx
          .select({ openingBalanceMinor: accounts.openingBalanceMinor })
          .from(accounts)
          .where(eq(accounts.id, id));
        if (account === undefined) throw new LedgerError('NOT_FOUND', 'No such account');
        const monthOf = sql<YearMonth>`to_char(${transactions.localDate}, 'YYYY-MM')`;
        const buckets = await tx
          .select({
            month: monthOf,
            netMinor: bigintSql(sql`sum(${postings.amountMinor})`),
            inflowMinor: INFLOW,
            outflowMinor: OUTFLOW,
          })
          .from(postings)
          .innerJoin(transactions, LIVE_POSTINGS)
          .where(and(eq(postings.accountId, id), lte(transactions.localDate, end)))
          .groupBy(monthOf);
        const { timezone } = await userContextIn(tx, userId);
        const adjustments = (
          await tx
            .select({ amountMinor: balanceAdjustments.amountMinor, createdAt: balanceAdjustments.createdAt })
            .from(balanceAdjustments)
            .where(eq(balanceAdjustments.accountId, id))
        ).map((row) => ({ amountMinor: row.amountMinor, date: localDateOf(row.createdAt, timezone) }));

        const last = end.slice(0, 7) as YearMonth;
        return Array.from({ length: months }, (_, index) => {
          const month = shiftMonth(last, index - months + 1);
          const bucket = buckets.find((candidate) => candidate.month === month);
          const posted = buckets.reduce((sum, row) => (row.month <= month ? sum + row.netMinor : sum), 0n);
          const adjusted = adjustments.reduce(
            (sum, row) => (row.date.slice(0, 7) <= month && row.date <= end ? sum + row.amountMinor : sum),
            0n,
          );
          return {
            month,
            closingBalanceMinor: account.openingBalanceMinor + posted + adjusted,
            inflowMinor: bucket?.inflowMinor ?? 0n,
            outflowMinor: bucket?.outflowMinor ?? 0n,
          };
        });
      }),
  };
}
