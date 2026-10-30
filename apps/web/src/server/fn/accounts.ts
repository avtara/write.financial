// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Write and detail server functions of "Rekening & dompet" (FR-R1–R6). The user always comes from the session; the
 * ledger repositories enforce ownership (RLS) and the account rules (cards, default, FR-R3 lock).
 */
import { createServerFn } from '@tanstack/react-start';
import type { AccountFlows, AccountSeriesPoint, AccountView, ReconcileResult } from '@wf/db/accounts';
import type { CategoryView } from '@wf/db/categories';
import { localDateOf } from '@wf/db/ledger-core';
import { LedgerError } from '@wf/db/ledger-errors';
import type { TransactionRow } from '@wf/db/transaction-query';
import { ACCOUNT_TYPES } from '@wf/domain/ledger';
import { parseLocalDate, type LocalDate } from '@wf/domain/period';
import { ImageRejectedError, prepareImageUpload } from '@wf/integrations/image';
import * as z from 'zod';
import { isColor } from '../../lib/colors.ts';
import { attempt, requireSession, UploadRejectedError, type Result } from '../access.ts';
import type { RequestContext } from '../request-middleware.ts';
import { services, type Services } from '../runtime.ts';

const currency = z.string().regex(/^[A-Z]{3}$/);
const localDate = z
  .string()
  .refine((value) => {
    try {
      parseLocalDate(value);
      return true;
    } catch {
      return false;
    }
  })
  .transform((value) => value as LocalDate);
const day = z.int().min(1).max(31);
const nonNegative = z.bigint().nonnegative();

/** FR-R1/FR-R2 fields a form may set; `logoKey` only changes through {@link setAccountLogo}. */
const accountFields = z.object({
  type: z.enum(ACCOUNT_TYPES),
  providerName: z.string().trim().min(1).max(80),
  catalogId: z.string().trim().min(1).max(80).nullable().optional(),
  displayName: z.string().trim().min(1).max(40),
  currency,
  openingBalanceMinor: z.bigint(),
  openingDate: localDate,
  color: z.string().refine(isColor),
  last4: z
    .string()
    .regex(/^[0-9]{4}$/)
    .nullable()
    .optional(),
  phoneMasked: z.string().max(20).nullable().optional(),
  includeInAvailable: z.boolean().optional(),
  isDefaultQuickEntry: z.boolean().optional(),
  lowBalanceThresholdMinor: nonNegative.nullable().optional(),
  ccLimitMinor: nonNegative.nullable().optional(),
  ccStatementDay: day.nullable().optional(),
  ccDueDay: day.nullable().optional(),
});

export type AccountFields = z.input<typeof accountFields>;

/** Removes `undefined` members (the repositories take `exactOptionalPropertyTypes` inputs). */
function defined<T extends object>(value: T): { [K in keyof T]: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(value).filter(([, member]) => member !== undefined)) as {
    [K in keyof T]: Exclude<T[K], undefined>;
  };
}

/** Runs `action` for the session user (signed in, no further rule). */
function forUser<T>(
  context: Pick<RequestContext, 'session'>,
  action: (userId: string, services: Services, timezone: string) => Promise<T>,
): Promise<Result<T>> {
  return services().then((all) =>
    attempt(async () => {
      const { user } = await requireSession(context.session, {}, all.now());
      return action(user.id, all, user.timezone ?? 'Asia/Jakarta');
    }),
  );
}

/** FR-R1: a new account. */
export const createAccount = createServerFn({ method: 'POST' })
  .validator(accountFields)
  .handler(({ context, data }): Promise<Result<AccountView>> =>
    forUser(context, (userId, { accounts }) => accounts.create(userId, defined(data))),
  );

/** FR-R1–R3: changes some fields; currency and opening balance/date are refused once locked (`ACCOUNT_LOCKED`). */
export const updateAccount = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.uuid(), patch: accountFields.partial() }))
  .handler(({ context, data }): Promise<Result<AccountView>> =>
    forUser(context, (userId, { accounts }) => accounts.update(userId, data.id, defined(data.patch))),
  );

/**
 * FR-R5: archives an account; optionally moves its whole (positive) balance to another account of the same currency
 * first, and hands the Quick Add default to `newDefaultId`.
 */
export const archiveAccount = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      id: z.uuid(),
      newDefaultId: z.uuid().nullable().optional(),
      transfer: z.object({ toAccountId: z.uuid(), clientId: z.uuid() }).nullable().optional(),
    }),
  )
  .handler(({ context, data }): Promise<Result<AccountView>> =>
    forUser(context, async (userId, { accounts, transactions, now }) => {
      if (data.transfer != null) {
        const [from, to] = await Promise.all([
          accounts.get(userId, data.id),
          accounts.get(userId, data.transfer.toAccountId),
        ]);
        if (to.currency !== from.currency) throw new LedgerError('INVALID_ACCOUNT', 'Different currencies');
        if (from.balanceMinor > 0n) {
          await transactions.create(userId, {
            type: 'transfer',
            clientId: data.transfer.clientId,
            occurredAt: now(),
            fromAccountId: from.id,
            toAccountId: to.id,
            sentMinor: from.balanceMinor,
            receivedMinor: from.balanceMinor,
            source: 'manual',
          });
        }
      }
      return accounts.archive(userId, data.id, data.newDefaultId == null ? {} : { newDefaultId: data.newDefaultId });
    }),
  );

/** FR-R5: makes an archived account active again. */
export const restoreAccount = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.uuid() }))
  .handler(({ context, data }): Promise<Result<AccountView>> =>
    forUser(context, (userId, { accounts }) => accounts.restore(userId, data.id)),
  );

/**
 * FR-R5 "Hapus permanen": deletes an archived account with its transactions, then their attachment objects and the
 * account's logo. A storage failure is logged; the rows are already gone.
 */
export const deleteAccount = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.uuid() }))
  .handler(({ context, data }): Promise<Result<{ deletedTransactions: number }>> =>
    forUser(context, async (userId, { accounts, attachmentStore, logoStore, logger }) => {
      const { logoKey } = await accounts.get(userId, data.id);
      const { deletedTransactions, objectKeys } = await accounts.deletePermanently(userId, data.id);
      const removals = [
        ...objectKeys.map((key) => attachmentStore.delete(userId, key)),
        ...(logoKey === null ? [] : [logoStore.delete(userId, logoKey)]),
      ];
      for (const outcome of await Promise.allSettled(removals)) {
        if (outcome.status === 'rejected') logger.warn({ err: outcome.reason }, 'account object deletion failed');
      }
      return { deletedTransactions };
    }),
  );

/** FR-R6: the new order of every active account. */
export const reorderAccounts = createServerFn({ method: 'POST' })
  .validator(z.object({ ids: z.array(z.uuid()).max(500) }))
  .handler(({ context, data }): Promise<Result<null>> =>
    forUser(context, async (userId, { accounts }) => {
      await accounts.reorder(userId, data.ids);
      return null;
    }),
  );

const reconcileInput = z.discriminatedUnion('mode', [
  z.object({
    id: z.uuid(),
    mode: z.literal('transaction'),
    actualBalanceMinor: z.bigint(),
    categoryId: z.uuid().nullable(),
    clientId: z.uuid(),
    occurredAt: z.date(),
  }),
  z.object({ id: z.uuid(), mode: z.literal('correction'), actualBalanceMinor: z.bigint() }),
]);

/** FR-R4: records the difference to the actual balance as a transaction (a) or a correction (c). */
export const reconcileAccount = createServerFn({ method: 'POST' })
  .validator(reconcileInput)
  .handler(({ context, data }): Promise<Result<ReconcileResult>> =>
    forUser(context, (userId, { accounts }) => {
      const { id, ...input } = data;
      return accounts.reconcile(userId, id, input);
    }),
  );

/** FR-R4 bulk ("Sesuaikan beberapa rekening"): each difference becomes a categorized transaction at `occurredAt`. */
export const reconcileAccounts = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      occurredAt: z.date(),
      items: z
        .array(
          z.object({
            id: z.uuid(),
            actualBalanceMinor: z.bigint(),
            categoryId: z.uuid().nullable(),
            clientId: z.uuid(),
          }),
        )
        .min(1)
        .max(100),
    }),
  )
  .handler(({ context, data }): Promise<Result<ReconcileResult[]>> =>
    forUser(context, async (userId, { accounts }) => {
      const results: ReconcileResult[] = [];
      for (const { id, ...item } of data.items) {
        results.push(
          await accounts.reconcile(userId, id, { mode: 'transaction', occurredAt: data.occurredAt, ...item }),
        );
      }
      return results;
    }),
  );

/** Months in the detail panel's chart (FR-R6). */
const DETAIL_MONTHS = 6;
/** Rows in the detail panel's "Transaksi terakhir". */
const RECENT_LIMIT = 5;

export type DetailCategory = Pick<CategoryView, 'id' | 'name' | 'builtInKey' | 'icon' | 'color'>;

export interface AccountDetail {
  /** Today in the user's time zone. */
  readonly today: LocalDate;
  readonly series: AccountSeriesPoint[];
  /** Flows of the current calendar month up to today. */
  readonly flows: AccountFlows;
  readonly recent: TransactionRow[];
  /** The categories of {@link recent}. */
  readonly categories: DetailCategory[];
}

/** FR-R6 detail panel: 6-month balances, this month's flows, and the latest transactions. */
export const getAccountDetail = createServerFn({ method: 'GET' })
  .validator(z.object({ id: z.uuid() }))
  .handler(({ context, data }): Promise<Result<AccountDetail>> =>
    forUser(context, async (userId, { accounts, categories, transactionQuery, now }, timezone) => {
      const today = localDateOf(now(), timezone);
      const from = `${today.slice(0, 8)}01` as LocalDate;
      const [series, flows, recent] = await Promise.all([
        accounts.series(userId, data.id, { months: DETAIL_MONTHS, end: today }),
        accounts.flows(userId, data.id, { from, to: today }),
        transactionQuery.list(userId, { accountIds: [data.id] }, { sort: 'date_desc', limit: RECENT_LIMIT }),
      ]);
      const used = new Set(recent.rows.map((row) => row.categoryId));
      const all = used.size === 0 ? [] : await categories.list(userId, { includeArchived: true });
      return {
        today,
        series,
        flows,
        recent: recent.rows,
        categories: all
          .filter((category) => used.has(category.id))
          .map(({ id, name, builtInKey, icon, color }) => ({ id, name, builtInKey, icon, color })),
      };
    }),
  );

/**
 * FR-R1 "Unggah PNG": replaces the account's logo with the uploaded image (`file` in the form data, re-encoded and
 * stripped by the image pipeline, at most 320 px) stored encrypted in the avatars bucket.
 */
export const setAccountLogo = createServerFn({ method: 'POST' })
  .validator(z.instanceof(FormData))
  .handler(({ context, data }): Promise<Result<AccountView>> =>
    forUser(context, async (userId, { accounts, logoStore }) => {
      const id = z.uuid().parse(data.get('id'));
      const file = z.instanceof(File).parse(data.get('file'));
      const before = await accounts.get(userId, id);
      let thumbnail;
      try {
        ({ thumbnail } = await prepareImageUpload(new Uint8Array(await file.arrayBuffer())));
      } catch (error) {
        if (error instanceof ImageRejectedError) throw new UploadRejectedError(error.reason);
        throw error;
      }
      const { key } = await logoStore.put(userId, thumbnail.bytes, thumbnail.mime);
      const after = await accounts.update(userId, id, { logoKey: key });
      if (before.logoKey !== null) await logoStore.delete(userId, before.logoKey);
      return after;
    }),
  );

/** FR-R1 "Pakai ikon": drops the uploaded logo. */
export const removeAccountLogo = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.uuid() }))
  .handler(({ context, data }): Promise<Result<AccountView>> =>
    forUser(context, async (userId, { accounts, logoStore }) => {
      const { logoKey } = await accounts.get(userId, data.id);
      const after = await accounts.update(userId, data.id, { logoKey: null });
      if (logoKey !== null) await logoStore.delete(userId, logoKey);
      return after;
    }),
  );
