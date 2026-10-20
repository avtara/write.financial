// SPDX-License-Identifier: AGPL-3.0-only
/**
 * In-app notifications (FR-S5): the notification panel and page (filters, unread counts, mark read) and the
 * "Pengingat berikutnya" empty state. Producers (the worker, and the app for its own events) insert through
 * {@link insertNotificationIn}, idempotent by `ref`. A notification is message keys plus JSON params (amounts as
 * `{ amountMinor: '186000', currency: 'IDR' }` strings, dates `YYYY-MM-DD`), rendered per locale and privacy mode by
 * the UI; its action only opens a page.
 */
import { addDays, type LocalDate } from '@wf/domain/period';
import { and, asc, desc, eq, gt, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import { firstRow, withUser, type Database, type Transaction } from './db.ts';
import { localDateOf, userContextIn } from './ledger-core.ts';
import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_TYPES,
  notifications,
  recurrences,
  scheduledOccurrences,
  subscriptions,
  type JsonObject,
} from './schema.ts';

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export interface NewNotification {
  readonly type: NotificationType;
  readonly category: NotificationCategory;
  /** Message keys in `@wf/i18n` (`notification_<type>_title|_body`). */
  readonly titleKey: string;
  readonly bodyKey: string;
  readonly params?: JsonObject;
  /** The page the notification opens (never an action that records anything). */
  readonly action?: { readonly href: string } | null;
  /** The producer's idempotency key, e.g. `rem.{occurrenceId}`. */
  readonly ref: string;
}

export interface NotificationView {
  readonly id: string;
  readonly type: NotificationType;
  readonly category: NotificationCategory;
  readonly titleKey: string;
  readonly bodyKey: string;
  readonly params: JsonObject;
  readonly action: { readonly href: string } | null;
  readonly ref: string;
  readonly readAt: Date | null;
  readonly createdAt: Date;
}

export interface NotificationRange {
  /** First day (user's time zone); default 29 days before `to`, so the default range is the last 30 days. */
  readonly from?: LocalDate;
  /** Last day (user's time zone); default today. */
  readonly to?: LocalDate;
}

export interface NotificationFilter extends NotificationRange {
  readonly filter?: 'all' | 'unread';
  readonly type?: NotificationType;
  readonly category?: NotificationCategory;
  /** Words matched (case-insensitive) against the param values, e.g. a subscription or account name. */
  readonly search?: string;
  /** Default 30, clamped to 1–100. */
  readonly limit?: number;
  /** `nextCursor` of the previous page. */
  readonly before?: string;
}

export interface NotificationCounts {
  readonly total: number;
  readonly unread: number;
  readonly unreadByCategory: Record<NotificationCategory, number>;
  readonly byType: Record<NotificationType, number>;
}

export interface NextReminder {
  readonly occurrenceId: string;
  readonly sourceType: 'recurrence' | 'subscription';
  readonly sourceId: string;
  /** Subscription name, or the recurrence's merchant or description. */
  readonly name: string;
  readonly dueDate: LocalDate;
  readonly remindAt: Date;
  readonly expectedMinor: bigint;
  readonly currency: string;
}

export interface NotificationsRepository {
  /** Newest first, `limit` per page; `nextCursor` is `null` on the last page. */
  list: (
    userId: string,
    filter?: NotificationFilter,
  ) => Promise<{ items: NotificationView[]; nextCursor: string | null }>;
  /** Counts in the range (default last 30 days); `unread` feeds the bell badge. */
  counts: (userId: string, range?: NotificationRange) => Promise<NotificationCounts>;
  /** Marks the given notifications, or all unread ones (of `category`), read; returns how many changed. */
  markRead: (
    userId: string,
    target: { readonly ids: readonly string[] } | { readonly all: true; readonly category?: NotificationCategory },
  ) => Promise<{ updated: number }>;
  /** The next reminder still to fire (empty state "Pengingat berikutnya"), or `null`. */
  nextReminder: (userId: string) => Promise<NextReminder | null>;
}

/** INSERT … ON CONFLICT (user_id, ref) DO NOTHING; returns the existing id when not created. Works as `wf_worker`. */
export async function insertNotificationIn(
  tx: Transaction,
  userId: string,
  input: NewNotification,
): Promise<{ id: string; created: boolean }> {
  const [row] = await tx
    .insert(notifications)
    .values({
      userId,
      type: input.type,
      category: input.category,
      titleKey: input.titleKey,
      bodyKey: input.bodyKey,
      params: input.params ?? {},
      action: input.action ?? null,
      ref: input.ref,
    })
    .onConflictDoNothing({ target: [notifications.userId, notifications.ref] })
    .returning({ id: notifications.id });
  if (row !== undefined) return { id: row.id, created: true };
  const existing = firstRow(
    await tx.select({ id: notifications.id }).from(notifications).where(eq(notifications.ref, input.ref)),
    'notifications',
  );
  return { id: existing.id, created: false };
}

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;
const RANGE_DAYS = 30;

/** `created_at` within `range`, as calendar days in the user's time zone. */
async function rangeIn(tx: Transaction, userId: string, now: Date, range: NotificationRange): Promise<SQL> {
  const { timezone } = await userContextIn(tx, userId);
  const to = range.to ?? localDateOf(now, timezone);
  const from = range.from ?? addDays(to, 1 - RANGE_DAYS);
  const day = sql`(${notifications.createdAt} at time zone ${timezone})::date`;
  return sql`${day} between ${from}::date and ${to}::date`;
}

export function createNotifications(
  db: Database,
  { now = () => new Date() }: { now?: () => Date } = {},
): NotificationsRepository {
  return {
    list: (userId, filter = {}) =>
      withUser(db, userId, async (tx) => {
        const limit = Math.min(Math.max(Math.trunc(filter.limit ?? DEFAULT_LIMIT), 1), MAX_LIMIT);
        const conditions = [await rangeIn(tx, userId, now(), filter)];
        if (filter.filter === 'unread') conditions.push(isNull(notifications.readAt));
        if (filter.type !== undefined) conditions.push(eq(notifications.type, filter.type));
        if (filter.category !== undefined) conditions.push(eq(notifications.category, filter.category));
        for (const word of (filter.search ?? '').trim().split(/\s+/).filter(Boolean)) {
          const pattern = `%${word.replace(/[\\%_]/g, '\\$&')}%`;
          conditions.push(
            sql`exists (select 1 from jsonb_each_text(${notifications.params}) as p where p.value ilike ${pattern})`,
          );
        }
        if (filter.before !== undefined) {
          conditions.push(
            sql`(${notifications.createdAt}, ${notifications.id}) < (select n.created_at, n.id from ${notifications} n where n.id = ${filter.before})`,
          );
        }
        const rows = await tx
          .select({
            id: notifications.id,
            type: notifications.type,
            category: notifications.category,
            titleKey: notifications.titleKey,
            bodyKey: notifications.bodyKey,
            params: notifications.params,
            action: notifications.action,
            ref: notifications.ref,
            readAt: notifications.readAt,
            createdAt: notifications.createdAt,
          })
          .from(notifications)
          .where(and(...conditions))
          .orderBy(desc(notifications.createdAt), desc(notifications.id))
          .limit(limit + 1);
        const items = rows
          .slice(0, limit)
          .map((row) => ({ ...row, action: row.action as { readonly href: string } | null }));
        // More rows than `limit` (≥ 1) means the page is full, so it has a last item.
        return { items, nextCursor: rows.length > limit ? (items.at(-1) as NotificationView).id : null };
      }),

    counts: (userId, range = {}) =>
      withUser(db, userId, async (tx) => {
        const rows = await tx
          .select({
            type: notifications.type,
            category: notifications.category,
            total: sql<number>`count(*)::int`,
            unread: sql<number>`(count(*) filter (where ${notifications.readAt} is null))::int`,
          })
          .from(notifications)
          .where(await rangeIn(tx, userId, now(), range))
          .groupBy(notifications.type, notifications.category);
        const unreadByCategory = Object.fromEntries(NOTIFICATION_CATEGORIES.map((key) => [key, 0])) as Record<
          NotificationCategory,
          number
        >;
        const byType = Object.fromEntries(NOTIFICATION_TYPES.map((key) => [key, 0])) as Record<
          NotificationType,
          number
        >;
        let total = 0;
        let unread = 0;
        for (const row of rows) {
          total += row.total;
          unread += row.unread;
          unreadByCategory[row.category] += row.unread;
          byType[row.type] += row.total;
        }
        return { total, unread, unreadByCategory, byType };
      }),

    markRead: (userId, target) =>
      withUser(db, userId, async (tx) => {
        if ('ids' in target && target.ids.length === 0) return { updated: 0 };
        const scope =
          'ids' in target
            ? inArray(notifications.id, [...target.ids])
            : target.category === undefined
              ? undefined
              : eq(notifications.category, target.category);
        const rows = await tx
          .update(notifications)
          .set({ readAt: now() })
          .where(and(isNull(notifications.readAt), scope))
          .returning({ id: notifications.id });
        return { updated: rows.length };
      }),

    nextReminder: (userId) =>
      withUser(db, userId, async (tx) => {
        const [row] = await tx
          .select({
            occurrenceId: scheduledOccurrences.id,
            sourceType: scheduledOccurrences.sourceType,
            sourceId: scheduledOccurrences.sourceId,
            name: sql<string>`coalesce(${subscriptions.name}, ${recurrences.template}->>'merchant', ${recurrences.template}->>'description', '')`,
            dueDate: scheduledOccurrences.dueDate,
            remindAt: scheduledOccurrences.remindAt,
            expectedMinor: scheduledOccurrences.expectedMinor,
            currency: scheduledOccurrences.currency,
          })
          .from(scheduledOccurrences)
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
          .where(
            and(
              inArray(scheduledOccurrences.sourceType, ['recurrence', 'subscription']),
              inArray(scheduledOccurrences.status, ['scheduled', 'due_review']),
              isNull(scheduledOccurrences.remindedAt),
              gt(scheduledOccurrences.remindAt, now()),
            ),
          )
          .orderBy(asc(scheduledOccurrences.remindAt), asc(scheduledOccurrences.id))
          .limit(1);
        return row === undefined
          ? null
          : { ...row, sourceType: row.sourceType as NextReminder['sourceType'], remindAt: row.remindAt as Date };
      }),
  };
}
