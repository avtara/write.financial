// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The worker side of scheduled occurrences (plan §6 `occurrences` and `reminders`, FR-L7, FR-T6, FR-SUB2/SUB6). D14:
 * nothing here records a transaction; a due occurrence becomes a pending review item that only the user confirms.
 *
 * Lifecycle: `scheduled` → (the daily `occurrences` job on/after 00.05 of the due date) `due_review` with one review
 * item (`occ.{occurrenceId}`) and a `review_due` notification → (from the day after the due date) `unconfirmed` with
 * one `bill_overdue` notification. Reminders fire at `remind_at` (09.00 local, H-N) exactly once: the notification
 * (`rem.{occurrenceId}`), its email (unless `notif.email === false`; no amount with privacy mode on), and
 * `reminded_at` are written in one transaction under a row lock. A receivable's due date (FR-U7) only reminds, in the
 * app, never by email. Every write is keyed (review `dedupe_key`, notification `ref`, outbox `(notification_id,
 * channel)`), so a retry or restart creates no duplicates.
 */
import type { Dek } from '@wf/crypto/envelope';
import { addDays, countDays, type LocalDate } from '@wf/domain/period';
import { and, asc, eq, gte, inArray, isNotNull, lt, lte } from 'drizzle-orm';
import { withUser, type Database, type Transaction } from './db.ts';
import { insertNotificationIn } from './notifications.ts';
import { decodeTemplate, materializeIn, templateAmount, userClockIn, type ScheduleSource } from './occurrences.ts';
import { emailsType } from './notification-settings.ts';
import { deliveryPreferencesIn, insertOutboxIn } from './outbox.ts';
import { insertReviewItemIn, occurrenceReviewItemIn } from './review-items.ts';
import {
  accounts,
  categories,
  debts,
  receivables,
  recurrences,
  scheduledOccurrences,
  subscriptions,
} from './schema.ts';

/** The Receivables tab of the Debts page. */
const RECEIVABLES_HREF = '/debts?tab=receivables';

/** What a notification about an occurrence names. */
export interface OccurrenceSubject {
  /** Subscription name; for a recurrence its description, merchant, or category (built-in key as stored). */
  readonly name: string;
  /** The account it is paid from (or into, for income). */
  readonly accountId: string;
  readonly accountName: string;
  /** `false` for income: nothing leaves the account. */
  readonly outflow: boolean;
  /** The page a notification about it opens. */
  readonly href: string;
}

export interface OccurrenceSourceRef {
  readonly sourceType: string;
  readonly sourceId: string;
}

const subjectKey = (row: OccurrenceSourceRef) => `${row.sourceType}.${row.sourceId}`;

/** Subjects of the recurrence and subscription occurrences in `rows`, by `{sourceType}.{sourceId}`. */
export async function occurrenceSubjectsIn(
  tx: Transaction,
  rows: readonly OccurrenceSourceRef[],
): Promise<Map<string, OccurrenceSubject>> {
  const ids = (type: ScheduleSource['type']) => [
    ...new Set(rows.filter((row) => row.sourceType === type).map((row) => row.sourceId)),
  ];
  const subjects = new Map<string, Omit<OccurrenceSubject, 'accountName'>>();
  const subscriptionIds = ids('subscription');
  if (subscriptionIds.length > 0) {
    const subs = await tx
      .select({ id: subscriptions.id, name: subscriptions.name, accountId: subscriptions.payFromAccountId })
      .from(subscriptions)
      .where(inArray(subscriptions.id, subscriptionIds));
    for (const sub of subs) {
      subjects.set(`subscription.${sub.id}`, {
        name: sub.name,
        accountId: sub.accountId,
        outflow: true,
        href: '/subscriptions',
      });
    }
  }
  const recurrenceIds = ids('recurrence');
  if (recurrenceIds.length > 0) {
    const schedules = await tx
      .select({ id: recurrences.id, template: recurrences.template })
      .from(recurrences)
      .where(inArray(recurrences.id, recurrenceIds));
    const templates = schedules.map((row) => ({ id: row.id, template: decodeTemplate(row.template) }));
    const categoryIds = templates.flatMap(({ template }) =>
      template.type !== 'transfer' && template.categoryId !== null ? [template.categoryId] : [],
    );
    const categoryNames = new Map(
      categoryIds.length === 0
        ? []
        : (
            await tx
              .select({ id: categories.id, name: categories.name })
              .from(categories)
              .where(inArray(categories.id, categoryIds))
          ).map((row) => [row.id, row.name]),
    );
    for (const { id, template } of templates) {
      const category =
        template.type === 'transfer' || template.categoryId === null ? null : categoryNames.get(template.categoryId);
      const named = template.description ?? (template.type === 'transfer' ? null : template.merchant) ?? category;
      subjects.set(`recurrence.${id}`, {
        name: named ?? '',
        accountId: templateAmount(template).accountId,
        outflow: template.type !== 'income',
        href: '/calendar',
      });
    }
  }
  const debtIds = ids('installment');
  if (debtIds.length > 0) {
    const rowsOfDebts = await tx
      .select({ id: debts.id, name: debts.name, accountId: debts.payFromAccountId })
      .from(debts)
      .where(inArray(debts.id, debtIds));
    for (const debt of rowsOfDebts) {
      // Only non-card debts (with "Bayar dari") have installment occurrences.
      subjects.set(`installment.${debt.id}`, {
        name: debt.name,
        accountId: debt.accountId as string,
        outflow: true,
        href: '/debts',
      });
    }
  }
  // A card payment due date names the card itself (its name is filled in from the account below).
  for (const cardId of ids('cc_statement')) {
    subjects.set(`cc_statement.${cardId}`, { name: '', accountId: cardId, outflow: true, href: '/debts' });
  }
  const accountIds = [...new Set([...subjects.values()].map((subject) => subject.accountId))];
  const accountNames = new Map(
    accountIds.length === 0
      ? []
      : (
          await tx
            .select({ id: accounts.id, name: accounts.displayName })
            .from(accounts)
            .where(inArray(accounts.id, accountIds))
        ).map((row) => [row.id, row.name]),
  );
  return new Map(
    [...subjects].map(([key, subject]) => [
      key,
      // A subject without a name falls back to its account ("BCA Tahapan").
      {
        ...subject,
        accountName: accountNames.get(subject.accountId) as string,
        name: subject.name === '' ? (accountNames.get(subject.accountId) as string) : subject.name,
      },
    ]),
  );
}

export interface AdvanceResult {
  /** New occurrences materialized (90 days ahead). */
  readonly materialized: number;
  /** Occurrences moved to the Review queue. */
  readonly due: number;
  /** Occurrences that became overdue (`unconfirmed`). */
  readonly overdue: number;
  /** Notifications created (review due, overdue, trial ending, pause ending). */
  readonly notifications: number;
}

export interface RemindResult {
  /** `false` when there was nothing to do (already reminded, not yet time, resolved, or gone). */
  readonly reminded: boolean;
  /** Whether an email was queued. */
  readonly emailed: boolean;
}

export interface OccurrenceJobs {
  /**
   * The daily `occurrences` job: materializes, moves due occurrences to review (with their review items), marks the
   * ones past their due date `unconfirmed`, and notifies trials and pauses ending within their reminder days.
   * Idempotent.
   */
  advance: (userId: string, now: Date) => Promise<AdvanceResult>;
  /** The `reminders` job: the bill reminder of one occurrence, exactly once. */
  remind: (userId: string, occurrenceId: string, now: Date) => Promise<RemindResult>;
}

/** Sources whose due occurrences go to the Review queue; a `cc_statement` occurrence only reminds. */
const SCHEDULE_SOURCES: ScheduleSource['type'][] = ['recurrence', 'subscription', 'installment'];

const OCCURRENCE = {
  id: scheduledOccurrences.id,
  sourceType: scheduledOccurrences.sourceType,
  sourceId: scheduledOccurrences.sourceId,
  dueDate: scheduledOccurrences.dueDate,
  expectedMinor: scheduledOccurrences.expectedMinor,
  currency: scheduledOccurrences.currency,
  status: scheduledOccurrences.status,
  remindAt: scheduledOccurrences.remindAt,
  remindedAt: scheduledOccurrences.remindedAt,
};

const amountOf = (row: { readonly expectedMinor: bigint; readonly currency: string }) => ({
  amountMinor: row.expectedMinor.toString(),
  currency: row.currency,
});

/** Days from `today` to `date` (0 on the day itself). */
const daysUntil = (today: LocalDate, date: LocalDate) => countDays(today, date) - 1;

export function createOccurrenceJobs(
  db: Database,
  options: { readonly getDek: (userId: string) => Promise<Dek> },
): OccurrenceJobs {
  return {
    advance: async (userId, now) => {
      // Never inside the transaction below: getDek opens its own.
      const dek = await options.getDek(userId);
      return withUser(db, userId, async (tx) => {
        const { today } = await userClockIn(tx, userId, now);
        const { created: materialized } = await materializeIn(tx, userId, { now });
        let notifications = 0;
        const notified = (result: { created: boolean }) => {
          if (result.created) notifications += 1;
        };

        const due = await tx
          .select(OCCURRENCE)
          .from(scheduledOccurrences)
          .where(
            and(
              eq(scheduledOccurrences.status, 'scheduled'),
              lte(scheduledOccurrences.dueDate, today),
              inArray(scheduledOccurrences.sourceType, SCHEDULE_SOURCES),
            ),
          )
          .orderBy(asc(scheduledOccurrences.dueDate), asc(scheduledOccurrences.id));
        const dueSubjects = await occurrenceSubjectsIn(tx, due);
        for (const occurrence of due) {
          await insertReviewItemIn(tx, userId, dek, await occurrenceReviewItemIn(tx, userId, occurrence.id));
          await tx
            .update(scheduledOccurrences)
            .set({ status: 'due_review', updatedAt: now })
            .where(eq(scheduledOccurrences.id, occurrence.id));
          // One already past its due date is announced as overdue below instead.
          if (occurrence.dueDate < today) continue;
          const subject = dueSubjects.get(subjectKey(occurrence)) as OccurrenceSubject;
          notified(
            await insertNotificationIn(tx, userId, {
              type: 'review_due',
              category: 'budget_bills',
              titleKey: 'notification_review_due_title',
              bodyKey: 'notification_review_due_body',
              params: {
                name: subject.name,
                dueDate: occurrence.dueDate,
                amount: amountOf(occurrence),
                account: subject.accountName,
              },
              action: { href: '/review' },
              ref: `due.${occurrence.id}`,
            }),
          );
        }

        const overdue = await tx
          .select(OCCURRENCE)
          .from(scheduledOccurrences)
          .where(and(eq(scheduledOccurrences.status, 'due_review'), lt(scheduledOccurrences.dueDate, today)))
          .orderBy(asc(scheduledOccurrences.dueDate), asc(scheduledOccurrences.id));
        const overdueSubjects = await occurrenceSubjectsIn(tx, overdue);
        for (const occurrence of overdue) {
          await tx
            .update(scheduledOccurrences)
            .set({ status: 'unconfirmed', updatedAt: now })
            .where(eq(scheduledOccurrences.id, occurrence.id));
          const subject = overdueSubjects.get(subjectKey(occurrence)) as OccurrenceSubject;
          notified(
            await insertNotificationIn(tx, userId, {
              type: 'bill_overdue',
              category: 'budget_bills',
              titleKey: 'notification_bill_overdue_title',
              bodyKey: 'notification_bill_overdue_body',
              params: {
                name: subject.name,
                dueDate: occurrence.dueDate,
                amount: amountOf(occurrence),
                account: subject.accountName,
              },
              action: { href: '/review' },
              ref: `overdue.${occurrence.id}`,
            }),
          );
        }

        // D-N reminders of subscriptions: the free trial's last day and the day billing resumes after a pause.
        const SUBSCRIPTION = {
          id: subscriptions.id,
          name: subscriptions.name,
          priceMinor: subscriptions.priceMinor,
          currency: subscriptions.currency,
          remindDaysBefore: subscriptions.remindDaysBefore,
          trialEndsOn: subscriptions.trialEndsOn,
          pausedUntil: subscriptions.pausedUntil,
          pauseRemindDays: subscriptions.pauseRemindDays,
        };
        const trials = await tx
          .select(SUBSCRIPTION)
          .from(subscriptions)
          .where(
            and(
              eq(subscriptions.status, 'active'),
              isNotNull(subscriptions.remindDaysBefore),
              gte(subscriptions.trialEndsOn, today),
            ),
          );
        for (const sub of trials) {
          const trialEndsOn = sub.trialEndsOn as LocalDate;
          if (daysUntil(today, trialEndsOn) > (sub.remindDaysBefore as number)) continue;
          notified(
            await insertNotificationIn(tx, userId, {
              type: 'trial_ending',
              category: 'budget_bills',
              titleKey: 'notification_trial_ending_title',
              bodyKey: 'notification_trial_ending_body',
              params: {
                name: sub.name,
                trialEndsOn,
                firstBill: addDays(trialEndsOn, 1),
                amount: { amountMinor: sub.priceMinor.toString(), currency: sub.currency },
              },
              action: { href: '/subscriptions' },
              ref: `trial.${sub.id}.${trialEndsOn}`,
            }),
          );
        }
        const pauses = await tx
          .select(SUBSCRIPTION)
          .from(subscriptions)
          .where(
            and(
              eq(subscriptions.status, 'paused'),
              isNotNull(subscriptions.pauseRemindDays),
              gte(subscriptions.pausedUntil, today),
            ),
          );
        for (const sub of pauses) {
          const pausedUntil = sub.pausedUntil as LocalDate;
          if (daysUntil(today, pausedUntil) > (sub.pauseRemindDays as number)) continue;
          notified(
            await insertNotificationIn(tx, userId, {
              type: 'pause_ending',
              category: 'budget_bills',
              titleKey: 'notification_pause_ending_title',
              bodyKey: 'notification_pause_ending_body',
              params: {
                name: sub.name,
                pausedUntil,
                amount: { amountMinor: sub.priceMinor.toString(), currency: sub.currency },
              },
              action: { href: '/subscriptions' },
              ref: `pause.${sub.id}.${pausedUntil}`,
            }),
          );
        }

        return { materialized, due: due.length, overdue: overdue.length, notifications };
      });
    },

    remind: (userId, occurrenceId, now) =>
      withUser(db, userId, async (tx) => {
        // The row lock serializes concurrent runs of the same reminder; the second one sees `reminded_at`.
        const [occurrence] = await tx
          .select(OCCURRENCE)
          .from(scheduledOccurrences)
          .where(eq(scheduledOccurrences.id, occurrenceId))
          .for('update');
        if (
          occurrence === undefined ||
          occurrence.remindedAt !== null ||
          occurrence.remindAt === null ||
          occurrence.remindAt > now ||
          (occurrence.status !== 'scheduled' && occurrence.status !== 'due_review')
        ) {
          return { reminded: false, emailed: false };
        }
        const { today } = await userClockIn(tx, userId, now);
        const days = Math.max(0, daysUntil(today, occurrence.dueDate));
        let emailed = false;
        if (occurrence.sourceType === 'receivable') {
          // FR-U7 "hanya ke kamu": in the app only. The person's name is encrypted personal data, so the reminder
          // names what the money was for.
          const [receivable] = await tx
            .select({ description: receivables.description })
            .from(receivables)
            .where(eq(receivables.id, occurrence.sourceId));
          if (receivable === undefined) return { reminded: false, emailed: false };
          await insertNotificationIn(tx, userId, {
            type: 'receivable_due',
            category: 'budget_bills',
            titleKey: 'notification_receivable_due_title',
            bodyKey:
              receivable.description === null
                ? 'notification_receivable_due_plain_body'
                : 'notification_receivable_due_body',
            params: {
              description: receivable.description,
              amount: amountOf(occurrence),
              dueDate: occurrence.dueDate,
              days,
            },
            action: { href: RECEIVABLES_HREF },
            ref: `rem.${occurrence.id}`,
          });
        } else {
          const subject = (await occurrenceSubjectsIn(tx, [occurrence])).get(
            subjectKey(occurrence),
          ) as OccurrenceSubject;
          const notification = await insertNotificationIn(tx, userId, {
            type: 'bill_reminder',
            category: 'budget_bills',
            titleKey: 'notification_bill_reminder_title',
            bodyKey: days === 0 ? 'notification_bill_reminder_today_body' : 'notification_bill_reminder_body',
            params: {
              name: subject.name,
              dueDate: occurrence.dueDate,
              amount: amountOf(occurrence),
              account: subject.accountName,
              days,
            },
            action: { href: subject.href },
            ref: `rem.${occurrence.id}`,
          });
          const preferences = await deliveryPreferencesIn(tx, userId);
          emailed =
            emailsType(preferences.settings, 'bill_reminder') &&
            (await insertOutboxIn(
              tx,
              userId,
              notification.id,
              {
                kind: 'bill_reminder',
                name: subject.name,
                dueDate: occurrence.dueDate,
                amount: preferences.hideBalances ? null : amountOf(occurrence),
                path: subject.href,
              },
              now,
            ));
        }
        await tx
          .update(scheduledOccurrences)
          .set({ remindedAt: now, updatedAt: now })
          .where(eq(scheduledOccurrences.id, occurrence.id));
        return { reminded: true, emailed };
      }),
  };
}
