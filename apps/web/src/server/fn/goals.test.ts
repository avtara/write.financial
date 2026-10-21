// SPDX-License-Identifier: AGPL-3.0-only
import { LedgerError } from '@wf/db/ledger-errors';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeSession } from '../../../test/fixtures.ts';
import { DANA_DARURAT, LIBURAN_BALI, SERVIS_MOTOR } from '../../../test/goal-fixtures.ts';
import { call, requestContext, validatorOf } from '../../../test/server-fn.ts';
import * as fns from './goals.ts';

const fake = vi.hoisted(() => ({
  goals: {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    setSources: vi.fn(),
    remove: vi.fn(),
    deposit: vi.fn(),
    withdraw: vi.fn(),
    spend: vi.fn(),
    moveRemainder: vi.fn(),
    complete: vi.fn(),
    reopen: vi.fn(),
    addPlan: vi.fn(),
    setPlanActive: vi.fn(),
    updatePlan: vi.fn(),
  },
  periods: { list: vi.fn(), payday: vi.fn() },
  budgets: { fillFromAverage: vi.fn() },
  schedules: { listRecurrences: vi.fn(), listScheduled: vi.fn(), updateRecurrence: vi.fn() },
  transactionQuery: { list: vi.fn() },
}));

// vi.mock factories run before imports; they load the shared helper themselves.
vi.mock('@tanstack/react-start', async () => (await import('../../../test/server-fn.ts')).serverFnModule());
vi.mock('../runtime.ts', () => ({
  services: () => Promise.resolve({ ...fake, now: () => new Date('2026-10-15T02:42:00Z') }),
}));

const USER_ID = fakeSession().user.id;
const context = () => requestContext(fakeSession());
const GOAL_ID = '0192a6c4-0000-7000-8000-000000000001';
const PLAN_ID = '0192a6c4-0000-7000-8000-000000000002';
const REC_ID = '0192a6c4-0000-7000-8000-000000000003';
const ACCOUNT = '0192a6c4-0000-7000-8000-000000000004';
const OTHER = '0192a6c4-0000-7000-8000-000000000005';

/** A recurring transfer as `listRecurrences` returns it. */
function recurrence(overrides: Record<string, unknown> = {}, template: Record<string, unknown> = {}) {
  return {
    id: REC_ID,
    currency: 'IDR',
    freq: 'monthly',
    interval: 1,
    startOn: '2026-10-25',
    weekday: null,
    monthDay: 25,
    end: { type: 'never' },
    remindOffsetDays: 1,
    status: 'active',
    stoppedAt: null,
    preview: [],
    nextDue: { occurrenceId: 'occ', dueDate: '2026-10-25', status: 'scheduled' },
    occurrences: { confirmed: 0, skipped: 0, open: 1 },
    createdAt: new Date(0),
    template: {
      type: 'transfer',
      fromAccountId: ACCOUNT,
      toAccountId: OTHER,
      sentMinor: 1_150_000n,
      receivedMinor: 1_150_000n,
      description: 'Sisihkan dana tidak rutin',
      tags: [],
      allocations: [
        { goalId: LIBURAN_BALI.id, amountMinor: 867_000n },
        { goalId: SERVIS_MOTOR.id, amountMinor: 283_000n },
      ],
      ...template,
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  fake.goals.list.mockResolvedValue([DANA_DARURAT, LIBURAN_BALI, SERVIS_MOTOR]);
  fake.goals.get.mockResolvedValue(DANA_DARURAT);
  fake.periods.list.mockResolvedValue({ today: '2026-10-15', baseCurrency: 'IDR', current: { id: 'period' } });
  fake.periods.payday.mockResolvedValue({ day: 25, merchant: 'PT Kinarya', count: 2 });
  fake.budgets.fillFromAverage.mockResolvedValue([
    { categoryId: 'a', averageMinor: 10_000_000n },
    { categoryId: 'b', averageMinor: 8_000_000n },
  ]);
  fake.schedules.listRecurrences.mockResolvedValue([recurrence()]);
  fake.schedules.listScheduled.mockResolvedValue([]);
  fake.transactionQuery.list.mockResolvedValue({ rows: [], total: 0 });
});

describe('reading goals', () => {
  it('answers the page: goals with their next contribution month, the month’s movements, and the suggestions', async () => {
    fake.schedules.listRecurrences.mockResolvedValueOnce([
      recurrence({ id: 'weekly', freq: 'weekly' }),
      recurrence({ id: 'expense' }, { type: 'expense' }),
      recurrence({ id: 'unplanned' }, { allocations: [] }),
      recurrence({ id: 'no-allocations' }, { allocations: undefined }),
      recurrence({ id: 'mixed' }, { allocations: [{ goalId: DANA_DARURAT.id, amountMinor: 1n }] }),
      recurrence(),
    ]);
    fake.schedules.listScheduled.mockResolvedValueOnce([
      {
        occurrenceId: 'occ',
        sourceType: 'recurrence',
        sourceId: 'rec-kantong',
        name: 'Kantong darurat',
        icon: null,
        dueDate: '2026-10-01',
        expectedMinor: 500_000n,
        currency: 'IDR',
        status: 'confirmed',
        transactionId: 'tx',
        accountId: ACCOUNT,
        direction: 'transfer',
      },
    ]);
    const result = await call<{ ok: true; value: fns.GoalsOverview }>(fns.getGoals, { context: context(), data: {} });
    expect(result.value).toMatchObject({
      today: '2026-10-15',
      month: '2026-10',
      baseCurrency: 'IDR',
      averageSpendingMinor: 18_000_000n,
      payday: 25,
      setAside: {
        recurrenceId: REC_ID,
        name: 'Sisihkan dana tidak rutin',
        monthDay: 25,
        fromAccountId: ACCOUNT,
        toAccountId: OTHER,
        amountMinor: 1_150_000n,
        goalIds: [LIBURAN_BALI.id, SERVIS_MOTOR.id],
      },
    });
    expect(result.value.goals.map((goal) => [goal.id, goal.nextMonth])).toEqual([
      [DANA_DARURAT.id, '2026-10'],
      [LIBURAN_BALI.id, '2026-10'],
      [SERVIS_MOTOR.id, '2026-10'],
    ]);
    expect(result.value.movements.map((movement) => movement.key)).toEqual(['rec-kantong:2026-10-01']);
    const range = { from: '2026-10-01', to: '2026-10-31' };
    expect(fake.schedules.listRecurrences).toHaveBeenCalledWith(USER_ID, { status: 'active' });
    expect(fake.schedules.listScheduled).toHaveBeenCalledWith(USER_ID, range);
    expect(fake.transactionQuery.list).toHaveBeenCalledWith(
      USER_ID,
      { ...range, types: ['transfer'], tags: ['dana-darurat', 'liburan-bali', 'servis-motor'] },
      { limit: 200 },
    );
    expect(fake.budgets.fillFromAverage).toHaveBeenCalledWith(USER_ID, 'period');
  });

  it('reads another month, and does without goal tags, a period row, or a set-aside transfer', async () => {
    fake.goals.list.mockResolvedValueOnce([{ ...DANA_DARURAT, tag: null }]);
    fake.periods.list.mockResolvedValueOnce({ today: '2026-10-15', baseCurrency: 'IDR', current: { id: null } });
    fake.schedules.listRecurrences.mockResolvedValueOnce([]);
    const result = await call<{ ok: true; value: fns.GoalsOverview }>(fns.getGoals, {
      context: context(),
      data: { month: '2026-09' },
    });
    expect(result.value).toMatchObject({ month: '2026-09', averageSpendingMinor: 0n, setAside: null, movements: [] });
    expect(fake.schedules.listScheduled).toHaveBeenCalledWith(USER_ID, { from: '2026-09-01', to: '2026-09-30' });
    expect(fake.transactionQuery.list).not.toHaveBeenCalled();
    expect(fake.budgets.fillFromAverage).not.toHaveBeenCalled();
  });

  it('names the set-aside transfer only when it has a description', async () => {
    fake.schedules.listRecurrences.mockResolvedValueOnce([recurrence({}, { description: undefined })]);
    const result = await call<{ ok: true; value: fns.GoalsOverview }>(fns.getGoals, { context: context(), data: {} });
    expect(result.value.setAside).toMatchObject({ recurrenceId: REC_ID, name: null });
  });

  it('lists goals by status for the Record sheet', async () => {
    expect(await call(fns.listGoals, { context: context(), data: { status: 'active' } })).toMatchObject({ ok: true });
    expect(fake.goals.list).toHaveBeenCalledWith(USER_ID, { status: 'active' });
    await call(fns.listGoals, { context: context(), data: {} });
    expect(fake.goals.list).toHaveBeenLastCalledWith(USER_ID, {});
  });

  it('reads a goal’s history over the last 12 months, newest first', async () => {
    fake.transactionQuery.list.mockResolvedValueOnce({
      rows: [
        {
          id: 'a',
          type: 'transfer',
          localDate: '2026-09-14',
          accountId: ACCOUNT,
          toAccountId: 'acc-jago',
          amountMinor: -2n,
          receivedMinor: 2n,
          tags: ['dana-darurat'],
          source: 'manual',
        },
        {
          id: 'b',
          type: 'transfer',
          localDate: '2026-10-07',
          accountId: ACCOUNT,
          toAccountId: 'acc-jago',
          amountMinor: -1n,
          receivedMinor: 1n,
          tags: ['dana-darurat'],
          source: 'manual',
        },
      ],
      total: 2,
    });
    const result = await call<{ ok: true; value: { key: string }[] }>(fns.getGoalHistory, {
      context: context(),
      data: { id: GOAL_ID },
    });
    expect(result.value.map((movement) => movement.key)).toEqual(['b', 'a']);
    expect(fake.goals.get).toHaveBeenCalledWith(USER_ID, GOAL_ID);
    expect(fake.schedules.listScheduled).toHaveBeenCalledWith(USER_ID, { from: '2025-11-01', to: '2026-10-31' });
  });
});

describe('making and changing goals', () => {
  const input = {
    name: 'Laptop kerja baru',
    icon: 'laptop',
    color: 'blue',
    targetMinor: 18_000_000n,
    currency: 'IDR',
    deadlineMonth: '2027-06',
    tag: 'Laptop kerja baru',
    accountId: ACCOUNT,
  };

  it('creates a goal with its sources and contributions', async () => {
    fake.goals.create.mockResolvedValueOnce({ id: GOAL_ID });
    fake.goals.addPlan.mockResolvedValueOnce({ id: GOAL_ID, plans: ['a'] });
    const plan = { amountMinor: 2_250_000n, monthDay: 25, fromAccountId: OTHER, startOn: '2026-11-25' };
    expect(
      await call(fns.createGoal, {
        context: context(),
        data: { ...input, sources: [{ accountId: ACCOUNT, mode: 'whole', amountMinor: undefined }], plans: [plan] },
      }),
    ).toEqual({ ok: true, value: { id: GOAL_ID, plans: ['a'] } });
    expect(fake.goals.create).toHaveBeenCalledWith(USER_ID, {
      ...input,
      sources: [{ accountId: ACCOUNT, mode: 'whole' }],
    });
    expect(fake.goals.addPlan).toHaveBeenCalledWith(USER_ID, GOAL_ID, plan);
    fake.goals.create.mockResolvedValueOnce({ id: GOAL_ID });
    expect(await call(fns.createGoal, { context: context(), data: input })).toEqual({
      ok: true,
      value: { id: GOAL_ID },
    });
    expect(fake.goals.create).toHaveBeenLastCalledWith(USER_ID, { ...input, sources: [] });
  });

  it('removes the new goal again when a contribution is refused', async () => {
    fake.goals.create.mockResolvedValueOnce({ id: GOAL_ID });
    fake.goals.addPlan.mockRejectedValueOnce(new LedgerError('INVALID_GOAL', 'no'));
    const plan = { amountMinor: 1n, monthDay: 1, fromAccountId: OTHER, startOn: '2026-11-01' };
    expect(await call(fns.createGoal, { context: context(), data: { ...input, plans: [plan] } })).toEqual({
      ok: false,
      code: 'INVALID_GOAL',
    });
    expect(fake.goals.remove).toHaveBeenCalledWith(USER_ID, GOAL_ID);
  });

  it('joins the payday transfer the sinking funds share by growing it, and shares others as they are', async () => {
    fake.goals.create.mockResolvedValueOnce({ id: GOAL_ID });
    fake.goals.get.mockResolvedValueOnce({ id: GOAL_ID, joined: true });
    expect(
      await call(fns.createGoal, {
        context: context(),
        data: {
          ...input,
          kind: 'sinking',
          plans: [{ recurrenceId: REC_ID, amountMinor: 250_000n, startMonth: '2026-11', endMonth: '2027-04' }],
        },
      }),
    ).toEqual({ ok: true, value: { id: GOAL_ID, joined: true } });
    expect(fake.schedules.updateRecurrence).toHaveBeenCalledWith(USER_ID, REC_ID, {
      freq: 'monthly',
      interval: 1,
      startOn: '2026-10-25',
      weekday: null,
      monthDay: 25,
      end: { type: 'never' },
      remindOffsetDays: 1,
      template: expect.objectContaining({
        sentMinor: 1_400_000n,
        receivedMinor: 1_400_000n,
        allocations: [
          { goalId: LIBURAN_BALI.id, amountMinor: 867_000n },
          { goalId: SERVIS_MOTOR.id, amountMinor: 283_000n },
          // From its first month on: the transfer's occurrences send the plans running each month.
          { goalId: GOAL_ID, amountMinor: 250_000n, startMonth: '2026-11', endMonth: '2027-04' },
        ],
      }) as unknown,
    });
    expect(fake.goals.addPlan).not.toHaveBeenCalled();
    // Transfers not wholly planned for goals, across currencies, or not transfers take a share as they are.
    for (const other of [
      recurrence({}, { sentMinor: 2_000_000n, receivedMinor: 2_000_000n }),
      recurrence({}, { receivedMinor: 70n }),
      recurrence({}, { allocations: [] }),
      recurrence({}, { allocations: undefined }),
      recurrence({}, { type: 'expense' }),
    ]) {
      fake.schedules.listRecurrences.mockResolvedValueOnce([other]);
      await call(fns.addGoalPlan, {
        context: context(),
        data: { goalId: GOAL_ID, plan: { recurrenceId: REC_ID, amountMinor: 1n } },
      });
      expect(fake.goals.addPlan).toHaveBeenLastCalledWith(USER_ID, GOAL_ID, { recurrenceId: REC_ID, amountMinor: 1n });
    }
    expect(fake.schedules.updateRecurrence).toHaveBeenCalledTimes(1);
    fake.schedules.listRecurrences.mockResolvedValueOnce([]);
    expect(
      await call(fns.addGoalPlan, {
        context: context(),
        data: { goalId: GOAL_ID, plan: { recurrenceId: REC_ID, amountMinor: 1n } },
      }),
    ).toEqual({ ok: false, code: 'NOT_FOUND' });
  });

  it('adds a new monthly contribution, pauses, and changes one', async () => {
    fake.goals.addPlan.mockResolvedValueOnce({ id: GOAL_ID });
    const plan = { amountMinor: 1n, monthDay: 1, fromAccountId: OTHER, toAccountId: undefined, startOn: '2026-11-01' };
    expect(await call(fns.addGoalPlan, { context: context(), data: { goalId: GOAL_ID, plan } })).toEqual({
      ok: true,
      value: { id: GOAL_ID },
    });
    expect(fake.goals.addPlan).toHaveBeenCalledWith(USER_ID, GOAL_ID, {
      amountMinor: 1n,
      monthDay: 1,
      fromAccountId: OTHER,
      startOn: '2026-11-01',
    });
    await call(fns.setGoalPlanActive, { context: context(), data: { planId: PLAN_ID, active: false } });
    expect(fake.goals.setPlanActive).toHaveBeenCalledWith(USER_ID, PLAN_ID, false);
    await call(fns.updateGoalPlan, { context: context(), data: { planId: PLAN_ID, amountMinor: 600_000n } });
    expect(fake.goals.updatePlan).toHaveBeenCalledWith(USER_ID, PLAN_ID, { amountMinor: 600_000n });
  });

  it('updates a goal, with its sources when sent, and removes one', async () => {
    fake.goals.update.mockResolvedValue({ id: GOAL_ID, updated: true });
    fake.goals.setSources.mockResolvedValueOnce({ id: GOAL_ID, sources: true });
    expect(
      await call(fns.updateGoal, {
        context: context(),
        data: { id: GOAL_ID, patch: { name: 'Baru', deadlineMonth: undefined } },
      }),
    ).toEqual({ ok: true, value: { id: GOAL_ID, updated: true } });
    expect(fake.goals.update).toHaveBeenCalledWith(USER_ID, GOAL_ID, { name: 'Baru' });
    expect(fake.goals.setSources).not.toHaveBeenCalled();
    expect(
      await call(fns.updateGoal, {
        context: context(),
        data: { id: GOAL_ID, patch: {}, sources: [{ accountId: ACCOUNT, mode: 'fixed', amountMinor: 5n }] },
      }),
    ).toEqual({ ok: true, value: { id: GOAL_ID, sources: true } });
    expect(fake.goals.setSources).toHaveBeenCalledWith(USER_ID, GOAL_ID, [
      { accountId: ACCOUNT, mode: 'fixed', amountMinor: 5n },
    ]);
    expect(await call(fns.removeGoal, { context: context(), data: { id: GOAL_ID } })).toEqual({
      ok: true,
      value: null,
    });
    expect(fake.goals.remove).toHaveBeenCalledWith(USER_ID, GOAL_ID);
  });
});

describe('moving money', () => {
  const move = {
    id: GOAL_ID,
    clientId: '0192a6c4-0000-7000-8000-000000000009',
    occurredAt: new Date('2026-10-15T02:42:00Z'),
    fromAccountId: ACCOUNT,
    toAccountId: OTHER,
    amountMinor: 1_000_000n,
    note: undefined,
  };
  const repoInput = {
    clientId: move.clientId,
    occurredAt: move.occurredAt,
    fromAccountId: ACCOUNT,
    toAccountId: OTHER,
    amountMinor: 1_000_000n,
  };

  it('deposits and withdraws as labeled transfers', async () => {
    fake.goals.deposit.mockResolvedValueOnce({ transactionId: 'tx' });
    expect(await call(fns.depositToGoal, { context: context(), data: move })).toEqual({
      ok: true,
      value: { transactionId: 'tx' },
    });
    expect(fake.goals.deposit).toHaveBeenCalledWith(USER_ID, GOAL_ID, repoInput);
    await call(fns.withdrawFromGoal, { context: context(), data: { ...move, note: 'Servis AC' } });
    expect(fake.goals.withdraw).toHaveBeenCalledWith(USER_ID, GOAL_ID, { ...repoInput, note: 'Servis AC' });
  });

  it('pays an expense from a goal, and refuses anything but an expense', async () => {
    const entry = {
      type: 'expense',
      clientId: move.clientId,
      occurredAt: move.occurredAt,
      accountId: ACCOUNT,
      amountMinor: 812_000n,
      categoryId: null,
      description: 'Perpanjang STNK — Samsat Jaksel',
      tags: undefined,
    };
    const used = {
      id: GOAL_ID,
      plans: [
        { id: 'paused', active: false },
        { id: PLAN_ID, active: true },
      ],
    };
    fake.goals.spend.mockResolvedValueOnce({ transactionId: 'tx', goal: used });
    fake.goals.setPlanActive.mockResolvedValueOnce({ id: GOAL_ID, stopped: true });
    expect(
      await call(fns.spendFromGoal, { context: context(), data: { goalId: GOAL_ID, markUsed: true, entry } }),
    ).toEqual({ ok: true, value: { transactionId: 'tx', goal: { id: GOAL_ID, stopped: true } } });
    expect(fake.goals.setPlanActive).toHaveBeenCalledTimes(1);
    expect(fake.goals.setPlanActive).toHaveBeenCalledWith(USER_ID, PLAN_ID, false);
    fake.goals.spend.mockResolvedValueOnce({ transactionId: 'tx-2', goal: used });
    expect(
      await call(fns.spendFromGoal, { context: context(), data: { goalId: GOAL_ID, markUsed: false, entry } }),
    ).toEqual({ ok: true, value: { transactionId: 'tx-2', goal: used } });
    expect(fake.goals.setPlanActive).toHaveBeenCalledTimes(1);
    const draft = {
      type: 'expense',
      clientId: move.clientId,
      occurredAt: move.occurredAt,
      accountId: ACCOUNT,
      amountMinor: 812_000n,
      categoryId: null,
      description: 'Perpanjang STNK — Samsat Jaksel',
    };
    expect(fake.goals.spend).toHaveBeenCalledWith(USER_ID, GOAL_ID, { draft, markUsed: true });
    expect(
      await call(fns.spendFromGoal, {
        context: context(),
        data: { goalId: GOAL_ID, markUsed: true, entry: { ...entry, type: 'transfer' } },
      }),
    ).toEqual({ ok: false, code: 'INVALID_GOAL' });
  });

  it('completes, reopens, and hands on a remainder', async () => {
    await call(fns.completeGoal, { context: context(), data: { id: GOAL_ID, stopPlans: true } });
    expect(fake.goals.complete).toHaveBeenCalledWith(USER_ID, GOAL_ID, { stopPlans: true });
    await call(fns.reopenGoal, { context: context(), data: { id: GOAL_ID, resumePlanIds: [PLAN_ID] } });
    expect(fake.goals.reopen).toHaveBeenCalledWith(USER_ID, GOAL_ID, { resumePlanIds: [PLAN_ID] });
    await call(fns.moveGoalRemainder, { context: context(), data: { id: GOAL_ID, toGoalId: null } });
    expect(fake.goals.moveRemainder).toHaveBeenCalledWith(USER_ID, GOAL_ID, { toGoalId: null });
  });
});

describe('access and input', () => {
  it('refuses signed-out requests', async () => {
    for (const fn of Object.values(fns)) {
      expect(await call(fn, { context: requestContext(null), data: {} })).toEqual({
        ok: false,
        code: 'UNAUTHENTICATED',
      });
    }
    expect(fake.goals.list).not.toHaveBeenCalled();
  });

  it('validates months, amounts, sources, and plans', () => {
    const overview = validatorOf(fns.getGoals);
    expect(overview.safeParse({ month: '2026-10' }).success).toBe(true);
    expect(overview.safeParse({ month: '2026-13' }).success).toBe(false);
    const create = validatorOf(fns.createGoal);
    const goal = {
      name: ' Liburan ',
      icon: 'plane',
      color: 'violet',
      targetMinor: 1n,
      currency: 'IDR',
      deadlineMonth: null,
      tag: null,
    };
    expect(create.parse(goal)).toMatchObject({ name: 'Liburan' });
    expect(create.safeParse({ ...goal, targetMinor: 0n }).success).toBe(false);
    expect(create.safeParse({ ...goal, name: ' ' }).success).toBe(false);
    expect(create.safeParse({ ...goal, targetMonths: 25 }).success).toBe(false);
    expect(create.safeParse({ ...goal, sources: [{ accountId: ACCOUNT, mode: 'some' }] }).success).toBe(false);
    expect(
      create.parse({
        ...goal,
        plans: [{ amountMinor: 1n, monthDay: 31, fromAccountId: OTHER, startOn: '2026-11-30' }],
      }),
    ).toMatchObject({ plans: [{ startOn: '2026-11-30' }] });
    expect(
      create.safeParse({
        ...goal,
        plans: [{ amountMinor: 1n, monthDay: 32, fromAccountId: OTHER, startOn: '2026-11-30' }],
      }).success,
    ).toBe(false);
    const deposit = validatorOf(fns.depositToGoal);
    expect(
      deposit.safeParse({
        id: GOAL_ID,
        clientId: GOAL_ID,
        occurredAt: new Date(),
        fromAccountId: ACCOUNT,
        amountMinor: 0n,
      }).success,
    ).toBe(false);
  });
});
