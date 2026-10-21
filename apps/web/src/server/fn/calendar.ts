// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The calendar's reads (FR-C1–C3): a month or week view's daily totals, every transaction, and the scheduled events
 * (bills, recurring transfers; they never affect balances), and a year's daily totals. The user always comes from the
 * session.
 */
import { createServerFn } from '@tanstack/react-start';
import type { ScheduledItem } from '@wf/db/schedules';
import type { DayGroup, TransactionRow } from '@wf/db/transaction-query';
import { countDays, type LocalDate } from '@wf/domain/period';
import * as z from 'zod';
import { attempt, requireSession, type Result } from '../access.ts';
import { localDate } from '../inputs.ts';
import { services } from '../runtime.ts';

/** A month view spans at most six weeks; a week view two (this one and the last, for "vs Sen–Kam lalu"). */
export const CALENDAR_RANGE_MAX_DAYS = 42;
/** Rows per page of the repository (its maximum). */
const PAGE = 200;

export interface CalendarRange {
  /** Each day's totals (as the Overview and Transactions count them). */
  readonly days: DayGroup[];
  /** Oldest first. */
  readonly rows: TransactionRow[];
  readonly scheduled: ScheduledItem[];
  /** Whether the user ever recorded a transaction (the empty state otherwise). */
  readonly hasTransactions: boolean;
}

export interface CalendarYear {
  readonly days: DayGroup[];
  readonly hasTransactions: boolean;
}

/** FR-C1/C2 month and week views: the range's transactions and scheduled events. */
export const getCalendarRange = createServerFn({ method: 'GET' })
  .validator(
    z
      .object({ from: localDate, to: localDate })
      .refine(({ from, to }) => from <= to && countDays(from, to) <= CALENDAR_RANGE_MAX_DAYS, {
        message: 'The range must be 1–42 days',
      }),
  )
  .handler(async ({ context, data }): Promise<Result<CalendarRange>> => {
    const { transactionQuery, schedules, now } = await services();
    return attempt(async () => {
      const { user } = await requireSession(context.session, {}, now());
      const filter = { from: data.from, to: data.to };
      const rows: TransactionRow[] = [];
      for (let total = Infinity; rows.length < total;) {
        const page = await transactionQuery.list(user.id, filter, {
          sort: 'date_asc',
          limit: PAGE,
          offset: rows.length,
        });
        rows.push(...page.rows);
        total = page.rows.length === 0 ? rows.length : page.total;
      }
      const [days, scheduled, ever] = await Promise.all([
        transactionQuery.groupByDay(user.id, filter),
        schedules.listScheduled(user.id, filter),
        transactionQuery.list(user.id, {}, { limit: 1 }),
      ]);
      return { days, rows, scheduled, hasTransactions: ever.total > 0 };
    });
  });

/** FR-C1 year view: each day's totals of `year`. */
export const getCalendarYear = createServerFn({ method: 'GET' })
  .validator(z.object({ year: z.int().min(2000).max(2100) }))
  .handler(async ({ context, data }): Promise<Result<CalendarYear>> => {
    const { transactionQuery, now } = await services();
    return attempt(async () => {
      const { user } = await requireSession(context.session, {}, now());
      const [days, ever] = await Promise.all([
        transactionQuery.groupByDay(user.id, {
          from: `${String(data.year)}-01-01` as LocalDate,
          to: `${String(data.year)}-12-31` as LocalDate,
        }),
        transactionQuery.list(user.id, {}, { limit: 1 }),
      ]);
      return { days, hasTransactions: ever.total > 0 };
    });
  });
