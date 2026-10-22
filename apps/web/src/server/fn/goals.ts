// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Tabungan" (FR-G1, G3, G4; FR-B6 sinking funds): savings goals with their account sources, recurring contributions,
 * deposits and withdrawals, completing and reopening, paying an expense from a goal, and moving what is left.
 * Deposits, withdrawals, and payments are labeled transactions of the user; recurring contributions are shares of
 * recurring transfers, which only ever reach the ledger through the Review queue (D14). Progress, the estimate, and
 * emergency-fund months are computed on the page with `@wf/domain/goals`. The user always comes from the session.
 */
import { createServerFn } from '@tanstack/react-start';
import type { GoalView } from '@wf/db/goals';
import { LedgerError } from '@wf/db/ledger-errors';
import type { RecurrenceView } from '@wf/db/schedules';
import { GOAL_KINDS, GOAL_STATUSES, GOAL_TARGET_MODES } from '@wf/domain/goals';
import { dateInMonth, shiftMonth, type LocalDate, type YearMonth } from '@wf/domain/period';
import * as z from 'zod';
import { goalMovements, nextContributionMonth, type GoalMovement } from '../../lib/goal-movements.ts';
import { attempt, requireSession, type Result } from '../access.ts';
import { defined, localDate } from '../inputs.ts';
import { services, type Services } from '../runtime.ts';
import { RECORD_TRANSACTION_INPUT } from './transactions-write.ts';

const id = z.uuid();
const positiveMinor = z.bigint().positive();
const yearMonth = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
  .transform((value) => value as YearMonth);
const note = z.string().max(2000).nullable().optional();
/** Months of history "Riwayat setoran" covers (the scheduled items answer at most 366 days). */
const HISTORY_MONTHS = 12;
/** Most labeled transfers one range reads. */
const TRANSFER_LIMIT = 200;

const source = z.object({
  accountId: id,
  mode: z.enum(['whole', 'fixed']),
  amountMinor: positiveMinor.nullable().optional(),
});

const goalFields = {
  name: z.string().trim().min(1).max(40),
  icon: z.string().min(1).max(40),
  color: z.string().min(1).max(20),
  targetMinor: positiveMinor,
  targetMode: z.enum(GOAL_TARGET_MODES).optional(),
  targetMonths: z.number().int().min(1).max(24).nullable().optional(),
  deadlineMonth: yearMonth.nullable(),
  tag: z.string().trim().min(1).max(64).nullable(),
  accountId: id.nullable().optional(),
};

/** The months a plan runs in ("Nov–Apr"); omitted: from this month (a new transfer: its first month), until changed. */
const planMonths = { startMonth: yearMonth.optional(), endMonth: yearMonth.nullable().optional() };

/** A share of an existing recurring transfer ("Sisihkan tiap gajian"), or a new monthly one ("Setoran rutin"). */
const plan = z.union([
  z.object({ recurrenceId: id, amountMinor: positiveMinor, ...planMonths }),
  z.object({
    amountMinor: positiveMinor,
    monthDay: z.number().int().min(1).max(31),
    fromAccountId: id,
    toAccountId: id.nullable().optional(),
    startOn: localDate,
    remindOffsetDays: z.number().int().min(0).max(30).nullable().optional(),
    ...planMonths,
  }),
]);
type PlanInput = z.output<typeof plan>;

/** A goal with the month its next recurring contribution lands in (the base of "Estimasi tercapai"). */
export interface GoalSummary extends GoalView {
  readonly nextMonth: YearMonth;
}

/** The recurring transfer sinking funds share ("Sisihkan dana tidak rutin", FR-B6 "Sisihkan tiap gajian"). */
export interface SetAsideTransfer {
  readonly recurrenceId: string;
  readonly name: string | null;
  readonly monthDay: number | null;
  readonly fromAccountId: string;
  readonly toAccountId: string;
  readonly amountMinor: bigint;
  readonly goalIds: string[];
}

export interface GoalsOverview {
  readonly today: LocalDate;
  /** The month "Setoran {month}" shows. */
  readonly month: YearMonth;
  readonly baseCurrency: string;
  /** Every goal (active, completed, used), in the user's order. */
  readonly goals: GoalSummary[];
  /** The month's contributions, oldest first. */
  readonly movements: GoalMovement[];
  /** The average monthly spending of the last periods ("3× pengeluaran bulanan"); `0n` without history. */
  readonly averageSpendingMinor: bigint;
  /** The day salary usually arrives ("Tiap 25"); `null` without salary. */
  readonly payday: number | null;
  readonly setAside: SetAsideTransfer | null;
}

function signedIn(session: Parameters<typeof requireSession>[0]): Promise<{ userId: string; all: Services }> {
  return services().then(async (all) => {
    const { user } = await requireSession(session, {}, all.now());
    return { userId: user.id, all };
  });
}

/** The movements of `goals` from `from` to `to`. */
async function movementsIn(
  all: Services,
  userId: string,
  goals: readonly GoalView[],
  range: { readonly from: LocalDate; readonly to: LocalDate },
): Promise<GoalMovement[]> {
  const tags = [...new Set(goals.flatMap((goal) => goal.tag ?? []))];
  const [scheduled, transfers] = await Promise.all([
    all.schedules.listScheduled(userId, range),
    // No tags would mean no tag filter at all.
    tags.length === 0
      ? Promise.resolve({ rows: [] })
      : all.transactionQuery.list(userId, { ...range, types: ['transfer'], tags }, { limit: TRANSFER_LIMIT }),
  ]);
  return goalMovements(goals, scheduled, transfers.rows);
}

/** A monthly transfer whose active plans are all sinking funds' (the first, in the user's order). */
function setAsideOf(recurrences: readonly RecurrenceView[], goals: readonly GoalView[]): SetAsideTransfer | null {
  const sinking = new Set(goals.filter((goal) => goal.kind === 'sinking').map((goal) => goal.id));
  for (const recurrence of recurrences) {
    const { template } = recurrence;
    if (recurrence.freq !== 'monthly' || template.type !== 'transfer') continue;
    const goalIds = (template.allocations ?? []).map((part) => part.goalId);
    if (goalIds.length === 0 || !goalIds.every((goalId) => sinking.has(goalId))) continue;
    return {
      recurrenceId: recurrence.id,
      name: template.description ?? null,
      monthDay: recurrence.monthDay,
      fromAccountId: template.fromAccountId,
      toAccountId: template.toAccountId,
      amountMinor: template.sentMinor,
      goalIds,
    };
  }
  return null;
}

/**
 * Adds a plan; a share of a transfer planned wholly for goals ("Sisihkan dana tidak rutin" Rp1.150.000) grows the
 * transfer by the share (Rp1.400.000) instead of being refused for exceeding it — from the share's first month on, as
 * the transfer's occurrences send the plans running each month.
 */
async function addPlanIn(all: Services, userId: string, goalId: string, input: PlanInput): Promise<GoalView> {
  if (!('recurrenceId' in input)) return all.goals.addPlan(userId, goalId, defined(input));
  const recurrence = (await all.schedules.listRecurrences(userId)).find(
    (candidate) => candidate.id === input.recurrenceId,
  );
  if (recurrence === undefined) throw new LedgerError('NOT_FOUND', 'No such recurrence');
  const { template } = recurrence;
  const allocations = template.type === 'transfer' ? (template.allocations ?? []) : [];
  const planned = allocations.reduce((sum, part) => sum + part.amountMinor, 0n);
  if (
    template.type !== 'transfer' ||
    allocations.length === 0 ||
    planned !== template.sentMinor ||
    template.sentMinor !== template.receivedMinor
  ) {
    return all.goals.addPlan(userId, goalId, defined(input));
  }
  const total = planned + input.amountMinor;
  await all.schedules.updateRecurrence(userId, recurrence.id, {
    freq: recurrence.freq,
    interval: recurrence.interval,
    startOn: recurrence.startOn,
    weekday: recurrence.weekday,
    monthDay: recurrence.monthDay,
    end: recurrence.end,
    remindOffsetDays: recurrence.remindOffsetDays,
    template: {
      ...template,
      sentMinor: total,
      receivedMinor: total,
      allocations: [
        ...allocations,
        defined({ goalId, amountMinor: input.amountMinor, startMonth: input.startMonth, endMonth: input.endMonth }),
      ],
    },
  });
  return all.goals.get(userId, goalId);
}

/** The "Tabungan" page: every goal, the month's contributions, and what the forms suggest. */
export const getGoals = createServerFn({ method: 'GET' })
  .validator(z.object({ month: yearMonth.optional() }))
  .handler(({ context, data }): Promise<Result<GoalsOverview>> =>
    attempt(async () => {
      const { userId, all } = await signedIn(context.session);
      const [goals, periods, payday, recurrences] = await Promise.all([
        all.goals.list(userId),
        all.periods.list(userId),
        all.periods.payday(userId),
        all.schedules.listRecurrences(userId, { status: 'active' }),
      ]);
      const current = periods.today.slice(0, 7) as YearMonth;
      const month = data.month ?? current;
      const [movements, average] = await Promise.all([
        movementsIn(all, userId, goals, { from: dateInMonth(month, 1), to: dateInMonth(month, 31) }),
        periods.current.id === null ? Promise.resolve([]) : all.budgets.fillFromAverage(userId, periods.current.id),
      ]);
      return {
        today: periods.today,
        month,
        baseCurrency: periods.baseCurrency,
        goals: goals.map((goal) => ({ ...goal, nextMonth: nextContributionMonth(goal, recurrences, current) })),
        movements,
        averageSpendingMinor: average.reduce((sum, line) => sum + line.averageMinor, 0n),
        payday: payday.day,
        setAside: setAsideOf(recurrences, goals),
      };
    }),
  );

/** The active goals, for the Record sheet's "Bayar dari tujuan" (FR-G4). */
export const listGoals = createServerFn({ method: 'GET' })
  .validator(z.object({ status: z.enum([...GOAL_STATUSES, 'all']).optional() }))
  .handler(({ context, data }): Promise<Result<GoalView[]>> =>
    attempt(async () => {
      const { userId, all } = await signedIn(context.session);
      return all.goals.list(userId, defined(data));
    }),
  );

/** "Riwayat setoran" of one goal over the last 12 months, newest first, with this month's next contribution. */
export const getGoalHistory = createServerFn({ method: 'GET' })
  .validator(z.object({ id }))
  .handler(({ context, data }): Promise<Result<GoalMovement[]>> =>
    attempt(async () => {
      const { userId, all } = await signedIn(context.session);
      const [goal, periods] = await Promise.all([all.goals.get(userId, data.id), all.periods.list(userId)]);
      const month = periods.today.slice(0, 7) as YearMonth;
      const range = { from: dateInMonth(shiftMonth(month, 1 - HISTORY_MONTHS), 1), to: dateInMonth(month, 31) };
      // One goal: each movement's amount is its share.
      return (await movementsIn(all, userId, [goal], range)).reverse();
    }),
  );

/** FR-G1 "Tujuan baru" / FR-B6 "Dana tidak rutin baru", with its account sources and recurring contributions. */
export const createGoal = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      ...goalFields,
      kind: z.enum(GOAL_KINDS).optional(),
      currency: z.string().regex(/^[A-Z]{3}$/),
      sources: z.array(source).max(10).optional(),
      plans: z.array(plan).max(5).optional(),
    }),
  )
  .handler(({ context, data }): Promise<Result<GoalView>> =>
    attempt(async () => {
      const { userId, all } = await signedIn(context.session);
      const { plans = [], sources = [], ...input } = data;
      const created = await all.goals.create(userId, {
        ...defined(input),
        sources: sources.map((part) => defined(part)),
      });
      try {
        let goal = created;
        for (const part of plans) goal = await addPlanIn(all, userId, created.id, part);
        return goal;
      } catch (error) {
        // A refused contribution leaves no goal behind.
        await all.goals.remove(userId, created.id);
        throw error;
      }
    }),
  );

/** "Ubah tujuan": the given fields, and the account sources when sent. */
export const updateGoal = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      id,
      patch: z.object(goalFields).partial(),
      sources: z.array(source).max(10).optional(),
    }),
  )
  .handler(({ context, data }): Promise<Result<GoalView>> =>
    attempt(async () => {
      const { userId, all } = await signedIn(context.session);
      const updated = await all.goals.update(userId, data.id, defined(data.patch));
      return data.sources === undefined
        ? updated
        : all.goals.setSources(
            userId,
            data.id,
            data.sources.map((part) => defined(part)),
          );
    }),
  );

/** "Hapus tujuan": its transactions stay, unlinked. */
export const removeGoal = createServerFn({ method: 'POST' })
  .validator(z.object({ id }))
  .handler(({ context, data }): Promise<Result<null>> =>
    attempt(async () => {
      const { userId, all } = await signedIn(context.session);
      await all.goals.remove(userId, data.id);
      return null;
    }),
  );

/** FR-G3 "Setor manual": a transfer labeled with the goal. */
export const depositToGoal = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      id,
      clientId: id,
      occurredAt: z.date(),
      fromAccountId: id,
      toAccountId: id.nullable().optional(),
      amountMinor: positiveMinor,
      note,
    }),
  )
  .handler(({ context, data }): Promise<Result<{ transactionId: string; goal: GoalView }>> =>
    attempt(async () => {
      const { userId, all } = await signedIn(context.session);
      const { id: goalId, ...input } = data;
      return all.goals.deposit(userId, goalId, defined(input));
    }),
  );

/** FR-G3 "Tarik dana": a transfer out of one of the goal's accounts, labeled with the goal. */
export const withdrawFromGoal = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      id,
      clientId: id,
      occurredAt: z.date(),
      fromAccountId: id,
      toAccountId: id,
      amountMinor: positiveMinor,
      note,
    }),
  )
  .handler(({ context, data }): Promise<Result<{ transactionId: string; goal: GoalView }>> =>
    attempt(async () => {
      const { userId, all } = await signedIn(context.session);
      const { id: goalId, ...input } = data;
      return all.goals.withdraw(userId, goalId, defined(input));
    }),
  );

/**
 * FR-G4 "Bayar dari tujuan": the Record sheet's expense paid with the goal's money; `markUsed` → "Terpakai", and its
 * recurring contributions stop.
 */
export const spendFromGoal = createServerFn({ method: 'POST' })
  .validator(z.object({ goalId: id, markUsed: z.boolean(), entry: RECORD_TRANSACTION_INPUT }))
  .handler(({ context, data }): Promise<Result<{ transactionId: string; goal: GoalView }>> =>
    attempt(async () => {
      const { userId, all } = await signedIn(context.session);
      const { entry } = data;
      // Only an expense is paid from a goal; the repository refuses anything else.
      if (entry.type !== 'expense') throw new LedgerError('INVALID_GOAL', 'Paying from a goal is an expense');
      const spent = await all.goals.spend(userId, data.goalId, { draft: defined(entry), markUsed: data.markUsed });
      // A used goal collects nothing more: its recurring contributions stop (the set-aside transfer shrinks).
      let { goal } = spent;
      if (data.markUsed) {
        for (const plan of spent.goal.plans)
          if (plan.active) goal = await all.goals.setPlanActive(userId, plan.id, false);
      }
      return { transactionId: spent.transactionId, goal };
    }),
  );

/** FR-G4 "Pindahkan sisa" of a completed or used goal to another goal, or "Lepas jadi saldo bebas" (`null`). */
export const moveGoalRemainder = createServerFn({ method: 'POST' })
  .validator(z.object({ id, toGoalId: id.nullable() }))
  .handler(({ context, data }): Promise<Result<GoalView[]>> =>
    attempt(async () => {
      const { userId, all } = await signedIn(context.session);
      return all.goals.moveRemainder(userId, data.id, { toGoalId: data.toGoalId });
    }),
  );

/** FR-G4 "Tandai selesai"; `stopPlans` = "Hentikan setoran rutin". */
export const completeGoal = createServerFn({ method: 'POST' })
  .validator(z.object({ id, stopPlans: z.boolean() }))
  .handler(({ context, data }): Promise<Result<{ goal: GoalView; stoppedPlanIds: string[] }>> =>
    attempt(async () => {
      const { userId, all } = await signedIn(context.session);
      return all.goals.complete(userId, data.id, { stopPlans: data.stopPlans });
    }),
  );

/** "Urungkan" of completing: active again, with the plans completing stopped. */
export const reopenGoal = createServerFn({ method: 'POST' })
  .validator(z.object({ id, resumePlanIds: z.array(id).max(20) }))
  .handler(({ context, data }): Promise<Result<GoalView>> =>
    attempt(async () => {
      const { userId, all } = await signedIn(context.session);
      return all.goals.reopen(userId, data.id, { resumePlanIds: data.resumePlanIds });
    }),
  );

/** A new recurring contribution ("Setoran rutin", "Sisihkan tiap gajian"). */
export const addGoalPlan = createServerFn({ method: 'POST' })
  .validator(z.object({ goalId: id, plan }))
  .handler(({ context, data }): Promise<Result<GoalView>> =>
    attempt(async () => {
      const { userId, all } = await signedIn(context.session);
      return addPlanIn(all, userId, data.goalId, data.plan);
    }),
  );

/** "Jeda setoran rutin" / resume. */
export const setGoalPlanActive = createServerFn({ method: 'POST' })
  .validator(z.object({ planId: id, active: z.boolean() }))
  .handler(({ context, data }): Promise<Result<GoalView>> =>
    attempt(async () => {
      const { userId, all } = await signedIn(context.session);
      return all.goals.setPlanActive(userId, data.planId, data.active);
    }),
  );

/** "Ubah setoran rutin": the plan's monthly amount. */
export const updateGoalPlan = createServerFn({ method: 'POST' })
  .validator(z.object({ planId: id, amountMinor: positiveMinor }))
  .handler(({ context, data }): Promise<Result<GoalView>> =>
    attempt(async () => {
      const { userId, all } = await signedIn(context.session);
      return all.goals.updatePlan(userId, data.planId, { amountMinor: data.amountMinor });
    }),
  );
