// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The dashboard (FR-D1, FR-D2, FR-S7) for a week, a period, a year, or a custom range, in one user transaction: KPIs
 * with the like-for-like comparison, the money-flow input (`moneyFlow` of `@wf/domain/dashboard` draws it with the
 * menu options), spending per category with a series for the small multiples, six periods of income vs expense, the
 * spending calendar, per-account flows, and the budget card. Amounts are in the base currency unless noted.
 */
import { ratioBps, SAVING_RATE_TARGET_BPS, weeklyBudget, type BudgetLineState } from '@wf/domain/budget';
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
  /** "Sisa pemasukan" = income − expense: what was not spent, wherever it stayed. */
  readonly leftoverMinor: bigint;
  /**
   * "Ditabung": transfers from everyday accounts (counted in "Saldo tersedia") to savings and investment accounts,
   * less transfers back; can be negative when more came back than went in.
   */
  readonly savedMinor: bigint;
  /** Saved ÷ income; `null` without income. */
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
  /** Income − expense. */
  readonly leftoverMinor: bigint;
  /** Net moved to savings and investment accounts (see {@link Kpis.savedMinor}). */
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
      readonly leftoverBps: number | null;
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
  /**
   * Income vs expense per period, oldest first: the six up to the one containing the end of the current range
   * ("6 bulan terakhir"), or a year's twelve ("Per bulan, Januari–Desember"; periods after today are empty).
   * `averageSavedMinor` averages the periods that have started.
   */
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

/** One day's net move into one savings or investment account ({@link savingsIn}). */
interface SavingsMove {
  readonly date: LocalDate;
  readonly accountId: string;
  readonly savedMinor: bigint;
}

/**
 * Saving, as it happened: transfers from an everyday account (counted in "Saldo tersedia") to a savings or
 * investment account (not counted), less transfers back, per day and savings account, in the base currency. Moves
 * between two everyday accounts or between two savings accounts are not saving, and a credit card on either side
 * is a bill being paid, not money put aside.
 */
async function savingsIn(tx: Transaction, range: DateRange): Promise<SavingsMove[]> {
  const rows = await tx.execute<{ date: string; account_id: string; saved: string }>(sql`
    select t.local_date::text as date,
           case when sa.include_in_available then ra.id else sa.id end as account_id,
           sum(case when sa.include_in_available then -s.amount_base_minor else -r.amount_base_minor end)::text as saved
    from transactions t
    join postings s on s.transaction_id = t.id and s.role = 'principal' and s.amount_minor < 0
    join postings r on r.transaction_id = t.id and r.role = 'principal' and r.amount_minor > 0
    join accounts sa on sa.id = s.account_id
    join accounts ra on ra.id = r.account_id
    where t.deleted_at is null and t.type = 'transfer'
      and t.local_date between ${range.from} and ${range.to}
      and sa.type <> 'credit_card' and ra.type <> 'credit_card'
      and sa.include_in_available <> ra.include_in_available
    group by 1, 2`);
  return rows.map((row) => ({
    date: row.date as LocalDate,
    accountId: row.account_id,
    savedMinor: BigInt(row.saved),
  }));
}

/** The KPIs of `range` from day totals (newest first) and savings moves covering it. */
function kpisOf(days: readonly DayGroup[], savings: readonly SavingsMove[], range: DateRange): Kpis {
  let incomeMinor = 0n;
  let expenseMinor = 0n;
  for (const day of days) {
    if (day.date < range.from || day.date > range.to) continue;
    incomeMinor += day.inMinor;
    expenseMinor += day.outMinor;
  }
  let savedMinor = 0n;
  for (const move of savings) {
    if (move.date >= range.from && move.date <= range.to) savedMinor += move.savedMinor;
  }
  return {
    incomeMinor,
    expenseMinor,
    leftoverMinor: incomeMinor - expenseMinor,
    savedMinor,
    savingRateBps: ratioBps(savedMinor, incomeMinor),
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
        const covering = await coveringIn(tx, ranges.full, startDay);
        // Income vs expense per period: six up to the end of the range, or the year's twelve.
        const trendPeriods =
          request.scope === 'year'
            ? covering
            : (await coveringIn(tx, { from: addDays(current.to, -6 * 31), to: current.to }, startDay)).slice(-6);
        // One day-totals query over everything the KPIs, the trend, and the calendar sum up (M8.5: one query per
        // period took most of the year view's time).
        const spanned = [
          current,
          ranges.previous,
          ...trendPeriods.filter((item) => item.start <= today).map((item) => ({ from: item.start, to: item.end })),
        ];
        const span = {
          from: spanned.reduce((from, range) => (range.from < from ? range.from : from), current.from),
          to: spanned.reduce((to, range) => (range.to > to ? range.to : to), current.to),
        };
        const allDays = await dayTotalsIn(tx, userId, span);
        const savings = await savingsIn(tx, span);
        const currentKpis = kpisOf(allDays, savings, current);
        const previousKpis = kpisOf(allDays, savings, ranges.previous);

        // Money flow and categories.
        const totals = await categoryTotalsIn(tx, userId, current);
        const groupRows = await tx.select({ id: categories.id, group: categories.group }).from(categories);
        const groupOf = new Map(groupRows.map((row) => [row.id, row.group]));
        const expenses = totals.filter((row) => row.kind === 'expense');
        // "Tabungan" in the money flow: what reached each savings or investment account (net of what came back).
        const savedTo = new Map<string, bigint>();
        for (const row of savings) {
          if (row.date < current.from || row.date > current.to) continue;
          savedTo.set(row.accountId, (savedTo.get(row.accountId) ?? 0n) + row.savedMinor);
        }
        const transfers = [...savedTo]
          .filter(([, amountMinor]) => amountMinor > 0n)
          .map(([accountId, amountMinor]) => ({ accountId, amountMinor }))
          .sort((a, b) => (b.amountMinor > a.amountMinor ? 1 : b.amountMinor < a.amountMinor ? -1 : 0));
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

        const trend: TrendPeriod[] = trendPeriods.map((item) => {
          const kpis = item.start > today ? null : kpisOf(allDays, savings, { from: item.start, to: item.end });
          return {
            label: item.label,
            start: item.start,
            end: item.end,
            incomeMinor: kpis?.incomeMinor ?? 0n,
            expenseMinor: kpis?.expenseMinor ?? 0n,
            leftoverMinor: kpis?.leftoverMinor ?? 0n,
            savedMinor: kpis?.savedMinor ?? 0n,
          };
        });
        const started = trend.filter((item) => item.start <= today);

        const days = allDays.filter((day) => day.date >= current.from && day.date <= current.to);
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
              leftoverBps: changeBps(currentKpis.leftoverMinor, previousKpis.leftoverMinor),
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
            averageSavedMinor:
              started.reduce((total, item) => total + item.savedMinor, 0n) / BigInt(Math.max(started.length, 1)),
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
