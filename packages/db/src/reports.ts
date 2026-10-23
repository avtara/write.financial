// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Reports (FR-LP1–LP5). A report is a stored snapshot of a range: the KPIs with their comparison, the savings rate,
 * the spending lines (categories against their budget, merchants, tags, accounts), goals, the largest transactions,
 * subscriptions, the daily series, and net worth at the range end. A monthly report is final once its period closed and
 * is never rewritten; quarters, years, and custom ranges are built from the same ledger figures and marked
 * provisional while they include a day that has not ended.
 *
 * Net worth counts the balances of the user's accounts at the range end (opening + postings up to it + corrections)
 * plus the investment portfolio's value at the last daily snapshot on or before it. A balance in a currency with no
 * reference rate at that date is left out and named in `unvaluedCurrencies`, so a snapshot never invents a rate.
 */
import type { Dek } from '@wf/crypto/envelope';
import type { AccountType } from '@wf/domain/ledger';
import { countDays, type LocalDate } from '@wf/domain/period';
import {
  busiestWeek,
  dailyAverageMinor,
  previousRange,
  quarterRange,
  reportTotals,
  shareLines,
  statusOf,
  topShareBps,
  totalsDelta,
  yearRange,
  type BusiestWeek,
  type ReportKind,
  type ReportStatus,
  type ReportTotals,
  type TotalsDelta,
} from '@wf/domain/report';
import { and, asc, desc, eq, gte, isNull, lt, lte, sql } from 'drizzle-orm';
import { withUser, type Database, type Transaction } from './db.ts';
import { budgetStatusIn } from './budgets.ts';
import { createGoals, type GoalView } from './goals.ts';
import { LedgerError } from './ledger-errors.ts';
import { periodIn, type PeriodView } from './periods.ts';
import {
  accounts,
  balanceAdjustments,
  categories,
  fxRates,
  periods,
  portfolioSnapshots,
  postings,
  reports,
  subscriptions,
  tags,
  transactionTags,
  transactions,
  users,
} from './schema.ts';
import { categoryTotalsIn, dayTotalsIn, isOut } from './transaction-query.ts';
import type { JsonObject, JsonValue } from './schema.ts';

/** FR-LP1 categories: spent against the budget line of the period ("Belanja Online 2.600.000/2.000.000"). */
export interface ReportCategoryLine {
  readonly categoryId: string | null;
  readonly name: string | null;
  readonly spentMinor: bigint;
  readonly shareBps: number;
  readonly limitMinor: bigint | null;
  readonly usedBps: number | null;
  /** "lewat Rp600.000" when over the limit. */
  readonly overMinor: bigint;
}

export interface ReportMerchantLine {
  readonly merchant: string;
  readonly totalMinor: bigint;
  readonly count: number;
  /** Of all expenses. */
  readonly shareBps: number;
}

export interface ReportTagLine {
  readonly tagId: string;
  readonly name: string;
  readonly totalMinor: bigint;
  readonly count: number;
}

export interface ReportAccountLine {
  readonly accountId: string;
  readonly name: string;
  readonly type: AccountType;
  readonly inMinor: bigint;
  readonly outMinor: bigint;
}

export interface ReportGoalLine {
  readonly goalId: string;
  readonly name: string;
  readonly savedMinor: bigint;
  readonly targetMinor: bigint;
  readonly progressBps: number;
}

export interface ReportLargestLine {
  readonly transactionId: string;
  readonly date: LocalDate;
  readonly description: string;
  readonly merchant: string | null;
  readonly amountMinor: bigint;
  /** Of all expenses ("Sewa Kos 24,6%"). */
  readonly shareBps: number;
}

export interface ReportSubscriptionLine {
  readonly active: number;
  /** Normalized to a month, base currency only; foreign subscriptions are counted in `unconverted`. */
  readonly monthlyMinor: bigint;
  readonly yearlyMinor: bigint;
  /** Of all expenses; `null` without expenses. */
  readonly shareBps: number | null;
  /** Active subscriptions in another currency with no rate at the range end. */
  readonly unconverted: number;
}

export interface ReportNetWorth {
  readonly valueMinor: bigint;
  /** Base-currency account balances at the range end. */
  readonly cashMinor: bigint;
  /** The portfolio's value at the last daily snapshot on or before the range end. */
  readonly investmentsMinor: bigint;
  /** Currencies left out because no reference rate covered the range end. */
  readonly unvaluedCurrencies: string[];
  readonly asOf: LocalDate;
}

export interface ReportDayLine {
  readonly date: LocalDate;
  readonly outMinor: bigint;
}

export interface ReportSections {
  readonly categories: readonly ReportCategoryLine[];
  readonly merchants: readonly ReportMerchantLine[];
  readonly tags: readonly ReportTagLine[];
  readonly accounts: readonly ReportAccountLine[];
  readonly goals: readonly ReportGoalLine[];
  readonly largest: readonly ReportLargestLine[];
  /** "6 transaksi = 40% dari pengeluaran"; `null` without expenses. */
  readonly largestShareBps: number | null;
  readonly subscriptions: ReportSubscriptionLine;
  readonly days: readonly ReportDayLine[];
  readonly averageDailyMinor: bigint;
  readonly busiestWeek: BusiestWeek | null;
  /** `null` when no account balance or portfolio value could be valued. */
  readonly netWorth: ReportNetWorth | null;
}

export interface ReportRangeLabel {
  /** A neutral, locale-free label: `2026-09`, `2026-Q3`, `2026`, `2026-10-01/2026-10-15`. */
  readonly label: string;
  readonly range: { readonly from: LocalDate; readonly to: LocalDate };
}

export interface ReportView {
  readonly id: string;
  readonly kind: ReportKind;
  readonly status: ReportStatus;
  /** The period of a monthly report. */
  readonly periodId: string | null;
  readonly label: string;
  readonly range: { readonly from: LocalDate; readonly to: LocalDate };
  readonly compare: ReportRangeLabel | null;
  readonly totals: ReportTotals;
  readonly previous: ReportTotals | null;
  readonly delta: TotalsDelta | null;
  readonly sections: ReportSections;
  readonly generatedAt: Date;
}

export interface ReportSummary {
  readonly id: string;
  readonly kind: ReportKind;
  readonly status: ReportStatus;
  readonly label: string;
  readonly range: { readonly from: LocalDate; readonly to: LocalDate };
  readonly totals: ReportTotals;
}

export type ReportRequest =
  | { readonly kind: 'monthly'; readonly periodId: string }
  | { readonly kind: 'quarterly'; readonly year: number; readonly quarter: 1 | 2 | 3 | 4 }
  | { readonly kind: 'yearly'; readonly year: number }
  | { readonly kind: 'custom'; readonly from: LocalDate; readonly to: LocalDate };

export interface ReportsRepository {
  /**
   * The report of a closed period, generated on first use and returned as stored afterwards (final reports are
   * immutable). `now` decides whether a range is still provisional.
   * @throws {LedgerError} `NOT_FOUND`, `INVALID_PERIOD` (not closed, bad range)
   */
  generate: (userId: string, request: ReportRequest, now: Date) => Promise<ReportView>;
  /** Newest first. */
  list: (userId: string, options?: { readonly limit?: number }) => Promise<ReportSummary[]>;
  get: (userId: string, id: string) => Promise<ReportView>;
  /** The newest final monthly report ("Laporan final tersedia s.d. Sep 2026"). */
  latestFinal: (userId: string) => Promise<ReportView | null>;
  /** Closed periods that have no monthly report yet, oldest first (the worker's `reports` job). */
  pendingMonthly: (userId: string) => Promise<{ readonly id: string; readonly label: string }[]>;
}

const MAX_CUSTOM_DAYS = 366;
const MONTHS_ID = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'] as const;
const MERCHANT_LIMIT = 8;
const TAG_LIMIT = 8;
const LARGEST_LIMIT = 6;

const toJson = (value: unknown): JsonValue => value as JsonValue;
const str = (value: bigint): JsonValue => value.toString();

/** Money in a `jsonb` column is a decimal string (json has no bigint). */
const big = (value: JsonValue, field: string): bigint => {
  if (typeof value !== 'string') throw new LedgerError('INVALID_REPORT', `${field} is not a string`);
  return BigInt(value);
};

const nullableBig = (value: JsonValue): bigint | null => (value === null ? null : big(value, 'amount'));

const optionalBig = (value: JsonValue | undefined): bigint | null => (value === undefined || value === null ? null : big(value, 'amount'));

function encodeSections(sections: ReportSections): JsonObject {
  return toJson({
    categories: sections.categories.map((line) => ({
      categoryId: line.categoryId,
      name: line.name,
      spentMinor: str(line.spentMinor),
      shareBps: line.shareBps,
      limitMinor: line.limitMinor === null ? null : str(line.limitMinor),
      usedBps: line.usedBps,
      overMinor: str(line.overMinor),
    })),
    merchants: sections.merchants.map((line) => ({
      merchant: line.merchant,
      totalMinor: str(line.totalMinor),
      count: line.count,
      shareBps: line.shareBps,
    })),
    tags: sections.tags.map((line) => ({
      tagId: line.tagId,
      name: line.name,
      totalMinor: str(line.totalMinor),
      count: line.count,
    })),
    accounts: sections.accounts.map((line) => ({
      accountId: line.accountId,
      name: line.name,
      type: line.type,
      inMinor: str(line.inMinor),
      outMinor: str(line.outMinor),
    })),
    goals: sections.goals.map((line) => ({
      goalId: line.goalId,
      name: line.name,
      savedMinor: str(line.savedMinor),
      targetMinor: str(line.targetMinor),
      progressBps: line.progressBps,
    })),
    largest: sections.largest.map((line) => ({
      transactionId: line.transactionId,
      date: line.date,
      description: line.description,
      merchant: line.merchant,
      amountMinor: str(line.amountMinor),
      shareBps: line.shareBps,
    })),
    largestShareBps: sections.largestShareBps,
    subscriptions: {
      active: sections.subscriptions.active,
      monthlyMinor: str(sections.subscriptions.monthlyMinor),
      yearlyMinor: str(sections.subscriptions.yearlyMinor),
      shareBps: sections.subscriptions.shareBps,
      unconverted: sections.subscriptions.unconverted,
    },
    days: sections.days.map((day) => ({ date: day.date, outMinor: str(day.outMinor) })),
    averageDailyMinor: str(sections.averageDailyMinor),
    busiestWeek:
      sections.busiestWeek === null
        ? null
        : {
            from: sections.busiestWeek.from,
            to: sections.busiestWeek.to,
            totalMinor: str(sections.busiestWeek.totalMinor),
          },
    netWorth:
      sections.netWorth === null
        ? null
        : {
            valueMinor: str(sections.netWorth.valueMinor),
            cashMinor: str(sections.netWorth.cashMinor),
            investmentsMinor: str(sections.netWorth.investmentsMinor),
            unvaluedCurrencies: [...sections.netWorth.unvaluedCurrencies],
            asOf: sections.netWorth.asOf,
          },
  }) as JsonObject;
}

function decodeSections(raw: JsonObject): ReportSections {
  const data = raw as unknown as {
    categories: { categoryId: string | null; name: string | null; spentMinor: JsonValue; shareBps: number; limitMinor: JsonValue; usedBps: number | null; overMinor: JsonValue }[];
    merchants: { merchant: string; totalMinor: JsonValue; count: number; shareBps: number }[];
    tags: { tagId: string; name: string; totalMinor: JsonValue; count: number }[];
    accounts: { accountId: string; name: string; type: AccountType; inMinor: JsonValue; outMinor: JsonValue }[];
    goals: { goalId: string; name: string; savedMinor: JsonValue; targetMinor: JsonValue; progressBps: number }[];
    largest: { transactionId: string; date: LocalDate; description: string; merchant: string | null; amountMinor: JsonValue; shareBps: number }[];
    largestShareBps: number | null;
    subscriptions: { active: number; monthlyMinor: JsonValue; yearlyMinor: JsonValue; shareBps: number | null; unconverted: number };
    days: { date: LocalDate; outMinor: JsonValue }[];
    averageDailyMinor: JsonValue;
    busiestWeek: { from: LocalDate; to: LocalDate; totalMinor: JsonValue } | null;
    netWorth: {
      valueMinor: JsonValue;
      cashMinor: JsonValue;
      investmentsMinor: JsonValue;
      unvaluedCurrencies: string[];
      asOf: LocalDate;
    } | null;
  };
  return {
    categories: data.categories.map((line) => ({
      categoryId: line.categoryId,
      name: line.name,
      spentMinor: big(line.spentMinor, 'spentMinor'),
      shareBps: line.shareBps,
      limitMinor: nullableBig(line.limitMinor),
      usedBps: line.usedBps,
      overMinor: big(line.overMinor, 'overMinor'),
    })),
    merchants: data.merchants.map((line) => ({
      merchant: line.merchant,
      totalMinor: big(line.totalMinor, 'totalMinor'),
      count: line.count,
      shareBps: line.shareBps,
    })),
    tags: data.tags.map((line) => ({
      tagId: line.tagId,
      name: line.name,
      totalMinor: big(line.totalMinor, 'totalMinor'),
      count: line.count,
    })),
    accounts: data.accounts.map((line) => ({
      accountId: line.accountId,
      name: line.name,
      type: line.type,
      inMinor: big(line.inMinor, 'inMinor'),
      outMinor: big(line.outMinor, 'outMinor'),
    })),
    goals: data.goals.map((line) => ({
      goalId: line.goalId,
      name: line.name,
      savedMinor: big(line.savedMinor, 'savedMinor'),
      targetMinor: big(line.targetMinor, 'targetMinor'),
      progressBps: line.progressBps,
    })),
    largest: data.largest.map((line) => ({
      transactionId: line.transactionId,
      date: line.date,
      description: line.description,
      merchant: line.merchant,
      amountMinor: big(line.amountMinor, 'amountMinor'),
      shareBps: line.shareBps,
    })),
    largestShareBps: data.largestShareBps,
    subscriptions: {
      active: data.subscriptions.active,
      monthlyMinor: big(data.subscriptions.monthlyMinor, 'monthlyMinor'),
      yearlyMinor: big(data.subscriptions.yearlyMinor, 'yearlyMinor'),
      shareBps: data.subscriptions.shareBps,
      unconverted: data.subscriptions.unconverted,
    },
    days: data.days.map((day) => ({ date: day.date, outMinor: big(day.outMinor, 'outMinor') })),
    averageDailyMinor: big(data.averageDailyMinor, 'averageDailyMinor'),
    busiestWeek:
      data.busiestWeek === null
        ? null
        : { from: data.busiestWeek.from, to: data.busiestWeek.to, totalMinor: big(data.busiestWeek.totalMinor, 'totalMinor') },
    netWorth:
      data.netWorth === null
        ? null
        : {
            valueMinor: big(data.netWorth.valueMinor, 'valueMinor'),
            cashMinor: big(data.netWorth.cashMinor, 'cashMinor'),
            investmentsMinor: big(data.netWorth.investmentsMinor, 'investmentsMinor'),
            unvaluedCurrencies: data.netWorth.unvaluedCurrencies,
            asOf: data.netWorth.asOf,
          },
  };
}

/** The stored row as the view the API returns. */
function viewOf(row: typeof reports.$inferSelect): ReportView {
  const totals = reportTotals({
    incomeMinor: row.incomeMinor,
    expenseMinor: row.expenseMinor,
    txCount: row.txCount,
    netWorthMinor: row.netWorthMinor,
  });
  const previous =
    row.previous === null
      ? null
      : reportTotals({
          incomeMinor: big((row.previous as JsonObject)['incomeMinor'] as JsonValue, 'incomeMinor'),
          expenseMinor: big((row.previous as JsonObject)['expenseMinor'] as JsonValue, 'expenseMinor'),
          txCount: Number((row.previous as JsonObject)['txCount'] as JsonValue),
          netWorthMinor: optionalBig((row.previous as JsonObject)['netWorthMinor']),
        });
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    periodId: row.periodId,
    label: row.label,
    range: { from: row.rangeStart, to: row.rangeEnd },
    compare:
      row.compareStart === null || row.compareEnd === null
        ? null
        : { label: row.compareLabel ?? `${row.compareStart}/${row.compareEnd}`, range: { from: row.compareStart, to: row.compareEnd } },
    totals,
    previous,
    delta: totalsDelta(totals, previous),
    sections: decodeSections(row.sections),
    generatedAt: row.generatedAt,
  };
}

const summaryOf = (row: typeof reports.$inferSelect): ReportSummary => ({
  id: row.id,
  kind: row.kind,
  status: row.status,
  label: row.label,
  range: { from: row.rangeStart, to: row.rangeEnd },
  totals: reportTotals({
    incomeMinor: row.incomeMinor,
    expenseMinor: row.expenseMinor,
    txCount: row.txCount,
    netWorthMinor: row.netWorthMinor,
  }),
});

/** The user's local date for `at` (periods are local; a monthly report's status is about its own time zone). */
function localToday(at: Date, timeZone: string): LocalDate {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    at,
  ) as LocalDate;
}

/** The base-currency calendar date of `at`; ranges are not tied to a user's time zone. */
function baseToday(at: Date): LocalDate {
  return new Date(at.getTime() + 7 * 3_600_000).toISOString().slice(0, 10) as LocalDate;
}

export function createReports(
  db: Database,
  options: { readonly getDek: (userId: string) => Promise<Dek>; readonly now?: () => Date },
): ReportsRepository {
  const now = options.now ?? (() => new Date());
  const goalsRepo = createGoals(db, { getDek: options.getDek, now });

  return {
    generate: async (userId, request, at) => {
      const resolved = await resolve(userId, request, at);
      // Goal progress lives in the goals repository (accounts and asset shares); it is read once, before the report's
      // own transaction, so nothing nests a user transaction inside another.
      const goalValues = await goalsRepo.list(userId);
      const row = await withUser(db, userId, async (tx) => {
        const existing = await findIn(tx, userId, resolved.kind, resolved.range);
        if (existing !== null) return existing;
        const totals = await totalsIn(tx, userId, resolved.range);
        const sections = await sectionsIn(tx, userId, resolved.range, resolved.period, totals, at, goalValues);
        const compare = await compareIn(tx, userId, resolved, at);
        const [inserted] = await tx
          .insert(reports)
          .values({
            userId,
            kind: resolved.kind,
            status: resolved.status,
            periodId: resolved.period?.id ?? null,
            label: resolved.label,
            rangeStart: resolved.range.from,
            rangeEnd: resolved.range.to,
            compareStart: compare?.range.from ?? null,
            compareEnd: compare?.range.to ?? null,
            compareLabel: compare?.label ?? null,
            txCount: totals.txCount,
            incomeMinor: totals.incomeMinor,
            expenseMinor: totals.expenseMinor,
            savedMinor: totals.savedMinor,
            savingRateBps: totals.savingRateBps,
            netWorthMinor: totals.netWorthMinor,
            previous:
              compare === null
                ? null
                : (toJson({
                    incomeMinor: compare.totals.incomeMinor.toString(),
                    expenseMinor: compare.totals.expenseMinor.toString(),
                    txCount: compare.totals.txCount,
                    netWorthMinor: compare.totals.netWorthMinor === null ? null : compare.totals.netWorthMinor.toString(),
                  }) as JsonObject),
            sections: encodeSections(sections),
            generatedAt: at,
          })
          // Two generations racing: the first row wins and stays (a stored report is immutable).
          .onConflictDoNothing()
          .returning();
        if (inserted !== undefined) return inserted;
        const winner = await findIn(tx, userId, resolved.kind, resolved.range);
        if (winner === null) throw new LedgerError('NOT_FOUND', 'The report could not be stored');
        return winner;
      });
      return viewOf(row);
    },

    list: (userId, { limit = 24 } = {}) =>
      withUser(db, userId, async (tx) => {
        const rows = await tx
          .select()
          .from(reports)
          .orderBy(desc(reports.rangeEnd), desc(reports.generatedAt))
          .limit(Math.min(Math.max(limit, 1), 100));
        return rows.map(summaryOf);
      }),

    get: (userId, id) =>
      withUser(db, userId, async (tx) => {
        const [row] = await tx.select().from(reports).where(eq(reports.id, id)).limit(1);
        if (row === undefined) throw new LedgerError('NOT_FOUND', 'No such report');
        return viewOf(row);
      }),

    pendingMonthly: (userId) =>
      withUser(db, userId, async (tx) => {
        const rows = await tx
          .select({ id: periods.id, label: periods.label })
          .from(periods)
          .where(
            and(
              eq(periods.status, 'closed'),
              sql`not exists (select 1 from ${reports} where ${reports.periodId} = ${periods.id} and ${reports.kind} = 'monthly')`,
            ),
          )
          .orderBy(asc(periods.startDate));
        return rows;
      }),

    latestFinal: (userId) =>
      withUser(db, userId, async (tx) => {
        const [row] = await tx
          .select()
          .from(reports)
          .where(and(eq(reports.kind, 'monthly'), eq(reports.status, 'final')))
          .orderBy(desc(reports.rangeEnd))
          .limit(1);
        return row === undefined ? null : viewOf(row);
      }),
  };

  /** The kind, range, label, and status of a request; a monthly report needs its closed period. */
  async function resolve(
    userId: string,
    request: ReportRequest,
    at: Date,
  ): Promise<{
    readonly kind: ReportKind;
    readonly range: { readonly from: LocalDate; readonly to: LocalDate };
    readonly label: string;
    readonly status: ReportStatus;
    readonly period: PeriodView | null;
  }> {
    if (request.kind === 'monthly') {
      const period = await withUser(db, userId, (tx) => periodIn(tx, request.periodId));
      if (period.status !== 'closed') throw new LedgerError('INVALID_PERIOD', 'The period is still open');
      const range = { from: period.start, to: period.end };
      return { kind: 'monthly', range, label: period.label, status: statusOf(range, baseToday(at)), period };
    }
    if (request.kind === 'quarterly') {
      const range = quarterRange(request.year, request.quarter);
      return { kind: 'quarterly', range, label: `${request.year}-Q${String(request.quarter)}`, status: statusOf(range, baseToday(at)), period: null };
    }
    if (request.kind === 'yearly') {
      const range = yearRange(request.year);
      return { kind: 'yearly', range, label: String(request.year), status: statusOf(range, baseToday(at)), period: null };
    }
    if (request.from > request.to) throw new LedgerError('INVALID_PERIOD', 'The range starts after it ends');
    if (countDays(request.from, request.to) > MAX_CUSTOM_DAYS) {
      throw new LedgerError('INVALID_PERIOD', 'The range is longer than a year');
    }
    const range = { from: request.from, to: request.to };
    return { kind: 'custom', range, label: `${range.from}/${range.to}`, status: statusOf(range, baseToday(at)), period: null };
  }

  /** The stored row of the same kind and range, if any. */
  async function findIn(
    tx: Transaction,
    userId: string,
    kind: ReportKind,
    range: { readonly from: LocalDate; readonly to: LocalDate },
  ): Promise<typeof reports.$inferSelect | null> {
    const [row] = await tx
      .select()
      .from(reports)
      .where(and(eq(reports.userId, userId), eq(reports.kind, kind), eq(reports.rangeStart, range.from), eq(reports.rangeEnd, range.to)))
      .limit(1);
    return row ?? null;
  }

  /** The compared range: the period before a monthly report, or the same number of days before any other range. */
  async function compareIn(
    tx: Transaction,
    userId: string,
    resolved: { readonly range: { readonly from: LocalDate; readonly to: LocalDate }; readonly period: PeriodView | null },
    at: Date,
  ): Promise<{ readonly range: { readonly from: LocalDate; readonly to: LocalDate }; readonly label: string; readonly totals: ReportTotals } | null> {
    let range = previousRange(resolved.range);
    let label = `${range.from}/${range.to}`;
    if (resolved.period !== null) {
      const [previous] = await tx
        .select({ start: periods.startDate, end: periods.endDate, label: periods.label })
        .from(periods)
        .where(and(eq(periods.userId, userId), lt(periods.endDate, resolved.period.start)))
        .orderBy(desc(periods.endDate))
        .limit(1);
      if (previous !== undefined) {
        range = { from: previous.start, to: previous.end };
        label = previous.label;
      }
    }
    const totals = await totalsIn(tx, userId, range);
    return totals.txCount === 0 && totals.incomeMinor === 0n && totals.expenseMinor === 0n ? null : { range, label, totals };
  }

  /** Flows, count, and net worth of a range. */
  async function totalsIn(
    tx: Transaction,
    userId: string,
    range: { readonly from: LocalDate; readonly to: LocalDate },
  ): Promise<ReportTotals> {
    const days = await dayTotalsIn(tx, userId, { from: range.from, to: range.to });
    const netWorth = await netWorthIn(tx, userId, range.to);
    return reportTotals({
      incomeMinor: days.reduce((total, day) => total + day.inMinor, 0n),
      expenseMinor: days.reduce((total, day) => total + day.outMinor, 0n),
      txCount: days.reduce((total, day) => total + day.count, 0),
      netWorthMinor: netWorth?.valueMinor ?? null,
    });
  }

  /**
   * Cash balances at `to` plus the portfolio's last value on or before it. A foreign balance without a reference rate
   * at that date is left out and named, never converted with a later rate.
   */
  async function netWorthIn(tx: Transaction, userId: string, to: LocalDate): Promise<ReportNetWorth | null> {
    const [user] = await tx.select({ base: users.baseCurrency }).from(users).where(eq(users.id, userId)).limit(1);
    if (user === undefined) return null;
    const rows = await tx
      .select({ id: accounts.id, currency: accounts.currency, openingMinor: accounts.openingBalanceMinor })
      .from(accounts)
      .orderBy(asc(accounts.sortOrder), asc(accounts.createdAt));
    const balances = await tx
      .select({ accountId: postings.accountId, amountMinor: sql<string>`sum(${postings.amountMinor})` })
      .from(postings)
      .innerJoin(transactions, eq(transactions.id, postings.transactionId))
      .where(and(isNull(transactions.deletedAt), lte(sql`${transactions.occurredAt}::date`, to)))
      .groupBy(postings.accountId);
    const adjustments = await tx
      .select({ accountId: balanceAdjustments.accountId, amountMinor: sql<string>`sum(${balanceAdjustments.amountMinor})` })
      .from(balanceAdjustments)
      .groupBy(balanceAdjustments.accountId);
    const rates = await tx
      .select({ base: fxRates.base, rate: fxRates.rate, asOf: fxRates.asOf })
      .from(fxRates)
      .where(and(eq(fxRates.quote, user.base), lte(fxRates.asOf, to)))
      .orderBy(asc(fxRates.asOf));
    const rateOf = new Map<string, bigint>();
    for (const rate of rates) rateOf.set(rate.base, rateMinor(rate.rate));
    const paidIn = new Map(balances.map((row) => [row.accountId, BigInt(row.amountMinor)]));
    const adjusted = new Map(adjustments.map((row) => [row.accountId, BigInt(row.amountMinor)]));
    let cashMinor = 0n;
    const unvalued = new Set<string>();
    for (const account of rows) {
      const own = account.openingMinor + (paidIn.get(account.id) ?? 0n) + (adjusted.get(account.id) ?? 0n);
      if (account.currency === user.base) {
        cashMinor += own;
        continue;
      }
      const rate = rateOf.get(account.currency);
      if (rate === undefined) {
        unvalued.add(account.currency);
        continue;
      }
      cashMinor += (own * rate) / 100n;
    }
    const [snapshot] = await tx
      .select({ value: portfolioSnapshots.valueBaseMinor, date: portfolioSnapshots.snapshotDate })
      .from(portfolioSnapshots)
      .where(lte(portfolioSnapshots.snapshotDate, to))
      .orderBy(desc(portfolioSnapshots.snapshotDate))
      .limit(1);
    if (cashMinor === 0n && snapshot === undefined) return null;
    return {
      valueMinor: cashMinor + (snapshot?.value ?? 0n),
      cashMinor,
      investmentsMinor: snapshot?.value ?? 0n,
      unvaluedCurrencies: [...unvalued].sort(),
      asOf: snapshot?.date ?? to,
    };
  }

  /** The spending lines of the report. */
  async function sectionsIn(
    tx: Transaction,
    userId: string,
    range: { readonly from: LocalDate; readonly to: LocalDate },
    period: PeriodView | null,
    totals: ReportTotals,
    at: Date,
    goalValues: readonly GoalView[],
  ): Promise<ReportSections> {
    const categoryTotals = await categoryTotalsIn(tx, userId, { from: range.from, to: range.to });
    const expense = categoryTotals.filter((line) => line.kind === 'expense');
    const names = new Map((await tx.select({ id: categories.id, name: categories.name }).from(categories)).map((row) => [row.id, row.name]));
    const limits = new Map(
      (period === null ? [] : (await budgetStatusIn(tx, userId, period, at)).lines).map((line) => [line.categoryId, line]),
    );
    const shares = shareLines(
      expense.map((line) => ({ key: line.categoryId, totalMinor: line.totalMinor })),
      totals.expenseMinor,
    );
    const categoriesLines: ReportCategoryLine[] = expense.map((line, index) => {
      const limit = line.categoryId === null ? undefined : limits.get(line.categoryId);
      return {
        categoryId: line.categoryId,
        name: line.categoryId === null ? null : (names.get(line.categoryId) ?? null),
        spentMinor: line.totalMinor,
        shareBps: shares[index]?.shareBps ?? 0,
        limitMinor: limit?.limitMinor ?? null,
        usedBps: limit?.usedBps ?? null,
        overMinor: limit !== undefined && limit.spentMinor > limit.limitMinor ? limit.spentMinor - limit.limitMinor : 0n,
      };
    });

    const merchantRows = await tx
      .select({
        merchant: sql<string>`coalesce(nullif(btrim(${transactions.merchant}), ''), nullif(btrim(${transactions.description}), ''), '')`,
        totalMinor: sql<string>`sum(abs(${postings.amountBaseMinor}))`,
        count: sql<number>`count(distinct ${transactions.id})::int`,
      })
      .from(postings)
      .innerJoin(transactions, eq(transactions.id, postings.transactionId))
      .where(
        and(isNull(transactions.deletedAt), gte(sql`${transactions.occurredAt}::date`, range.from), lte(sql`${transactions.occurredAt}::date`, range.to), isOut),
      )
      .groupBy(sql`1`)
      .orderBy(desc(sql`sum(abs(${postings.amountBaseMinor}))`))
      .limit(MERCHANT_LIMIT);
    const merchantShares = shareLines(
      merchantRows.map((row) => ({ key: row.merchant, totalMinor: BigInt(row.totalMinor) })),
      totals.expenseMinor,
    );
    const merchants: ReportMerchantLine[] = merchantRows.map((row, index) => ({
      merchant: row.merchant,
      totalMinor: BigInt(row.totalMinor),
      count: row.count,
      shareBps: merchantShares[index]?.shareBps ?? 0,
    }));

    const tagRows = await tx
      .select({
        tagId: tags.id,
        name: tags.slug,
        totalMinor: sql<string>`sum(abs(${postings.amountBaseMinor}))`,
        count: sql<number>`count(distinct ${transactions.id})::int`,
      })
      .from(transactionTags)
      .innerJoin(transactions, eq(transactions.id, transactionTags.transactionId))
      .innerJoin(tags, eq(tags.id, transactionTags.tagId))
      .innerJoin(postings, eq(postings.transactionId, transactions.id))
      .where(
        and(isNull(transactions.deletedAt), gte(sql`${transactions.occurredAt}::date`, range.from), lte(sql`${transactions.occurredAt}::date`, range.to), isOut),
      )
      .groupBy(tags.id, tags.slug)
      .orderBy(desc(sql`sum(abs(${postings.amountBaseMinor}))`))
      .limit(TAG_LIMIT);
    const tagLines: ReportTagLine[] = tagRows.map((row) => ({
      tagId: row.tagId,
      name: row.name,
      totalMinor: BigInt(row.totalMinor),
      count: row.count,
    }));

    const accountRows = await tx
      .select({
        accountId: postings.accountId,
        name: accounts.displayName,
        type: accounts.type,
        inMinor: sql<string>`coalesce(sum(${postings.amountBaseMinor}) filter (where ${transactions.type} = 'income' and ${postings.role} = 'principal'), 0)`,
        outMinor: sql<string>`coalesce(sum(abs(${postings.amountBaseMinor})) filter (where ${transactions.type} in ('expense', 'writeoff') and ${postings.role} = 'principal'), 0)`,
      })
      .from(postings)
      .innerJoin(transactions, eq(transactions.id, postings.transactionId))
      .innerJoin(accounts, eq(accounts.id, postings.accountId))
      .where(and(isNull(transactions.deletedAt), gte(sql`${transactions.occurredAt}::date`, range.from), lte(sql`${transactions.occurredAt}::date`, range.to)))
      .groupBy(postings.accountId, accounts.displayName, accounts.type)
      .orderBy(asc(accounts.displayName));
    const accountLines: ReportAccountLine[] = accountRows.map((row) => ({
      accountId: row.accountId,
      name: row.name,
      type: row.type,
      inMinor: BigInt(row.inMinor),
      outMinor: BigInt(row.outMinor),
    }));

    const goalLines: ReportGoalLine[] = goalValues
      .filter((goal) => goal.archivedAt === null)
      .map((goal) => ({
        goalId: goal.id,
        name: goal.name,
        savedMinor: goal.savedMinor,
        targetMinor: goal.targetMinor,
        progressBps: goal.targetMinor > 0n ? Number((goal.savedMinor * 10_000n) / goal.targetMinor) : 0,
      }));

    const largestRows = await tx
      .select({
        id: transactions.id,
        date: sql<LocalDate>`${transactions.occurredAt}::date`,
        description: transactions.description,
        merchant: transactions.merchant,
        amountMinor: sql<string>`abs(${postings.amountBaseMinor})`,
      })
      .from(postings)
      .innerJoin(transactions, eq(transactions.id, postings.transactionId))
      .where(
        and(isNull(transactions.deletedAt), gte(sql`${transactions.occurredAt}::date`, range.from), lte(sql`${transactions.occurredAt}::date`, range.to), isOut),
      )
      .orderBy(desc(sql`abs(${postings.amountBaseMinor})`), asc(transactions.occurredAt))
      .limit(LARGEST_LIMIT);
    const largestShares = shareLines(
      largestRows.map((row) => ({ key: row.id, totalMinor: BigInt(row.amountMinor) })),
      totals.expenseMinor,
    );
    const largest: ReportLargestLine[] = largestRows.map((row, index) => ({
      transactionId: row.id,
      date: row.date,
      description: row.description ?? row.merchant ?? '',
      merchant: row.merchant,
      amountMinor: BigInt(row.amountMinor),
      shareBps: largestShares[index]?.shareBps ?? 0,
    }));

    const baseCurrency = (await tx.select({ currency: users.baseCurrency }).from(users).where(eq(users.id, userId)))[0]?.currency;
    const subscriptionRows = await tx
      .select({ priceMinor: subscriptions.priceMinor, currency: subscriptions.currency, cycle: subscriptions.cycle })
      .from(subscriptions)
      .where(eq(subscriptions.status, 'active'));
    let monthlyMinor = 0n;
    let unconverted = 0;
    for (const row of subscriptionRows) {
      if (row.currency !== baseCurrency) {
        unconverted += 1;
        continue;
      }
      monthlyMinor += row.cycle === 'yearly' ? row.priceMinor / 12n : row.cycle === 'weekly' ? (row.priceMinor * 52n) / 12n : row.priceMinor;
    }
    const subscriptionSection: ReportSubscriptionLine = {
      active: subscriptionRows.length,
      monthlyMinor,
      yearlyMinor: monthlyMinor * 12n,
      shareBps: totals.expenseMinor > 0n ? Number((monthlyMinor * 10_000n) / totals.expenseMinor) : null,
      unconverted,
    };

    const days: ReportDayLine[] = (await dayTotalsIn(tx, userId, { from: range.from, to: range.to }))
      .map((day) => ({ date: day.date, outMinor: day.outMinor }))
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const netWorth = await netWorthIn(tx, userId, range.to);

    return {
      categories: categoriesLines,
      merchants,
      tags: tagLines,
      accounts: accountLines,
      goals: goalLines,
      largest,
      largestShareBps: topShareBps(largest, LARGEST_LIMIT, totals.expenseMinor),
      subscriptions: subscriptionSection,
      days,
      averageDailyMinor: dailyAverageMinor(totals.expenseMinor, range),
      busiestWeek: busiestWeek(days),
      netWorth,
    };
  }
}

/** `16350.00000000` → 16350 (the rate's whole units; the reference rates have no more precision than that). */
function rateMinor(rate: string): bigint {
  return BigInt(rate.split('.')[0] as string);
}
