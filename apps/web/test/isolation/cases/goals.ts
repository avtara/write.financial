// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Isolation cases for the server functions in `src/server/fn/goals.ts`, run by
 * `src/server/fn/isolation.integration.test.ts`. A and B each get a goal with a fixed source and a monthly plan;
 * B's calls aimed at A's goal, plan, accounts, or recurrence are refused and leave A's rows as they were.
 */
import { randomUUID } from 'node:crypto';
import type { GoalView } from '@wf/db/goals';
import { expect } from 'vitest';
import type { Result } from '../../../src/server/access.ts';
import type { GoalsOverview } from '../../../src/server/fn/goals.ts';
import {
  A_LEDGER,
  aId,
  as,
  bId,
  type Case,
  idsOf,
  type LocalDate,
  type Name,
  NOT_FOUND,
  ok,
  services,
  SOME_ID,
  superuser,
  UNAUTHENTICATED,
} from '../harness.ts';

interface Setup {
  readonly goal: GoalView;
  /** The goal's account (its fixed source) and a second account to move money from. */
  readonly home: string;
  readonly other: string;
}

const setups: Partial<Record<'A' | 'B', Promise<Setup>>> = {};

/** The user's goal with a Rp100.000 fixed source and a Rp50.000 monthly plan, made once. */
function setUpOf(user: 'A' | 'B'): Promise<Setup> {
  setups[user] ??= (async () => {
    const userId = user === 'A' ? aId : bId;
    const name = user === 'A' ? A_LEDGER.goal : 'Tujuan B';
    const account = (displayName: string) =>
      services.accounts.create(userId, {
        type: 'bank',
        providerName: 'Bank',
        displayName,
        currency: 'IDR',
        openingBalanceMinor: 2_000_000n,
        openingDate: '2026-10-01' as LocalDate,
        color: 'blue',
      });
    const home = (await account(`${name} rumah`)).id;
    const other = (await account(`${name} sumber`)).id;
    const created = await services.goals.create(userId, {
      name,
      icon: 'shield',
      color: 'blue',
      targetMinor: 1_000_000n,
      currency: 'IDR',
      deadlineMonth: null,
      tag: name,
      accountId: home,
      sources: [{ accountId: home, mode: 'fixed', amountMinor: 100_000n }],
    });
    const goal = await services.goals.addPlan(userId, created.id, {
      amountMinor: 50_000n,
      monthDay: 25,
      fromAccountId: other,
      startOn: '2026-11-25' as LocalDate,
    });
    return { goal, home, other };
  })();
  return setups[user];
}

/** A's goals, sources, plans, recurrences, and transactions as stored; B's calls must leave them unchanged. */
const aGoalRows = async () => ({
  goals: await superuser`SELECT * FROM goals WHERE user_id = ${aId} ORDER BY id`,
  sources: await superuser`SELECT * FROM goal_funding_sources WHERE user_id = ${aId} ORDER BY id`,
  plans: await superuser`SELECT * FROM goal_contribution_plans WHERE user_id = ${aId} ORDER BY id`,
  recurrences: await superuser`SELECT * FROM recurrences WHERE user_id = ${aId} ORDER BY id`,
  transactions: await superuser`SELECT id, deleted_at FROM transactions WHERE user_id = ${aId} ORDER BY id`,
});

/** Calls `fn` as B with `input` (aimed at A): refused with `expected`, A's goal rows unchanged. */
async function refusedForB(fn: Name, input: unknown, expected: unknown = NOT_FOUND): Promise<void> {
  const before = await aGoalRows();
  expect(await as('B', fn, input)).toEqual(expected);
  expect(await aGoalRows()).toEqual(before);
}

const deposit = (setup: Setup, overrides: object = {}) => ({
  id: setup.goal.id,
  clientId: randomUUID(),
  occurredAt: new Date('2026-10-07T05:00:00Z'),
  fromAccountId: setup.other,
  toAccountId: setup.home,
  amountMinor: 10_000n,
  ...overrides,
});

export const cases = {
  getGoals: {
    input: () => ({}),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      const b = await setUpOf('B');
      await setUpOf('A');
      const ofB = await as<Result<GoalsOverview>>('B', 'getGoals', input);
      // B's onboarding goal and B's own one; never A's.
      expect(ofB.ok && ofB.value.goals.map((goal) => goal.id).sort()).toEqual((await idsOf('goals', bId)).sort());
      expect(ofB.ok && ofB.value.goals.map((goal) => goal.name)).not.toContain(A_LEDGER.goal);
      expect(ofB.ok && ofB.value.goals.find((goal) => goal.id === b.goal.id)?.sources).toMatchObject([
        { accountId: b.home, valueMinor: 100_000n },
      ]);
      const ofA = await as<Result<GoalsOverview>>('A', 'getGoals', { month: '2026-10' });
      expect(ofA.ok && ofA.value.goals.map((goal) => goal.name)).toEqual([A_LEDGER.goal]);
    },
  },
  listGoals: {
    input: () => ({ status: 'active' }),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      const ofB = await as<Result<GoalView[]>>('B', 'listGoals', input);
      expect(ofB.ok && ofB.value.map((goal) => goal.id).sort()).toEqual((await idsOf('goals', bId)).sort());
      expect(ofB.ok && ofB.value.map((goal) => goal.name)).toContain('Tujuan B');
    },
  },
  getGoalHistory: {
    input: () => ({ id: SOME_ID }),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const a = await setUpOf('A');
      const b = await setUpOf('B');
      await refusedForB('getGoalHistory', { id: a.goal.id });
      expect(await as('B', 'getGoalHistory', { id: b.goal.id })).toMatchObject({ ok: true });
    },
  },
  createGoal: {
    input: () => ({
      name: 'Liburan B',
      icon: 'plane',
      color: 'violet',
      targetMinor: 5_000_000n,
      currency: 'IDR',
      deadlineMonth: '2027-06',
      tag: 'Liburan B',
    }),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      const a = await setUpOf('A');
      const b = await setUpOf('B');
      const fields = input as Record<string, unknown>;
      // A's account is neither a source, nor where it is kept, nor where a plan comes from.
      await refusedForB(
        'createGoal',
        { ...fields, sources: [{ accountId: a.home, mode: 'fixed', amountMinor: 1n }] },
        { ok: false, code: 'INVALID_GOAL' },
      );
      await refusedForB('createGoal', { ...fields, accountId: a.home }, { ok: false, code: 'INVALID_GOAL' });
      const withPlan = {
        ...fields,
        accountId: b.home,
        plans: [{ amountMinor: 1_000n, monthDay: 1, fromAccountId: a.other, startOn: '2026-11-01' }],
      };
      const before = await idsOf('goals', bId);
      expect(await as('B', 'createGoal', withPlan)).toMatchObject({ ok: false });
      // The refused plan leaves no goal behind.
      expect(await idsOf('goals', bId)).toEqual(before);
      const created = await as<Result<GoalView>>('B', 'createGoal', input);
      expect(created).toMatchObject(ok({ name: 'Liburan B', kind: 'savings' }));
      expect(await idsOf('goals', bId)).toContain(created.ok && created.value.id);
    },
  },
  updateGoal: {
    input: () => ({ id: SOME_ID, patch: { name: 'Pwned' } }),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const a = await setUpOf('A');
      const b = await setUpOf('B');
      await refusedForB('updateGoal', { id: a.goal.id, patch: { name: 'Pwned' } });
      await refusedForB(
        'updateGoal',
        { id: b.goal.id, patch: {}, sources: [{ accountId: a.home, mode: 'whole' }] },
        { ok: false, code: 'INVALID_GOAL' },
      );
      expect(await as('B', 'updateGoal', { id: b.goal.id, patch: { name: 'Tujuan B' } })).toMatchObject(
        ok({ name: 'Tujuan B' }),
      );
    },
  },
  depositToGoal: {
    input: () => ({
      id: SOME_ID,
      clientId: randomUUID(),
      occurredAt: new Date('2026-10-07T05:00:00Z'),
      fromAccountId: SOME_ID,
      amountMinor: 1n,
    }),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const a = await setUpOf('A');
      const b = await setUpOf('B');
      await refusedForB('depositToGoal', deposit(b, { id: a.goal.id }));
      const before = await aGoalRows();
      expect(await as('B', 'depositToGoal', deposit(b, { fromAccountId: a.other }))).toMatchObject({ ok: false });
      expect(await as('B', 'depositToGoal', deposit(b, { toAccountId: a.home }))).toMatchObject({ ok: false });
      expect(await aGoalRows()).toEqual(before);
      expect(await as('B', 'depositToGoal', deposit(b))).toMatchObject(ok({ goal: { savedMinor: 110_000n } }));
    },
  },
  withdrawFromGoal: {
    input: () => ({
      id: SOME_ID,
      clientId: randomUUID(),
      occurredAt: new Date('2026-10-07T05:00:00Z'),
      fromAccountId: SOME_ID,
      toAccountId: SOME_ID,
      amountMinor: 1n,
    }),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const a = await setUpOf('A');
      const b = await setUpOf('B');
      const out = (overrides: object) =>
        deposit(b, { fromAccountId: b.home, toAccountId: b.other, amountMinor: 10_000n, ...overrides });
      await refusedForB('withdrawFromGoal', out({ id: a.goal.id, fromAccountId: a.home }));
      const before = await aGoalRows();
      expect(await as('B', 'withdrawFromGoal', out({ toAccountId: a.other }))).toMatchObject({ ok: false });
      expect(await aGoalRows()).toEqual(before);
      expect(await as('B', 'withdrawFromGoal', out({}))).toMatchObject(ok({ goal: { savedMinor: 100_000n } }));
    },
  },
  spendFromGoal: {
    input: () => ({
      goalId: SOME_ID,
      markUsed: false,
      entry: {
        type: 'expense',
        clientId: randomUUID(),
        occurredAt: new Date('2026-10-07T05:00:00Z'),
        accountId: SOME_ID,
        amountMinor: 1n,
        categoryId: null,
      },
    }),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      const a = await setUpOf('A');
      const b = await setUpOf('B');
      const { entry } = input as { entry: Record<string, unknown> };
      const spend = (goalId: string, accountId: string, markUsed = false) => ({
        goalId,
        markUsed,
        entry: { ...entry, clientId: randomUUID(), accountId, amountMinor: 5_000n },
      });
      await refusedForB('spendFromGoal', spend(a.goal.id, b.home));
      const before = await aGoalRows();
      expect(await as('B', 'spendFromGoal', spend(b.goal.id, a.home))).toMatchObject({ ok: false });
      expect(await aGoalRows()).toEqual(before);
      expect(
        await as('B', 'spendFromGoal', { ...spend(b.goal.id, b.home), entry: { ...entry, type: 'income' } }),
      ).toEqual({ ok: false, code: 'INVALID_GOAL' });
      expect(await as('B', 'spendFromGoal', spend(b.goal.id, b.home))).toMatchObject(
        ok({ goal: { savedMinor: 95_000n, status: 'active' } }),
      );
    },
  },
  completeGoal: {
    input: () => ({ id: SOME_ID, stopPlans: true }),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const a = await setUpOf('A');
      const b = await setUpOf('B');
      await refusedForB('completeGoal', { id: a.goal.id, stopPlans: true });
      const done = await as<Result<{ goal: GoalView; stoppedPlanIds: string[] }>>('B', 'completeGoal', {
        id: b.goal.id,
        stopPlans: true,
      });
      expect(done).toMatchObject(ok({ goal: { status: 'completed' }, stoppedPlanIds: [b.goal.plans[0]?.id] }));
    },
  },
  moveGoalRemainder: {
    input: () => ({ id: SOME_ID, toGoalId: null }),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const a = await setUpOf('A');
      const b = await setUpOf('B');
      const [other] = await idsOf('goals', bId, `name = 'Liburan B'`);
      await refusedForB('moveGoalRemainder', { id: a.goal.id, toGoalId: null });
      // B's completed goal cannot hand its remainder to A's goal.
      await refusedForB('moveGoalRemainder', { id: b.goal.id, toGoalId: a.goal.id });
      const moved = await as<Result<GoalView[]>>('B', 'moveGoalRemainder', { id: b.goal.id, toGoalId: other });
      expect(moved.ok && moved.value.map((goal) => [goal.name, goal.savedMinor])).toEqual([
        ['Tujuan B', 0n],
        ['Liburan B', 95_000n],
      ]);
    },
  },
  reopenGoal: {
    input: () => ({ id: SOME_ID, resumePlanIds: [] }),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const a = await setUpOf('A');
      const b = await setUpOf('B');
      await refusedForB('reopenGoal', { id: a.goal.id, resumePlanIds: [] });
      // A's plan cannot be resumed through B's goal.
      await refusedForB('reopenGoal', { id: b.goal.id, resumePlanIds: [a.goal.plans[0]?.id] });
      expect(await as('B', 'reopenGoal', { id: b.goal.id, resumePlanIds: [b.goal.plans[0]?.id] })).toMatchObject(
        ok({ status: 'active', monthlyPlanMinor: 50_000n }),
      );
    },
  },
  addGoalPlan: {
    input: () => ({ goalId: SOME_ID, plan: { recurrenceId: SOME_ID, amountMinor: 1n } }),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const a = await setUpOf('A');
      const b = await setUpOf('B');
      const monthly = (fromAccountId: string) => ({
        amountMinor: 20_000n,
        monthDay: 1,
        fromAccountId,
        startOn: '2026-11-01',
      });
      await refusedForB('addGoalPlan', { goalId: a.goal.id, plan: monthly(b.other) });
      await refusedForB('addGoalPlan', {
        goalId: b.goal.id,
        plan: { recurrenceId: a.goal.plans[0]?.recurrenceId, amountMinor: 1n },
      });
      const before = await aGoalRows();
      expect(await as('B', 'addGoalPlan', { goalId: b.goal.id, plan: monthly(a.other) })).toMatchObject({
        ok: false,
      });
      expect(await aGoalRows()).toEqual(before);
      expect(await as('B', 'addGoalPlan', { goalId: b.goal.id, plan: monthly(b.other) })).toMatchObject(
        ok({ monthlyPlanMinor: 70_000n }),
      );
    },
  },
  setGoalPlanActive: {
    input: () => ({ planId: SOME_ID, active: false }),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const a = await setUpOf('A');
      const b = await setUpOf('B');
      await refusedForB('setGoalPlanActive', { planId: a.goal.plans[0]?.id, active: false });
      expect(await as('B', 'setGoalPlanActive', { planId: b.goal.plans[0]?.id, active: false })).toMatchObject(
        ok({ monthlyPlanMinor: 20_000n }),
      );
    },
  },
  updateGoalPlan: {
    input: () => ({ planId: SOME_ID, amountMinor: 1n }),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const a = await setUpOf('A');
      const b = await setUpOf('B');
      await refusedForB('updateGoalPlan', { planId: a.goal.plans[0]?.id, amountMinor: 1n });
      expect(await as('B', 'updateGoalPlan', { planId: b.goal.plans[0]?.id, amountMinor: 60_000n })).toMatchObject({
        ok: true,
      });
    },
  },
  removeGoal: {
    input: () => ({ id: SOME_ID }),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const a = await setUpOf('A');
      const b = await setUpOf('B');
      await refusedForB('removeGoal', { id: a.goal.id });
      expect(await as('B', 'removeGoal', { id: b.goal.id })).toEqual(ok(null));
      expect(await idsOf('goals', bId)).not.toContain(b.goal.id);
    },
  },
} satisfies Partial<Record<Name, Case>>;
