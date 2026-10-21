// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Savings goals and sinking funds (FR-G1–G4, FR-B6: one entity, `kind`). A goal's progress is the value of its
 * funding sources (FR-G2): an account wholly (its balance) or a fixed amount of it; investment assets join in M5.
 * Recurring contributions ("Setoran rutin") are goal plans on recurring transfers (`goal_contribution_plans`), so
 * they reach the Review queue like every recurrence (D14). Deposit and withdraw are labeled transfers (the goal's tag
 * and `transactions.goal_id`); "Bayar dari tujuan" is an expense with `paid_from_goal_id`. Every method is one user
 * transaction; percentages, ETA, and emergency-fund months are `@wf/domain/goals`' job.
 */
import type { Dek } from '@wf/crypto/envelope';
import type { GoalKind, GoalStatus, GoalTargetMode } from '@wf/domain/goals';
import type { LocalDate, YearMonth } from '@wf/domain/period';
import { and, asc, eq, inArray, ne, sql, type SQL } from 'drizzle-orm';
import { viewsIn as accountViewsIn } from './accounts.ts';
import { firstRow, withUser, type Database, type Transaction } from './db.ts';
import { recordTransactionIn, resolveTagsIn, type EntryDraft } from './ledger-core.ts';
import { LedgerError } from './ledger-errors.ts';
import { decodeTemplate, encodeTemplate, userClockIn, type RecurrenceTemplate } from './occurrences.ts';
import {
  activePlannedIn,
  createRecurrenceIn,
  lockedRecurrenceIn,
  rebuildRecurrenceIn,
  resumeRecurrenceIn,
  stopRecurrenceIn,
} from './schedules.ts';
import {
  accounts,
  goalContributionPlans,
  goalFundingSources,
  goals,
  recurrences,
  tags,
  transactions,
  type GOAL_SOURCE_MODES,
} from './schema.ts';

export type GoalSourceMode = (typeof GOAL_SOURCE_MODES)[number];

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

/** A recurring contribution: the goal's share of a recurring transfer (day and from → to are the recurrence's). */
export interface GoalPlanView {
  readonly id: string;
  readonly recurrenceId: string;
  /** In the destination account's currency. */
  readonly amountMinor: bigint;
  readonly active: boolean;
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
  /** In source order. */
  readonly sources: GoalSourceView[];
  /** Σ source values, in `currency`. */
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
}

/** Editable fields; omitted ones are kept. */
export type GoalPatch = Partial<Omit<GoalInput, 'currency' | 'sources'>>;

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

/** A new recurring contribution: a share of an existing recurring transfer, or a new monthly one. */
export type GoalPlanInput =
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
  /** Replaces the funding sources. @throws {LedgerError} `NOT_FOUND`, `INVALID_GOAL` */
  setSources: (userId: string, id: string, sources: readonly GoalSourceInput[]) => Promise<GoalView>;
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
  /** @throws {LedgerError} `NOT_FOUND`, `INVALID_GOAL`, `INVALID_RECURRENCE` */
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

async function viewsIn(tx: Transaction, userId: string, where?: SQL): Promise<GoalView[]> {
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
    sources.filter((source) => source.mode === 'whole').map((source) => source.accountId),
  );
  const plans = await tx
    .select({
      id: goalContributionPlans.id,
      goalId: goalContributionPlans.goalId,
      recurrenceId: goalContributionPlans.recurrenceId,
      amountMinor: goalContributionPlans.amountMinor,
      active: goalContributionPlans.active,
      monthDay: recurrences.monthDay,
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
        accountId: source.accountId,
        accountName: source.accountName,
        mode: source.mode,
        amountMinor: source.amountMinor,
        valueMinor: source.amountMinor ?? (balances.get(source.accountId) as bigint),
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
          monthDay: plan.monthDay,
          fromAccountId: transfer.fromAccountId,
          toAccountId: transfer.toAccountId,
          recurrenceStatus: plan.recurrenceStatus,
        };
      });
    return {
      ...row,
      sources: own,
      savedMinor: own.reduce((sum, source) => sum + source.valueMinor, 0n),
      plans: ownPlans,
      monthlyPlanMinor: ownPlans.reduce((sum, plan) => sum + (plan.active ? plan.amountMinor : 0n), 0n),
    };
  });
}

async function viewIn(tx: Transaction, userId: string, id: string): Promise<GoalView> {
  const [view] = await viewsIn(tx, userId, eq(goals.id, id));
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
  await tx.delete(goalFundingSources).where(eq(goalFundingSources.goalId, goalId));
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

/** The account a deposit or new plan goes to by default: the goal's, else its first source's. */
async function homeAccountIn(tx: Transaction, row: GoalRow): Promise<string> {
  if (row.accountId !== null) return row.accountId;
  const [source] = await tx
    .select({ accountId: goalFundingSources.accountId })
    .from(goalFundingSources)
    .where(eq(goalFundingSources.goalId, row.id))
    .orderBy(asc(goalFundingSources.sortOrder), asc(goalFundingSources.createdAt));
  if (source === undefined) throw invalid('The goal has no account to deposit to');
  return source.accountId;
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
      withUser(db, userId, (tx) => viewsIn(tx, userId, status === 'all' ? undefined : eq(goals.status, status))),

    get: (userId, id) => withUser(db, userId, (tx) => viewIn(tx, userId, id)),

    create: (userId, input) =>
      withUser(db, userId, async (tx) => {
        const values = await goalValuesIn(tx, userId, input);
        const sources = input.sources ?? [];
        await checkSourcesIn(tx, userId, null, input.currency, sources);
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
        return viewIn(tx, userId, id);
      }),

    update: (userId, id, patch) =>
      withUser(db, userId, async (tx) => {
        const row = await lockedGoalIn(tx, id);
        const values = await goalValuesIn(tx, userId, { ...(await inputOfIn(tx, row)), ...patch });
        await tx
          .update(goals)
          .set({ ...values, updatedAt: now() })
          .where(eq(goals.id, id));
        return viewIn(tx, userId, id);
      }),

    setSources: (userId, id, sources) =>
      withUser(db, userId, async (tx) => {
        const row = await lockedGoalIn(tx, id);
        await checkSourcesIn(tx, userId, id, row.currency, sources);
        await writeSourcesIn(tx, userId, id, sources);
        return viewIn(tx, userId, id);
      }),

    allocations: (userId) =>
      withUser(db, userId, async (tx) => {
        const sources = await tx.select().from(goalFundingSources);
        const balances = await balancesIn(tx, userId, [...new Set(sources.map((source) => source.accountId))]);
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
        const [whole] = await tx
          .select({ goalId: goalFundingSources.goalId })
          .from(goalFundingSources)
          .where(
            and(
              eq(goalFundingSources.accountId, toAccountId),
              eq(goalFundingSources.mode, 'whole'),
              ne(goalFundingSources.goalId, id),
            ),
          );
        if (whole !== undefined) throw invalid('Another goal holds the whole account');
        const at = now();
        const transactionId = await transferIn(tx, userId, row, { ...input, toAccountId }, dek, at);
        const source = await sourceOnIn(tx, id, toAccountId);
        if (source === undefined) {
          await tx.insert(goalFundingSources).values({
            userId,
            goalId: id,
            accountId: toAccountId,
            mode: 'fixed',
            amountMinor: input.amountMinor,
            sortOrder: sql`(select coalesce(max(${goalFundingSources.sortOrder}) + 1, 0) from ${goalFundingSources} where ${goalFundingSources.goalId} = ${id})`,
          });
        } else if (source.mode === 'fixed') {
          await setFixedIn(tx, source.id, (source.amountMinor as bigint) + input.amountMinor, at);
        }
        return { transactionId, goal: await viewIn(tx, userId, id) };
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
        return { transactionId, goal: await viewIn(tx, userId, id) };
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
        return { transactionId, goal: await viewIn(tx, userId, id) };
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
            const there = await sourceOnIn(tx, toGoalId, source.accountId);
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
        return viewsIn(tx, userId, inArray(goals.id, toGoalId === null ? [id] : [id, toGoalId]));
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
        return { goal: await viewIn(tx, userId, id), stoppedPlanIds };
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
        return viewIn(tx, userId, id);
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
            .values({ userId, goalId, recurrenceId: recurrence.id, amountMinor: input.amountMinor });
          return viewIn(tx, userId, goalId);
        }
        const toAccountId = input.toAccountId ?? (await homeAccountIn(tx, row));
        await checkAccountIn(tx, toAccountId, row.currency);
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
              allocations: [{ goalId, amountMinor: input.amountMinor }],
            },
            freq: 'monthly',
            startOn: input.startOn,
            monthDay: input.monthDay,
            end: { type: 'never' },
            remindOffsetDays: input.remindOffsetDays === undefined ? 1 : input.remindOffsetDays,
          },
          at,
        );
        return viewIn(tx, userId, goalId);
      }),

    setPlanActive: (userId, planId, active) =>
      withUser(db, userId, async (tx) => {
        const plan = await setPlanActiveIn(tx, userId, planId, active, now());
        return viewIn(tx, userId, plan.goalId);
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
        return viewIn(tx, userId, plan.goalId);
      }),
  };
}
