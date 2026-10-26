// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Review queue items (FR-L7), shared by the app and the worker (D14: the worker only proposes, the user confirms).
 * Every proposal is stored encrypted with the user's DEK (`review_items.payload_enc`) because it carries amounts,
 * names, and accounts; the plain columns hold only what ordering, grouping, and badges need. Producers are idempotent
 * through `dedupe_key`: `occ.{occurrenceId}`, `catdel.{categoryId}.{transactionId}`,
 * `close.{periodId}.rollover.{categoryId}`, `close.{periodId}.leftover`.
 */
import { decryptText, encrypt } from '@wf/crypto/cipher';
import type { Dek } from '@wf/crypto/envelope';
import type { LocalDate } from '@wf/domain/period';
import { zonedInstant } from '@wf/domain/recurrence';
import { eq } from 'drizzle-orm';
import { firstRow, type Transaction } from './db.ts';
import { installmentExpenseIn } from './debts.ts';
import { userContextIn, type TransactionDraft } from './ledger-core.ts';
import { LedgerError } from './ledger-errors.ts';
import { decodeTemplate } from './occurrences.ts';
import {
  recurrences,
  reviewItems,
  scheduledOccurrences,
  subscriptions,
  type REVIEW_REASONS,
  type REVIEW_SOURCES,
  type REVIEW_STATUSES,
} from './schema.ts';

/** Wall-clock time of a proposed occurrence transaction on its due date (user's time zone). */
export const OCCURRENCE_TIME = '12:00';

/** AAD purpose of `review_items.payload_enc`. */
export const REVIEW_PAYLOAD_PURPOSE = 'review_items.payload';

export type ReviewReason = (typeof REVIEW_REASONS)[number];
export type ReviewSource = (typeof REVIEW_SOURCES)[number];
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** A proposed transaction; confirming records it with the review item id as `clientId`. */
export type ReviewDraft = DistributiveOmit<TransactionDraft, 'clientId'>;

export type ReviewPayload =
  /** `due_occurrence` (later also `ai_suggestion`, `import_row`): record this transaction. */
  | { readonly kind: 'transaction'; readonly draft: ReviewDraft; readonly receiptId?: string }
  /** `category_deleted`: the transaction lost its category and needs a new one ("Perlu kategori"). */
  | {
      readonly kind: 'category';
      readonly transactionId: string;
      readonly previousCategoryId: string;
      readonly previousCategoryName: string;
    }
  /** `period_close_proposal`: carry a budget line's remainder (or overspend) into the next period. */
  | {
      readonly kind: 'rollover';
      readonly periodId: string;
      readonly nextPeriodId: string;
      readonly categoryId: string;
      readonly deltaMinor: bigint;
    }
  /** `period_close_proposal`: move the period's leftover to a goal ("pindah sisa … ke Dana Darurat"). */
  | {
      readonly kind: 'leftover';
      readonly periodId: string;
      readonly amountMinor: bigint;
      readonly goalId: string | null;
      readonly fromAccountId: string | null;
      readonly toAccountId: string | null;
    };

export interface NewReviewItem {
  readonly reason: ReviewReason;
  readonly source: ReviewSource;
  readonly dedupeKey: string;
  readonly occurrenceId?: string;
  readonly subjectTransactionId?: string;
  readonly periodId?: string;
  readonly dueDate?: LocalDate;
  /** Percent, 0–100. */
  readonly aiConfidence?: number;
  readonly payload: ReviewPayload;
}

/** The payload as stored: JSON with bigints as decimal strings and dates as ISO strings (`Date#toJSON`). */
type Encoded<T> = T extends bigint
  ? string
  : T extends Date
    ? string
    : T extends object
      ? { [K in keyof T]: Encoded<T[K]> }
      : T;

function decodeDraft(draft: Encoded<ReviewDraft>): ReviewDraft {
  const occurredAt = new Date(draft.occurredAt);
  if (draft.type === 'transfer') {
    return {
      ...draft,
      occurredAt,
      sentMinor: BigInt(draft.sentMinor),
      receivedMinor: BigInt(draft.receivedMinor),
      fee: draft.fee ? { minor: BigInt(draft.fee.minor), categoryId: draft.fee.categoryId } : null,
    };
  }
  return { ...draft, occurredAt, amountMinor: BigInt(draft.amountMinor) };
}

/** Decrypts `review_items.payload_enc` (bigints and dates restored). */
export function readReviewPayload(dek: Dek, userId: string, payloadEnc: Uint8Array): ReviewPayload {
  const json = decryptText(dek, payloadEnc, { userId, purpose: REVIEW_PAYLOAD_PURPOSE });
  const payload = JSON.parse(json) as Encoded<ReviewPayload>;
  switch (payload.kind) {
    case 'transaction':
      return { ...payload, draft: decodeDraft(payload.draft) };
    case 'rollover':
      return { ...payload, deltaMinor: BigInt(payload.deltaMinor) };
    case 'leftover':
      return { ...payload, amountMinor: BigInt(payload.amountMinor) };
    case 'category':
      return payload;
  }
}

/**
 * Inserts a pending review item unless the user already has one with `dedupeKey` (in any status); then the existing
 * id is returned with `created: false`. Works as `wf_worker` (INSERT and SELECT only).
 */
export async function insertReviewItemIn(
  tx: Transaction,
  userId: string,
  dek: Dek,
  item: NewReviewItem,
): Promise<{ id: string; created: boolean }> {
  const [row] = await tx
    .insert(reviewItems)
    .values({
      userId,
      reason: item.reason,
      source: item.source,
      dedupeKey: item.dedupeKey,
      occurrenceId: item.occurrenceId ?? null,
      subjectTransactionId: item.subjectTransactionId ?? null,
      periodId: item.periodId ?? null,
      dueDate: item.dueDate ?? null,
      aiConfidence: item.aiConfidence ?? null,
      payloadEnc: encrypt(
        dek,
        JSON.stringify(item.payload, (_key, value: unknown) => (typeof value === 'bigint' ? value.toString() : value)),
        { userId, purpose: REVIEW_PAYLOAD_PURPOSE },
      ),
    })
    .onConflictDoNothing({ target: [reviewItems.userId, reviewItems.dedupeKey] })
    .returning({ id: reviewItems.id });
  if (row !== undefined) return { id: row.id, created: true };
  const existing = firstRow(
    await tx.select({ id: reviewItems.id }).from(reviewItems).where(eq(reviewItems.dedupeKey, item.dedupeKey)),
    'review_items',
  );
  return { id: existing.id, created: false };
}

/**
 * The `due_occurrence` item for an occurrence (dedupe `occ.{occurrenceId}`): the transaction its recurrence,
 * subscription, or non-card installment (FR-U6: the expense `Cicilan {name} ({seq}/{tenor})` from "Bayar dari")
 * proposes, for the expected amount, on the due date at {@link OCCURRENCE_TIME} local, `source = recurring`. Used by
 * the worker's daily job and by "Tandai dibayar" before the due date. Read-only (works as `wf_worker`).
 * @throws {LedgerError} `NOT_FOUND` when the occurrence, its source, or a supported source type is missing.
 */
export async function occurrenceReviewItemIn(
  tx: Transaction,
  userId: string,
  occurrenceId: string,
): Promise<NewReviewItem> {
  const [occurrence] = await tx
    .select({
      sourceType: scheduledOccurrences.sourceType,
      sourceId: scheduledOccurrences.sourceId,
      dueDate: scheduledOccurrences.dueDate,
      expectedMinor: scheduledOccurrences.expectedMinor,
    })
    .from(scheduledOccurrences)
    .where(eq(scheduledOccurrences.id, occurrenceId));
  if (occurrence === undefined) throw new LedgerError('NOT_FOUND', 'No such occurrence');
  const { timezone } = await userContextIn(tx, userId);
  const common = {
    occurredAt: zonedInstant(occurrence.dueDate, OCCURRENCE_TIME, timezone),
    source: 'recurring' as const,
  };
  let draft: ReviewDraft;
  if (occurrence.sourceType === 'subscription') {
    const [subscription] = await tx
      .select({
        name: subscriptions.name,
        plan: subscriptions.plan,
        accountId: subscriptions.payFromAccountId,
        categoryId: subscriptions.categoryId,
      })
      .from(subscriptions)
      .where(eq(subscriptions.id, occurrence.sourceId));
    if (subscription === undefined) throw new LedgerError('NOT_FOUND', 'No such subscription');
    draft = {
      ...common,
      type: 'expense',
      accountId: subscription.accountId,
      amountMinor: occurrence.expectedMinor,
      categoryId: subscription.categoryId,
      merchant: subscription.name,
      description: subscription.plan,
    };
  } else if (occurrence.sourceType === 'recurrence') {
    const [recurrence] = await tx
      .select({ template: recurrences.template })
      .from(recurrences)
      .where(eq(recurrences.id, occurrence.sourceId));
    if (recurrence === undefined) throw new LedgerError('NOT_FOUND', 'No such recurrence');
    const template = decodeTemplate(recurrence.template);
    if (template.type === 'transfer') {
      draft = {
        ...template,
        ...common,
        sentMinor: occurrence.expectedMinor,
        // Within one currency the received amount follows the expected one; across currencies it stays as planned.
        receivedMinor:
          template.sentMinor === template.receivedMinor ? occurrence.expectedMinor : template.receivedMinor,
      };
    } else {
      draft = { ...template, ...common, amountMinor: occurrence.expectedMinor };
    }
  } else if (occurrence.sourceType === 'installment') {
    const expense = await installmentExpenseIn(tx, occurrence.sourceId, occurrence.dueDate);
    draft = { ...expense, ...common, type: 'expense', amountMinor: occurrence.expectedMinor };
  } else {
    throw new LedgerError('NOT_FOUND', `Occurrences of ${occurrence.sourceType} have no proposal yet`);
  }
  return {
    reason: 'due_occurrence',
    source: 'schedule',
    dedupeKey: `occ.${occurrenceId}`,
    occurrenceId,
    dueDate: occurrence.dueDate,
    payload: { kind: 'transaction', draft },
  };
}
