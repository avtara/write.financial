// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Savings goals and sinking funds (FR-G1–G4, FR-B6: one entity, `kind`). A goal's progress is the value of its
 * funding sources (FR-G2): an account wholly (its balance) or a fixed amount of it (`sources`), and investment assets
 * wholly or a percentage of their units (`assetSources`: their share of the asset's value now plus pending buys;
 * Σ per asset across goals ≤ 100%, also a trigger). Asset sources need the goal in the base currency.
 * Recurring contributions ("Setoran rutin") are goal plans on recurring transfers (`goal_contribution_plans`), so
 * they reach the Review queue like every recurrence (D14); a plan runs in its months only, and confirming an
 * occurrence credits each running plan's goal in the transfer's destination (`creditGoalIn`). Deposit and withdraw
 * are labeled transfers (the goal's tag and `transactions.goal_id`); "Bayar dari tujuan" is an expense with
 * `paid_from_goal_id`. Every method is one user transaction; percentages, ETA, and emergency-fund months are
 * `@wf/domain/goals`' job.
 */
import type { Dek } from '@wf/crypto/envelope';
import type { InvalidGoalAssetError } from '@wf/domain/goal-assets';
import {
  checkAssetAllocations,
  goalShares,
  splitUnits,
  type GoalAssetSource,
  type GoalAssetSourceMode,
} from '@wf/domain/goal-assets';
import type { GoalKind, GoalStatus, GoalTargetMode, GoalValuation } from '@wf/domain/goals';
import type { LocalDate, YearMonth } from '@wf/domain/period';
import { and, asc, eq, inArray, isNotNull, ne, sql, type SQL } from 'drizzle-orm';
import { viewsIn as accountViewsIn } from './accounts.ts';
import { firstRow, withUser, type Database, type Transaction } from './db.ts';
import { recordTransactionIn, resolveTagsIn, userContextIn, type EntryDraft } from './ledger-core.ts';
import { LedgerError } from './ledger-errors.ts';
import { decodeTemplate, encodeTemplate, userClockIn, type RecurrenceTemplate } from './occurrences.ts';
import { assetValuesIn } from './portfolio.ts';
import {
  activePlannedIn,
  createRecurrenceIn,
  lockedRecurrenceIn,
  planMonthColumns,
  rebuildRecurrenceIn,
  resumeRecurrenceIn,
  stopRecurrenceIn,
  wholeHolderIn,
  type PlanMonthColumns,
} from './schedules.ts';
import {
  accounts,
  assets,
  goalContributionPlans,
  goalFundingSources,
  goals,
  recurrences,
  tags,
  transactions,
  type GOAL_SOURCE_MODES,
} from './schema.ts';

/** Modes of an account source (asset sources: `GoalAssetSourceMode`). */
export type GoalSourceMode = Exclude<(typeof GOAL_SOURCE_MODES)[number], 'percent'>;

/** A funding source as entered ("Atur sumber dana"). */
export interface GoalSourceInput {
  /** An active account in the goal's currency. */
  readonly accountId: string;
  /** `whole`: the account's balance (no other goal may use it); `fixed`: `amountMinor` of it. */
  readonly mode: GoalSourceMode;
  /** `fixed` only: > 0 and ≤ the account's free balance (balance − other goals' fixed amounts). */
  readonly amountMinor?: bigint | null;
}

export interface GoalSourceView {
  readonly id: string;
  readonly accountId: string;
  readonly accountName: string;
  readonly mode: GoalSourceMode;
  /** `fixed` only. */
  readonly amountMinor: bigint | null;
  /** What it adds to the goal now: the fixed amount, or the account's balance. */
  readonly valueMinor: bigint;
  readonly sortOrder: number;
}

/** An investment asset as a funding source ("Atur sumber dana" › aset). */
export interface GoalAssetSourceInput {
  readonly assetId: string;
  /** `whole`: the whole asset (counts 100%); `percent`: `pctBps` of its units. */
  readonly mode: GoalAssetSourceMode;
  /** `percent` only: 1–10 000; Σ per asset across goals ≤ 10 000. */
  readonly pctBps?: number | null;
}

/** A goal's share of one asset ("Atur alokasi ke tujuan" in the asset detail). */
export interface AssetAllocationInput {
  readonly goalId: string;
  readonly mode: GoalAssetSourceMode;
  /** `percent` only: 1–10 000. */
  readonly pctBps?: number | null;
}

export interface GoalAssetSourceView {
  readonly id: string;
  readonly assetId: string;
  readonly symbol: string;
  readonly assetName: string;
  readonly mode: GoalAssetSourceMode;
  /** 10 000 for a whole asset. */
  readonly bps: number;
  /** The goal's units of the asset ("0,718 unit"). */
  readonly units: string;
  /** Its part of the asset's value now plus pending buys ("diproses"), base currency (= the goal's). */
  readonly valueMinor: bigint;
  /** Missing FX is not a zero valuation; a missing price uses cost (FR-G6). */
  readonly valuation: Exclude<GoalValuation, 'cash'>;
  readonly sortOrder: number;
}

/** A recurring contribution: the goal's share of a recurring transfer (day and from → to are the recurrence's). */
export interface GoalPlanView {
  readonly id: string;
  readonly recurrenceId: string;
  /** In the destination account's currency. */
  readonly amountMinor: bigint;
  readonly active: boolean;
  /** The first month it sends its share in. */
  readonly startMonth: YearMonth;
  /** The last one; `null` = until changed. */
  readonly endMonth: YearMonth | null;
  /** Monthly recurrences only. */
  readonly monthDay: number | null;
  readonly fromAccountId: string;
  readonly toAccountId: string;
  readonly recurrenceStatus: 'active' | 'stopped';
}

export interface GoalView {
  readonly id: string;
  readonly name: string;
  readonly icon: string;
  readonly color: string;
  readonly kind: GoalKind;
  /** The target in force; for `monthly_expenses` the value last computed from `targetMonths`. */
  readonly targetMinor: bigint;
  readonly targetMode: GoalTargetMode;
  readonly targetMonths: number | null;
  readonly currency: string;
  readonly deadlineMonth: YearMonth | null;
  /** Slug of the goal's tag. */
  readonly tag: string | null;
  /** "Simpan di": where deposits go by default. */
  readonly accountId: string | null;
  /** "Tercapai" is derived (saved ≥ target while `active`). */
  readonly status: GoalStatus;
  readonly completedAt: Date | null;
  readonly sortOrder: number;
  readonly archivedAt: Date | null;
  /** Account sources, in source order. */
  readonly sources: GoalSourceView[];
  /** Asset sources, in source order. */
  readonly assetSources: GoalAssetSourceView[];
  /** Σ source values (accounts and assets), in `currency`. */
  readonly savedMinor: bigint;
  /** Oldest first. */
  readonly plans: GoalPlanView[];
  /** Σ active plan amounts ("Rp3.500.000/bulan"). */
  readonly monthlyPlanMinor: bigint;
}

export interface GoalInput {
  /** 1–40 characters after trimming. */
  readonly name: string;
  readonly icon: string;
  readonly color: string;
  /** Default `savings`; "Dana tidak rutin" are `sinking`. */
  readonly kind?: GoalKind;
  /** > 0, in `currency`. */
  readonly targetMinor: bigint;
  /** Default `fixed`. */
  readonly targetMode?: GoalTargetMode;
  /** `monthly_expenses` only (required): 1–24 ("3× pengeluaran bulanan"). */
  readonly targetMonths?: number | null;
  readonly currency: string;
  /** `YYYY-MM`. */
  readonly deadlineMonth: YearMonth | null;
  /** Tag input (`#Dana Darurat`, `dana-darurat`); created when missing. */
  readonly tag: string | null;
  /** "Simpan di": one of the user's active accounts; default none. */
  readonly accountId?: string | null;
  /** Default none. */
  readonly sources?: readonly GoalSourceInput[];
  /** Default none. */
  readonly assetSources?: readonly GoalAssetSourceInput[];
}

/** Editable fields; omitted ones are kept. */
export type GoalPatch = Partial<Omit<GoalInput, 'currency' | 'sources' | 'assetSources'>>;

/** "Setor manual". */
export interface GoalDeposit {
  /** Idempotency key of the transfer. */
  readonly clientId: string;
  readonly occurredAt: Date;
  readonly fromAccountId: string;
  /** Default: the goal's account, else its first source account; in the goal's currency. */
  readonly toAccountId?: string | null;
  /** > 0, in the goal's currency. */
  readonly amountMinor: bigint;
  readonly note?: string | null;
}

/** "Tarik dana". */
export interface GoalWithdrawal {
  readonly clientId: string;
  readonly occurredAt: Date;
  /** One of the goal's source accounts. */
  readonly fromAccountId: string;
  /** In the same currency. */
  readonly toAccountId: string;
  /** > 0; at most the fixed amount of a fixed source. */
  readonly amountMinor: bigint;
  readonly note?: string | null;
}

/**
 * A new recurring contribution: a share of an existing recurring transfer, or a new monthly one. It runs from
 * `startMonth` (default: this month when joining, `startOn`'s month for a new transfer) to `endMonth` (default: until
 * changed), so a "Nov–Apr" fund joining the payday set-aside is not in October's.
 */
export type GoalPlanInput = (
  | { readonly recurrenceId: string; readonly amountMinor: bigint }
  | {
      readonly amountMinor: bigint;
      /** 1–31 (clamped to the month's last day). */
      readonly monthDay: number;
      readonly fromAccountId: string;
      /** Default: the goal's account, else its first source account. */
      readonly toAccountId?: string | null;
      readonly startOn: LocalDate;
      /** Default 1 (H-1); `null` = no reminder. */
      readonly remindOffsetDays?: number | null;
    }
) & {
  /** `YYYY-MM`. */
  readonly startMonth?: YearMonth;
  /** `YYYY-MM`, not before `startMonth`. */
  readonly endMonth?: YearMonth | null;
};

/** Per account: what goals hold of it (Accounts page "dialokasikan ke tabungan"). */
export interface AccountAllocation {
  readonly accountId: string;
  /** In the account currency: Σ fixed amounts, or the balance when held wholly. */
  readonly allocatedMinor: bigint;
  readonly goalIds: string[];
}

export interface GoalsRepository {
  /** Goals by their order, then creation; default every status. */
  list: (userId: string, options?: { readonly status?: GoalStatus | 'all' }) => Promise<GoalView[]>;
  /** @throws {LedgerError} `NOT_FOUND` */
  get: (userId: string, id: string) => Promise<GoalView>;
  /** @throws {LedgerError} `INVALID_GOAL` (also for an unknown or archived account or a source rule), `INVALID_TAG` */
  create: (userId: string, input: GoalInput) => Promise<GoalView>;
  /** @throws {LedgerError} `NOT_FOUND`, `INVALID_GOAL`, `INVALID_TAG` */
  update: (userId: string, id: string, patch: GoalPatch) => Promise<GoalView>;
  /** Replaces the account funding sources. @throws {LedgerError} `NOT_FOUND`, `INVALID_GOAL` */
  setSources: (userId: string, id: string, sources: readonly GoalSourceInput[]) => Promise<GoalView>;
  /**
   * Replaces the asset funding sources (FR-G2).
   * @throws {LedgerError} `NOT_FOUND`, `INVALID_GOAL` (another currency than the base, Σ per asset > 100%)
   */
  setAssetSources: (userId: string, id: string, sources: readonly GoalAssetSourceInput[]) => Promise<GoalView>;
  /**
   * Replaces every goal's source on one asset at once (FR-G2 from the asset's side): the goals listed hold exactly
   * these shares (Σ ≤ 100%, each goal once, in the base currency), the asset's other sources go. A goal keeps the
   * place of a source it already had.
   * @throws {LedgerError} `NOT_FOUND` (asset), `INVALID_GOAL`
   */
  setAssetAllocations: (userId: string, assetId: string, sources: readonly AssetAllocationInput[]) => Promise<void>;
  /** Accounts with an allocation, in account order. */
  allocations: (userId: string) => Promise<AccountAllocation[]>;
  /**
   * "Hapus tujuan": transactions stay (unlinked), its plans go and a recurrence left without active plans stops.
   * @throws {LedgerError} `NOT_FOUND`
   */
  remove: (userId: string, id: string) => Promise<void>;
  /**
   * A transfer labeled with the goal; the destination's allocation grows (a fixed source gains the amount, a new
   * one is made; a whole source grows by itself).
   * @throws {LedgerError} `NOT_FOUND`, `INVALID_GOAL` (not active, another currency, an account held wholly by another
   * goal), and every code of recording a transfer
   */
  deposit: (userId: string, id: string, input: GoalDeposit) => Promise<{ transactionId: string; goal: GoalView }>;
  /**
   * A transfer out of one of the goal's source accounts, labeled with the goal; a fixed source shrinks (and goes at 0).
   * @throws {LedgerError} `NOT_FOUND`, `INVALID_GOAL`, and every code of recording a transfer
   */
  withdraw: (userId: string, id: string, input: GoalWithdrawal) => Promise<{ transactionId: string; goal: GoalView }>;
  /**
   * "Bayar dari tujuan": an expense with `paid_from_goal_id`; a fixed source on its account shrinks by the amount (at
   * most to 0); `markUsed` → status `used` ("Terpakai").
   * @throws {LedgerError} `NOT_FOUND`, `INVALID_GOAL` (not an expense, not active), and every code of recording it
   */
  spend: (
    userId: string,
    id: string,
    input: { readonly draft: EntryDraft; readonly markUsed: boolean },
  ) => Promise<{ transactionId: string; goal: GoalView }>;
  /**
   * "Pindahkan sisa" of a completed or used goal: its sources go to `toGoalId` (fixed amounts merge on the same
   * account), or are released (`null`, "Lepas jadi saldo bebas"). No money moves.
   * @throws {LedgerError} `NOT_FOUND`, `INVALID_GOAL`
   */
  moveRemainder: (userId: string, id: string, input: { readonly toGoalId: string | null }) => Promise<GoalView[]>;
  /** "Tandai selesai"; `stopPlans` deactivates its active plans. @throws {LedgerError} `NOT_FOUND`, `INVALID_GOAL` */
  complete: (
    userId: string,
    id: string,
    input: { readonly stopPlans: boolean },
  ) => Promise<{ goal: GoalView; stoppedPlanIds: string[] }>;
  /** "Urungkan": active again, the given plans of the goal reactivated. @throws {LedgerError} `NOT_FOUND` */
  reopen: (userId: string, id: string, input?: { readonly resumePlanIds?: readonly string[] }) => Promise<GoalView>;
  /**
   * A share of a recurring transfer; its destination must not be held wholly by another goal (confirming credits the
   * goal there).
   * @throws {LedgerError} `NOT_FOUND`, `INVALID_GOAL` (also for months that are not `YYYY-MM` or end before they
   * start), `INVALID_RECURRENCE`
   */
  addPlan: (userId: string, goalId: string, input: GoalPlanInput) => Promise<GoalView>;
  /**
   * Pauses or resumes a plan. A recurrence fully planned for goals sends Σ active plans; with none left it stops,
   * with one again it resumes.
   * @throws {LedgerError} `NOT_FOUND`
   */
  setPlanActive: (userId: string, planId: string, active: boolean) => Promise<GoalView>;
  /** @throws {LedgerError} `NOT_FOUND`, `INVALID_GOAL` */
  updatePlan: (userId: string, planId: string, input: { readonly amountMinor: bigint }) => Promise<GoalView>;
}

const NAME_MAX = 40;
const CURRENCY = /^[A-Z]{3}$/;
const YEAR_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const TARGET_MONTHS_MAX = 24;

const invalid = (message: string) => new LedgerError('INVALID_GOAL', message);

type GoalRow = typeof goals.$inferSelect;

/** Balances of `ids` by account id (missing ids are absent). */
async function balancesIn(tx: Transaction, userId: string, ids: readonly string[]): Promise<Map<string, bigint>> {
  if (ids.length === 0) return new Map();
  const { views } = await accountViewsIn(tx, userId, inArray(accounts.id, [...ids]));
  return new Map(views.map((view) => [view.id, view.balanceMinor]));
}

/** Read-only, same-transaction builder shared with the dated goal snapshot job. */
export async function goalViewsIn(tx: Transaction, userId: string, now: Date, where?: SQL): Promise<GoalView[]> {
  const rows = await tx
    .select({
      id: goals.id,
      name: goals.name,
      icon: goals.icon,
      color: goals.color,
      kind: goals.kind,
      targetMinor: goals.targetMinor,
      targetMode: goals.targetMode,
      targetMonths: goals.targetMonths,
      currency: goals.currency,
      deadlineMonth: sql<YearMonth | null>`to_char(${goals.deadlineMonth}, 'YYYY-MM')`,
      tag: tags.slug,
      accountId: goals.accountId,
      status: goals.status,
      completedAt: goals.completedAt,
      sortOrder: goals.sortOrder,
      archivedAt: goals.archivedAt,
    })
    .from(goals)
    .leftJoin(tags, eq(tags.id, goals.tagId))
    .where(where)
    .orderBy(asc(goals.sortOrder), asc(goals.createdAt), asc(goals.id));
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);
  const sources = await tx
    .select({
      id: goalFundingSources.id,
      goalId: goalFundingSources.goalId,
      accountId: goalFundingSources.accountId,
      accountName: accounts.displayName,
      mode: goalFundingSources.mode,
      amountMinor: goalFundingSources.amountMinor,
      sortOrder: goalFundingSources.sortOrder,
    })
    .from(goalFundingSources)
    .innerJoin(accounts, eq(accounts.id, goalFundingSources.accountId))
    .where(inArray(goalFundingSources.goalId, ids))
    .orderBy(asc(goalFundingSources.sortOrder), asc(goalFundingSources.createdAt), asc(goalFundingSources.id));
  const balances = await balancesIn(
    tx,
    userId,
    sources.filter((source) => source.mode === 'whole').map((source) => source.accountId as string),
  );
  const assetSources = await assetSourcesIn(tx, userId, now, ids);
  const plans = await tx
    .select({
      id: goalContributionPlans.id,
      goalId: goalContributionPlans.goalId,
      recurrenceId: goalContributionPlans.recurrenceId,
      amountMinor: goalContributionPlans.amountMinor,
      active: goalContributionPlans.active,
      monthDay: recurrences.monthDay,
      startMonth: sql<YearMonth>`to_char(${goalContributionPlans.startMonth}, 'YYYY-MM')`,
      endMonth: sql<YearMonth | null>`to_char(${goalContributionPlans.endMonth}, 'YYYY-MM')`,
      template: recurrences.template,
      recurrenceStatus: recurrences.status,
    })
    .from(goalContributionPlans)
    .innerJoin(recurrences, eq(recurrences.id, goalContributionPlans.recurrenceId))
    .where(inArray(goalContributionPlans.goalId, ids))
    .orderBy(asc(goalContributionPlans.createdAt), asc(goalContributionPlans.id));
  return rows.map((row) => {
    const own = sources
      .filter((source) => source.goalId === row.id)
      .map((source): GoalSourceView => ({
        id: source.id,
        accountId: source.accountId as string,
        accountName: source.accountName,
        mode: source.mode as GoalSourceMode,
        amountMinor: source.amountMinor,
        valueMinor: source.amountMinor ?? (balances.get(source.accountId as string) as bigint),
        sortOrder: source.sortOrder,
      }));
    const ownPlans = plans
      .filter((plan) => plan.goalId === row.id)
      .map((plan): GoalPlanView => {
        // Plans only ever sit on transfers (`checkTemplateIn` keeps allocations to them).
        const transfer = decodeTemplate(plan.template) as Extract<RecurrenceTemplate, { type: 'transfer' }>;
        return {
          id: plan.id,
          recurrenceId: plan.recurrenceId,
          amountMinor: plan.amountMinor,
          active: plan.active,
          startMonth: plan.startMonth,
          endMonth: plan.endMonth,
          monthDay: plan.monthDay,
          fromAccountId: transfer.fromAccountId,
          toAccountId: transfer.toAccountId,
          recurrenceStatus: plan.recurrenceStatus,
        };
      });
    const ownAssets = assetSources.filter((source) => source.goalId === row.id).map((source) => source.view);
    return {
      ...row,
      sources: own,
      assetSources: ownAssets,
      savedMinor: [...own, ...ownAssets].reduce((sum, source) => sum + source.valueMinor, 0n),
      plans: ownPlans,
      monthlyPlanMinor: ownPlans.reduce((sum, plan) => sum + (plan.active ? plan.amountMinor : 0n), 0n),
    };
  });
}

async function viewIn(tx: Transaction, userId: string, now: Date, id: string): Promise<GoalView> {
  const [view] = await goalViewsIn(tx, userId, now, eq(goals.id, id));
  if (view === undefined) throw new LedgerError('NOT_FOUND', 'No such goal');
  return view;
}

async function lockedGoalIn(tx: Transaction, id: string): Promise<GoalRow> {
  const [row] = await tx.select().from(goals).where(eq(goals.id, id)).for('update');
  if (row === undefined) throw new LedgerError('NOT_FOUND', 'No such goal');
  return row;
}

/** An active account in `currency`. */
async function checkAccountIn(tx: Transaction, id: string, currency: string): Promise<void> {
  const [account] = await tx
    .select({ currency: accounts.currency })
    .from(accounts)
    .where(and(eq(accounts.id, id), eq(accounts.status, 'active')));
  if (account === undefined) throw invalid('No such active account');
  if (account.currency !== currency) throw invalid('The account must be in the goal currency');
}

/**
 * FR-G2 rules for `goalId`'s new sources: distinct active accounts in `currency`; `whole` only on an account no other
 * goal uses; `fixed` positive, not on an account another goal holds wholly, and ≤ the free balance.
 */
async function checkSourcesIn(
  tx: Transaction,
  userId: string,
  goalId: string | null,
  currency: string,
  sources: readonly GoalSourceInput[],
): Promise<void> {
  const ids = sources.map((source) => source.accountId);
  if (new Set(ids).size !== ids.length) throw invalid('One source per account');
  for (const source of sources) await checkAccountIn(tx, source.accountId, currency);
  if (ids.length === 0) return;
  const others = await tx
    .select({
      accountId: goalFundingSources.accountId,
      mode: goalFundingSources.mode,
      amountMinor: goalFundingSources.amountMinor,
    })
    .from(goalFundingSources)
    .where(
      and(
        inArray(goalFundingSources.accountId, ids),
        goalId === null ? undefined : ne(goalFundingSources.goalId, goalId),
      ),
    );
  const balances = await balancesIn(tx, userId, ids);
  for (const source of sources) {
    const onAccount = others.filter((other) => other.accountId === source.accountId);
    if (source.mode === 'whole') {
      if (onAccount.length > 0) throw invalid('The account is already used by another goal');
      if ((source.amountMinor ?? null) !== null) throw invalid('A whole account has no amount');
      continue;
    }
    const amount = source.amountMinor ?? 0n;
    if (amount <= 0n) throw invalid('A fixed amount must be positive');
    if (onAccount.some((other) => other.mode === 'whole')) throw invalid('Another goal holds the whole account');
    // Every other source here is fixed: a whole one was refused above.
    const taken = onAccount.reduce((sum, other) => sum + (other.amountMinor as bigint), 0n);
    if (amount > (balances.get(source.accountId) as bigint) - taken) {
      throw invalid('The amount exceeds the free balance');
    }
  }
}

async function writeSourcesIn(
  tx: Transaction,
  userId: string,
  goalId: string,
  sources: readonly GoalSourceInput[],
): Promise<void> {
  await tx
    .delete(goalFundingSources)
    .where(and(eq(goalFundingSources.goalId, goalId), isNotNull(goalFundingSources.accountId)));
  if (sources.length === 0) return;
  await tx.insert(goalFundingSources).values(
    sources.map((source, index) => ({
      userId,
      goalId,
      accountId: source.accountId,
      mode: source.mode,
      amountMinor: source.mode === 'fixed' ? (source.amountMinor as bigint) : null,
      sortOrder: index,
    })),
  );
}

/** Validated goal columns of `input` (all fields given). */
async function goalValuesIn(tx: Transaction, userId: string, input: Omit<GoalInput, 'sources'>) {
  const name = input.name.trim();
  if (name.length === 0 || name.length > NAME_MAX) throw invalid('Invalid goal name');
  if (input.targetMinor <= 0n) throw invalid('The target must be positive');
  if (!CURRENCY.test(input.currency)) throw invalid('Invalid currency code');
  if (input.deadlineMonth !== null && !YEAR_MONTH.test(input.deadlineMonth)) {
    throw invalid('The deadline must be YYYY-MM');
  }
  const targetMode = input.targetMode ?? 'fixed';
  const targetMonths = input.targetMonths ?? null;
  if (
    targetMode === 'monthly_expenses'
      ? targetMonths === null || !Number.isInteger(targetMonths) || targetMonths < 1 || targetMonths > TARGET_MONTHS_MAX
      : targetMonths !== null
  ) {
    throw invalid('Months of spending only for a dynamic target, 1–24');
  }
  const accountId = input.accountId ?? null;
  if (accountId !== null) await checkAccountIn(tx, accountId, input.currency);
  const [tagId = null] = input.tag === null ? [] : await resolveTagsIn(tx, userId, [input.tag]);
  return {
    name,
    icon: input.icon,
    color: input.color,
    kind: input.kind ?? 'savings',
    targetMinor: input.targetMinor,
    targetMode,
    targetMonths,
    currency: input.currency,
    // Stored as the first day of the month (`goals_deadline_check`).
    deadlineMonth: input.deadlineMonth === null ? null : (`${input.deadlineMonth}-01` as LocalDate),
    tagId,
    accountId,
  };
}

/** The input a stored goal was made from (to apply a patch onto). */
async function inputOfIn(tx: Transaction, row: GoalRow): Promise<Omit<GoalInput, 'sources'>> {
  const [tag] = row.tagId === null ? [] : await tx.select({ slug: tags.slug }).from(tags).where(eq(tags.id, row.tagId));
  return {
    name: row.name,
    icon: row.icon,
    color: row.color,
    kind: row.kind,
    targetMinor: row.targetMinor,
    targetMode: row.targetMode,
    targetMonths: row.targetMonths,
    currency: row.currency,
    deadlineMonth: row.deadlineMonth === null ? null : (row.deadlineMonth.slice(0, 7) as YearMonth),
    tag: tag?.slug ?? null,
    accountId: row.accountId,
  };
}

/** The account a deposit or new plan goes to by default: the goal's, else its first account source's. */
async function homeAccountIn(tx: Transaction, row: GoalRow): Promise<string> {
  if (row.accountId !== null) return row.accountId;
  const [source] = await tx
    .select({ accountId: goalFundingSources.accountId })
    .from(goalFundingSources)
    .where(and(eq(goalFundingSources.goalId, row.id), isNotNull(goalFundingSources.accountId)))
    .orderBy(asc(goalFundingSources.sortOrder), asc(goalFundingSources.createdAt));
  if (source === undefined) throw invalid('The goal has no account to deposit to');
  return source.accountId as string;
}

/** The asset sources of `goalIds` with their units and value now (their share of value + pending buys). */
async function assetSourcesIn(
  tx: Transaction,
  userId: string,
  now: Date,
  goalIds: readonly string[],
): Promise<{ readonly goalId: string; readonly view: GoalAssetSourceView }[]> {
  const rows = await tx
    .select({
      id: goalFundingSources.id,
      goalId: goalFundingSources.goalId,
      assetId: goalFundingSources.assetId,
      mode: goalFundingSources.mode,
      pctBps: goalFundingSources.pctBps,
      sortOrder: goalFundingSources.sortOrder,
    })
    .from(goalFundingSources)
    .where(isNotNull(goalFundingSources.assetId))
    .orderBy(asc(goalFundingSources.sortOrder), asc(goalFundingSources.createdAt), asc(goalFundingSources.id));
  if (!rows.some((row) => goalIds.includes(row.goalId))) return [];
  const values = await assetValuesIn(tx, userId, now);
  return values.assets.flatMap((valuation) => {
    // Every source of the asset (all goals), so each goal gets its exact part of the whole.
    const onAsset = rows.filter((row) => row.assetId === valuation.asset.id);
    if (onAsset.length === 0) return [];
    const domain = onAsset.map((row): GoalAssetSource => ({
      goalId: row.goalId,
      mode: row.mode === 'whole' ? 'whole' : 'percent',
      bps: row.pctBps ?? 10_000,
    }));
    const shares = goalShares((valuation.value?.valueBaseMinor ?? 0n) + valuation.pendingBaseMinor, domain);
    const units = splitUnits(valuation.holding.units, domain);
    return onAsset.flatMap((row, index) =>
      goalIds.includes(row.goalId)
        ? [
            {
              goalId: row.goalId,
              view: {
                id: row.id,
                assetId: valuation.asset.id,
                symbol: valuation.asset.symbol,
                assetName: valuation.asset.name,
                mode: (domain[index] as GoalAssetSource).mode,
                bps: (domain[index] as GoalAssetSource).bps,
                units: (units.goals[index] as { value: string }).value,
                valueMinor: (shares.goals[index] as { value: bigint }).value,
                valuation:
                  valuation.holding.units === '0'
                    ? 'cost'
                    : valuation.value === null
                      ? 'unavailable'
                      : valuation.value.priced
                        ? 'market'
                        : 'cost',
                sortOrder: row.sortOrder,
              },
            },
          ]
        : [],
    );
  });
}

/**
 * FR-G2 rules for `goalId`'s new asset sources: the goal in the base currency, distinct assets of the user, and per
 * asset Σ with the other goals' sources ≤ 100% (a whole asset 100%).
 */
async function checkAssetSourcesIn(
  tx: Transaction,
  userId: string,
  goalId: string | null,
  currency: string,
  sources: readonly GoalAssetSourceInput[],
): Promise<void> {
  if (sources.length === 0) return;
  const { baseCurrency } = await userContextIn(tx, userId);
  if (currency !== baseCurrency) throw invalid('Assets fund goals in the base currency');
  const ids = sources.map((source) => source.assetId);
  if (new Set(ids).size !== ids.length) throw invalid('One source per asset');
  const found = await tx.select({ id: assets.id }).from(assets).where(inArray(assets.id, ids));
  if (found.length !== ids.length) throw invalid('No such asset');
  const others = await tx
    .select({
      goalId: goalFundingSources.goalId,
      assetId: goalFundingSources.assetId,
      mode: goalFundingSources.mode,
      pctBps: goalFundingSources.pctBps,
    })
    .from(goalFundingSources)
    .where(
      and(
        inArray(goalFundingSources.assetId, ids),
        goalId === null ? undefined : ne(goalFundingSources.goalId, goalId),
      ),
    );
  for (const source of sources) {
    if (source.mode === 'whole' && (source.pctBps ?? null) !== null) throw invalid('A whole asset has no percentage');
    try {
      checkAssetAllocations([
        ...others
          .filter((other) => other.assetId === source.assetId)
          .map((other): GoalAssetSource => ({
            goalId: other.goalId,
            mode: other.mode === 'whole' ? 'whole' : 'percent',
            bps: other.pctBps ?? 10_000,
          })),
        { goalId: goalId ?? '', mode: source.mode, bps: source.pctBps ?? 0 },
      ]);
    } catch (error) {
      // `checkAssetAllocations` refuses only with InvalidGoalAssetError.
      throw invalid(`Invalid asset allocation: ${(error as InvalidGoalAssetError).reason}`);
    }
  }
}

async function writeAssetSourcesIn(
  tx: Transaction,
  userId: string,
  goalId: string,
  sources: readonly GoalAssetSourceInput[],
): Promise<void> {
  await tx
    .delete(goalFundingSources)
    .where(and(eq(goalFundingSources.goalId, goalId), isNotNull(goalFundingSources.assetId)));
  if (sources.length === 0) return;
  await tx.insert(goalFundingSources).values(
    sources.map((source, index) => ({
      userId,
      goalId,
      assetId: source.assetId,
      mode: source.mode,
      pctBps: source.mode === 'percent' ? (source.pctBps as number) : null,
      sortOrder: index,
    })),
  );
}

async function sourceOnIn(tx: Transaction, goalId: string, accountId: string) {
  const [source] = await tx
    .select()
    .from(goalFundingSources)
    .where(and(eq(goalFundingSources.goalId, goalId), eq(goalFundingSources.accountId, accountId)));
  return source;
}

/** A fixed source's amount becomes `amountMinor` (deleted at 0). */
async function setFixedIn(tx: Transaction, sourceId: string, amountMinor: bigint, at: Date): Promise<void> {
  if (amountMinor === 0n) {
    await tx.delete(goalFundingSources).where(eq(goalFundingSources.id, sourceId));
    return;
  }
  await tx.update(goalFundingSources).set({ amountMinor, updatedAt: at }).where(eq(goalFundingSources.id, sourceId));
}

/**
 * Money that reached `accountId` for goal `goalId` ("Setor manual", a confirmed contribution or leftover move): the
 * goal's fixed amount there grows, or a fixed source is made. Nothing changes when the account is held wholly — by the
 * goal itself it grew already, by another goal the money counts there — or is in another currency than the goal.
 */
export async function creditGoalIn(
  tx: Transaction,
  userId: string,
  goalId: string,
  accountId: string,
  amountMinor: bigint,
  at: Date,
): Promise<void> {
  if (amountMinor <= 0n || (await wholeHolderIn(tx, accountId)) !== null) return;
  const currencies = firstRow(
    await tx
      .select({ goal: goals.currency, account: accounts.currency })
      .from(goals)
      .innerJoin(accounts, eq(accounts.id, accountId))
      .where(eq(goals.id, goalId)),
    'goals',
  );
  if (currencies.goal !== currencies.account) return;
  const source = await sourceOnIn(tx, goalId, accountId);
  if (source !== undefined) {
    await setFixedIn(tx, source.id, (source.amountMinor as bigint) + amountMinor, at);
    return;
  }
  await tx.insert(goalFundingSources).values({
    userId,
    goalId,
    accountId,
    mode: 'fixed',
    amountMinor,
    sortOrder: sql`(select coalesce(max(${goalFundingSources.sortOrder}) + 1, 0) from ${goalFundingSources} where ${goalFundingSources.goalId} = ${goalId})`,
  });
}

/**
 * After the active plans of a recurrence changed from `before` to their current Σ: a recurrence fully planned for
 * goals (one currency, sending exactly `before`) sends the new Σ; with no active plan it stops, else it runs again.
 */
async function syncRecurrenceIn(
  tx: Transaction,
  userId: string,
  recurrenceId: string,
  before: bigint,
  at: Date,
): Promise<void> {
  const row = await lockedRecurrenceIn(tx, recurrenceId);
  const { today } = await userClockIn(tx, userId, at);
  const after = await activePlannedIn(tx, recurrenceId);
  if (after === 0n) {
    await stopRecurrenceIn(tx, userId, row, at, today);
    return;
  }
  const template = decodeTemplate(row.template);
  // Fully planned: it sent exactly the active shares (or none were active, so it had stopped for them).
  const fully =
    template.type === 'transfer' &&
    template.sentMinor === template.receivedMinor &&
    (template.sentMinor === before || before === 0n);
  if (fully && after !== before) {
    await tx
      .update(recurrences)
      .set({ template: encodeTemplate({ ...template, sentMinor: after, receivedMinor: after }), updatedAt: at })
      .where(eq(recurrences.id, recurrenceId));
    if (row.status === 'active') await rebuildRecurrenceIn(tx, userId, recurrenceId, at, today);
  }
  if (row.status === 'stopped') await resumeRecurrenceIn(tx, userId, row, at);
}

async function lockedPlanIn(tx: Transaction, planId: string) {
  const [plan] = await tx
    .select()
    .from(goalContributionPlans)
    .where(eq(goalContributionPlans.id, planId))
    .for('update');
  if (plan === undefined) throw new LedgerError('NOT_FOUND', 'No such goal plan');
  return plan;
}

/** Sets plan `planId` active or not and keeps its recurrence in step. */
async function setPlanActiveIn(tx: Transaction, userId: string, planId: string, active: boolean, at: Date) {
  const plan = await lockedPlanIn(tx, planId);
  if (plan.active === active) return plan;
  const before = await activePlannedIn(tx, plan.recurrenceId);
  await tx.update(goalContributionPlans).set({ active, updatedAt: at }).where(eq(goalContributionPlans.id, planId));
  await syncRecurrenceIn(tx, userId, plan.recurrenceId, before, at);
  return plan;
}

/**
 * The stored months of a new plan of `goalId` sending to `toAccountId` (default: from `firstMonth` on, until changed),
 * once no other goal holds that account wholly — confirming credits the goal there.
 */
async function newPlanMonthsIn(
  tx: Transaction,
  goalId: string,
  toAccountId: string,
  input: { readonly startMonth?: YearMonth; readonly endMonth?: YearMonth | null },
  firstMonth: string,
): Promise<PlanMonthColumns> {
  const holder = await wholeHolderIn(tx, toAccountId);
  if (holder !== null && holder !== goalId) throw invalid('Another goal holds the destination wholly');
  const months = planMonthColumns(input.startMonth ?? firstMonth, input.endMonth ?? null);
  if (months === null) throw invalid('A contribution runs from a YYYY-MM month to one not before it');
  return months;
}

export function createGoals(
  db: Database,
  options: { readonly getDek?: (userId: string) => Promise<Dek>; readonly now?: () => Date } = {},
): GoalsRepository {
  const now = options.now ?? (() => new Date());
  /** The DEK only when a note is written (never fetched inside another `withUser` transaction). */
  const dekFor = async (userId: string, note: string | null | undefined): Promise<Dek | null> => {
    if ((note?.trim() ?? '') === '') return null;
    if (options.getDek === undefined) throw new TypeError('A note needs getDek');
    return options.getDek(userId);
  };

  /** A labeled transfer of the goal. */
  const transferIn = async (
    tx: Transaction,
    userId: string,
    row: GoalRow,
    input: GoalWithdrawal,
    dek: Dek | null,
    at: Date,
  ): Promise<string> => {
    const [tag] =
      row.tagId === null ? [] : await tx.select({ slug: tags.slug }).from(tags).where(eq(tags.id, row.tagId));
    const { id } = await recordTransactionIn(
      tx,
      userId,
      {
        type: 'transfer',
        clientId: input.clientId,
        occurredAt: input.occurredAt,
        fromAccountId: input.fromAccountId,
        toAccountId: input.toAccountId,
        sentMinor: input.amountMinor,
        receivedMinor: input.amountMinor,
        description: row.name,
        note: input.note ?? null,
        tags: tag === undefined ? [] : [tag.slug],
      },
      dek,
      at,
    );
    await tx.update(transactions).set({ goalId: row.id, updatedAt: at }).where(eq(transactions.id, id));
    return id;
  };

  return {
    list: (userId, { status = 'all' } = {}) =>
      withUser(db, userId, (tx) =>
        goalViewsIn(tx, userId, now(), status === 'all' ? undefined : eq(goals.status, status)),
      ),

    get: (userId, id) => withUser(db, userId, (tx) => viewIn(tx, userId, now(), id)),

    create: (userId, input) =>
      withUser(db, userId, async (tx) => {
        const values = await goalValuesIn(tx, userId, input);
        const sources = input.sources ?? [];
        const assetSources = input.assetSources ?? [];
        await checkSourcesIn(tx, userId, null, input.currency, sources);
        await checkAssetSourcesIn(tx, userId, null, input.currency, assetSources);
        const sortOrder = firstRow(
          await tx
            .select({ next: sql<number>`coalesce(max(${goals.sortOrder}) + 1, 0)::int`.mapWith(Number) })
            .from(goals),
          'goals',
        ).next;
        const { id } = firstRow(
          await tx
            .insert(goals)
            .values({ userId, ...values, sortOrder })
            .returning({ id: goals.id }),
          'goals',
        );
        await writeSourcesIn(tx, userId, id, sources);
        await writeAssetSourcesIn(tx, userId, id, assetSources);
        return viewIn(tx, userId, now(), id);
      }),

    update: (userId, id, patch) =>
      withUser(db, userId, async (tx) => {
        const row = await lockedGoalIn(tx, id);
        const values = await goalValuesIn(tx, userId, { ...(await inputOfIn(tx, row)), ...patch });
        await tx
          .update(goals)
          .set({ ...values, updatedAt: now() })
          .where(eq(goals.id, id));
        return viewIn(tx, userId, now(), id);
      }),

    setSources: (userId, id, sources) =>
      withUser(db, userId, async (tx) => {
        const row = await lockedGoalIn(tx, id);
        await checkSourcesIn(tx, userId, id, row.currency, sources);
        await writeSourcesIn(tx, userId, id, sources);
        return viewIn(tx, userId, now(), id);
      }),

    setAssetSources: (userId, id, sources) =>
      withUser(db, userId, async (tx) => {
        const row = await lockedGoalIn(tx, id);
        await checkAssetSourcesIn(tx, userId, id, row.currency, sources);
        await writeAssetSourcesIn(tx, userId, id, sources);
        return viewIn(tx, userId, now(), id);
      }),

    setAssetAllocations: (userId, assetId, sources) =>
      withUser(db, userId, async (tx) => {
        const [asset] = await tx.select({ id: assets.id }).from(assets).where(eq(assets.id, assetId)).for('update');
        if (asset === undefined) throw new LedgerError('NOT_FOUND', 'No such asset');
        const removeAll = () => tx.delete(goalFundingSources).where(eq(goalFundingSources.assetId, assetId));
        if (sources.length === 0) {
          await removeAll();
          return;
        }
        const goalIds = sources.map((source) => source.goalId);
        const found = await tx
          .select({ id: goals.id, currency: goals.currency })
          .from(goals)
          .where(inArray(goals.id, goalIds));
        if (found.length !== new Set(goalIds).size) throw invalid('No such goal');
        const { baseCurrency } = await userContextIn(tx, userId);
        if (found.some((goal) => goal.currency !== baseCurrency))
          throw invalid('Assets fund goals in the base currency');
        if (sources.some((source) => source.mode === 'whole' && (source.pctBps ?? null) !== null)) {
          throw invalid('A whole asset has no percentage');
        }
        try {
          checkAssetAllocations(
            sources.map((source) => ({ goalId: source.goalId, mode: source.mode, bps: source.pctBps ?? 0 })),
          );
        } catch (error) {
          // `checkAssetAllocations` refuses only with InvalidGoalAssetError.
          throw invalid(`Invalid asset allocation: ${(error as InvalidGoalAssetError).reason}`);
        }
        const current = await tx
          .select({
            goalId: goalFundingSources.goalId,
            assetId: goalFundingSources.assetId,
            sortOrder: goalFundingSources.sortOrder,
          })
          .from(goalFundingSources)
          .where(inArray(goalFundingSources.goalId, goalIds));
        await removeAll();
        await tx.insert(goalFundingSources).values(
          sources.map((source) => {
            const own = current.filter((row) => row.goalId === source.goalId && row.assetId !== null);
            const kept = own.find((row) => row.assetId === assetId);
            return {
              userId,
              goalId: source.goalId,
              assetId,
              mode: source.mode,
              pctBps: source.mode === 'percent' ? (source.pctBps as number) : null,
              sortOrder: kept?.sortOrder ?? Math.max(-1, ...own.map((row) => row.sortOrder)) + 1,
            };
          }),
        );
      }),

    allocations: (userId) =>
      withUser(db, userId, async (tx) => {
        const sources = await tx.select().from(goalFundingSources).where(isNotNull(goalFundingSources.accountId));
        const balances = await balancesIn(tx, userId, [
          ...new Set(sources.map((source) => source.accountId as string)),
        ]);
        const order = await tx
          .select({ id: accounts.id })
          .from(accounts)
          .orderBy(asc(accounts.sortOrder), asc(accounts.createdAt), asc(accounts.id));
        return order.flatMap(({ id }): AccountAllocation[] => {
          const onAccount = sources.filter((source) => source.accountId === id);
          if (onAccount.length === 0) return [];
          return [
            {
              accountId: id,
              allocatedMinor: onAccount.reduce(
                (sum, source) => sum + (source.amountMinor ?? (balances.get(id) as bigint)),
                0n,
              ),
              goalIds: onAccount.map((source) => source.goalId),
            },
          ];
        });
      }),

    remove: (userId, id) =>
      withUser(db, userId, async (tx) => {
        await lockedGoalIn(tx, id);
        const at = now();
        await tx.update(transactions).set({ goalId: null }).where(eq(transactions.goalId, id));
        await tx.update(transactions).set({ paidFromGoalId: null }).where(eq(transactions.paidFromGoalId, id));
        const plans = await tx
          .select({ recurrenceId: goalContributionPlans.recurrenceId })
          .from(goalContributionPlans)
          .where(and(eq(goalContributionPlans.goalId, id), eq(goalContributionPlans.active, true)));
        const before = new Map<string, bigint>();
        for (const { recurrenceId } of plans) before.set(recurrenceId, await activePlannedIn(tx, recurrenceId));
        await tx.delete(goals).where(eq(goals.id, id));
        for (const [recurrenceId, total] of before) await syncRecurrenceIn(tx, userId, recurrenceId, total, at);
      }),

    deposit: async (userId, id, input) => {
      const dek = await dekFor(userId, input.note);
      return withUser(db, userId, async (tx) => {
        const row = await lockedGoalIn(tx, id);
        if (row.status !== 'active') throw invalid('Only an active goal takes deposits');
        const toAccountId = input.toAccountId ?? (await homeAccountIn(tx, row));
        await checkAccountIn(tx, toAccountId, row.currency);
        const holder = await wholeHolderIn(tx, toAccountId);
        if (holder !== null && holder !== id) throw invalid('Another goal holds the whole account');
        const at = now();
        const transactionId = await transferIn(tx, userId, row, { ...input, toAccountId }, dek, at);
        await creditGoalIn(tx, userId, id, toAccountId, input.amountMinor, at);
        return { transactionId, goal: await viewIn(tx, userId, now(), id) };
      });
    },

    withdraw: async (userId, id, input) => {
      const dek = await dekFor(userId, input.note);
      return withUser(db, userId, async (tx) => {
        const row = await lockedGoalIn(tx, id);
        const source = await sourceOnIn(tx, id, input.fromAccountId);
        if (source === undefined) throw invalid('Withdraw from one of the goal’s accounts');
        if (source.mode === 'fixed' && input.amountMinor > (source.amountMinor as bigint)) {
          throw invalid('The amount exceeds what the goal holds there');
        }
        await checkAccountIn(tx, input.toAccountId, row.currency);
        const at = now();
        const transactionId = await transferIn(tx, userId, row, input, dek, at);
        if (source.mode === 'fixed') {
          await setFixedIn(tx, source.id, (source.amountMinor as bigint) - input.amountMinor, at);
        }
        return { transactionId, goal: await viewIn(tx, userId, now(), id) };
      });
    },

    spend: async (userId, id, { draft, markUsed }) => {
      const dek = await dekFor(userId, draft.note);
      return withUser(db, userId, async (tx) => {
        const row = await lockedGoalIn(tx, id);
        if (draft.type !== 'expense') throw invalid('Paying from a goal is an expense');
        if (row.status !== 'active') throw invalid('Only an active goal pays');
        const at = now();
        const { id: transactionId } = await recordTransactionIn(tx, userId, draft, dek, at);
        await tx
          .update(transactions)
          .set({ paidFromGoalId: id, updatedAt: at })
          .where(eq(transactions.id, transactionId));
        const source = await sourceOnIn(tx, id, draft.accountId);
        if (source?.mode === 'fixed') {
          const held = source.amountMinor as bigint;
          await setFixedIn(tx, source.id, held > draft.amountMinor ? held - draft.amountMinor : 0n, at);
        }
        if (markUsed) {
          await tx.update(goals).set({ status: 'used', completedAt: at, updatedAt: at }).where(eq(goals.id, id));
        }
        return { transactionId, goal: await viewIn(tx, userId, now(), id) };
      });
    },

    moveRemainder: (userId, id, { toGoalId }) =>
      withUser(db, userId, async (tx) => {
        const row = await lockedGoalIn(tx, id);
        if (row.status === 'active') throw invalid('Only a completed or used goal hands its remainder on');
        const sources = await tx.select().from(goalFundingSources).where(eq(goalFundingSources.goalId, id));
        const at = now();
        if (toGoalId !== null) {
          const target = await lockedGoalIn(tx, toGoalId);
          if (target.id === id || target.status !== 'active' || target.currency !== row.currency) {
            throw invalid('Move the remainder to another active goal in the same currency');
          }
          for (const source of sources) {
            if (source.assetId !== null) {
              const [there] = await tx
                .select()
                .from(goalFundingSources)
                .where(and(eq(goalFundingSources.goalId, toGoalId), eq(goalFundingSources.assetId, source.assetId)));
              if (there === undefined) {
                await tx
                  .update(goalFundingSources)
                  .set({ goalId: toGoalId, updatedAt: at })
                  .where(eq(goalFundingSources.id, source.id));
                continue;
              }
              // Both are percentages (a whole asset is held by one goal only) counted toward the asset's 100%, so their
              // sum fits; the moved one goes first for the trigger.
              const pctBps = (there.pctBps as number) + (source.pctBps as number);
              await tx.delete(goalFundingSources).where(eq(goalFundingSources.id, source.id));
              await tx
                .update(goalFundingSources)
                .set(pctBps >= 10_000 ? { mode: 'whole', pctBps: null, updatedAt: at } : { pctBps, updatedAt: at })
                .where(eq(goalFundingSources.id, there.id));
              continue;
            }
            const there = await sourceOnIn(tx, toGoalId, source.accountId as string);
            if (there === undefined) {
              await tx
                .update(goalFundingSources)
                .set({ goalId: toGoalId, updatedAt: at })
                .where(eq(goalFundingSources.id, source.id));
              continue;
            }
            // Only fixed amounts can meet on one account (a whole one is held by a single goal).
            await setFixedIn(tx, there.id, (there.amountMinor as bigint) + (source.amountMinor as bigint), at);
            await tx.delete(goalFundingSources).where(eq(goalFundingSources.id, source.id));
          }
        }
        await tx.delete(goalFundingSources).where(eq(goalFundingSources.goalId, id));
        return goalViewsIn(tx, userId, now(), inArray(goals.id, toGoalId === null ? [id] : [id, toGoalId]));
      }),

    complete: (userId, id, { stopPlans }) =>
      withUser(db, userId, async (tx) => {
        const row = await lockedGoalIn(tx, id);
        if (row.status !== 'active') throw invalid('The goal is not active');
        const at = now();
        await tx.update(goals).set({ status: 'completed', completedAt: at, updatedAt: at }).where(eq(goals.id, id));
        const stoppedPlanIds: string[] = [];
        if (stopPlans) {
          const active = await tx
            .select({ id: goalContributionPlans.id })
            .from(goalContributionPlans)
            .where(and(eq(goalContributionPlans.goalId, id), eq(goalContributionPlans.active, true)))
            .orderBy(asc(goalContributionPlans.createdAt), asc(goalContributionPlans.id));
          for (const plan of active) {
            await setPlanActiveIn(tx, userId, plan.id, false, at);
            stoppedPlanIds.push(plan.id);
          }
        }
        return { goal: await viewIn(tx, userId, now(), id), stoppedPlanIds };
      }),

    reopen: (userId, id, { resumePlanIds = [] } = {}) =>
      withUser(db, userId, async (tx) => {
        await lockedGoalIn(tx, id);
        const at = now();
        await tx.update(goals).set({ status: 'active', completedAt: null, updatedAt: at }).where(eq(goals.id, id));
        for (const planId of resumePlanIds) {
          const plan = await lockedPlanIn(tx, planId);
          if (plan.goalId !== id) throw new LedgerError('NOT_FOUND', 'No such goal plan');
          await setPlanActiveIn(tx, userId, planId, true, at);
        }
        return viewIn(tx, userId, now(), id);
      }),

    addPlan: (userId, goalId, input) =>
      withUser(db, userId, async (tx) => {
        const row = await lockedGoalIn(tx, goalId);
        if (input.amountMinor <= 0n) throw invalid('A contribution must be positive');
        const at = now();
        if ('recurrenceId' in input) {
          const recurrence = await lockedRecurrenceIn(tx, input.recurrenceId);
          const template = decodeTemplate(recurrence.template);
          if (template.type !== 'transfer') throw invalid('Contributions are recurring transfers');
          const { today } = await userClockIn(tx, userId, at);
          const months = await newPlanMonthsIn(tx, goalId, template.toAccountId, input, today.slice(0, 7));
          const [taken] = await tx
            .select({ id: goalContributionPlans.id })
            .from(goalContributionPlans)
            .where(
              and(eq(goalContributionPlans.recurrenceId, recurrence.id), eq(goalContributionPlans.goalId, goalId)),
            );
          if (taken !== undefined) throw invalid('The goal already has a share of this transfer');
          if ((await activePlannedIn(tx, recurrence.id)) + input.amountMinor > template.receivedMinor) {
            throw invalid('The shares exceed the transfer');
          }
          await tx
            .insert(goalContributionPlans)
            .values({ userId, goalId, recurrenceId: recurrence.id, amountMinor: input.amountMinor, ...months });
          // A share that makes the transfer fully planned changes what its coming occurrences send.
          if (recurrence.status === 'active') await rebuildRecurrenceIn(tx, userId, recurrence.id, at, today);
          return viewIn(tx, userId, now(), goalId);
        }
        const toAccountId = input.toAccountId ?? (await homeAccountIn(tx, row));
        await checkAccountIn(tx, toAccountId, row.currency);
        const startMonth = input.startMonth ?? (input.startOn.slice(0, 7) as YearMonth);
        await newPlanMonthsIn(tx, goalId, toAccountId, input, startMonth);
        const [tag] =
          row.tagId === null ? [] : await tx.select({ slug: tags.slug }).from(tags).where(eq(tags.id, row.tagId));
        await createRecurrenceIn(
          tx,
          userId,
          {
            template: {
              type: 'transfer',
              fromAccountId: input.fromAccountId,
              toAccountId,
              sentMinor: input.amountMinor,
              receivedMinor: input.amountMinor,
              description: row.name,
              tags: tag === undefined ? [] : [tag.slug],
              allocations: [{ goalId, amountMinor: input.amountMinor, startMonth, endMonth: input.endMonth ?? null }],
            },
            freq: 'monthly',
            startOn: input.startOn,
            monthDay: input.monthDay,
            end: { type: 'never' },
            remindOffsetDays: input.remindOffsetDays === undefined ? 1 : input.remindOffsetDays,
          },
          at,
        );
        return viewIn(tx, userId, now(), goalId);
      }),

    setPlanActive: (userId, planId, active) =>
      withUser(db, userId, async (tx) => {
        const plan = await setPlanActiveIn(tx, userId, planId, active, now());
        return viewIn(tx, userId, now(), plan.goalId);
      }),

    updatePlan: (userId, planId, { amountMinor }) =>
      withUser(db, userId, async (tx) => {
        if (amountMinor <= 0n) throw invalid('A contribution must be positive');
        const plan = await lockedPlanIn(tx, planId);
        const at = now();
        const before = await activePlannedIn(tx, plan.recurrenceId);
        await tx
          .update(goalContributionPlans)
          .set({ amountMinor, updatedAt: at })
          .where(eq(goalContributionPlans.id, planId));
        if (plan.active) {
          const template = decodeTemplate((await lockedRecurrenceIn(tx, plan.recurrenceId)).template);
          const after = await activePlannedIn(tx, plan.recurrenceId);
          // A transfer fully planned for goals follows the plans; one only partly planned must still hold them.
          const fully = template.type === 'transfer' && template.sentMinor === before;
          if (!fully && template.type === 'transfer' && after > template.receivedMinor) {
            throw invalid('The shares exceed the transfer');
          }
          await syncRecurrenceIn(tx, userId, plan.recurrenceId, before, at);
        }
        return viewIn(tx, userId, now(), plan.goalId);
      }),
  };
}
