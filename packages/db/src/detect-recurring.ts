// SPDX-License-Identifier: AGPL-3.0-only
/**
 * FR-SUB4 subscription detection (`detect-recurring` job, daily from 03.00 in the user's time zone): runs
 * `detectSubscriptions` over the last {@link DETECTION_WINDOW_DAYS} days of expenses with a merchant, skipping
 * merchants that already are subscriptions or whose candidate was added or dismissed. New merchants become
 * `detected_recurring` rows (status `new`) with one `subscriptions_detected` notification each (ref
 * `det.{merchantKey}`); candidates still `new` are refreshed with the latest charge. Suggestions only: "Tambahkan"
 * in the app creates the subscription.
 */
import { addDays } from '@wf/domain/period';
import { detectSubscriptions, merchantKey, type DetectionTransaction } from '@wf/domain/subscriptions';
import { and, eq, gte, isNotNull, isNull, sql } from 'drizzle-orm';
import { withUser, type Database } from './db.ts';
import { insertNotificationIn } from './notifications.ts';
import { userClockIn } from './occurrences.ts';
import { detectedRecurring, postings, subscriptions, transactions } from './schema.ts';

/** About six months of history. */
export const DETECTION_WINDOW_DAYS = 186;

export interface DetectResult {
  /** New candidates (each notified once). */
  readonly created: number;
  /** Candidates still `new` refreshed with the latest charge. */
  readonly updated: number;
}

export interface DetectRecurring {
  detect: (userId: string, now: Date) => Promise<DetectResult>;
}

export function createDetectRecurring(db: Database): DetectRecurring {
  return {
    detect: (userId, now) =>
      withUser(db, userId, async (tx) => {
        const { today } = await userClockIn(tx, userId, now);
        const charges: DetectionTransaction[] = (
          await tx
            .select({
              merchant: transactions.merchant,
              localDate: transactions.localDate,
              amountMinor: sql<bigint>`(-${postings.amountMinor})::bigint`.mapWith(BigInt),
              currency: postings.currency,
              accountId: postings.accountId,
              categoryId: transactions.categoryId,
            })
            .from(transactions)
            .innerJoin(postings, and(eq(postings.transactionId, transactions.id), eq(postings.role, 'principal')))
            .where(
              and(
                eq(transactions.type, 'expense'),
                isNull(transactions.deletedAt),
                isNotNull(transactions.merchant),
                gte(transactions.localDate, addDays(today, -DETECTION_WINDOW_DAYS)),
              ),
            )
        ).map((row) => ({ ...row, merchant: row.merchant as string }));

        const subscribed = await tx.select({ name: subscriptions.name }).from(subscriptions);
        const candidates = await tx
          .select({ merchantKey: detectedRecurring.merchantKey, status: detectedRecurring.status })
          .from(detectedRecurring);
        const known = new Set([
          ...subscribed.map((row) => merchantKey(row.name)),
          ...candidates.filter((row) => row.status !== 'new').map((row) => row.merchantKey),
        ]);
        const pending = new Set(candidates.filter((row) => row.status === 'new').map((row) => row.merchantKey));

        let created = 0;
        let updated = 0;
        for (const found of detectSubscriptions(charges, { today, known })) {
          const values = {
            merchant: found.merchant,
            dayOfMonth: found.dayOfMonth,
            amountMinor: found.amountMinor,
            currency: found.currency,
            occurrences: found.occurrences,
            lastSeenOn: found.lastSeenOn,
            accountId: found.accountId,
            categoryId: found.categoryId,
          };
          if (pending.has(found.merchantKey)) {
            await tx
              .update(detectedRecurring)
              .set({ ...values, updatedAt: now })
              .where(and(eq(detectedRecurring.merchantKey, found.merchantKey), eq(detectedRecurring.status, 'new')));
            updated += 1;
            continue;
          }
          // A concurrent run may have inserted it meanwhile; the notification ref keeps that to one notification.
          await tx
            .insert(detectedRecurring)
            .values({ userId, merchantKey: found.merchantKey, ...values })
            .onConflictDoNothing({ target: [detectedRecurring.userId, detectedRecurring.merchantKey] });
          created += 1;
          await insertNotificationIn(tx, userId, {
            type: 'subscriptions_detected',
            category: 'budget_bills',
            titleKey: 'notification_subscriptions_detected_title',
            bodyKey: 'notification_subscriptions_detected_body',
            params: {
              merchant: found.merchant,
              amount: { amountMinor: found.amountMinor.toString(), currency: found.currency },
              day: found.dayOfMonth,
              count: found.occurrences,
            },
            action: { href: '/subscriptions' },
            ref: `det.${found.merchantKey}`,
          });
        }
        return { created, updated };
      }),
  };
}
