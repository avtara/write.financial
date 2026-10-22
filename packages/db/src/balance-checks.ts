// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The `balance-checks` job (07.00 in the user's time zone; FR-R2, FR-ST3, FR-SUB6), notifications only:
 * - `low_balance`: an active account below its `low_balance_threshold_minor`, once per account and day
 *   (ref `low.{accountId}.{date}`);
 * - `account_unchecked`: an active account not reconciled for 14 days (since its creation when never), once per
 *   account and stale spell (ref `unchecked.{accountId}.{date it became stale}`);
 * - `insufficient_balance`: the bills due in the next 3 days (scheduled or in review) exceed the balance of the account
 *   paying them, once per account and day (ref `insufficient.{accountId}.{date}`).
 * Balances come from the accounts page's query (`viewsIn`, read only).
 */
import { addDays, type LocalDate } from '@wf/domain/period';
import { and, eq, gte, inArray, lte } from 'drizzle-orm';
import { viewsIn, type AccountBalanceView } from './accounts.ts';
import { withUser, type Database } from './db.ts';
import { localDateOf } from './ledger-core.ts';
import { insertNotificationIn } from './notifications.ts';
import { occurrenceSubjectsIn } from './occurrence-jobs.ts';
import { userClockIn } from './occurrences.ts';
import { accounts, scheduledOccurrences } from './schema.ts';

/** Days without reconciliation after which an account counts as not checked. */
export const UNCHECKED_DAYS = 14;
/** How far ahead bills are compared with the paying account's balance (FR-SUB6). */
export const BILL_HORIZON_DAYS = 3;

export interface BalanceCheckResult {
  readonly lowBalance: number;
  readonly unchecked: number;
  readonly insufficient: number;
}

export interface BalanceChecks {
  /** Creates the notifications due today; returns how many of each kind were new. */
  check: (userId: string, now: Date) => Promise<BalanceCheckResult>;
}

const money = (amountMinor: bigint, currency: string) => ({ amountMinor: amountMinor.toString(), currency });

export function createBalanceChecks(db: Database): BalanceChecks {
  return {
    check: (userId, now) =>
      withUser(db, userId, async (tx) => {
        const { timeZone, today } = await userClockIn(tx, userId, now);
        const { views } = await viewsIn(tx, userId, eq(accounts.status, 'active'));
        const counts = { lowBalance: 0, unchecked: 0, insufficient: 0 };
        const account = (view: AccountBalanceView) => ({ accountId: view.id, account: view.displayName });

        for (const view of views) {
          const threshold = view.lowBalanceThresholdMinor;
          if (threshold !== null && view.balanceMinor < threshold) {
            const result = await insertNotificationIn(tx, userId, {
              type: 'low_balance',
              category: 'budget_bills',
              titleKey: 'notification_low_balance_title',
              bodyKey: 'notification_low_balance_body',
              params: {
                ...account(view),
                balance: money(view.balanceMinor, view.currency),
                threshold: money(threshold, view.currency),
              },
              action: { href: '/accounts' },
              ref: `low.${view.id}.${today}`,
            });
            if (result.created) counts.lowBalance += 1;
          }

          const checkedOn = localDateOf(view.lastReconciledAt ?? view.createdAt, timeZone);
          const staleOn = addDays(checkedOn, UNCHECKED_DAYS);
          if (staleOn <= today) {
            const result = await insertNotificationIn(tx, userId, {
              type: 'account_unchecked',
              category: 'budget_bills',
              titleKey: 'notification_account_unchecked_title',
              bodyKey:
                view.lastReconciledAt === null
                  ? 'notification_account_unchecked_never_body'
                  : 'notification_account_unchecked_body',
              params: { ...account(view), checkedOn },
              action: { href: '/accounts' },
              ref: `unchecked.${view.id}.${staleOn}`,
            });
            if (result.created) counts.unchecked += 1;
          }
        }

        const until: LocalDate = addDays(today, BILL_HORIZON_DAYS);
        const bills = await tx
          .select({
            sourceType: scheduledOccurrences.sourceType,
            sourceId: scheduledOccurrences.sourceId,
            dueDate: scheduledOccurrences.dueDate,
            expectedMinor: scheduledOccurrences.expectedMinor,
          })
          .from(scheduledOccurrences)
          .where(
            and(
              inArray(scheduledOccurrences.status, ['scheduled', 'due_review']),
              inArray(scheduledOccurrences.sourceType, ['recurrence', 'subscription']),
              gte(scheduledOccurrences.dueDate, today),
              lte(scheduledOccurrences.dueDate, until),
            ),
          );
        const subjects = await occurrenceSubjectsIn(tx, bills);
        const byAccount = new Map<string, { neededMinor: bigint; count: number; lastDue: LocalDate }>();
        for (const bill of bills) {
          const subject = subjects.get(`${bill.sourceType}.${bill.sourceId}`);
          if (subject === undefined || !subject.outflow) continue;
          const total = byAccount.get(subject.accountId) ?? { neededMinor: 0n, count: 0, lastDue: bill.dueDate };
          byAccount.set(subject.accountId, {
            neededMinor: total.neededMinor + bill.expectedMinor,
            count: total.count + 1,
            lastDue: bill.dueDate > total.lastDue ? bill.dueDate : total.lastDue,
          });
        }
        for (const view of views) {
          const total = byAccount.get(view.id);
          // A credit card pays from its remaining credit; one without a known limit is not checked.
          const availableMinor =
            view.type !== 'credit_card'
              ? view.balanceMinor
              : view.ccLimitMinor === null
                ? null
                : view.ccLimitMinor + view.balanceMinor;
          if (total === undefined || availableMinor === null || total.neededMinor <= availableMinor) continue;
          const result = await insertNotificationIn(tx, userId, {
            type: 'insufficient_balance',
            category: 'budget_bills',
            titleKey: 'notification_insufficient_balance_title',
            bodyKey: 'notification_insufficient_balance_body',
            params: {
              ...account(view),
              balance: money(availableMinor, view.currency),
              needed: money(total.neededMinor, view.currency),
              count: total.count,
              until: total.lastDue,
            },
            action: { href: '/subscriptions' },
            ref: `insufficient.${view.id}.${today}`,
          });
          if (result.created) counts.insufficient += 1;
        }
        return counts;
      }),
  };
}
