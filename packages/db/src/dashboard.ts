// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The dashboard (FR-D1, FR-D2, FR-S7) for a week, a period, a year, or a custom range, in one user transaction: KPIs
 * with the like-for-like comparison, the money-flow input (`moneyFlow` of `@wf/domain/dashboard` draws it with the
 * menu options), spending per category with a series for the small multiples, six periods of income vs expense, the
 * spending calendar, per-account flows, and the budget card. Amounts are in the base currency unless noted.
 */
import { ratioBps, savingRateBps, SAVING_RATE_TARGET_BPS, weeklyBudget, type BudgetLineState } from '@wf/domain/budget';
import type { CategoryGroup } from '@wf/domain/categories';
import {
  changeBps,
  customRanges,
  monthRanges,
  rangeSummary,
  weekRanges,
  yearRanges,
  type DashboardRanges,
  type DateRange,
  type MoneyFlowInput,
  type RangeSummary,
  type WeekStart,
} from '@wf/domain/dashboard';
import { addDays, countDays, type LocalDate, type YearMonth } from '@wf/domain/period';
import { and, asc, eq, gte, isNull, lte, sql } from 'drizzle-orm';
import { withUser, type Database, type Transaction } from './db.ts';
import { budgetStatusIn } from './budgets.ts';
import { userContextIn } from './ledger-core.ts';
import { LedgerError } from './ledger-errors.ts';
import { coveringIn, ensureIn, periodIn, periodOnIn, settingsIn, type PeriodView } from './periods.ts';
import { categories, postings, transactions, userPreferences } from './schema.ts';
import { categoryTotalsIn, dayTotalsIn, isOut, lineCategoryId, type DayGroup } from './transaction-query.ts';

export type DashboardRequest =
  | { readonly scope: 'week' }
  | { readonly scope: 'month'; readonly periodId?: string | undefined }
  | { readonly scope: 'year'; readonly year?: number | undefined }
  | { readonly scope: 'range'; readonly from: LocalDate; readonly to: LocalDate };

export type DashboardScope = DashboardRequest['scope'];

export interface Kpis {
  readonly incomeMinor: bigint;
  /** Expense principal + fees + FX-difference losses; transfers are not spending. */
  readonly expenseMinor: bigint;
  /** "Ditabung & Investasi" = income − expense. */
  readonly savedMinor: bigint;
  /** `null` without income. */
  readonly savingRateBps: number | null;
}

export interface CategorySpending {
  /** `null` = uncategorized. */
  readonly categoryId: string | null;
  readonly group: CategoryGroup | null;
  readonly totalMinor: bigint;
  readonly count: number;
  /** Share of all spending in the range. */
  readonly shareBps: number;
  /** Per day (week, month, range) or per month (year), zero-filled, oldest first. */
  readonly series: bigint[];
}

export interface TrendPeriod {
  readonly label: YearMonth;
  readonly start: LocalDate;
  readonly end: LocalDate;
  readonly incomeMinor: bigint;
  readonly expenseMinor: bigint;
  readonly savedMinor: bigint;
}

export interface DashboardBudgetLine {
  readonly categoryId: string;
  /** The limit for the scope: the period's, × 7 ÷ days for a week, × periods so far for a year. */
  readonly limitMinor: bigint;
  readonly spentMinor: bigint;
  readonly usedBps: number | null;
  /** The period's state (month scope) or `over` / `ok` against the scope's limit. */
  readonly state: BudgetLineState;
}

export interface Dashboard {
  readonly scope: DashboardScope;
  readonly today: LocalDate;
  readonly baseCurrency: string;
  readonly ranges: DashboardRanges;
  /** The period shown (month scope) or the one containing today (week scope); `null` for year and range. */
  readonly period: PeriodView | null;
  /** FR-S7 "30 hari · melintasi 2 periode" for the full range. */
  readonly summary: RangeSummary;
  readonly kpis: {
    readonly current: Kpis;
    readonly previous: Kpis;
    /** Relative changes in basis points; the saving rate changes in points (bps difference). */
    readonly change: {
      readonly incomeBps: number | null;
      readonly expenseBps: number | null;
      readonly savedBps: number | null;
      readonly savingRateBps: number | null;
    };
    /** "Target 30%". */
    readonly savingRateTargetBps: number;
  };
  /** Input of `moneyFlow(flow, options)` for the current range. */
  readonly flow: MoneyFlowInput;
  /** Spending per category, largest first. */
  readonly categories: CategorySpending[];
  /** Bucket starts of {@link CategorySpending.series}. */
  readonly buckets: LocalDate[];
  /** Six periods up to the one containing the end of the current range, oldest first ("6 bulan terakhir"). */
  readonly trend: { readonly periods: TrendPeriod[]; readonly averageSavedMinor: bigint };
  /** Spending calendar of the current range, newest day first, and the daily average ("rata-rata harian"). */
  readonly calendar: { readonly days: DayGroup[]; readonly averageDailySpendMinor: bigint };
  /** Per account, in its own currency, for the current range ("+Rp1.200.000 bulan ini"). */
  readonly accounts: { readonly accountId: string; readonly inflowMinor: bigint; readonly outflowMinor: bigint }[];
  /** The budget card; `null` without a budget. */
  readonly budget: { readonly lines: DashboardBudgetLine[]; readonly overCount: number } | null;
}

export interface DashboardRepository {
  /** @throws {LedgerError} `NOT_FOUND` (period), `INVALID_PERIOD` (range: from after to, or longer than 366 days) */
  get: (userId: string, request: DashboardRequest) => Promise<Dashboard>;
}

const MAX_RANGE_DAYS = 366;

async function kpisIn(tx: Transaction, userId: string, range: DateRange): Promise<Kpis> {
  const days = await dayTotalsIn(tx, userId, range);
  const incomeMinor = days.reduce((total, day) => total + day.inMinor, 0n);
  const expenseMinor = days.reduce((total, day) => total + day.outMinor, 0n);
  return {
    incomeMinor,
    expenseMinor,
    savedMinor: incomeMinor - expenseMinor,
    savingRateBps: savingRateBps(incomeMinor, expenseMinor),
  };
}

/** Day buckets for up to 62 days, month buckets beyond. */
function bucketsOf(range: DateRange): { readonly unit: 'day' | 'month'; readonly starts: LocalDate[] } {
  const unit = countDays(range.from, range.to) > 62 ? 'month' : 'day';
  const starts: LocalDate[] = [];
  let start = unit === 'day' ? range.from : (`${range.from.slice(0, 7)}-01` as LocalDate);
  while (start <= range.to) {
    starts.push(start);
    if (unit === 'day') {
      start = addDays(start, 1);
    } else {
      // The first of the next month: the 1st + 31 days always lands in it.
      start = `${addDays(start, 31).slice(0, 7)}-01` as LocalDate;
    }
  }
  return { unit, starts };
}

export function createDashboard(db: Database, options: { readonly now?: () => Date } = {}): DashboardRepository {
  const now = options.now ?? (() => new Date());

  return {
    get: (userId, request) =>
      withUser(db, userId, async (tx) => {
        const { baseCurrency } = await userContextIn(tx, userId);
        const { startDay, today } = await settingsIn(tx, userId, now());
        await ensureIn(tx, userId, today, startDay);
        const [preferences] = await tx
          .select({ weekStart: userPreferences.weekStart })
          .from(userPreferences)
          .where(eq(userPreferences.userId, userId));
        const weekStart: WeekStart = preferences?.weekStart ?? 'monday';

        let ranges: DashboardRanges;
        let period: PeriodView | null = null;
        if (request.scope === 'range') {
          if (request.from > request.to || countDays(request.from, request.to) > MAX_RANGE_DAYS) {
            throw new LedgerError('INVALID_PERIOD', 'A range runs forward and lasts at most 366 days');
          }
          ranges = customRanges({ from: request.from, to: request.to });
        } else if (request.scope === 'year') {
          ranges = yearRanges(request.year ?? Number(today.slice(0, 4)), startDay, today);
        } else {
          period =
            request.scope === 'month' && request.periodId !== undefined
              ? await periodIn(tx, request.periodId)
              : ((await periodOnIn(tx, today)) as PeriodView);
          if (request.scope === 'week') {
            ranges = weekRanges(today, weekStart);
          } else {
            const before = await coveringIn(
              tx,
              { from: addDays(period.start, -1), to: addDays(period.start, -1) },
              startDay,
            );
            ranges = monthRanges(period, before.at(-1) as PeriodView, today);
          }
        }
        const { current } = ranges;

        const [currentKpis, previousKpis] = [
          await kpisIn(tx, userId, current),
          await kpisIn(tx, userId, ranges.previous),
        ];
        const covering = await coveringIn(tx, ranges.full, startDay);

        // Money flow and categories.
        const totals = await categoryTotalsIn(tx, userId, current);
        const groupRows = await tx.select({ id: categories.id, group: categories.group }).from(categories);
        const groupOf = new Map(groupRows.map((row) => [row.id, row.group]));
        const expenses = totals.filter((row) => row.kind === 'expense');
        const transfers = await tx
          .select({
            accountId: postings.accountId,
            amountMinor: sql`sum(${postings.amountBaseMinor})`.mapWith(BigInt),
          })
          .from(postings)
          .innerJoin(transactions, eq(transactions.id, postings.transactionId))
          .where(
            and(
              isNull(transactions.deletedAt),
              eq(transactions.type, 'transfer'),
              eq(postings.role, 'principal'),
              sql`${postings.amountMinor} > 0`,
              gte(transactions.localDate, current.from),
              lte(transactions.localDate, current.to),
            ),
          )
          .groupBy(postings.accountId)
          .orderBy(sql`sum(${postings.amountBaseMinor}) desc`, asc(postings.accountId));
        const flow: MoneyFlowInput = {
          incomes: totals
            .filter((row) => row.kind === 'income')
            .map((row) => ({ categoryId: row.categoryId, amountMinor: row.totalMinor })),
          expenses: expenses.map((row) => ({
            categoryId: row.categoryId,
            group: (row.categoryId === null ? undefined : groupOf.get(row.categoryId)) ?? 'other',
            amountMinor: row.totalMinor,
          })),
          transfers,
        };

        const { unit, starts } = bucketsOf(current);
        // A literal, not a parameter: GROUP BY must see the same expression as the select list.
        const bucket = sql<LocalDate>`to_char(date_trunc(${sql.raw(`'${unit}'`)}, ${transactions.localDate}), 'YYYY-MM-DD')`;
        const seriesRows = await tx
          .select({
            categoryId: lineCategoryId,
            bucket,
            totalMinor: sql`sum(-${postings.amountBaseMinor})`.mapWith(BigInt),
          })
          .from(transactions)
          .innerJoin(postings, eq(postings.transactionId, transactions.id))
          .where(
            and(
              isNull(transactions.deletedAt),
              gte(transactions.localDate, current.from),
              lte(transactions.localDate, current.to),
              isOut,
            ),
          )
          .groupBy(lineCategoryId, bucket);
        const index = new Map(starts.map((start, position) => [start, position]));
        const categoriesOut: CategorySpending[] = expenses.map((row) => {
          const series = starts.map(() => 0n);
          for (const point of seriesRows) {
            if (point.categoryId === row.categoryId) series[index.get(point.bucket) as number] = point.totalMinor;
          }
          return {
            categoryId: row.categoryId,
            // Uncategorized (`null`) has no group; every category id is in `groupOf`.
            group: groupOf.get(row.categoryId ?? '') ?? null,
            totalMinor: row.totalMinor,
            count: row.count,
            shareBps: row.shareBps,
            series,
          };
        });

        // Six periods of income vs expense.
        const trendEnd = current.to;
        const trendPeriods = (await coveringIn(tx, { from: addDays(trendEnd, -6 * 31), to: trendEnd }, startDay)).slice(
          -6,
        );
        const trend: TrendPeriod[] = [];
        for (const item of trendPeriods) {
          const kpis = await kpisIn(tx, userId, { from: item.start, to: item.end });
          trend.push({
            label: item.label,
            start: item.start,
            end: item.end,
            incomeMinor: kpis.incomeMinor,
            expenseMinor: kpis.expenseMinor,
            savedMinor: kpis.savedMinor,
          });
        }

        const days = await dayTotalsIn(tx, userId, current);
        const accountFlows = await tx
          .select({
            accountId: postings.accountId,
            inflowMinor: sql`sum(greatest(${postings.amountMinor}, 0))`.mapWith(BigInt),
            outflowMinor: sql`sum(greatest(-${postings.amountMinor}, 0))`.mapWith(BigInt),
          })
          .from(postings)
          .innerJoin(transactions, eq(transactions.id, postings.transactionId))
          .where(
            and(
              isNull(transactions.deletedAt),
              gte(transactions.localDate, current.from),
              lte(transactions.localDate, current.to),
            ),
          )
          .groupBy(postings.accountId)
          .orderBy(asc(postings.accountId));

        // The budget card.
        let budget: Dashboard['budget'] = null;
        const budgetPeriod = period ?? ((await periodOnIn(tx, today)) as PeriodView);
        const status = await budgetStatusIn(tx, userId, budgetPeriod, now());
        if (status.lines.length > 0) {
          const spentOf = new Map(expenses.map((row) => [row.categoryId, row.totalMinor]));
          const lines = status.lines.map((line): DashboardBudgetLine => {
            if (request.scope === 'month') {
              const { categoryId, limitMinor, spentMinor, usedBps, state } = line;
              return { categoryId, limitMinor, spentMinor, usedBps, state };
            }
            const limitMinor =
              request.scope === 'week'
                ? weeklyBudget(line.limitMinor, budgetPeriod.days)
                : line.limitMinor * BigInt(covering.filter((item) => item.start <= today).length);
            const spentMinor = spentOf.get(line.categoryId) ?? 0n;
            return {
              categoryId: line.categoryId,
              limitMinor,
              spentMinor,
              usedBps: ratioBps(spentMinor, limitMinor),
              state: spentMinor > limitMinor ? 'over' : spentMinor === 0n ? 'unused' : 'ok',
            };
          });
          budget = { lines, overCount: lines.filter((line) => line.state === 'over').length };
        }

        const outMinor = days.reduce((total, day) => total + day.outMinor, 0n);
        return {
          scope: request.scope,
          today,
          baseCurrency,
          ranges,
          period,
          summary: rangeSummary(ranges.full, covering),
          kpis: {
            current: currentKpis,
            previous: previousKpis,
            change: {
              incomeBps: changeBps(currentKpis.incomeMinor, previousKpis.incomeMinor),
              expenseBps: changeBps(currentKpis.expenseMinor, previousKpis.expenseMinor),
              savedBps: changeBps(currentKpis.savedMinor, previousKpis.savedMinor),
              savingRateBps:
                currentKpis.savingRateBps === null || previousKpis.savingRateBps === null
                  ? null
                  : currentKpis.savingRateBps - previousKpis.savingRateBps,
            },
            savingRateTargetBps: SAVING_RATE_TARGET_BPS,
          },
          flow,
          categories: categoriesOut,
          buckets: starts,
          trend: {
            periods: trend,
            // Never empty: the periods covering a range always include at least one.
            averageSavedMinor: trend.reduce((total, item) => total + item.savedMinor, 0n) / BigInt(trend.length),
          },
          calendar: {
            days,
            averageDailySpendMinor: outMinor / BigInt(countDays(current.from, current.to)),
          },
          accounts: accountFlows,
          budget,
        };
      }),
  };
}
