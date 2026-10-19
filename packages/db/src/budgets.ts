// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Budgets (FR-B1–B5): versions effective from a period label until the next one, their lines, the budget status of a
 * period (Section 06 page: hero, Needs/Wants, per-category pace, "Perlu perhatian"), change history, the 3-month fill,
 * moving leftover between categories (per-period overrides, Undo), and dismissed warnings.
 *
 * A line's limit in a period = the version's limit, prorated `× days ÷ 30` in a transition period (computed, never
 * stored), plus the period's overrides. Editing the budget of a period writes the version effective from that
 * period's label (copying the one in force first), so earlier periods keep their numbers; no edit may reach a closed
 * period (FR-P3).
 */
import { randomUUID } from 'node:crypto';
import {
  ALERT_PCTS,
  budgetTotals,
  closeProposals,
  DEFAULT_ALERT_PCT,
  FILL_AVERAGE_PERIODS,
  type InvalidBudgetError,
  lineStatus,
  moveLeftover,
  ratioBps,
  safeDailyStepMinor,
  averageSpend,
  type AlertPct,
  type BudgetContext,
  type BudgetLineState,
  type BudgetLineStatus,
  type BudgetTotals,
  type CloseProposals,
  type LimitDelta,
} from '@wf/domain/budget';
import {
  BUILT_IN_CATEGORIES,
  type BuiltInCategoryKey,
  type CategoryGroup,
  type CategoryKind,
} from '@wf/domain/categories';
import { addDays, periodAfter, prorateLimit, type LocalDate, type Period, type YearMonth } from '@wf/domain/period';
import { and, asc, eq, gte, inArray, isNull, lt, min, sql } from 'drizzle-orm';
import { firstRow, withUser, type Database, type Transaction } from './db.ts';
import { linesIn, versionInForceIn, type BudgetLineRow } from './budget-core.ts';
import { userContextIn } from './ledger-core.ts';
import { LedgerError } from './ledger-errors.ts';
import { coveringIn, ensureIn, periodIn, periodOnIn, settingsIn, type PeriodView } from './periods.ts';
import {
  budgetAlertDismissals,
  budgetLines,
  budgetPeriodOverrides,
  budgetVersions,
  categories,
  periods,
  transactions,
} from './schema.ts';
import { categoryTotalsIn } from './transaction-query.ts';

export interface BudgetLineInput {
  readonly categoryId: string;
  /** ≥ 0, base currency. */
  readonly limitMinor: bigint;
  readonly rollover?: boolean;
  /** Defaults to the category's "fixed cost" flag. */
  readonly isFixed?: boolean;
  /** 50, 80, 85 (default), or 100. */
  readonly alertPct?: AlertPct;
}

export interface BudgetLinePatch {
  readonly categoryId: string;
  /** Required when the category has no line yet ("Tambah kategori"). */
  readonly limitMinor?: bigint;
  readonly rollover?: boolean;
  readonly isFixed?: boolean;
  readonly alertPct?: AlertPct;
}

export interface BudgetCategory {
  readonly categoryId: string;
  readonly kind: CategoryKind;
  readonly group: CategoryGroup;
  /** As stored: the key for built-in categories (render via `builtInKey`). */
  readonly name: string;
  readonly builtInKey: BuiltInCategoryKey | null;
  readonly icon: string;
  readonly color: string;
}

export interface BudgetLineView extends BudgetCategory, BudgetLineStatus {
  /** The version's limit before proration and overrides. */
  readonly baseLimitMinor: bigint;
  /** Σ overrides of this period (moved leftover, rollover). */
  readonly overridesMinor: bigint;
  readonly rollover: boolean;
  readonly isFixed: boolean;
  readonly alertPct: AlertPct;
  /** Transactions counted in `spentMinor`. */
  readonly count: number;
  /** FR-B5: the warning is dismissed until the end of the period. */
  readonly dismissed: boolean;
}

export interface BudgetGroupTotal {
  readonly group: CategoryGroup;
  readonly limitMinor: bigint;
  readonly spentMinor: bigint;
  /** Needs 10.400.000 / 12.000.000 → 8667 (87%), Wants 6.100.000 / 6.750.000 → 9037 (90%). */
  readonly usedBps: number | null;
  readonly lineCount: number;
  readonly overCount: number;
}

/** M3 adds `will_exceed` once scheduled bills feed `scheduledMinor`. */
export type AttentionReason = Extract<BudgetLineState, 'over' | 'warning'>;

export interface BudgetStatus {
  readonly period: PeriodView;
  readonly today: LocalDate;
  /** FR-P3: a closed period is read-only. */
  readonly readOnly: boolean;
  readonly baseCurrency: string;
  readonly version: {
    readonly id: string;
    readonly effectiveFrom: YearMonth;
    readonly expectedIncomeMinor: bigint | null;
  } | null;
  readonly lines: BudgetLineView[];
  /** Expense groups with lines, Needs first. */
  readonly groups: BudgetGroupTotal[];
  readonly totals: BudgetTotals & {
    /** Spending in categories without a line ("+Rp700.000 tanpa anggaran"), uncategorized included. */
    readonly unbudgetedSpentMinor: bigint;
  };
  /** "Perlu perhatian": lines over the limit or at their warning threshold, not dismissed. */
  readonly attention: { readonly categoryId: string; readonly reason: AttentionReason }[];
  readonly dismissedCount: number;
  /** FR-P4 proposals for when the period closes (rollover, leftover to savings). */
  readonly close: CloseProposals;
  /** The next period when it is a transition ("Berikutnya: periode transisi 1–24 November", Rp18.750.000 → 15.000.000). */
  readonly nextTransition: {
    readonly period: Period;
    readonly limitMinor: bigint;
    readonly proratedMinor: bigint;
  } | null;
}

export interface BudgetVersionView {
  readonly id: string;
  readonly effectiveFrom: YearMonth;
  readonly expectedIncomeMinor: bigint | null;
  readonly totalMinor: bigint;
  readonly lines: BudgetLineRow[];
}

export interface BudgetHistoryChange {
  readonly categoryId: string;
  /** `added` = a category new in this version ("Kategori baru"). */
  readonly change: 'added' | 'updated' | 'removed';
  readonly fromMinor: bigint | null;
  readonly toMinor: bigint | null;
  readonly at: Date;
}

export interface BudgetHistoryEntry {
  readonly versionId: string;
  readonly effectiveFrom: YearMonth;
  readonly totalMinor: bigint;
  readonly lineCount: number;
  readonly createdAt: Date;
  /** Against the version before; `null` for the first version ("Anggaran dibuat"). */
  readonly changes: BudgetHistoryChange[] | null;
}

export interface FillSuggestion {
  readonly categoryId: string;
  /** Average spending of the periods counted, rounded up to the safe-daily step (Rp1.000). */
  readonly averageMinor: bigint;
}

export interface BudgetsRepository {
  /** FR-B2: the budget page of a period (default: the current one). @throws {LedgerError} `NOT_FOUND` */
  status: (userId: string, options?: { readonly periodId?: string }) => Promise<BudgetStatus>;
  /** FR-B1 "Riwayat perubahan", newest version first. */
  history: (userId: string) => Promise<BudgetHistoryEntry[]>;
  /**
   * FR-B1 "Atur anggaran · berlaku mulai …": sets the lines of the version effective from `effectiveFrom`.
   * @throws {LedgerError} `INVALID_BUDGET`, `INVALID_CATEGORY`, `PERIOD_CLOSED` (it would change a closed period)
   */
  saveVersion: (
    userId: string,
    input: {
      readonly effectiveFrom: YearMonth;
      readonly expectedIncomeMinor?: bigint | null;
      readonly lines: readonly BudgetLineInput[];
    },
  ) => Promise<BudgetVersionView>;
  /**
   * FR-B2 inline limit edit, FR-B4 options, "Tambah kategori": changes one line from the period on.
   * @throws {LedgerError} `NOT_FOUND`, `INVALID_BUDGET`, `INVALID_CATEGORY`, `PERIOD_CLOSED`
   */
  setLine: (userId: string, periodId: string, patch: BudgetLinePatch) => Promise<BudgetVersionView>;
  /** "Hapus dari anggaran" from the period on. @throws {LedgerError} `NOT_FOUND`, `PERIOD_CLOSED` */
  removeLine: (userId: string, periodId: string, categoryId: string) => Promise<BudgetVersionView>;
  /** FR-B1 "Isi dari rata-rata 3 bulan" for the period's budget sheet. @throws {LedgerError} `NOT_FOUND` */
  fillFromAverage: (userId: string, periodId: string) => Promise<FillSuggestion[]>;
  /**
   * FR-B3 "Pindahkan sisa": the total stays the same. @throws {LedgerError} `NOT_FOUND`, `INVALID_BUDGET`,
   * `PERIOD_CLOSED`
   */
  moveLeftover: (
    userId: string,
    periodId: string,
    move: {
      readonly targetCategoryId: string;
      readonly sources: readonly { readonly categoryId: string; readonly amountMinor: bigint }[];
    },
  ) => Promise<{ readonly moveId: string; readonly deltas: LimitDelta[] }>;
  /** "Urungkan" of a move. @throws {LedgerError} `NOT_FOUND`, `PERIOD_CLOSED` */
  undoMove: (userId: string, moveId: string) => Promise<{ readonly removed: number }>;
  /** FR-B5 "Abaikan" until the end of the period. @throws {LedgerError} `NOT_FOUND`, `PERIOD_CLOSED` */
  dismissAlert: (userId: string, periodId: string, categoryId: string) => Promise<void>;
  /** "Tampilkan": shows a dismissed warning again. @throws {LedgerError} `NOT_FOUND` */
  restoreAlert: (userId: string, periodId: string, categoryId: string) => Promise<void>;
}

const BUILT_IN_KEYS = new Set<string>(BUILT_IN_CATEGORIES.map((category) => category.key));
const GROUP_ORDER: readonly CategoryGroup[] = ['needs', 'wants', 'financial'];

const CATEGORY = {
  categoryId: categories.id,
  kind: categories.kind,
  group: categories.group,
  name: categories.name,
  icon: categories.icon,
  color: categories.color,
  isFixed: categories.isFixed,
};

function invalid(message: string): LedgerError {
  return new LedgerError('INVALID_BUDGET', message);
}

interface CategoryRow extends Omit<BudgetCategory, 'builtInKey'> {
  readonly isFixed: boolean;
}

/** Live expense and fee categories among `ids`, by id. @throws {LedgerError} `INVALID_CATEGORY` */
async function budgetCategoriesIn(tx: Transaction, ids: readonly string[]): Promise<Map<string, CategoryRow>> {
  const rows =
    ids.length === 0
      ? []
      : await tx
          .select(CATEGORY)
          .from(categories)
          .where(and(inArray(categories.id, [...ids]), isNull(categories.deletedAt)));
  const byId = new Map(rows.map((row) => [row.categoryId, row]));
  for (const id of ids) {
    const row = byId.get(id);
    if (row === undefined || row.kind === 'income') {
      throw new LedgerError('INVALID_CATEGORY', 'A budget line needs a live expense or fee category');
    }
  }
  return byId;
}

function checkLine(line: { readonly limitMinor?: bigint; readonly alertPct?: number }): void {
  if (line.limitMinor !== undefined && line.limitMinor < 0n) throw invalid('A limit must not be negative');
  if (line.alertPct !== undefined && !(ALERT_PCTS as readonly number[]).includes(line.alertPct)) {
    throw invalid('The alert threshold must be 50, 80, 85, or 100');
  }
}

/**
 * FR-P3: refuses a version change effective from `label` that would reach a closed period (one labelled from `label`
 * up to the next version).
 */
async function assertVersionEditableIn(tx: Transaction, label: YearMonth): Promise<void> {
  const [next] = await tx
    .select({ effectiveFrom: budgetVersions.effectiveFrom })
    .from(budgetVersions)
    .where(sql`${budgetVersions.effectiveFrom} > ${label}`)
    .orderBy(asc(budgetVersions.effectiveFrom))
    .limit(1);
  const [closed] = await tx
    .select({ id: periods.id })
    .from(periods)
    .where(
      and(
        eq(periods.status, 'closed'),
        gte(periods.label, label),
        next === undefined ? undefined : lt(periods.label, next.effectiveFrom),
      ),
    )
    .limit(1);
  if (closed !== undefined) throw new LedgerError('PERIOD_CLOSED', 'The change would reach a closed period');
}

/** The id of the version effective from `label`, created as a copy of the one in force when missing. */
async function versionFromIn(tx: Transaction, userId: string, label: YearMonth): Promise<string> {
  await assertVersionEditableIn(tx, label);
  const inForce = await versionInForceIn(tx, label);
  if (inForce?.effectiveFrom === label) return inForce.id;
  const [created] = await tx
    .insert(budgetVersions)
    .values({ userId, effectiveFrom: label, expectedIncomeMinor: inForce?.expectedIncomeMinor ?? null })
    .returning({ id: budgetVersions.id });
  const { id } = created as { id: string };
  if (inForce !== null && inForce.lines.length > 0) {
    await tx.insert(budgetLines).values(
      inForce.lines.map(({ categoryId, limitMinor, rollover, isFixed, alertPct, sortOrder }) => ({
        categoryId,
        limitMinor,
        rollover,
        isFixed,
        alertPct,
        sortOrder,
        userId,
        versionId: id,
      })),
    );
  }
  return id;
}

async function versionViewIn(tx: Transaction, id: string): Promise<BudgetVersionView> {
  const version = firstRow(
    await tx
      .select({
        id: budgetVersions.id,
        effectiveFrom: budgetVersions.effectiveFrom,
        expectedIncomeMinor: budgetVersions.expectedIncomeMinor,
      })
      .from(budgetVersions)
      .where(eq(budgetVersions.id, id)),
    'budget_versions',
  );
  const lines = await linesIn(tx, id);
  return { ...version, totalMinor: lines.reduce((total, line) => total + line.limitMinor, 0n), lines };
}

/** An open period row. @throws {LedgerError} `NOT_FOUND`, `PERIOD_CLOSED` */
async function openPeriodIn(tx: Transaction, periodId: string): Promise<PeriodView> {
  const period = await periodIn(tx, periodId);
  if (period.status === 'closed') throw new LedgerError('PERIOD_CLOSED', 'The period is closed');
  return period;
}

/** A line's limit in `period`: prorated in a transition period. */
function periodLimit(limitMinor: bigint, period: Pick<Period, 'kind' | 'days'>): bigint {
  return period.kind === 'transition' ? prorateLimit(limitMinor, period.days) : limitMinor;
}

/** FR-B2: the budget page of `period` (also the dashboard's budget card). */
export async function budgetStatusIn(
  tx: Transaction,
  userId: string,
  period: PeriodView,
  now: Date,
): Promise<BudgetStatus> {
  const { baseCurrency } = await userContextIn(tx, userId);
  const { startDay, today } = await settingsIn(tx, userId, now);
  const version = await versionInForceIn(tx, period.label);
  const lineRows = version?.lines ?? [];
  const categoryRows = await budgetCategoriesIn(
    tx,
    lineRows.map((line) => line.categoryId),
  );
  const overrides = await tx
    .select({
      categoryId: budgetPeriodOverrides.categoryId,
      deltaMinor: sql`sum(${budgetPeriodOverrides.deltaMinor})`.mapWith(BigInt),
    })
    .from(budgetPeriodOverrides)
    .where(eq(budgetPeriodOverrides.periodId, period.id as string))
    .groupBy(budgetPeriodOverrides.categoryId);
  const overrideOf = new Map(overrides.map((row) => [row.categoryId, row.deltaMinor]));
  const dismissedRows = await tx
    .select({ categoryId: budgetAlertDismissals.categoryId })
    .from(budgetAlertDismissals)
    .where(eq(budgetAlertDismissals.periodId, period.id as string));
  const dismissed = new Set(dismissedRows.map((row) => row.categoryId));
  const spending = (await categoryTotalsIn(tx, userId, { from: period.start, to: period.end })).filter(
    (row) => row.kind === 'expense',
  );
  const spentOf = new Map(spending.map((row) => [row.categoryId, row]));

  const context: BudgetContext = { period, today, stepMinor: safeDailyStepMinor(baseCurrency) };
  const lines = lineRows.map((line): BudgetLineView => {
    const { categoryId, kind, group, name, icon, color } = categoryRows.get(line.categoryId) as CategoryRow;
    const category = { categoryId, kind, group, name, icon, color };
    const overridesMinor = overrideOf.get(line.categoryId) ?? 0n;
    const spent = spentOf.get(line.categoryId);
    const status = lineStatus(
      {
        limitMinor: periodLimit(line.limitMinor, period) + overridesMinor,
        spentMinor: spent?.totalMinor ?? 0n,
        isFixed: line.isFixed,
        alertPct: line.alertPct,
        scheduledMinor: 0n,
      },
      context,
    );
    return {
      ...category,
      builtInKey: BUILT_IN_KEYS.has(category.name) ? (category.name as BuiltInCategoryKey) : null,
      ...status,
      baseLimitMinor: line.limitMinor,
      overridesMinor,
      rollover: line.rollover,
      isFixed: line.isFixed,
      alertPct: line.alertPct,
      count: spent?.count ?? 0,
      dismissed: dismissed.has(line.categoryId),
    };
  });

  const budgeted = new Set(lineRows.map((line) => line.categoryId));
  const unbudgetedSpentMinor = spending
    .filter((row) => row.categoryId === null || !budgeted.has(row.categoryId))
    .reduce((total, row) => total + row.totalMinor, 0n);
  const groups = GROUP_ORDER.flatMap((group): BudgetGroupTotal[] => {
    const members = lines.filter((line) => line.group === group);
    if (members.length === 0) return [];
    const limitMinor = members.reduce((total, line) => total + line.limitMinor, 0n);
    const spentMinor = members.reduce((total, line) => total + line.spentMinor, 0n);
    return [
      {
        group,
        limitMinor,
        spentMinor,
        usedBps: ratioBps(spentMinor, limitMinor),
        lineCount: members.length,
        overCount: members.filter((line) => line.state === 'over').length,
      },
    ];
  });
  const attention = lines
    .filter((line) => !line.dismissed && (line.state === 'over' || line.state === 'warning'))
    .map((line) => ({ categoryId: line.categoryId, reason: line.state as AttentionReason }));

  const [nextRow] = await tx
    .select({
      kind: periods.kind,
      start: periods.startDate,
      end: periods.endDate,
      days: periods.days,
      label: periods.label,
    })
    .from(periods)
    .where(eq(periods.startDate, addDays(period.end, 1)));
  const next: Period = nextRow ?? periodAfter(period, startDay);
  let nextTransition: BudgetStatus['nextTransition'] = null;
  if (next.kind === 'transition') {
    const nextLines = (await versionInForceIn(tx, next.label))?.lines ?? [];
    nextTransition = {
      period: next,
      limitMinor: nextLines.reduce((total, line) => total + line.limitMinor, 0n),
      proratedMinor: nextLines.reduce((total, line) => total + prorateLimit(line.limitMinor, next.days), 0n),
    };
  }

  return {
    period,
    today,
    readOnly: period.status === 'closed',
    baseCurrency,
    version:
      version === null
        ? null
        : { id: version.id, effectiveFrom: version.effectiveFrom, expectedIncomeMinor: version.expectedIncomeMinor },
    lines,
    groups,
    totals: { ...budgetTotals(lines, context), unbudgetedSpentMinor },
    attention,
    dismissedCount: lines.filter((line) => line.dismissed).length,
    close: closeProposals(lines),
    nextTransition,
  };
}

export function createBudgets(db: Database, options: { readonly now?: () => Date } = {}): BudgetsRepository {
  const now = options.now ?? (() => new Date());

  /** Applies `edit` to the version effective from the open period's label and returns that version. */
  const editVersion = (
    userId: string,
    periodId: string,
    edit: (tx: Transaction, versionId: string) => Promise<void>,
  ): Promise<BudgetVersionView> =>
    withUser(db, userId, async (tx) => {
      const period = await openPeriodIn(tx, periodId);
      const versionId = await versionFromIn(tx, userId, period.label);
      await edit(tx, versionId);
      return versionViewIn(tx, versionId);
    });

  return {
    status: (userId, { periodId } = {}) =>
      withUser(db, userId, async (tx) => {
        let period: PeriodView;
        if (periodId === undefined) {
          const { startDay, today } = await settingsIn(tx, userId, now());
          await ensureIn(tx, userId, today, startDay);
          period = (await periodOnIn(tx, today)) as PeriodView;
        } else {
          period = await periodIn(tx, periodId);
        }
        return budgetStatusIn(tx, userId, period, now());
      }),

    history: (userId) =>
      withUser(db, userId, async (tx) => {
        const versions = await tx
          .select({
            id: budgetVersions.id,
            effectiveFrom: budgetVersions.effectiveFrom,
            createdAt: budgetVersions.createdAt,
          })
          .from(budgetVersions)
          .orderBy(asc(budgetVersions.effectiveFrom));
        let previous: BudgetLineRow[] | null = null;
        const entries: BudgetHistoryEntry[] = [];
        for (const version of versions) {
          const lines = await linesIn(tx, version.id);
          let changes: BudgetHistoryChange[] | null = null;
          if (previous !== null) {
            const before = new Map(previous.map((line) => [line.categoryId, line]));
            const after = new Set(lines.map((line) => line.categoryId));
            changes = [
              ...lines.flatMap((line): BudgetHistoryChange[] => {
                const old = before.get(line.categoryId);
                if (old === undefined) {
                  return [
                    {
                      categoryId: line.categoryId,
                      change: 'added',
                      fromMinor: null,
                      toMinor: line.limitMinor,
                      at: line.updatedAt,
                    },
                  ];
                }
                return old.limitMinor === line.limitMinor
                  ? []
                  : [
                      {
                        categoryId: line.categoryId,
                        change: 'updated',
                        fromMinor: old.limitMinor,
                        toMinor: line.limitMinor,
                        at: line.updatedAt,
                      },
                    ];
              }),
              ...previous
                .filter((line) => !after.has(line.categoryId))
                .map((line): BudgetHistoryChange => ({
                  categoryId: line.categoryId,
                  change: 'removed',
                  fromMinor: line.limitMinor,
                  toMinor: null,
                  at: version.createdAt,
                })),
            ].sort((a, b) => b.at.getTime() - a.at.getTime());
          }
          entries.push({
            versionId: version.id,
            effectiveFrom: version.effectiveFrom,
            totalMinor: lines.reduce((total, line) => total + line.limitMinor, 0n),
            lineCount: lines.length,
            createdAt: version.createdAt,
            changes,
          });
          previous = lines;
        }
        return entries.reverse();
      }),

    saveVersion: (userId, input) =>
      withUser(db, userId, async (tx) => {
        if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.effectiveFrom)) throw invalid('effectiveFrom must be YYYY-MM');
        if (input.expectedIncomeMinor != null && input.expectedIncomeMinor < 0n) {
          throw invalid('The expected income must not be negative');
        }
        const ids = input.lines.map((line) => line.categoryId);
        if (new Set(ids).size !== ids.length) throw invalid('A category appears twice');
        input.lines.forEach(checkLine);
        const categoryRows = await budgetCategoriesIn(tx, ids);
        const versionId = await versionFromIn(tx, userId, input.effectiveFrom);
        if (input.expectedIncomeMinor !== undefined) {
          await tx
            .update(budgetVersions)
            .set({ expectedIncomeMinor: input.expectedIncomeMinor, updatedAt: now() })
            .where(eq(budgetVersions.id, versionId));
        }
        const existing = new Map((await linesIn(tx, versionId)).map((line) => [line.categoryId, line]));
        const removed = [...existing.keys()].filter((id) => !ids.includes(id));
        if (removed.length > 0) {
          await tx
            .delete(budgetLines)
            .where(and(eq(budgetLines.versionId, versionId), inArray(budgetLines.categoryId, removed)));
        }
        for (const [index, line] of input.lines.entries()) {
          const values = {
            limitMinor: line.limitMinor,
            rollover: line.rollover ?? false,
            isFixed: line.isFixed ?? categoryRows.get(line.categoryId)?.isFixed,
            alertPct: line.alertPct ?? DEFAULT_ALERT_PCT,
            sortOrder: index,
          };
          const old = existing.get(line.categoryId);
          if (old === undefined) {
            await tx.insert(budgetLines).values({ ...values, userId, versionId, categoryId: line.categoryId });
          } else if (Object.entries(values).some(([key, value]) => old[key as keyof typeof values] !== value)) {
            await tx
              .update(budgetLines)
              .set({ ...values, updatedAt: now() })
              .where(and(eq(budgetLines.versionId, versionId), eq(budgetLines.categoryId, line.categoryId)));
          }
        }
        return versionViewIn(tx, versionId);
      }),

    setLine: (userId, periodId, patch) =>
      editVersion(userId, periodId, async (tx, versionId) => {
        checkLine(patch);
        const category = (await budgetCategoriesIn(tx, [patch.categoryId])).get(patch.categoryId);
        const changes = {
          ...(patch.limitMinor === undefined ? {} : { limitMinor: patch.limitMinor }),
          ...(patch.rollover === undefined ? {} : { rollover: patch.rollover }),
          ...(patch.isFixed === undefined ? {} : { isFixed: patch.isFixed }),
          ...(patch.alertPct === undefined ? {} : { alertPct: patch.alertPct }),
        };
        const updated = await tx
          .update(budgetLines)
          .set({ ...changes, updatedAt: now() })
          .where(and(eq(budgetLines.versionId, versionId), eq(budgetLines.categoryId, patch.categoryId)))
          .returning({ categoryId: budgetLines.categoryId });
        if (updated.length > 0) return;
        if (patch.limitMinor === undefined) throw invalid('A new budget line needs a limit');
        // An aggregate without GROUP BY always returns one row.
        const last = firstRow(
          await tx
            .select({ sortOrder: sql<number>`coalesce(max(${budgetLines.sortOrder}), -1)::int` })
            .from(budgetLines)
            .where(eq(budgetLines.versionId, versionId)),
          'budget_lines',
        );
        await tx.insert(budgetLines).values({
          userId,
          versionId,
          categoryId: patch.categoryId,
          limitMinor: patch.limitMinor,
          rollover: patch.rollover ?? false,
          isFixed: patch.isFixed ?? (category?.isFixed as boolean),
          alertPct: patch.alertPct ?? DEFAULT_ALERT_PCT,
          sortOrder: last.sortOrder + 1,
        });
      }),

    removeLine: (userId, periodId, categoryId) =>
      editVersion(userId, periodId, async (tx, versionId) => {
        const deleted = await tx
          .delete(budgetLines)
          .where(and(eq(budgetLines.versionId, versionId), eq(budgetLines.categoryId, categoryId)))
          .returning({ categoryId: budgetLines.categoryId });
        if (deleted.length === 0) throw new LedgerError('NOT_FOUND', 'The category has no budget line');
      }),

    fillFromAverage: (userId, periodId) =>
      withUser(db, userId, async (tx) => {
        const period = await periodIn(tx, periodId);
        const { baseCurrency } = await userContextIn(tx, userId);
        const { startDay } = await settingsIn(tx, userId, now());
        const [first] = await tx
          .select({ day: min(transactions.localDate) })
          .from(transactions)
          .where(isNull(transactions.deletedAt));
        const firstDay = first?.day ?? null;
        if (firstDay === null) return [];
        // The periods before this one, latest first, that end after the first transaction.
        const earlier = (
          await coveringIn(
            tx,
            { from: addDays(period.start, -FILL_AVERAGE_PERIODS * 31 - 31), to: addDays(period.start, -1) },
            startDay,
          )
        )
          .filter((candidate) => candidate.end < period.start && candidate.end >= firstDay)
          .slice(-FILL_AVERAGE_PERIODS);
        const totals = new Map<string, bigint[]>();
        for (const [index, candidate] of earlier.entries()) {
          for (const row of await categoryTotalsIn(tx, userId, { from: candidate.start, to: candidate.end })) {
            if (row.kind !== 'expense' || row.categoryId === null) continue;
            const amounts = totals.get(row.categoryId) ?? earlier.map(() => 0n);
            amounts[index] = row.totalMinor;
            totals.set(row.categoryId, amounts);
          }
        }
        const step = safeDailyStepMinor(baseCurrency);
        return [...totals].map(([categoryId, amounts]) => ({ categoryId, averageMinor: averageSpend(amounts, step) }));
      }),

    moveLeftover: (userId, periodId, move) =>
      withUser(db, userId, async (tx) => {
        const period = await openPeriodIn(tx, periodId);
        const status = await budgetStatusIn(tx, userId, period, now());
        let deltas: LimitDelta[];
        try {
          deltas = moveLeftover(status.lines, move.targetCategoryId, move.sources);
        } catch (error) {
          // The domain refuses an invalid move with an InvalidBudgetError and throws nothing else.
          const refusal = error as InvalidBudgetError;
          throw invalid(refusal.message);
        }
        const moveId = randomUUID();
        await tx
          .insert(budgetPeriodOverrides)
          .values(deltas.map((delta) => ({ ...delta, userId, periodId, reason: 'transfer' as const, moveId })));
        return { moveId, deltas };
      }),

    undoMove: (userId, moveId) =>
      withUser(db, userId, async (tx) => {
        const [row] = await tx
          .select({ periodId: budgetPeriodOverrides.periodId })
          .from(budgetPeriodOverrides)
          .where(eq(budgetPeriodOverrides.moveId, moveId))
          .limit(1);
        if (row === undefined) throw new LedgerError('NOT_FOUND', 'No such move');
        await openPeriodIn(tx, row.periodId);
        const removed = await tx
          .delete(budgetPeriodOverrides)
          .where(eq(budgetPeriodOverrides.moveId, moveId))
          .returning({ id: budgetPeriodOverrides.id });
        return { removed: removed.length };
      }),

    dismissAlert: (userId, periodId, categoryId) =>
      withUser(db, userId, async (tx) => {
        await openPeriodIn(tx, periodId);
        await budgetCategoriesIn(tx, [categoryId]);
        await tx.insert(budgetAlertDismissals).values({ userId, periodId, categoryId }).onConflictDoNothing();
      }),

    restoreAlert: (userId, periodId, categoryId) =>
      withUser(db, userId, async (tx) => {
        await periodIn(tx, periodId);
        await tx
          .delete(budgetAlertDismissals)
          .where(and(eq(budgetAlertDismissals.periodId, periodId), eq(budgetAlertDismissals.categoryId, categoryId)));
      }),
  };
}
