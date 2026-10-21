// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The Review queue ("Perlu ditinjau", FR-L7) as the user works it (wf_app): list with decrypted proposals, the sidebar
 * badge, and the only place a proposal is applied (PRD §1 "nothing changes without confirmation", D14). Confirming
 * records the proposed transaction with the review item id as `client_id` (a replay returns the same transaction),
 * assigns a category, applies a rollover override, or moves the period leftover; ignoring skips the occurrence.
 * Every state change runs in one `withUser` transaction with the item locked (`FOR UPDATE`).
 */
import type { Dek } from '@wf/crypto/envelope';
import { addDays, type LocalDate, type YearMonth } from '@wf/domain/period';
import type { TransactionType } from '@wf/domain/transactions';
import { and, asc, count, eq, gt, inArray, isNull, ne, sql, type SQL } from 'drizzle-orm';
import { firstRow, withUser, type Database, type Transaction } from './db.ts';
import { logActivity } from './activity.ts';
import { assertOpenTransactionsIn, checkCategoryIn, recordTransactionIn } from './ledger-core.ts';
import { LedgerError } from './ledger-errors.ts';
import { decodeTemplate, subscriptionDueDates } from './occurrences.ts';
import {
  insertReviewItemIn,
  occurrenceReviewItemIn,
  readReviewPayload,
  type ReviewDraft,
  type ReviewPayload,
  type ReviewReason,
  type ReviewSource,
  type ReviewStatus,
} from './review-items.ts';
import {
  budgetPeriodOverrides,
  goals,
  periods,
  postings,
  recurrences,
  REVIEW_REASONS,
  reviewItems,
  scheduledOccurrences,
  subscriptions,
  tags,
  transactions,
} from './schema.ts';

/** Changes the user made in the review card before confirming; omitted fields keep the proposal. */
export interface ReviewEdits {
  /** Entry amount, transfer sent amount (received follows within one currency), or the leftover to move. */
  readonly amountMinor?: bigint;
  /** Transfer received amount (across currencies). */
  readonly receivedMinor?: bigint;
  readonly accountId?: string;
  readonly fromAccountId?: string;
  readonly toAccountId?: string;
  /** Entry category; required to resolve a `category` item. */
  readonly categoryId?: string | null;
  readonly occurredAt?: Date;
  readonly description?: string | null;
  readonly merchant?: string | null;
  readonly note?: string | null;
  readonly tags?: readonly string[];
  /** Leftover target goal (its tag is put on the transfer); `null` = no goal. */
  readonly goalId?: string | null;
}

export interface ReviewOccurrenceView {
  readonly id: string;
  readonly sourceType: (typeof scheduledOccurrences.$inferSelect)['sourceType'];
  readonly sourceId: string;
  readonly status: (typeof scheduledOccurrences.$inferSelect)['status'];
  readonly dueDate: LocalDate;
}

/** The recorded transaction a `category` item is about, as its card shows it. */
export interface ReviewSubject {
  readonly type: TransactionType;
  readonly occurredAt: Date;
  readonly merchant: string | null;
  readonly description: string | null;
  readonly accountId: string;
  /** Signed principal on `accountId`, in `currency`. */
  readonly amountMinor: bigint;
  readonly currency: string;
}

/** The part of a recurring transfer planned for a goal ("DIBAGI KE"). */
export interface ReviewAllocation {
  readonly goalId: string;
  readonly goalName: string;
  readonly amountMinor: bigint;
}

export interface ReviewItemView {
  readonly id: string;
  readonly reason: ReviewReason;
  readonly source: ReviewSource;
  readonly status: ReviewStatus;
  readonly payload: ReviewPayload;
  readonly occurrence: ReviewOccurrenceView | null;
  /**
   * What the card is about: the subscription or recurrence name, the transaction's merchant or description, or the
   * leftover's goal name; `null` when there is none (e.g. a rollover: show its category).
   */
  readonly label: string | null;
  /** Label (`YYYY-MM`) of the period of a period-close proposal. */
  readonly periodLabel: YearMonth | null;
  readonly subjectTransactionId: string | null;
  /** `category` items: the transaction itself; `null` otherwise (or once it is gone). */
  readonly subject: ReviewSubject | null;
  /** Occurrences of a recurring transfer: the goal allocations of its template (empty otherwise). */
  readonly allocations: readonly ReviewAllocation[];
  readonly periodId: string | null;
  readonly dueDate: LocalDate | null;
  readonly aiConfidence: number | null;
  readonly resultingTransactionId: string | null;
  readonly resolvedAt: Date | null;
  readonly createdAt: Date;
}

export interface ReviewListOptions {
  /** Default `pending`; `resolved` = confirmed or ignored. */
  readonly status?: 'pending' | 'resolved';
  readonly reason?: ReviewReason;
  readonly source?: ReviewSource;
  /** Default 50, clamped to 1–200. */
  readonly limit?: number;
  readonly offset?: number;
}

export interface ReviewCounts {
  /** Pending items: the sidebar badge. */
  readonly total: number;
  readonly byReason: Record<ReviewReason, number>;
}

export interface ConfirmResult {
  /** The recorded transaction (transaction and leftover items), or the re-categorized one (category items). */
  readonly transactionId: string | null;
  /** `budget_period_overrides` rows created (rollover items). */
  readonly overrideIds: string[];
}

export interface ReviewRepository {
  /** Ordered: AI suggestions by confidence, then due items by due date, then oldest first. */
  list: (userId: string, options?: ReviewListOptions) => Promise<{ items: ReviewItemView[]; total: number }>;
  counts: (userId: string) => Promise<ReviewCounts>;
  /**
   * Applies the item's proposal (with `edits`) and resolves it.
   * @throws {LedgerError} `NOT_FOUND`, `REVIEW_RESOLVED`, `PERIOD_CLOSED`, `INVALID_CATEGORY`, `INVALID_TRANSACTION`,
   * and every code of recording a transaction.
   */
  confirm: (userId: string, itemId: string, edits?: ReviewEdits) => Promise<ConfirmResult>;
  /**
   * Confirms each item in its own transaction ("Tandai semua dibayar", bulk category); expected refusals are
   * reported per item, the rest are confirmed.
   */
  confirmBulk: (
    userId: string,
    itemIds: readonly string[],
    edits?: Pick<ReviewEdits, 'categoryId'>,
  ) => Promise<{ confirmed: string[]; failed: { id: string; code: LedgerError['code'] }[] }>;
  /** Resolves pending items without applying them; their occurrences are skipped. Returns how many changed. */
  ignore: (userId: string, itemIds: readonly string[]) => Promise<{ ignored: number }>;
  /**
   * "Belum dibayar / Belum ditagih": the item stays pending and its occurrence becomes `unconfirmed`.
   * @throws {LedgerError} `NOT_FOUND` (also for items without an occurrence), `REVIEW_RESOLVED`
   */
  markUnpaid: (userId: string, itemId: string) => Promise<void>;
  /**
   * "Tandai dibayar" before the due date: creates the occurrence's review item (`occ.{id}`) if needed and confirms it.
   * @throws {LedgerError} as {@link ReviewRepository.confirm}
   */
  confirmOccurrence: (userId: string, occurrenceId: string, edits?: ReviewEdits) => Promise<ConfirmResult>;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
/** Far enough ahead to find a subscription's next bill after skipped or early-confirmed ones (yearly cycles). */
const ADVANCE_HORIZON_DAYS = 800;

/** `value` without its `undefined` properties (an omitted edit keeps the proposal). */
function definedOnly<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined)) as Partial<T>;
}

function applyEdits(draft: ReviewDraft, edits: ReviewEdits): ReviewDraft {
  const common = definedOnly({
    occurredAt: edits.occurredAt,
    description: edits.description,
    merchant: edits.merchant,
    note: edits.note,
    tags: edits.tags,
  });
  if (draft.type === 'transfer') {
    const sentMinor = edits.amountMinor ?? draft.sentMinor;
    return {
      ...draft,
      ...common,
      ...definedOnly({ fromAccountId: edits.fromAccountId, toAccountId: edits.toAccountId }),
      sentMinor,
      receivedMinor: edits.receivedMinor ?? (draft.sentMinor === draft.receivedMinor ? sentMinor : draft.receivedMinor),
    };
  }
  return {
    ...draft,
    ...common,
    ...definedOnly({ accountId: edits.accountId, amountMinor: edits.amountMinor, categoryId: edits.categoryId }),
  };
}

/**
 * After the bill due on `dueDate` was confirmed or skipped: when it was the subscription's next bill, moves
 * `next_billing_date` to the following bill that is neither confirmed nor skipped (kept when there is none).
 */
async function advanceSubscriptionIn(
  tx: Transaction,
  occurrence: Pick<ReviewOccurrenceView, 'sourceType' | 'sourceId' | 'dueDate'>,
  now: Date,
): Promise<void> {
  if (occurrence.sourceType !== 'subscription') return;
  const [subscription] = await tx
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.id, occurrence.sourceId))
    .for('update');
  if (subscription?.nextBillingDate !== occurrence.dueDate) return;
  const done = await tx
    .select({ dueDate: scheduledOccurrences.dueDate })
    .from(scheduledOccurrences)
    .where(
      and(
        eq(scheduledOccurrences.sourceType, 'subscription'),
        eq(scheduledOccurrences.sourceId, subscription.id),
        gt(scheduledOccurrences.dueDate, occurrence.dueDate),
        inArray(scheduledOccurrences.status, ['confirmed', 'skipped']),
      ),
    );
  const resolved = new Set<string>(done.map((row) => row.dueDate));
  const from = addDays(occurrence.dueDate, 1);
  const next = subscriptionDueDates(subscription, from, addDays(from, ADVANCE_HORIZON_DAYS)).find(
    (due) => !resolved.has(due),
  );
  if (next === undefined) return;
  await tx
    .update(subscriptions)
    .set({ nextBillingDate: next, updatedAt: now })
    .where(eq(subscriptions.id, subscription.id));
}

async function lockedItemIn(tx: Transaction, itemId: string) {
  const [item] = await tx.select().from(reviewItems).where(eq(reviewItems.id, itemId)).for('update');
  if (item === undefined) throw new LedgerError('NOT_FOUND', 'No such review item');
  if (item.status !== 'pending') throw new LedgerError('REVIEW_RESOLVED', 'The review item is already resolved');
  return item;
}

async function occurrenceIn(tx: Transaction, occurrenceId: string): Promise<ReviewOccurrenceView> {
  const [occurrence] = await tx
    .select({
      id: scheduledOccurrences.id,
      sourceType: scheduledOccurrences.sourceType,
      sourceId: scheduledOccurrences.sourceId,
      status: scheduledOccurrences.status,
      dueDate: scheduledOccurrences.dueDate,
    })
    .from(scheduledOccurrences)
    .where(eq(scheduledOccurrences.id, occurrenceId))
    .for('update');
  // The foreign key keeps an item's occurrence; a missing one can only be a wrong id.
  if (occurrence === undefined) throw new LedgerError('NOT_FOUND', 'No such occurrence');
  return occurrence;
}

/** The leftover move: a transfer tagged with the goal's tag, `source = period_close`. */
async function leftoverIn(
  tx: Transaction,
  userId: string,
  dek: Dek,
  itemId: string,
  payload: Extract<ReviewPayload, { kind: 'leftover' }>,
  edits: ReviewEdits,
  now: Date,
): Promise<string> {
  const goalId = edits.goalId === undefined ? payload.goalId : edits.goalId;
  const fromAccountId = edits.fromAccountId ?? payload.fromAccountId;
  const toAccountId = edits.toAccountId ?? payload.toAccountId;
  if (fromAccountId === null || toAccountId === null) {
    throw new LedgerError('INVALID_TRANSACTION', 'The leftover move needs both accounts');
  }
  let tag: string | null = null;
  if (goalId !== null) {
    const [goal] = await tx
      .select({ slug: tags.slug })
      .from(goals)
      .leftJoin(tags, eq(tags.id, goals.tagId))
      .where(eq(goals.id, goalId));
    if (goal === undefined) throw new LedgerError('INVALID_GOAL', 'No such goal');
    tag = goal.slug;
  }
  const amountMinor = edits.amountMinor ?? payload.amountMinor;
  const result = await recordTransactionIn(
    tx,
    userId,
    {
      type: 'transfer',
      clientId: itemId,
      occurredAt: edits.occurredAt ?? now,
      fromAccountId,
      toAccountId,
      sentMinor: amountMinor,
      receivedMinor: edits.receivedMinor ?? amountMinor,
      description: edits.description ?? null,
      note: edits.note ?? null,
      tags: tag === null ? [] : [tag],
      source: 'period_close',
    },
    dek,
    now,
  );
  return result.id;
}

/** Applies and resolves one pending item inside the caller's transaction. */
async function confirmIn(
  tx: Transaction,
  userId: string,
  dek: Dek,
  itemId: string,
  edits: ReviewEdits,
  now: Date,
): Promise<ConfirmResult> {
  const item = await lockedItemIn(tx, itemId);
  const payload = readReviewPayload(dek, userId, item.payloadEnc);
  let transactionId: string | null = null;
  const overrideIds: string[] = [];
  switch (payload.kind) {
    case 'transaction': {
      const draft = applyEdits(payload.draft, edits);
      transactionId = (await recordTransactionIn(tx, userId, { ...draft, clientId: item.id }, dek, now)).id;
      if (item.occurrenceId !== null) {
        const occurrence = await occurrenceIn(tx, item.occurrenceId);
        await tx
          .update(scheduledOccurrences)
          .set({ status: 'confirmed', transactionId, updatedAt: now })
          .where(eq(scheduledOccurrences.id, occurrence.id));
        await advanceSubscriptionIn(tx, occurrence, now);
      }
      break;
    }
    case 'category': {
      const categoryId = edits.categoryId ?? null;
      if (categoryId === null) throw new LedgerError('INVALID_CATEGORY', 'Choose a category');
      const [subject] = await tx
        .select({ type: transactions.type })
        .from(transactions)
        .where(and(eq(transactions.id, payload.transactionId), isNull(transactions.deletedAt)));
      if (subject === undefined) throw new LedgerError('NOT_FOUND', 'No such transaction');
      if (subject.type !== 'expense' && subject.type !== 'income') {
        throw new LedgerError('INVALID_TRANSACTION', 'Only expenses and incomes have a category');
      }
      await assertOpenTransactionsIn(tx, [payload.transactionId]);
      await checkCategoryIn(tx, categoryId, subject.type);
      await tx
        .update(transactions)
        .set({ categoryId, updatedAt: now })
        .where(eq(transactions.id, payload.transactionId));
      await logActivity(tx, userId, 'transaction', [payload.transactionId], 'updated', {
        fields: ['categoryId'],
        source: 'review',
      });
      transactionId = payload.transactionId;
      break;
    }
    case 'rollover': {
      const [next] = await tx
        .select({ status: periods.status })
        .from(periods)
        .where(eq(periods.id, payload.nextPeriodId));
      if (next === undefined) throw new LedgerError('NOT_FOUND', 'No such period');
      if (next.status === 'closed') throw new LedgerError('PERIOD_CLOSED', 'The next period is closed');
      const override = firstRow(
        await tx
          .insert(budgetPeriodOverrides)
          .values({
            userId,
            periodId: payload.nextPeriodId,
            categoryId: payload.categoryId,
            deltaMinor: payload.deltaMinor,
            reason: 'rollover',
            reviewItemId: item.id,
          })
          .returning({ id: budgetPeriodOverrides.id }),
        'budget_period_overrides',
      );
      overrideIds.push(override.id);
      break;
    }
    case 'leftover':
      transactionId = await leftoverIn(tx, userId, dek, item.id, payload, edits, now);
      break;
  }
  await tx
    .update(reviewItems)
    .set({ status: 'confirmed', resolvedAt: now, resultingTransactionId: transactionId, updatedAt: now })
    .where(eq(reviewItems.id, item.id));
  return { transactionId, overrideIds };
}

export function createReview(
  db: Database,
  { getDek, now = () => new Date() }: { getDek: (userId: string) => Promise<Dek>; now?: () => Date },
): ReviewRepository {
  return {
    list: async (userId, { status = 'pending', reason, source, limit = DEFAULT_LIMIT, offset = 0 } = {}) => {
      // Fetched first: getDek opens its own transaction.
      const dek = await getDek(userId);
      return withUser(db, userId, async (tx) => {
        const conditions: SQL[] = [
          status === 'pending' ? eq(reviewItems.status, 'pending') : ne(reviewItems.status, 'pending'),
        ];
        if (reason !== undefined) conditions.push(eq(reviewItems.reason, reason));
        if (source !== undefined) conditions.push(eq(reviewItems.source, source));
        const where = and(...conditions);
        const rows = await tx
          .select({
            item: reviewItems,
            occurrence: {
              id: scheduledOccurrences.id,
              sourceType: scheduledOccurrences.sourceType,
              sourceId: scheduledOccurrences.sourceId,
              status: scheduledOccurrences.status,
              dueDate: scheduledOccurrences.dueDate,
            },
            label: sql<
              string | null
            >`coalesce(${subscriptions.name}, ${recurrences.template}->>'merchant', ${recurrences.template}->>'description', ${transactions.merchant}, ${transactions.description})`,
            periodLabel: periods.label,
            template: recurrences.template,
            subject: {
              type: transactions.type,
              occurredAt: transactions.occurredAt,
              merchant: transactions.merchant,
              description: transactions.description,
              deletedAt: transactions.deletedAt,
            },
          })
          .from(reviewItems)
          .leftJoin(scheduledOccurrences, eq(scheduledOccurrences.id, reviewItems.occurrenceId))
          .leftJoin(
            subscriptions,
            and(
              eq(scheduledOccurrences.sourceType, 'subscription'),
              eq(subscriptions.id, scheduledOccurrences.sourceId),
            ),
          )
          .leftJoin(
            recurrences,
            and(eq(scheduledOccurrences.sourceType, 'recurrence'), eq(recurrences.id, scheduledOccurrences.sourceId)),
          )
          .leftJoin(transactions, eq(transactions.id, reviewItems.subjectTransactionId))
          .leftJoin(periods, eq(periods.id, reviewItems.periodId))
          .where(where)
          .orderBy(
            sql`${reviewItems.aiConfidence} desc nulls last`,
            sql`${reviewItems.dueDate} asc nulls last`,
            asc(reviewItems.createdAt),
            asc(reviewItems.id),
          )
          .limit(Math.min(Math.max(Math.trunc(limit), 1), MAX_LIMIT))
          .offset(Math.max(Math.trunc(offset), 0));
        const { total } = firstRow(await tx.select({ total: count() }).from(reviewItems).where(where), 'review_items');
        const goalNames = new Map(
          (await tx.select({ id: goals.id, name: goals.name }).from(goals)).map((goal) => [goal.id, goal.name]),
        );
        const subjectIds = rows.flatMap((row) =>
          row.subject === null || row.subject.deletedAt !== null ? [] : [row.item.subjectTransactionId as string],
        );
        // The principal on the paying account (a transfer's outgoing leg sorts first).
        const principals = new Map<string, { accountId: string; amountMinor: bigint; currency: string }>();
        if (subjectIds.length > 0) {
          const legs = await tx
            .select({
              transactionId: postings.transactionId,
              accountId: postings.accountId,
              amountMinor: postings.amountMinor,
              currency: postings.currency,
            })
            .from(postings)
            .where(and(inArray(postings.transactionId, subjectIds), eq(postings.role, 'principal')))
            .orderBy(asc(postings.amountMinor));
          for (const { transactionId, ...leg } of legs) {
            if (!principals.has(transactionId)) principals.set(transactionId, leg);
          }
        }
        const items = rows.map(({ item, occurrence, label, periodLabel, template, subject }): ReviewItemView => {
          const payload = readReviewPayload(dek, userId, item.payloadEnc);
          const proposed =
            payload.kind === 'transaction'
              ? (payload.draft.merchant ?? payload.draft.description ?? null)
              : payload.kind === 'leftover' && payload.goalId !== null
                ? (goalNames.get(payload.goalId) ?? null)
                : null;
          const principal = principals.get(item.subjectTransactionId ?? '');
          const decoded = template === null ? null : decodeTemplate(template);
          return {
            id: item.id,
            reason: item.reason,
            source: item.source,
            status: item.status,
            payload,
            occurrence,
            label: label ?? proposed,
            periodLabel,
            subjectTransactionId: item.subjectTransactionId,
            subject:
              subject === null || principal === undefined
                ? null
                : {
                    type: subject.type,
                    occurredAt: subject.occurredAt,
                    merchant: subject.merchant,
                    description: subject.description,
                    ...principal,
                  },
            allocations:
              decoded?.type === 'transfer'
                ? // `decodeTemplate` always lists them (maybe none).
                  (decoded.allocations as NonNullable<typeof decoded.allocations>).map((part) => ({
                    goalId: part.goalId,
                    goalName: goalNames.get(part.goalId) ?? '',
                    amountMinor: part.amountMinor,
                  }))
                : [],
            periodId: item.periodId,
            dueDate: item.dueDate,
            aiConfidence: item.aiConfidence,
            resultingTransactionId: item.resultingTransactionId,
            resolvedAt: item.resolvedAt,
            createdAt: item.createdAt,
          };
        });
        return { items, total };
      });
    },

    counts: (userId) =>
      withUser(db, userId, async (tx) => {
        const rows = await tx
          .select({ reason: reviewItems.reason, count: count() })
          .from(reviewItems)
          .where(eq(reviewItems.status, 'pending'))
          .groupBy(reviewItems.reason);
        const byReason = Object.fromEntries(REVIEW_REASONS.map((reason) => [reason, 0])) as Record<
          ReviewReason,
          number
        >;
        let total = 0;
        for (const row of rows) {
          byReason[row.reason] = row.count;
          total += row.count;
        }
        return { total, byReason };
      }),

    confirm: async (userId, itemId, edits = {}) => {
      const dek = await getDek(userId);
      return withUser(db, userId, (tx) => confirmIn(tx, userId, dek, itemId, edits, now()));
    },

    confirmBulk: async (userId, itemIds, edits = {}) => {
      const dek = await getDek(userId);
      const confirmed: string[] = [];
      const failed: { id: string; code: LedgerError['code'] }[] = [];
      for (const id of itemIds) {
        try {
          await withUser(db, userId, (tx) => confirmIn(tx, userId, dek, id, edits, now()));
          confirmed.push(id);
        } catch (error) {
          if (!(error instanceof LedgerError)) throw error;
          failed.push({ id, code: error.code });
        }
      }
      return { confirmed, failed };
    },

    ignore: (userId, itemIds) =>
      withUser(db, userId, async (tx) => {
        if (itemIds.length === 0) return { ignored: 0 };
        const at = now();
        const items = await tx
          .update(reviewItems)
          .set({ status: 'ignored', resolvedAt: at, updatedAt: at })
          .where(and(inArray(reviewItems.id, [...itemIds]), eq(reviewItems.status, 'pending')))
          .returning({ occurrenceId: reviewItems.occurrenceId });
        const occurrenceIds = items.flatMap((item) => (item.occurrenceId === null ? [] : [item.occurrenceId]));
        if (occurrenceIds.length > 0) {
          const skipped = await tx
            .update(scheduledOccurrences)
            .set({ status: 'skipped', updatedAt: at })
            .where(inArray(scheduledOccurrences.id, occurrenceIds))
            .returning({
              sourceType: scheduledOccurrences.sourceType,
              sourceId: scheduledOccurrences.sourceId,
              dueDate: scheduledOccurrences.dueDate,
            });
          // Oldest first, so each skip moves the next bill one step.
          skipped.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
          for (const occurrence of skipped) await advanceSubscriptionIn(tx, occurrence, at);
        }
        return { ignored: items.length };
      }),

    markUnpaid: (userId, itemId) =>
      withUser(db, userId, async (tx) => {
        const item = await lockedItemIn(tx, itemId);
        if (item.occurrenceId === null) throw new LedgerError('NOT_FOUND', 'The review item has no occurrence');
        const at = now();
        await tx
          .update(scheduledOccurrences)
          .set({ status: 'unconfirmed', updatedAt: at })
          .where(eq(scheduledOccurrences.id, item.occurrenceId));
        await tx.update(reviewItems).set({ updatedAt: at }).where(eq(reviewItems.id, item.id));
      }),

    confirmOccurrence: async (userId, occurrenceId, edits = {}) => {
      const dek = await getDek(userId);
      return withUser(db, userId, async (tx) => {
        const occurrence = await occurrenceIn(tx, occurrenceId);
        if (occurrence.status === 'confirmed' || occurrence.status === 'skipped') {
          throw new LedgerError('REVIEW_RESOLVED', 'The occurrence is already resolved');
        }
        const item = await occurrenceReviewItemIn(tx, userId, occurrenceId);
        const { id } = await insertReviewItemIn(tx, userId, dek, item);
        return confirmIn(tx, userId, dek, id, edits, now());
      });
    },
  };
}
