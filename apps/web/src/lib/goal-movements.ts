// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What went into (and out of) savings goals in a date range (FR-G3, FR-B6; design 13 "Setoran Oktober", "Riwayat
 * setoran"): the occurrences of recurring contributions (a goal's share of a recurring transfer, `plan`) and the other
 * transfers labeled with a goal's tag (`manual`: "Setor manual", "Tarik dana", a period's leftover). A transfer that
 * confirmed an occurrence is counted once, through its occurrence; recurring transfers without a plan of the goal
 * (an investment DCA tagged with it) are not contributions of an account goal.
 */
import type { GoalView } from '@wf/db/goals';
import type { RecurrenceView, ScheduledItem } from '@wf/db/schedules';
import type { TransactionRow } from '@wf/db/transaction-query';
import { planRunsIn } from '@wf/domain/goals';
import type { LocalDate, YearMonth } from '@wf/domain/period';

/** `recorded`: in Transactions; `review`: waiting in "Perlu ditinjau"; `scheduled`: still to come. */
export type MovementStatus = 'recorded' | 'review' | 'scheduled' | 'skipped';

export interface GoalShare {
  readonly goalId: string;
  /** Signed: a withdrawal is negative. */
  readonly amountMinor: bigint;
}

export interface GoalMovement {
  /** Stable React key. */
  readonly key: string;
  readonly date: LocalDate;
  readonly kind: 'plan' | 'manual';
  /** The recurring transfer's description ("Kantong darurat"); `null` for manual transfers. */
  readonly name: string | null;
  /** Per goal, in the goal's currency. */
  readonly shares: readonly GoalShare[];
  /** Σ shares. */
  readonly amountMinor: bigint;
  readonly fromAccountId: string;
  readonly toAccountId: string | null;
  readonly status: MovementStatus;
  readonly transactionId: string | null;
}

const STATUS: Readonly<Record<ScheduledItem['status'], MovementStatus>> = {
  scheduled: 'scheduled',
  due_review: 'review',
  unconfirmed: 'review',
  confirmed: 'recorded',
  skipped: 'skipped',
};

/** The accounts a goal's money sits in: its sources and its "Simpan di" account. */
export function goalAccountIds(goal: Pick<GoalView, 'sources' | 'accountId'>): Set<string> {
  const ids = new Set(goal.sources.map((source) => source.accountId));
  if (goal.accountId !== null) ids.add(goal.accountId);
  return ids;
}

/** The movements of `goals` from the scheduled items and the labeled transfers of one range, oldest first. */
export function goalMovements(
  goals: readonly GoalView[],
  scheduled: readonly ScheduledItem[],
  transfers: readonly TransactionRow[],
): GoalMovement[] {
  const movements: GoalMovement[] = [];
  const occurrenceTransactions = new Set(scheduled.flatMap((item) => item.transactionId ?? []));
  for (const item of scheduled) {
    if (item.sourceType !== 'recurrence') continue;
    const month = item.dueDate.slice(0, 7) as YearMonth;
    // Only plans running in the occurrence's month have a share of it ("Nov–Apr" is not in October's).
    const linked = goals.flatMap((goal) =>
      goal.plans
        .filter((plan) => plan.recurrenceId === item.sourceId && planRunsIn(plan, month))
        .map((plan) => ({ goalId: goal.id, plan })),
    );
    const active = linked.filter(({ plan }) => plan.active);
    // A recorded occurrence also sent the shares of plans paused since — unless the active plans alone make up what
    // it sent (a plan stopped before it, as a goal reached or used on the 20th stops sending on the 25th).
    const plans =
      item.status === 'confirmed' && active.reduce((sum, { plan }) => sum + plan.amountMinor, 0n) !== item.expectedMinor
        ? linked
        : active;
    const [first] = plans;
    if (first === undefined) continue;
    const shares = plans.map(({ goalId, plan }) => ({ goalId, amountMinor: plan.amountMinor }));
    movements.push({
      key: `${item.sourceId}:${item.dueDate}`,
      date: item.dueDate,
      kind: 'plan',
      name: item.name,
      shares,
      amountMinor: shares.reduce((sum, share) => sum + share.amountMinor, 0n),
      fromAccountId: first.plan.fromAccountId,
      toAccountId: first.plan.toAccountId,
      status: STATUS[item.status],
      transactionId: item.transactionId,
    });
  }
  for (const row of transfers) {
    if (row.type !== 'transfer' || row.source === 'recurring' || occurrenceTransactions.has(row.id)) continue;
    const shares = goals.flatMap((goal): GoalShare[] => {
      if (goal.tag === null || !row.tags.includes(goal.tag)) return [];
      const accounts = goalAccountIds(goal);
      // Out of the goal's money and not back into it: a withdrawal; anything else labeled with it adds to it.
      const out = accounts.has(row.accountId) && (row.toAccountId === null || !accounts.has(row.toAccountId));
      return [{ goalId: goal.id, amountMinor: out ? row.amountMinor : (row.receivedMinor ?? -row.amountMinor) }];
    });
    if (shares.length === 0) continue;
    movements.push({
      key: row.id,
      date: row.localDate,
      kind: 'manual',
      name: null,
      shares,
      amountMinor: shares.reduce((sum, share) => sum + share.amountMinor, 0n),
      fromAccountId: row.accountId,
      toAccountId: row.toAccountId,
      status: 'recorded',
      transactionId: row.id,
    });
  }
  return movements.sort((a, b) => (a.date === b.date ? a.key.localeCompare(b.key) : a.date < b.date ? -1 : 1));
}

/**
 * The month of a goal's next recurring contribution, the base of its estimate ("Estimasi tercapai"): the earliest
 * month an active plan sends in — its recurrence's next due date, or the plan's first month when that is later —
 * never before `currentMonth` (`currentMonth` without any; plans already ended do not count).
 */
export function nextContributionMonth(
  goal: Pick<GoalView, 'plans'>,
  recurrences: readonly RecurrenceView[],
  currentMonth: YearMonth,
): YearMonth {
  const months = goal.plans.flatMap((plan) => {
    const due = plan.active
      ? recurrences.find((recurrence) => recurrence.id === plan.recurrenceId)?.nextDue?.dueDate
      : undefined;
    if (due === undefined) return [];
    const dueMonth = due.slice(0, 7) as YearMonth;
    const month = dueMonth < plan.startMonth ? plan.startMonth : dueMonth;
    return planRunsIn(plan, month) ? [month] : [];
  });
  const month = months.sort()[0] ?? currentMonth;
  return month < currentMonth ? currentMonth : month;
}
