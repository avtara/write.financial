// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Reports (FR-LP1–LP5). A report is a stored snapshot of a range: the KPIs with their comparison, the savings rate,
 * the spending lines (categories against their budget, merchants, tags, accounts), goals, the largest transactions,
 * subscriptions, the daily series, and net worth at the range end. Closed monthly reports are final and never
 * rewritten. Quarterly/yearly/custom reports always remain provisional (D10): full closed periods reuse their
 * final monthly snapshots, while only partial boundaries and the current period read the live ledger.
 *
 * Net worth counts non-platform balances at the cutoff (opening + local-date postings + dated corrections), plus
 * the last portfolio snapshot (platform cash included once), less outstanding non-card principal. Card liabilities
 * are already reflected in their account balances. Missing historical FX or portfolio data makes the KPI unavailable.
 */
import type { GoalValuation } from '@wf/domain/goals';
import type { CategoryGroup } from '@wf/domain/categories';
import { convert } from '@wf/domain/fx';
import type { AccountType } from '@wf/domain/ledger';
import { addDays, addMonths, countDays, type LocalDate } from '@wf/domain/period';
import {
  busiestWeek,
  dailyAverageMinor,
  previousRange,
  quarterRange,
  reportTotals,
  shareLines,
  progressBps,
  type ShareLine,
  topShareBps,
  totalsDelta,
  yearRange,
  type BusiestWeek,
  type ReportKind,
  type ReportStatus,
  type ReportTotals,
  type TotalsDelta,
} from '@wf/domain/report';
import { activeOn, subscriptionTotals, type PricedSubscription } from '@wf/domain/subscriptions';
import { and, asc, desc, eq, gte, isNull, lt, lte, sql } from 'drizzle-orm';
import { firstRow, withUser, type Database, type Transaction } from './db.ts';
import { budgetStatusIn } from './budgets.ts';
import { goalSnapshotIn } from './goal-snapshots.ts';
import { referenceRateIn, type ReferenceRate } from './fx-rates.ts';
import { localDateOf, userContextIn } from './ledger-core.ts';
import { LedgerError } from './ledger-errors.ts';
import { periodIn, type PeriodView } from './periods.ts';
import { aggregateReports, type ReportSegment } from './report-aggregation.ts';
import {
  accounts,
  balanceAdjustments,
  categories,
  debtInstallments,
  debts,
  investmentTrades,
  periods,
  portfolioSnapshots,
  postings,
  reports,
  subscriptions,
  tags,
  transactionTags,
  transactions,
} from './schema.ts';
import { categoryTotalsIn, dayTotalsIn, isOut } from './transaction-query.ts';
import type { JsonObject, JsonValue } from './schema.ts';

/** FR-LP1 categories: spent against the budget line of the period ("Belanja Online 2.600.000/2.000.000"). */
export interface ReportCategoryLine {
  readonly categoryId: string | null;
  readonly name: string | null;
  readonly group: CategoryGroup | null;
  readonly isFixed: boolean | null;
  readonly spentMinor: bigint;
  readonly shareBps: number;
  readonly limitMinor: bigint | null;
  readonly usedBps: number | null;
  /** "lewat Rp600.000" when over the limit. */
  readonly overMinor: bigint;
}

/** Named income sources retained in the final snapshot for the money-flow source table. */
export interface ReportIncomeLine {
  readonly categoryId: string | null;
  readonly name: string | null;
  readonly group: CategoryGroup | null;
  readonly totalMinor: bigint;
  readonly shareBps: number;
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
  readonly currency: string;
  readonly valuation: GoalValuation;
  readonly savedMinor: bigint | null;
  /** Unknown unless an actual snapshot covers the day immediately before the range. */
  readonly openingMinor: bigint | null;
  readonly targetMinor: bigint;
  readonly progressBps: number | null;
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
  /** Same monthly normalization as Subscriptions; foreign prices use an exact historical reference rate. */
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
  /** Non-card principal still owed; card balances are already included in cash. */
  readonly debtMinor: bigint;
  /** Existing platform cash or holdings without any historical portfolio snapshot. */
  readonly missingPortfolio: boolean;
  /** Currencies left out because no reference rate covered the range end. */
  readonly unvaluedCurrencies: string[];
  readonly asOf: LocalDate;
}

type EncodedNetWorth = Omit<ReportNetWorth, 'valueMinor' | 'cashMinor' | 'investmentsMinor' | 'debtMinor'> & {
  valueMinor: string;
  cashMinor: string;
  investmentsMinor: string;
  debtMinor: string;
};

function encodeNetWorth(value: ReportNetWorth | null): EncodedNetWorth | null {
  return value === null
    ? null
    : {
        ...value,
        valueMinor: value.valueMinor.toString(),
        cashMinor: value.cashMinor.toString(),
        investmentsMinor: value.investmentsMinor.toString(),
        debtMinor: value.debtMinor.toString(),
      };
}

function decodeNetWorth(value: EncodedNetWorth | null): ReportNetWorth | null {
  return value === null
    ? null
    : {
        ...value,
        valueMinor: BigInt(value.valueMinor),
        cashMinor: BigInt(value.cashMinor),
        investmentsMinor: BigInt(value.investmentsMinor),
        debtMinor: BigInt(value.debtMinor),
      };
}

/** Partial valuations are available for explanation but must never be presented as a complete KPI. */
function completeNetWorth(value: ReportNetWorth | null): bigint | null {
  return value === null || value.missingPortfolio || value.unvaluedCurrencies.length > 0 ? null : value.valueMinor;
}

export interface ReportDayLine {
  readonly date: LocalDate;
  readonly outMinor: bigint;
}

export interface ReportSections {
  readonly categories: readonly ReportCategoryLine[];
  readonly incomeSources: readonly ReportIncomeLine[];
  readonly merchants: readonly ReportMerchantLine[];
  readonly tags: readonly ReportTagLine[];
  readonly accounts: readonly ReportAccountLine[];
  readonly goals: readonly ReportGoalLine[];
  /** Null means no historical observation, not an empty goal list. A stale observation keeps its actual date. */
  readonly goalsAsOf: LocalDate | null;
  readonly largest: readonly ReportLargestLine[];
  /** "6 transaksi = 40% dari pengeluaran"; `null` without expenses. */
  readonly largestShareBps: number | null;
  readonly subscriptions: ReportSubscriptionLine;
  readonly days: readonly ReportDayLine[];
  readonly averageDailyMinor: bigint;
  readonly busiestWeek: BusiestWeek | null;
  /** `null` when no account balance or portfolio value could be valued. */
  readonly netWorth: ReportNetWorth | null;
  /** Six month-ends ending at the report cutoff; unknown history remains null, never an invented zero. */
  readonly netWorthHistory: readonly { readonly date: LocalDate; readonly valuation: ReportNetWorth | null }[];
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
  /** The closed period a monthly report is a snapshot of; `null` for the other kinds. */
  readonly periodId: string | null;
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
   * Closed monthly reports are generated once and returned unchanged. Other kinds refresh their stored range from
   * final monthly snapshots plus live boundary segments; `now` bounds them to the user's local today.
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
const LARGEST_LIMIT = 6;

const toJson = (value: unknown): JsonValue => value as JsonValue;
const str = (value: bigint): JsonValue => value.toString();

/** Money in a `jsonb` column is a decimal string (json has no bigint). */
const big = (value: JsonValue): bigint => BigInt(value as string);

const nullableBig = (value: JsonValue | undefined): bigint | null => (value == null ? null : big(value));

/** A field `encodeSections` always writes; its absence means the stored row is corrupt. */
const required = (object: JsonObject, key: string): JsonValue => {
  const value = object[key];
  if (value === undefined) throw new TypeError(`Corrupt report row: missing ${key}`);
  return value;
};

function encodeSections(sections: ReportSections): JsonObject {
  return toJson({
    incomeSources: sections.incomeSources.map((line) => ({ ...line, totalMinor: str(line.totalMinor) })),
    categories: sections.categories.map((line) => ({
      categoryId: line.categoryId,
      name: line.name,
      group: line.group,
      isFixed: line.isFixed,
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
      currency: line.currency,
      valuation: line.valuation,
      savedMinor: line.savedMinor === null ? null : str(line.savedMinor),
      openingMinor: line.openingMinor === null ? null : str(line.openingMinor),
      targetMinor: str(line.targetMinor),
      progressBps: line.progressBps,
    })),
    goalsAsOf: sections.goalsAsOf,
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
    netWorth: encodeNetWorth(sections.netWorth),
    netWorthHistory: sections.netWorthHistory.map((point) => ({
      date: point.date,
      valuation: encodeNetWorth(point.valuation),
    })),
  }) as JsonObject;
}

function decodeSections(raw: JsonObject): ReportSections {
  const data = raw as unknown as {
    categories: {
      categoryId: string | null;
      name: string | null;
      group: CategoryGroup | null;
      isFixed: boolean | null;
      spentMinor: JsonValue;
      shareBps: number;
      limitMinor: JsonValue;
      usedBps: number | null;
      overMinor: JsonValue;
    }[];
    incomeSources: {
      categoryId: string | null;
      name: string | null;
      group: CategoryGroup | null;
      totalMinor: string;
      shareBps: number;
    }[];
    merchants: { merchant: string; totalMinor: JsonValue; count: number; shareBps: number }[];
    tags: { tagId: string; name: string; totalMinor: JsonValue; count: number }[];
    accounts: { accountId: string; name: string; type: AccountType; inMinor: JsonValue; outMinor: JsonValue }[];
    goals: {
      goalId: string;
      name: string;
      currency: string;
      valuation: GoalValuation;
      savedMinor: JsonValue;
      openingMinor: JsonValue;
      targetMinor: JsonValue;
      progressBps: number | null;
    }[];
    goalsAsOf: LocalDate | null;
    largest: {
      transactionId: string;
      date: LocalDate;
      description: string;
      merchant: string | null;
      amountMinor: JsonValue;
      shareBps: number;
    }[];
    largestShareBps: number | null;
    subscriptions: {
      active: number;
      monthlyMinor: JsonValue;
      yearlyMinor: JsonValue;
      shareBps: number | null;
      unconverted: number;
    };
    days: { date: LocalDate; outMinor: JsonValue }[];
    averageDailyMinor: JsonValue;
    busiestWeek: { from: LocalDate; to: LocalDate; totalMinor: JsonValue } | null;
    netWorth: EncodedNetWorth | null;
    netWorthHistory: { date: LocalDate; valuation: EncodedNetWorth | null }[];
  };
  return {
    incomeSources: data.incomeSources.map((line) => ({ ...line, totalMinor: BigInt(line.totalMinor) })),
    categories: data.categories.map((line) => ({
      categoryId: line.categoryId,
      name: line.name,
      group: line.group,
      isFixed: line.isFixed,
      spentMinor: big(line.spentMinor),
      shareBps: line.shareBps,
      limitMinor: nullableBig(line.limitMinor),
      usedBps: line.usedBps,
      overMinor: big(line.overMinor),
    })),
    merchants: data.merchants.map((line) => ({
      merchant: line.merchant,
      totalMinor: big(line.totalMinor),
      count: line.count,
      shareBps: line.shareBps,
    })),
    tags: data.tags.map((line) => ({
      tagId: line.tagId,
      name: line.name,
      totalMinor: big(line.totalMinor),
      count: line.count,
    })),
    accounts: data.accounts.map((line) => ({
      accountId: line.accountId,
      name: line.name,
      type: line.type,
      inMinor: big(line.inMinor),
      outMinor: big(line.outMinor),
    })),
    goals: data.goals.map((line) => ({
      goalId: line.goalId,
      name: line.name,
      currency: line.currency,
      valuation: line.valuation,
      savedMinor: nullableBig(line.savedMinor),
      openingMinor: nullableBig(line.openingMinor),
      targetMinor: big(line.targetMinor),
      progressBps: line.progressBps,
    })),
    goalsAsOf: data.goalsAsOf,
    largest: data.largest.map((line) => ({
      transactionId: line.transactionId,
      date: line.date,
      description: line.description,
      merchant: line.merchant,
      amountMinor: big(line.amountMinor),
      shareBps: line.shareBps,
    })),
    largestShareBps: data.largestShareBps,
    subscriptions: {
      active: data.subscriptions.active,
      monthlyMinor: big(data.subscriptions.monthlyMinor),
      yearlyMinor: big(data.subscriptions.yearlyMinor),
      shareBps: data.subscriptions.shareBps,
      unconverted: data.subscriptions.unconverted,
    },
    days: data.days.map((day) => ({ date: day.date, outMinor: big(day.outMinor) })),
    averageDailyMinor: big(data.averageDailyMinor),
    busiestWeek:
      data.busiestWeek === null
        ? null
        : { from: data.busiestWeek.from, to: data.busiestWeek.to, totalMinor: big(data.busiestWeek.totalMinor) },
    netWorth: decodeNetWorth(data.netWorth),
    netWorthHistory: data.netWorthHistory.map((point) => ({
      date: point.date,
      valuation: decodeNetWorth(point.valuation),
    })),
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
          incomeMinor: big(required(row.previous, 'incomeMinor')),
          expenseMinor: big(required(row.previous, 'expenseMinor')),
          txCount: Number(required(row.previous, 'txCount')),
          netWorthMinor: nullableBig(required(row.previous, 'netWorthMinor')),
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
        : { label: row.compareLabel as string, range: { from: row.compareStart, to: row.compareEnd } },
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
  periodId: row.periodId,
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

export function createReports(db: Database): ReportsRepository {
  const repo: ReportsRepository = {
    generate: async (userId, request, at) => {
      const resolved = await resolve(userId, request, at);
      if (resolved.kind === 'monthly') {
        const cached = await withUser(db, userId, (tx) => findIn(tx, userId, resolved.kind, resolved.range));
        if (cached !== null) return viewOf(cached);
      }
      if (resolved.kind !== 'monthly') {
        const closed = await withUser(db, userId, (tx) =>
          tx
            .select({ id: periods.id })
            .from(periods)
            .where(
              and(
                eq(periods.status, 'closed'),
                gte(periods.startDate, resolved.range.from),
                lte(periods.endDate, resolved.range.to),
              ),
            )
            .orderBy(asc(periods.startDate)),
        );
        for (const period of closed) await repo.generate(userId, { kind: 'monthly', periodId: period.id }, at);
      }
      const row = await withUser(db, userId, async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`report:${userId}:${resolved.kind}:${resolved.range.from}:${resolved.range.to}`}, 0))`,
        );
        const existing = await findIn(tx, userId, resolved.kind, resolved.range);
        if (existing?.status === 'final') return existing;
        const { totals, sections } =
          resolved.kind === 'monthly'
            ? await segmentIn(tx, userId, resolved.range, resolved.period, at)
            : await aggregateIn(tx, userId, resolved.range, at);
        const compare = await compareIn(tx, userId, resolved);
        const values: typeof reports.$inferInsert = {
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
        };
        if (existing !== null) {
          return firstRow(
            await tx.update(reports).set(values).where(eq(reports.id, existing.id)).returning(),
            'reports',
          );
        }
        return firstRow(await tx.insert(reports).values(values).returning(), 'reports');
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
  return repo;

  /** Full closed periods come from their stored snapshots; only gaps and partial boundaries read the ledger. */
  async function aggregateIn(
    tx: Transaction,
    userId: string,
    range: { readonly from: LocalDate; readonly to: LocalDate },
    at: Date,
  ): Promise<ReportSegment> {
    const finals = await tx
      .select()
      .from(reports)
      .where(
        and(
          eq(reports.kind, 'monthly'),
          eq(reports.status, 'final'),
          gte(reports.rangeStart, range.from),
          lte(reports.rangeEnd, range.to),
        ),
      )
      .orderBy(asc(reports.rangeStart));
    const segments: ReportSegment[] = [];
    let cursor = range.from;
    for (const row of finals) {
      if (cursor < row.rangeStart)
        segments.push(await segmentIn(tx, userId, { from: cursor, to: addDays(row.rangeStart, -1) }, null, at));
      segments.push(viewOf(row));
      cursor = addDays(row.rangeEnd, 1);
    }
    if (cursor <= range.to) segments.push(await segmentIn(tx, userId, { from: cursor, to: range.to }, null, at));
    return aggregateReports(segments, range);
  }

  async function segmentIn(
    tx: Transaction,
    userId: string,
    range: { readonly from: LocalDate; readonly to: LocalDate },
    period: PeriodView | null,
    at: Date,
  ): Promise<ReportSegment> {
    const { baseCurrency } = await userContextIn(tx, userId);
    const sourceDays = await dayTotalsIn(tx, userId, range);
    const netWorth = await netWorthIn(tx, userId, range.to, baseCurrency);
    const totals = reportTotals({
      incomeMinor: sourceDays.reduce((sum, day) => sum + day.inMinor, 0n),
      expenseMinor: sourceDays.reduce((sum, day) => sum + day.outMinor, 0n),
      txCount: sourceDays.reduce((sum, day) => sum + day.count, 0),
      netWorthMinor: completeNetWorth(netWorth),
    });
    const days = sourceDays.map((day) => ({ date: day.date, outMinor: day.outMinor })).reverse();
    const netWorthHistory = await netWorthHistoryIn(tx, userId, range.to, baseCurrency, netWorth);
    const sections = await sectionsIn(
      tx,
      userId,
      range,
      period,
      totals,
      at,
      baseCurrency,
      days,
      netWorth,
      netWorthHistory,
    );
    return { range, totals, sections };
  }

  async function netWorthHistoryIn(
    tx: Transaction,
    userId: string,
    to: LocalDate,
    base: string,
    current: ReportNetWorth | null,
  ): Promise<ReportSections['netWorthHistory']> {
    const monthStart = `${to.slice(0, 7)}-01` as LocalDate;
    const dates: LocalDate[] = [];
    for (let offset = 5; offset > 0; offset -= 1) dates.push(addDays(addMonths(monthStart, 1 - offset), -1));
    dates.push(to);
    const finals = await tx
      .select()
      .from(reports)
      .where(and(eq(reports.kind, 'monthly'), gte(reports.rangeEnd, dates[0] as LocalDate), lte(reports.rangeEnd, to)));
    const saved = new Map(finals.map((row) => [row.rangeEnd, viewOf(row).sections.netWorth]));
    const history: { date: LocalDate; valuation: ReportNetWorth | null }[] = [];
    for (const date of dates) {
      history.push({
        date,
        valuation:
          date === to
            ? current
            : saved.has(date)
              ? (saved.get(date) as ReportNetWorth | null)
              : await netWorthIn(tx, userId, date, base),
      });
    }
    return history;
  }

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
    const today = await withUser(db, userId, async (tx) => localDateOf(at, (await userContextIn(tx, userId)).timezone));
    if (request.kind === 'monthly') {
      const period = await withUser(db, userId, (tx) => periodIn(tx, request.periodId));
      if (period.status !== 'closed') throw new LedgerError('INVALID_PERIOD', 'The period is still open');
      const range = { from: period.start, to: period.end };
      return { kind: 'monthly', range, label: period.label, status: 'final', period };
    }
    const bounded = (range: { readonly from: LocalDate; readonly to: LocalDate }) => {
      if (range.from > today) throw new LedgerError('INVALID_PERIOD', 'The range has not started');
      return { from: range.from, to: range.to < today ? range.to : today };
    };
    if (request.kind === 'quarterly') {
      const complete = quarterRange(request.year, request.quarter);
      return {
        kind: 'quarterly',
        range: bounded(complete),
        label: `${request.year}-Q${String(request.quarter)}`,
        status: 'provisional',
        period: null,
      };
    }
    if (request.kind === 'yearly') {
      const complete = yearRange(request.year);
      return {
        kind: 'yearly',
        range: bounded(complete),
        label: String(request.year),
        status: 'provisional',
        period: null,
      };
    }
    if (request.from > request.to) throw new LedgerError('INVALID_PERIOD', 'The range starts after it ends');
    if (countDays(request.from, request.to) > MAX_CUSTOM_DAYS) {
      throw new LedgerError('INVALID_PERIOD', 'The range is longer than a year');
    }
    const range = bounded({ from: request.from, to: request.to });
    return { kind: 'custom', range, label: `${range.from}/${range.to}`, status: 'provisional', period: null };
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
      .where(
        and(
          eq(reports.userId, userId),
          eq(reports.kind, kind),
          eq(reports.rangeStart, range.from),
          eq(reports.rangeEnd, range.to),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  /** The compared range: the period before a monthly report, or the same number of days before any other range. */
  async function compareIn(
    tx: Transaction,
    userId: string,
    resolved: {
      readonly range: { readonly from: LocalDate; readonly to: LocalDate };
      readonly period: PeriodView | null;
    },
  ): Promise<{
    readonly range: { readonly from: LocalDate; readonly to: LocalDate };
    readonly label: string;
    readonly totals: ReportTotals;
  } | null> {
    let range = previousRange(resolved.range);
    let label = `${range.from}/${range.to}`;
    if (resolved.period !== null) {
      const [previous] = await tx
        .select({ start: periods.startDate, end: periods.endDate, label: periods.label })
        .from(periods)
        .where(and(eq(periods.userId, userId), lt(periods.endDate, resolved.period.start)))
        .orderBy(desc(periods.endDate))
        .limit(1);
      if (previous === undefined) return null;
      range = { from: previous.start, to: previous.end };
      label = previous.label;
    }
    const totals = await totalsIn(tx, userId, range);
    return totals.txCount === 0 && totals.incomeMinor === 0n && totals.expenseMinor === 0n
      ? null
      : { range, label, totals };
  }

  /** Flows, count, and net worth of a range. */
  async function totalsIn(
    tx: Transaction,
    userId: string,
    range: { readonly from: LocalDate; readonly to: LocalDate },
  ): Promise<ReportTotals> {
    const days = await dayTotalsIn(tx, userId, { from: range.from, to: range.to });
    const { baseCurrency: base } = await userContextIn(tx, userId);
    const netWorth = await netWorthIn(tx, userId, range.to, base);
    return reportTotals({
      incomeMinor: days.reduce((total, day) => total + day.inMinor, 0n),
      expenseMinor: days.reduce((total, day) => total + day.outMinor, 0n),
      txCount: days.reduce((total, day) => total + day.count, 0),
      netWorthMinor: completeNetWorth(netWorth),
    });
  }

  /**
   * Cash balances at `to` plus the portfolio's last value on or before it. A foreign balance without a reference rate
   * at that date is left out and named, never converted with a later rate.
   */
  async function netWorthIn(
    tx: Transaction,
    userId: string,
    to: LocalDate,
    base: string,
  ): Promise<ReportNetWorth | null> {
    const { timezone } = await userContextIn(tx, userId);
    // A portfolio snapshot already includes platform cash. Counting investment accounts again would double it.
    const accountRows = await tx
      .select({
        id: accounts.id,
        type: accounts.type,
        currency: accounts.currency,
        opening: accounts.openingBalanceMinor,
      })
      .from(accounts)
      .where(lte(accounts.openingDate, to));
    const postRows = await tx
      .select({ accountId: postings.accountId, total: sql<bigint>`sum(${postings.amountMinor})`.mapWith(BigInt) })
      .from(postings)
      .innerJoin(transactions, eq(transactions.id, postings.transactionId))
      .where(and(isNull(transactions.deletedAt), lte(transactions.localDate, to)))
      .groupBy(postings.accountId);
    const adjustmentRows = await tx
      .select({
        accountId: balanceAdjustments.accountId,
        total: sql<bigint>`sum(${balanceAdjustments.amountMinor})`.mapWith(BigInt),
      })
      .from(balanceAdjustments)
      .where(sql`(${balanceAdjustments.createdAt} at time zone ${timezone})::date <= ${to}::date`)
      .groupBy(balanceAdjustments.accountId);
    const postingTotals = new Map(postRows.map((row) => [row.accountId, row.total]));
    const adjustmentTotals = new Map(adjustmentRows.map((row) => [row.accountId, row.total]));
    const currencyTotals = new Map<string, bigint>();
    let hasPlatformCash = false;
    for (const row of accountRows) {
      const balance = row.opening + (postingTotals.get(row.id) ?? 0n) + (adjustmentTotals.get(row.id) ?? 0n);
      if (row.type === 'investment') {
        hasPlatformCash ||= balance !== 0n;
      } else currencyTotals.set(row.currency, (currencyTotals.get(row.currency) ?? 0n) + balance);
    }
    const unvalued = new Set<string>();
    const rates = new Map<string, ReferenceRate | null>();
    const valueIn = async (currency: string, minor: bigint): Promise<bigint> => {
      if (minor === 0n || currency === base) return minor;
      let rate = rates.get(currency);
      if (rate === undefined) {
        rate = await referenceRateIn(tx, currency, base, to);
        rates.set(currency, rate);
      }
      if (rate === null) {
        unvalued.add(currency);
        return 0n;
      }
      return convert({ minor, currency }, base, rate);
    };
    let cash = 0n;
    for (const [currency, minor] of currencyTotals) cash += await valueIn(currency, minor);

    const payments = await tx
      .select({
        debtId: debtInstallments.debtId,
        principal: sql<bigint>`sum(${debtInstallments.principalMinor})`.mapWith(BigInt),
      })
      .from(debtInstallments)
      .innerJoin(transactions, eq(transactions.id, debtInstallments.transactionId))
      .where(and(isNull(transactions.deletedAt), lte(transactions.localDate, to)))
      .groupBy(debtInstallments.debtId);
    const paid = new Map(payments.map((row) => [row.debtId, row.principal]));
    const liabilities = await tx
      .select({ id: debts.id, principal: debts.principalMinor, currency: debts.currency })
      .from(debts)
      .where(
        sql`${debts.kind} <> 'card_installment' and (${debts.createdAt} at time zone ${timezone})::date <= ${to}::date`,
      );
    const owed = new Map<string, bigint>();
    for (const row of liabilities) {
      const remaining = row.principal - (paid.get(row.id) ?? 0n);
      if (remaining > 0n) owed.set(row.currency, (owed.get(row.currency) ?? 0n) + remaining);
    }
    let debt = 0n;
    for (const [currency, minor] of owed) debt += await valueIn(currency, minor);
    const [snapshot] = await tx
      .select({ date: portfolioSnapshots.snapshotDate, value: portfolioSnapshots.valueBaseMinor })
      .from(portfolioSnapshots)
      .where(lte(portfolioSnapshots.snapshotDate, to))
      .orderBy(desc(portfolioSnapshots.snapshotDate))
      .limit(1);
    let missingPortfolio = false;
    if (snapshot === undefined) {
      const held = await tx
        .select({ assetId: investmentTrades.assetId })
        .from(investmentTrades)
        .where(and(eq(investmentTrades.status, 'settled'), lte(investmentTrades.localDate, to)))
        .groupBy(investmentTrades.assetId)
        .having(sql`sum(${investmentTrades.unitsDelta}) <> 0`)
        .limit(1);
      missingPortfolio = hasPlatformCash || held.length > 0;
    }
    if (accountRows.length === 0 && snapshot === undefined && liabilities.length === 0) return null;
    return {
      valueMinor: cash + (snapshot?.value ?? 0n) - debt,
      cashMinor: cash,
      investmentsMinor: snapshot?.value ?? 0n,
      debtMinor: debt,
      missingPortfolio,
      asOf: snapshot?.date ?? to,
      unvaluedCurrencies: [...unvalued].sort(),
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
    baseCurrency: string,
    days: readonly ReportDayLine[],
    netWorth: ReportNetWorth | null,
    netWorthHistory: ReportSections['netWorthHistory'],
  ): Promise<ReportSections> {
    const categoryTotals = await categoryTotalsIn(tx, userId, { from: range.from, to: range.to });
    const expense = categoryTotals.filter((line) => line.kind === 'expense');
    const names = new Map<string | null, Pick<typeof categories.$inferSelect, 'name' | 'group' | 'isFixed'>>(
      (
        await tx
          .select({ id: categories.id, name: categories.name, group: categories.group, isFixed: categories.isFixed })
          .from(categories)
      ).map((row) => [row.id, row]),
    );
    const income = categoryTotals.filter((line) => line.kind === 'income');
    const incomeShares = shareLines(
      income.map((line) => ({ key: line.categoryId, totalMinor: line.totalMinor })),
      totals.incomeMinor,
    );
    const incomeSources = income.map((line, index) => ({
      categoryId: line.categoryId,
      name: names.get(line.categoryId)?.name ?? null,
      group: names.get(line.categoryId)?.group ?? null,
      totalMinor: line.totalMinor,
      shareBps: (incomeShares[index] as ShareLine<string | null>).shareBps,
    }));
    const limits = new Map(
      (period === null ? [] : (await budgetStatusIn(tx, userId, period, at)).lines).map((line) => [
        line.categoryId,
        line,
      ]),
    );
    const shares = shareLines(
      expense.map((line) => ({ key: line.categoryId, totalMinor: line.totalMinor })),
      totals.expenseMinor,
    );
    const categoriesLines: ReportCategoryLine[] = expense.map((line, index) => {
      const limit = line.categoryId === null ? undefined : limits.get(line.categoryId);
      return {
        categoryId: line.categoryId,
        name: names.get(line.categoryId)?.name ?? null,
        group: names.get(line.categoryId)?.group ?? null,
        isFixed: names.get(line.categoryId)?.isFixed ?? null,
        spentMinor: line.totalMinor,
        shareBps: (shares[index] as ShareLine<string | null>).shareBps,
        limitMinor: limit?.limitMinor ?? null,
        usedBps: limit?.usedBps ?? null,
        overMinor:
          limit !== undefined && limit.spentMinor > limit.limitMinor ? limit.spentMinor - limit.limitMinor : 0n,
      };
    });

    const merchantRows = await tx
      .select({
        merchant: sql<string>`coalesce(nullif(btrim(${transactions.merchant}), ''), nullif(btrim(${transactions.description}), ''), '')`,
        totalMinor: sql<string>`sum(-${postings.amountBaseMinor})`,
        count: sql<number>`count(distinct ${transactions.id})::int`,
      })
      .from(postings)
      .innerJoin(transactions, eq(transactions.id, postings.transactionId))
      .where(
        and(
          isNull(transactions.deletedAt),
          gte(transactions.localDate, range.from),
          lte(transactions.localDate, range.to),
          isOut,
        ),
      )
      .groupBy(sql`1`)
      .orderBy(desc(sql`sum(-${postings.amountBaseMinor})`), asc(sql`1`));
    const merchantShares = shareLines(
      merchantRows.map((row) => ({ key: row.merchant, totalMinor: BigInt(row.totalMinor) })),
      totals.expenseMinor,
    );
    const merchants: ReportMerchantLine[] = merchantRows.map((row, index) => ({
      merchant: row.merchant,
      // The description falls back to the merchant and then to an empty string, as the SQL above does.
      totalMinor: BigInt(row.totalMinor),
      count: row.count,
      shareBps: (merchantShares[index] as ShareLine<string>).shareBps,
    }));

    const tagRows = await tx
      .select({
        tagId: tags.id,
        name: tags.slug,
        totalMinor: sql<string>`sum(-${postings.amountBaseMinor})`,
        count: sql<number>`count(distinct ${transactions.id})::int`,
      })
      .from(transactionTags)
      .innerJoin(transactions, eq(transactions.id, transactionTags.transactionId))
      .innerJoin(tags, eq(tags.id, transactionTags.tagId))
      .innerJoin(postings, eq(postings.transactionId, transactions.id))
      .where(
        and(
          isNull(transactions.deletedAt),
          gte(transactions.localDate, range.from),
          lte(transactions.localDate, range.to),
          isOut,
        ),
      )
      .groupBy(tags.id, tags.slug)
      .orderBy(desc(sql`sum(-${postings.amountBaseMinor})`), asc(tags.slug));
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
        outMinor: sql<string>`coalesce(sum(-${postings.amountBaseMinor}) filter (where ${isOut}), 0)`,
      })
      .from(postings)
      .innerJoin(transactions, eq(transactions.id, postings.transactionId))
      .innerJoin(accounts, eq(accounts.id, postings.accountId))
      .where(
        and(
          isNull(transactions.deletedAt),
          gte(transactions.localDate, range.from),
          lte(transactions.localDate, range.to),
        ),
      )
      .groupBy(postings.accountId, accounts.displayName, accounts.type)
      .orderBy(asc(accounts.displayName));
    const accountLines: ReportAccountLine[] = accountRows.map((row) => ({
      accountId: row.accountId,
      name: row.name,
      type: row.type,
      inMinor: BigInt(row.inMinor),
      outMinor: BigInt(row.outMinor),
    }));

    const goalSnapshot = await goalSnapshotIn(tx, userId, range.to);
    const before = addDays(range.from, -1);
    const opening = await goalSnapshotIn(tx, userId, before);
    const previousGoals = opening?.date === before ? new Map(opening.goals.map((goal) => [goal.goalId, goal])) : null;
    const goalLines: ReportGoalLine[] = (goalSnapshot?.goals ?? []).map((goal) => {
      const prior = previousGoals?.get(goal.goalId);
      return {
        goalId: goal.goalId,
        name: goal.name,
        currency: goal.currency,
        valuation: goal.valuation,
        savedMinor: goal.savedMinor,
        openingMinor: prior?.currency === goal.currency ? prior.savedMinor : null,
        targetMinor: goal.targetMinor,
        progressBps: goal.savedMinor === null ? null : progressBps(goal.savedMinor, goal.targetMinor),
      };
    });

    const largestRows = await tx
      .select({
        id: transactions.id,
        date: transactions.localDate,
        description: sql<string>`coalesce(nullif(btrim(${transactions.description}), ''), nullif(btrim(${transactions.merchant}), ''), '')`,
        merchant: transactions.merchant,
        amountMinor: sql<string>`sum(-${postings.amountBaseMinor})`,
      })
      .from(postings)
      .innerJoin(transactions, eq(transactions.id, postings.transactionId))
      .where(
        and(
          isNull(transactions.deletedAt),
          gte(transactions.localDate, range.from),
          lte(transactions.localDate, range.to),
          isOut,
        ),
      )
      .groupBy(transactions.id)
      .orderBy(desc(sql`sum(-${postings.amountBaseMinor})`), asc(transactions.localDate), asc(transactions.id))
      .limit(LARGEST_LIMIT);
    const largestShares = shareLines(
      largestRows.map((row) => ({ key: row.id, totalMinor: BigInt(row.amountMinor) })),
      totals.expenseMinor,
    );
    const largest: ReportLargestLine[] = largestRows.map((row, index) => ({
      transactionId: row.id,
      date: row.date,
      description: row.description,
      merchant: row.merchant,
      // The description falls back to the merchant and then to an empty string, as the SQL above does.
      amountMinor: BigInt(row.amountMinor),
      shareBps: (largestShares[index] as ShareLine<string>).shareBps,
    }));

    const subscriptionRows = (
      await tx
        .select({
          priceMinor: subscriptions.priceMinor,
          currency: subscriptions.currency,
          cycle: subscriptions.cycle,
          startedOn: subscriptions.startedOn,
          trialEndsOn: subscriptions.trialEndsOn,
          pausedOn: subscriptions.pausedOn,
          pausedUntil: subscriptions.pausedUntil,
          endsOn: subscriptions.endsOn,
          status: subscriptions.status,
          cancelMode: subscriptions.cancelMode,
        })
        .from(subscriptions)
        .where(lte(subscriptions.startedOn, range.to))
    ).filter((row) => activeOn(row, range.to));
    const priced: PricedSubscription[] = [];
    const subscriptionRates = new Map<string, ReferenceRate | null>();
    let unconverted = 0;
    for (const row of subscriptionRows) {
      let priceMinor = row.priceMinor;
      if (row.currency !== baseCurrency) {
        let rate = subscriptionRates.get(row.currency);
        if (rate === undefined) {
          rate = await referenceRateIn(tx, row.currency, baseCurrency, range.to);
          subscriptionRates.set(row.currency, rate);
        }
        if (rate === null) {
          unconverted += 1;
          continue;
        }
        priceMinor = convert({ minor: row.priceMinor, currency: row.currency }, baseCurrency, rate);
      }
      priced.push({ priceMinor, cycle: row.cycle });
    }
    const subscriptionCosts = subscriptionTotals(priced);
    const subscriptionSection: ReportSubscriptionLine = {
      active: subscriptionRows.length,
      monthlyMinor: subscriptionCosts.monthlyMinor,
      yearlyMinor: subscriptionCosts.yearlyMinor,
      shareBps:
        totals.expenseMinor > 0n && unconverted === 0
          ? Number((subscriptionCosts.monthlyMinor * 10_000n) / totals.expenseMinor)
          : null,
      unconverted,
    };

    return {
      categories: categoriesLines,
      incomeSources,
      merchants,
      tags: tagLines,
      accounts: accountLines,
      goals: goalLines,
      goalsAsOf: goalSnapshot?.date ?? null,
      largest,
      largestShareBps: topShareBps(largest, LARGEST_LIMIT, totals.expenseMinor),
      subscriptions: subscriptionSection,
      days,
      averageDailyMinor: dailyAverageMinor(totals.expenseMinor, range),
      busiestWeek: busiestWeek(days, range),
      netWorth,
      netWorthHistory,
    };
  }
}
