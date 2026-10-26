// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Write server functions of "Catat transaksi" (M1, FR-T1–T4, T8, T9): recording an expense, income, or transfer,
 * deleting and restoring (Undo) transactions, the form's drafts, and the days with transactions for the date
 * picker. The user always comes from the session.
 */
import { createServerFn } from '@tanstack/react-start';
import type { DraftView } from '@wf/db/drafts';
import type { RecordResult } from '@wf/db/ledger-core';
import { countDays, type LocalDate } from '@wf/domain/period';
import * as z from 'zod';
import { attempt, requireSession, type Result } from '../access.ts';
import { services } from '../runtime.ts';

/** Longest date range {@link listTransactionDays} answers, in days (inclusive). */
const MAX_DAY_SPAN = 100;
/** Largest draft payload, as JSON characters. */
const MAX_DRAFT_PAYLOAD = 16_384;

const currency = z.string().regex(/^[A-Z]{3}$/);
const positiveMinor = z.bigint().positive();
const localDate = z.iso.date().transform((value) => value as LocalDate);

const common = {
  /** Idempotency key of the submission: a retry returns the first result. */
  clientId: z.uuid(),
  occurredAt: z.date(),
  description: z.string().max(200).nullable().optional(),
  merchant: z.string().max(200).nullable().optional(),
  note: z.string().max(2000).nullable().optional(),
  tags: z.array(z.string().min(1).max(64)).max(5).optional(),
  source: z.enum(['manual', 'quick', 'assistant']).optional(),
};

/** FR-T1/T2/T4: an expense or income on one account, or a transfer between two own accounts. */
export const RECORD_TRANSACTION_INPUT = z.discriminatedUnion('type', [
  z.object({
    type: z.enum(['expense', 'income']),
    ...common,
    accountId: z.uuid(),
    amountMinor: positiveMinor,
    categoryId: z.uuid().nullable(),
  }),
  z.object({
    type: z.literal('transfer'),
    ...common,
    fromAccountId: z.uuid(),
    toAccountId: z.uuid(),
    sentMinor: positiveMinor,
    receivedMinor: positiveMinor,
    manualRate: z
      .object({ base: currency, quote: currency, rate: z.string().regex(/^\d{1,12}(\.\d{1,8})?$/) })
      .nullable()
      .optional(),
    fee: z.object({ minor: positiveMinor, categoryId: z.uuid() }).nullable().optional(),
  }),
]);
export type RecordTransactionInput = z.infer<typeof RECORD_TRANSACTION_INPUT>;

const TRANSACTION_IDS = z.object({ ids: z.array(z.uuid()).min(1).max(200) });
const DRAFT_KIND = z.enum(['transaction']);

/** `value` without its `undefined` properties, as the repositories' exact optional properties require. */
export function defined<T extends object>(value: T): { [K in keyof T]: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(value).filter(([, child]) => child !== undefined)) as {
    [K in keyof T]: Exclude<T[K], undefined>;
  };
}

/** FR-T1–T4: records a confirmed transaction; idempotent per `clientId`. */
export const recordTransaction = createServerFn({ method: 'POST' })
  .validator(RECORD_TRANSACTION_INPUT)
  .handler(async ({ context, data }): Promise<Result<RecordResult>> => {
    const { transactions, now } = await services();
    return attempt(async () => {
      const { user } = await requireSession(context.session, {}, now());
      return transactions.create(user.id, defined(data));
    });
  });

/** Soft-deletes the user's live transactions among `ids`; returns the ids deleted. */
export const removeTransactions = createServerFn({ method: 'POST' })
  .validator(TRANSACTION_IDS)
  .handler(async ({ context, data }): Promise<Result<{ deleted: string[] }>> => {
    const { transactions, now } = await services();
    return attempt(async () => {
      const { user } = await requireSession(context.session, {}, now());
      return transactions.remove(user.id, data.ids);
    });
  });

/** Undo of {@link removeTransactions}: brings the user's deleted transactions among `ids` back. */
export const restoreTransactions = createServerFn({ method: 'POST' })
  .validator(TRANSACTION_IDS)
  .handler(async ({ context, data }): Promise<Result<{ restored: string[] }>> => {
    const { transactions, now } = await services();
    return attempt(async () => {
      const { user } = await requireSession(context.session, {}, now());
      return transactions.restore(user.id, data.ids);
    });
  });

/** FR-T9: the user's saved drafts of a form, newest first. */
export const listDrafts = createServerFn({ method: 'GET' })
  .validator(z.object({ kind: DRAFT_KIND }))
  .handler(async ({ context, data }): Promise<Result<DraftView[]>> => {
    const { drafts, now } = await services();
    return attempt(async () => {
      const { user } = await requireSession(context.session, {}, now());
      return drafts.list(user.id, data.kind);
    });
  });

/** FR-T9 "Simpan draf": creates a draft, or replaces the user's draft `id` (`NOT_FOUND` otherwise). */
export const saveDraft = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      id: z.uuid().optional(),
      kind: DRAFT_KIND,
      payload: z
        .record(z.string(), z.json())
        .refine((payload) => JSON.stringify(payload).length <= MAX_DRAFT_PAYLOAD, 'draft too large'),
    }),
  )
  .handler(async ({ context, data }): Promise<Result<{ id: string }>> => {
    const { drafts, now } = await services();
    return attempt(async () => {
      const { user } = await requireSession(context.session, {}, now());
      return drafts.save(user.id, defined(data));
    });
  });

/** Deletes the user's draft `id` (`NOT_FOUND` otherwise). */
export const removeDraft = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.uuid() }))
  .handler(async ({ context, data }): Promise<Result<null>> => {
    const { drafts, now } = await services();
    return attempt(async () => {
      const { user } = await requireSession(context.session, {}, now());
      await drafts.remove(user.id, data.id);
      return null;
    });
  });

/** FR-T8: the days in `from`–`to` (at most 100) with at least one transaction, ascending ("ada transaksi"). */
export const listTransactionDays = createServerFn({ method: 'GET' })
  .validator(
    z
      .object({ from: localDate, to: localDate })
      .refine(({ from, to }) => from <= to, 'from after to')
      .refine(({ from, to }) => countDays(from, to) <= MAX_DAY_SPAN, 'range too long'),
  )
  .handler(async ({ context, data }): Promise<Result<LocalDate[]>> => {
    const { transactionQuery, now } = await services();
    return attempt(async () => {
      const { user } = await requireSession(context.session, {}, now());
      const days = await transactionQuery.groupByDay(user.id, { from: data.from, to: data.to });
      return days
        .filter((day) => day.count > 0)
        .map((day) => day.date)
        .sort();
    });
  });
