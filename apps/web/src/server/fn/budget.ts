// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Read server functions of the M2 screens: the period switcher and Settings › Periode bulanan (FR-P1/P2), the budget
 * page with its sheets (FR-B1/B2), and the dashboard (FR-D1/D2, FR-S7 custom range). The user always comes from the
 * session.
 */
import { createServerFn } from '@tanstack/react-start';
import type { BudgetHistoryEntry, BudgetStatus, FillSuggestion } from '@wf/db/budgets';
import type { Dashboard } from '@wf/db/dashboard';
import type { Payday, PeriodsOverview } from '@wf/db/periods';
import type { CategoryGroup, TransactionRow } from '@wf/db/transaction-query';
import { addDays, type LocalDate, type YearMonth } from '@wf/domain/period';
import * as z from 'zod';
import { attempt, requireSession, type Result } from '../access.ts';
import { localDate } from '../inputs.ts';
import { services } from '../runtime.ts';

/** FR-B2 "Detail kategori": the period's daily spending, the three periods before, and the latest transactions. */
export interface BudgetCategoryDetail {
  /** Every day of the period, zero-filled. */
  readonly daily: readonly { readonly date: LocalDate; readonly outMinor: bigint }[];
  /** "3 bulan terakhir": up to three earlier periods (from the first one with data), then this one. */
  readonly months: readonly { readonly label: YearMonth; readonly spentMinor: bigint; readonly current: boolean }[];
  /** The latest five, newest first. */
  readonly transactions: readonly TransactionRow[];
  readonly transactionCount: number;
}

/** How many earlier periods "3 bulan terakhir" shows. */
const DETAIL_MONTHS = 3;
const DETAIL_TRANSACTIONS = 5;

/** FR-P1: the periods up to today (rows newest first), the current one, and the next two. */
export const listPeriods = createServerFn({ method: 'GET' }).handler(
  async ({ context }): Promise<Result<PeriodsOverview>> => {
    const { periods, now } = await services();
    return attempt(async () => {
      const { user } = await requireSession(context.session, {}, now());
      return periods.list(user.id);
    });
  },
);

/** FR-B2: the budget page of a period (default: the current one). */
export const getBudgetStatus = createServerFn({ method: 'GET' })
  .validator(z.object({ periodId: z.uuid().optional() }))
  .handler(async ({ context, data }): Promise<Result<BudgetStatus>> => {
    const { budgets, now } = await services();
    return attempt(async () => {
      const { user } = await requireSession(context.session, {}, now());
      return budgets.status(user.id, data.periodId === undefined ? {} : { periodId: data.periodId });
    });
  });

/** FR-B1 "Riwayat perubahan anggaran", newest version first. */
export const getBudgetHistory = createServerFn({ method: 'GET' }).handler(
  async ({ context }): Promise<Result<BudgetHistoryEntry[]>> => {
    const { budgets, now } = await services();
    return attempt(async () => {
      const { user } = await requireSession(context.session, {}, now());
      return budgets.history(user.id);
    });
  },
);

/** FR-B1 "Isi dari rata-rata 3 bulan" for the budget sheet of a period. */
export const getBudgetFill = createServerFn({ method: 'GET' })
  .validator(z.object({ periodId: z.uuid() }))
  .handler(async ({ context, data }): Promise<Result<FillSuggestion[]>> => {
    const { budgets, now } = await services();
    return attempt(async () => {
      const { user } = await requireSession(context.session, {}, now());
      return budgets.fillFromAverage(user.id, data.periodId);
    });
  });

/** "Tambah kategori anggaran": spending per expense category in a period ("Rp22.660 bulan ini"). */
export const listPeriodSpending = createServerFn({ method: 'GET' })
  .validator(z.object({ periodId: z.uuid() }))
  .handler(async ({ context, data }): Promise<Result<CategoryGroup[]>> => {
    const { periods, transactionQuery, now } = await services();
    return attempt(async () => {
      const { user } = await requireSession(context.session, {}, now());
      const period = await periods.get(user.id, data.periodId);
      const groups = await transactionQuery.groupByCategory(user.id, { from: period.start, to: period.end });
      return groups.filter((group) => group.kind === 'expense');
    });
  });

/** FR-B2 "Detail kategori" of a budgeted (or any expense) category in a period. */
export const getBudgetCategory = createServerFn({ method: 'GET' })
  .validator(z.object({ periodId: z.uuid(), categoryId: z.uuid() }))
  .handler(async ({ context, data }): Promise<Result<BudgetCategoryDetail>> => {
    const { periods, transactionQuery, now } = await services();
    return attempt(async () => {
      const { user } = await requireSession(context.session, {}, now());
      const period = await periods.get(user.id, data.periodId);
      const filter = { categoryIds: [data.categoryId] };
      const summary = await transactionQuery.summary(user.id, { ...filter, from: period.start, to: period.end });
      const earlier = (
        await periods.covering(user.id, {
          from: addDays(period.start, -(DETAIL_MONTHS + 1) * 31),
          to: addDays(period.start, -1),
        })
      ).slice(-DETAIL_MONTHS);
      const months: { label: YearMonth; spentMinor: bigint; current: boolean }[] = [];
      for (const previous of earlier) {
        const { outMinor } = await transactionQuery.summary(user.id, {
          ...filter,
          from: previous.start,
          to: previous.end,
        });
        // Computed periods before the first one with data say nothing.
        if (months.length > 0 || outMinor > 0n || previous.id !== null) {
          months.push({ label: previous.label, spentMinor: outMinor, current: false });
        }
      }
      months.push({ label: period.label, spentMinor: summary.outMinor, current: true });
      const page = await transactionQuery.list(
        user.id,
        { ...filter, from: period.start, to: period.end },
        { sort: 'date_desc', limit: DETAIL_TRANSACTIONS },
      );
      return {
        daily: summary.dailySpend,
        months,
        transactions: page.rows,
        transactionCount: page.total,
      };
    });
  });

/** Settings › Periode bulanan (FR-P1): the start day, the periods, and the payday the salary incomes suggest. */
export const getPeriodSettings = createServerFn({ method: 'GET' }).handler(
  async ({ context }): Promise<Result<{ overview: PeriodsOverview; payday: Payday }>> => {
    const { periods, now } = await services();
    return attempt(async () => {
      const { user } = await requireSession(context.session, {}, now());
      return { overview: await periods.list(user.id), payday: await periods.payday(user.id) };
    });
  },
);

const dashboardRequest = z.discriminatedUnion('scope', [
  z.object({ scope: z.literal('week') }),
  z.object({ scope: z.literal('month'), periodId: z.uuid().optional() }),
  z.object({ scope: z.literal('year'), year: z.number().int().min(1000).max(9998).optional() }),
  z.object({ scope: z.literal('range'), from: localDate, to: localDate }),
]);

/** FR-D1/D2, FR-S7: the dashboard for a week, a period, a year, or a custom range. */
export const getDashboard = createServerFn({ method: 'GET' })
  .validator(dashboardRequest)
  .handler(async ({ context, data }): Promise<Result<Dashboard>> => {
    const { dashboard, now } = await services();
    return attempt(async () => {
      const { user } = await requireSession(context.session, {}, now());
      return dashboard.get(user.id, data);
    });
  });
