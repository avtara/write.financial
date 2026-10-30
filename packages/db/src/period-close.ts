// SPDX-License-Identifier: AGPL-3.0-only
/**
 * FR-P4 period close, worker side (`period-close` job at/after 00.05 the day after a period ends): before
 * `periods.lock`, the closing numbers of the budget page (`budgetStatusIn(…).close`, read only) become proposals in
 * the Review queue: one `rollover` item per rollover line with a remainder (applied on the next period), and one
 * `leftover` item moving what is left to the first goal ("pindah sisa Rp1.150.000 ke Dana Darurat"), plus one
 * `period_closed` notification. D14: nothing changes before the user confirms; every write is keyed
 * (`close.{periodId}.rollover.{categoryId}`, `close.{periodId}.leftover`, ref `close.{periodId}`), so it is idempotent.
 */
import type { Dek } from '@wf/crypto/envelope';
import { addDays, type LocalDate, type YearMonth } from '@wf/domain/period';
import { and, asc, desc, eq, gt, isNull, lt } from 'drizzle-orm';
import { withUser, type Database } from './db.ts';
import { budgetStatusIn } from './budgets.ts';
import { LedgerError } from './ledger-errors.ts';
import { insertNotificationIn } from './notifications.ts';
import { ensureIn, periodIn, settingsIn } from './periods.ts';
import { insertReviewItemIn } from './review-items.ts';
import { accounts, goals, periods, postings, transactions, transactionTags } from './schema.ts';

export interface EndedPeriod {
  readonly id: string;
  readonly label: YearMonth;
  readonly start: LocalDate;
  readonly end: LocalDate;
}

export interface CloseProposalResult {
  /** Rollover review items (new or existing). */
  readonly rollovers: number;
  /** Whether a leftover move was proposed (a positive leftover). */
  readonly leftover: boolean;
  /** Review items created by this run (0 on a rerun). */
  readonly created: number;
}

export interface PeriodClose {
  /** Open periods that ended before today, oldest first. */
  endedPeriods: (userId: string, now: Date) => Promise<EndedPeriod[]>;
  /**
   * The close proposals of an ended period (the job runs it, then `periods.lock`; a retry re-proposes idempotently).
   * @throws {LedgerError} `NOT_FOUND`, `INVALID_PERIOD` (it has not ended)
   */
  propose: (userId: string, periodId: string, now: Date) => Promise<CloseProposalResult>;
}

export function createPeriodClose(
  db: Database,
  options: { readonly getDek: (userId: string) => Promise<Dek> },
): PeriodClose {
  return {
    endedPeriods: (userId, now) =>
      withUser(db, userId, async (tx) => {
        const { today } = await settingsIn(tx, userId, now);
        return tx
          .select({ id: periods.id, label: periods.label, start: periods.startDate, end: periods.endDate })
          .from(periods)
          .where(and(eq(periods.status, 'open'), lt(periods.endDate, today)))
          .orderBy(asc(periods.startDate));
      }),

    propose: async (userId, periodId, now) => {
      const dek = await options.getDek(userId);
      return withUser(db, userId, async (tx) => {
        const period = await periodIn(tx, periodId);
        const { startDay, today } = await settingsIn(tx, userId, now);
        if (period.end >= today) throw new LedgerError('INVALID_PERIOD', 'The period has not ended yet');
        await ensureIn(tx, userId, today, startDay);
        const [next] = await tx
          .select({ id: periods.id })
          .from(periods)
          .where(eq(periods.startDate, addDays(period.end, 1)));
        const status = await budgetStatusIn(tx, userId, period, now);
        const { rollovers, leftoverMinor } = status.close;
        let created = 0;

        for (const { categoryId, deltaMinor } of rollovers) {
          const item = await insertReviewItemIn(tx, userId, dek, {
            reason: 'period_close_proposal',
            source: 'period_close',
            dedupeKey: `close.${periodId}.rollover.${categoryId}`,
            periodId,
            dueDate: period.end,
            // `ensureIn` created every row up to today, so the next period exists.
            payload: { kind: 'rollover', periodId, nextPeriodId: next?.id as string, categoryId, deltaMinor },
          });
          if (item.created) created += 1;
        }

        if (leftoverMinor > 0n) {
          const [goal] = await tx
            .select({ id: goals.id, tagId: goals.tagId })
            .from(goals)
            .where(isNull(goals.archivedAt))
            .orderBy(asc(goals.sortOrder), asc(goals.createdAt))
            .limit(1);
          // The first active account in the user's order is where everyday money sits.
          const [from] = await tx
            .select({ id: accounts.id })
            .from(accounts)
            .where(eq(accounts.status, 'active'))
            .orderBy(asc(accounts.sortOrder), asc(accounts.createdAt), asc(accounts.id))
            .limit(1);
          // The account the goal's money went to last: the receiving side of the latest transfer tagged with its tag.
          const [to] =
            goal?.tagId == null
              ? []
              : await tx
                  .select({ id: postings.accountId })
                  .from(transactionTags)
                  .innerJoin(transactions, eq(transactions.id, transactionTags.transactionId))
                  .innerJoin(postings, eq(postings.transactionId, transactions.id))
                  .where(
                    and(
                      eq(transactionTags.tagId, goal.tagId),
                      eq(transactions.type, 'transfer'),
                      isNull(transactions.deletedAt),
                      eq(postings.role, 'principal'),
                      gt(postings.amountMinor, 0n),
                    ),
                  )
                  .orderBy(desc(transactions.occurredAt), desc(transactions.id))
                  .limit(1);
          const item = await insertReviewItemIn(tx, userId, dek, {
            reason: 'period_close_proposal',
            source: 'period_close',
            dedupeKey: `close.${periodId}.leftover`,
            periodId,
            dueDate: period.end,
            payload: {
              kind: 'leftover',
              periodId,
              amountMinor: leftoverMinor,
              goalId: goal?.id ?? null,
              fromAccountId: from?.id ?? null,
              toAccountId: to?.id ?? null,
            },
          });
          if (item.created) created += 1;
        }

        await insertNotificationIn(tx, userId, {
          type: 'period_closed',
          category: 'budget_bills',
          titleKey: 'notification_period_closed_title',
          bodyKey: 'notification_period_closed_body',
          params: {
            start: period.start,
            end: period.end,
            proposals: rollovers.length + (leftoverMinor > 0n ? 1 : 0),
            leftover: { amountMinor: leftoverMinor.toString(), currency: status.baseCurrency },
          },
          action: { href: '/review' },
          ref: `close.${periodId}`,
        });
        return { rollovers: rollovers.length, leftover: leftoverMinor > 0n, created };
      });
    },
  };
}
