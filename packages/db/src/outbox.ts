// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Email outbox (plan §4.3 `notification_outbox`): the worker writes one row per notification and channel next to the
 * notification, and the `notify` job delivers it. Payloads hold what the email shows and nothing else; with privacy
 * mode on (`user_preferences.hide_balances`) they carry no amounts. Worker only (`wf_app` has no grant).
 */
import type { LocalDate } from '@wf/domain/period';
import type { Locale } from '@wf/i18n/locale';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { withUser, type Database, type Transaction } from './db.ts';
import { instanceSettings, notificationOutbox, userPreferences, users } from './schema.ts';

/** What an email shows; amounts as decimal strings of minor units (JSON has no bigint). */
export type OutboxPayload = {
  readonly kind: 'bill_reminder';
  /** Subscription or schedule name. */
  readonly name: string;
  readonly dueDate: LocalDate;
  /** `null` with privacy mode on. */
  readonly amount: { readonly amountMinor: string; readonly currency: string } | null;
  /** App path of the call to action, e.g. `/subscriptions`. */
  readonly path: string;
};

export interface OutboxMessage {
  /** `users.email`. */
  readonly to: string;
  readonly locale: Locale;
  /** Nickname, else name. */
  readonly recipientName: string;
  readonly instanceName: string;
  readonly payload: OutboxPayload;
  /** Set once delivered; a delivered row is never sent again. */
  readonly sentAt: Date | null;
}

export interface Outbox {
  /** The row with its recipient, or `null` when it is gone (purged with its notification, or another user's). */
  get: (userId: string, outboxId: string) => Promise<OutboxMessage | null>;
  /** Marks the row delivered at `now`; `false` when it was already. */
  markSent: (userId: string, outboxId: string, now: Date) => Promise<boolean>;
  /** Counts a failed attempt and keeps the error (truncated); after 5 the dispatch stops picking the row up. */
  markFailed: (userId: string, outboxId: string, error: string) => Promise<void>;
}

/** How a user wants to be notified outside the app. */
export interface DeliveryPreferences {
  /** Email unless `user_preferences.notif.email === false`. */
  readonly email: boolean;
  /** Privacy mode: emails carry no amounts. */
  readonly hideBalances: boolean;
}

export async function deliveryPreferencesIn(tx: Transaction, userId: string): Promise<DeliveryPreferences> {
  const [row] = await tx
    .select({ notif: userPreferences.notif, hideBalances: userPreferences.hideBalances })
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId));
  return { email: row?.notif['email'] !== false, hideBalances: row?.hideBalances ?? false };
}

/**
 * Queues the email of notification `notificationId` once (`UNIQUE (notification_id, channel)`), due at `sendAt` (the
 * job's clock, so the dispatch, which scans with the same clock, picks it up).
 */
export async function insertOutboxIn(
  tx: Transaction,
  userId: string,
  notificationId: string,
  payload: OutboxPayload,
  sendAt: Date,
): Promise<boolean> {
  const rows = await tx
    .insert(notificationOutbox)
    .values({ userId, notificationId, channel: 'email', payload, sendAt })
    .onConflictDoNothing({ target: [notificationOutbox.notificationId, notificationOutbox.channel] })
    .returning({ id: notificationOutbox.id });
  return rows.length > 0;
}

const MAX_ERROR_LENGTH = 500;

export function createOutbox(db: Database): Outbox {
  return {
    get: (userId, outboxId) =>
      withUser(db, userId, async (tx) => {
        const [row] = await tx
          .select({
            to: users.email,
            locale: users.locale,
            name: users.name,
            nickname: users.nickname,
            payload: notificationOutbox.payload,
            sentAt: notificationOutbox.sentAt,
          })
          .from(notificationOutbox)
          .innerJoin(users, eq(users.id, notificationOutbox.userId))
          .where(eq(notificationOutbox.id, outboxId));
        if (row === undefined) return null;
        const [instance] = await tx.select({ name: instanceSettings.instanceName }).from(instanceSettings);
        return {
          to: row.to,
          locale: row.locale,
          recipientName: row.nickname ?? row.name,
          instanceName: instance?.name ?? 'write.financial',
          payload: row.payload as OutboxPayload,
          sentAt: row.sentAt,
        };
      }),

    markSent: (userId, outboxId, now) =>
      withUser(db, userId, async (tx) => {
        const rows = await tx
          .update(notificationOutbox)
          .set({ sentAt: now })
          .where(and(eq(notificationOutbox.id, outboxId), isNull(notificationOutbox.sentAt)))
          .returning({ id: notificationOutbox.id });
        return rows.length > 0;
      }),

    markFailed: (userId, outboxId, error) =>
      withUser(db, userId, async (tx) => {
        await tx
          .update(notificationOutbox)
          .set({ attempts: sql`${notificationOutbox.attempts} + 1`, lastError: error.slice(0, MAX_ERROR_LENGTH) })
          .where(eq(notificationOutbox.id, outboxId));
      }),
  };
}
