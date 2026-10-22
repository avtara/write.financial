// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from 'node:crypto';
import type { LocalDate, YearMonth } from '@wf/domain/period';
import { DESIGN_SEED } from '@wf/domain/seed';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { fixtureGetDek, ledgerFixture, type LedgerFixture } from '../test/ledger-fixture.ts';
import { insertUser, pgError, PGLITE_HOOK_TIMEOUT, startMigrated, type TestDatabase } from '../test/pglite.ts';
import { creditGoalIn, createGoals, type GoalInput, type GoalSourceInput, type GoalsRepository } from './goals.ts';
import { withUser } from './db.ts';
import { createInvestments } from './investments.ts';
import { createSchedules } from './schedules.ts';
import { createTransactions } from './transactions.ts';

let test: TestDatabase;
let repo: GoalsRepository;
let alice: LedgerFixture;
let bob: string;

const NOW = new Date('2026-10-15T05:00:00Z');
const options = { getDek: fixtureGetDek, now: () => NOW };
const at = (date: string) => new Date(`${date}T12:00:00+07:00`);

beforeAll(async () => {
  test = await startMigrated();
  repo = createGoals(test.db, options);
}, PGLITE_HOOK_TIMEOUT);

afterAll(async () => {
  await test.close();
});

beforeEach(async () => {
  await test.query('DELETE FROM users');
  alice = await ledgerFixture(test, 'alice@example.test');
  bob = await insertUser(test, 'bob@example.test');
});

const asApp = <T>(fn: () => Promise<T>) => test.as('wf_app', fn);

const SEED_GOALS: GoalInput[] = DESIGN_SEED.goals.map((goal) => ({
  name: goal.name,
  icon: goal.icon,
  color: goal.color,
  kind: goal.kind,
  targetMinor: goal.targetMinor,
  targetMode: goal.targetMonths === null ? 'fixed' : 'monthly_expenses',
  targetMonths: goal.targetMonths,
  currency: goal.currency,
  deadlineMonth: goal.deadlineMonth as YearMonth | null,
  tag: goal.tag,
}));

const input = (overrides: Partial<GoalInput> = {}): GoalInput => ({ ...(SEED_GOALS[0] as GoalInput), ...overrides });

/** An account of `userId` (IDR, opened with 1.000.000 unless stated). */
async function account(
  userId: string,
  { currency = 'IDR', status = 'active' }: { currency?: string; status?: 'active' | 'archived' } = {},
): Promise<string> {
  const [row] = await test.query<{ id: string }>(
    `INSERT INTO accounts (user_id, type, provider_name, display_name, currency, opening_balance_minor, opening_date,
       color, status, archived_at)
     VALUES ($1, 'bank', 'Bank', 'Bank', $2, 1000000, '2026-01-01', 'blue', $3::account_status,
       CASE WHEN $3::account_status = 'archived' THEN now() END) RETURNING id`,
    [userId, currency, status],
  );
  return row?.id as string;
}

const goalTransactions = (column: 'goal_id' | 'paid_from_goal_id', goalId: string) =>
  test.query<{ type: string }>(`SELECT type FROM transactions WHERE ${column} = $1`, [goalId]);

describe('goals: create, list, update', () => {
  it('creates the seed goals in order with their tags, kinds, and targets', async () => {
    for (const goal of SEED_GOALS) await asApp(() => repo.create(alice.userId, goal));
    const goals = await asApp(() => repo.list(alice.userId));
    expect(
      goals.map(({ name, kind, targetMode, targetMonths, tag, sortOrder, status }) => [
        name,
        kind,
        targetMode,
        targetMonths,
        tag,
        sortOrder,
        status,
      ]),
    ).toEqual(
      SEED_GOALS.map((goal, index) => [
        goal.name,
        goal.kind,
        goal.targetMode,
        goal.targetMonths,
        goal.tag,
        index,
        'active',
      ]),
    );
    expect(goals[0]).toMatchObject({ sources: [], savedMinor: 0n, plans: [], monthlyPlanMinor: 0n, completedAt: null });
    expect(await test.query("SELECT deadline_month::text FROM goals WHERE name = 'Dana Darurat'")).toEqual([
      { deadline_month: '2027-11-01' },
    ]);
    expect(await asApp(() => repo.list(bob))).toEqual([]);
    await expect(asApp(() => repo.get(bob, goals[0]?.id as string))).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await asApp(() => repo.list(alice.userId, { status: 'completed' }))).toEqual([]);
  });

  it('trims the name, normalizes the tag, and defaults to a fixed savings goal', async () => {
    const tagged = await asApp(() =>
      repo.create(alice.userId, {
        name: '  Umroh  ',
        icon: 'moon',
        color: 'green',
        targetMinor: 1n,
        currency: 'IDR',
        deadlineMonth: null,
        tag: '#Dana Umroh',
      }),
    );
    expect(tagged).toMatchObject({ name: 'Umroh', tag: 'dana-umroh', kind: 'savings', targetMode: 'fixed' });
    const untagged = await asApp(() => repo.create(alice.userId, input({ name: 'Laptop', tag: null })));
    expect(untagged).toMatchObject({ tag: null, sortOrder: 1 });
  });

  it.each<[string, Partial<GoalInput>]>([
    ['an empty name', { name: '   ' }],
    ['a long name', { name: 'x'.repeat(41) }],
    ['a zero target', { targetMinor: 0n }],
    ['a currency', { currency: 'idr' }],
    ['a deadline', { deadlineMonth: '2027-13' as YearMonth }],
    ['a dynamic target without months', { targetMode: 'monthly_expenses', targetMonths: null }],
    ['too many months', { targetMode: 'monthly_expenses', targetMonths: 25 }],
    ['a fraction of a month', { targetMode: 'monthly_expenses', targetMonths: 1.5 }],
    ['months on a fixed target', { targetMode: 'fixed', targetMonths: 3 }],
  ])('rejects %s', async (_, overrides) => {
    await expect(asApp(() => repo.create(alice.userId, input(overrides)))).rejects.toMatchObject({
      code: 'INVALID_GOAL',
    });
  });

  it('rejects a tag without letters or digits', async () => {
    await expect(asApp(() => repo.create(alice.userId, input({ tag: '#' })))).rejects.toMatchObject({
      code: 'INVALID_TAG',
    });
  });

  it('keeps the "Simpan di" account: only an active account of the user in the goal currency', async () => {
    expect(await asApp(() => repo.create(alice.userId, input({ accountId: alice.jago })))).toMatchObject({
      accountId: alice.jago,
    });
    for (const other of [
      await account(bob),
      await account(alice.userId, { status: 'archived' }),
      await account(alice.userId, { currency: 'USD' }),
    ]) {
      await expect(asApp(() => repo.create(alice.userId, input({ accountId: other })))).rejects.toMatchObject({
        code: 'INVALID_GOAL',
      });
    }
  });

  it('updates the given fields and keeps the others', async () => {
    const goal = await asApp(() => repo.create(alice.userId, input({ accountId: alice.jago })));
    const updated = await asApp(() =>
      repo.update(alice.userId, goal.id, {
        name: 'Dana Darurat 6 bulan',
        targetMinor: 108_000_000n,
        targetMonths: 6,
        kind: 'savings',
        tag: null,
      }),
    );
    expect(updated).toMatchObject({
      name: 'Dana Darurat 6 bulan',
      targetMinor: 108_000_000n,
      targetMode: 'monthly_expenses',
      targetMonths: 6,
      deadlineMonth: '2027-11',
      tag: null,
      accountId: alice.jago,
    });
    const fixed = await asApp(() =>
      repo.update(alice.userId, goal.id, { targetMode: 'fixed', targetMonths: null, tag: 'darurat' }),
    );
    expect(fixed).toMatchObject({ targetMode: 'fixed', targetMonths: null, tag: 'darurat', deadlineMonth: '2027-11' });
    const undated = await asApp(() =>
      repo.create(alice.userId, input({ name: 'Undated', tag: null, deadlineMonth: null })),
    );
    expect(await asApp(() => repo.update(alice.userId, undated.id, { icon: 'star' }))).toMatchObject({
      icon: 'star',
      deadlineMonth: null,
    });
    await expect(asApp(() => repo.update(alice.userId, goal.id, { name: '' }))).rejects.toMatchObject({
      code: 'INVALID_GOAL',
    });
    await expect(asApp(() => repo.update(bob, goal.id, { name: 'x' }))).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('cannot be written by the worker', async () => {
    await expect(test.as('wf_worker', () => repo.create(alice.userId, input({ tag: null })))).rejects.toMatchObject(
      pgError(/permission denied/),
    );
  });
});

describe('goals: funding sources (FR-G2)', () => {
  it('counts a whole account by its balance and a fixed amount as is; allocations per account', async () => {
    await alice.entry('expense', '2026-10-10', 5_000_000n, null, { accountId: alice.jago });
    // An account no goal uses has no allocation.
    await account(alice.userId);
    const darurat = await asApp(() =>
      repo.create(alice.userId, input({ sources: [{ accountId: alice.jago, mode: 'whole' }] })),
    );
    expect(darurat.sources).toEqual([
      {
        id: expect.any(String) as string,
        accountId: alice.jago,
        accountName: 'Jago',
        mode: 'whole',
        amountMinor: null,
        valueMinor: 95_000_000n,
        sortOrder: 0,
      },
    ]);
    expect(darurat.savedMinor).toBe(95_000_000n);
    const rumah = await asApp(() =>
      repo.create(
        alice.userId,
        input({
          name: 'DP Rumah',
          tag: null,
          sources: [{ accountId: alice.bca, mode: 'fixed', amountMinor: 5_000_000n }],
        }),
      ),
    );
    const motor = await asApp(() =>
      repo.create(
        alice.userId,
        input({ name: 'Motor', tag: null, sources: [{ accountId: alice.bca, mode: 'fixed', amountMinor: 720_000n }] }),
      ),
    );
    expect(rumah.savedMinor).toBe(5_000_000n);
    expect(await asApp(() => repo.allocations(alice.userId))).toEqual([
      { accountId: alice.bca, allocatedMinor: 5_720_000n, goalIds: [rumah.id, motor.id] },
      { accountId: alice.jago, allocatedMinor: 95_000_000n, goalIds: [darurat.id] },
    ]);
    expect(await asApp(() => repo.allocations(bob))).toEqual([]);

    // Replacing: the free balance of BCA for DP Rumah excludes Motor's 720.000 only.
    const replaced = await asApp(() =>
      repo.setSources(alice.userId, rumah.id, [{ accountId: alice.bca, mode: 'fixed', amountMinor: 99_280_000n }]),
    );
    expect(replaced.savedMinor).toBe(99_280_000n);
    await expect(
      asApp(() =>
        repo.setSources(alice.userId, rumah.id, [{ accountId: alice.bca, mode: 'fixed', amountMinor: 99_280_001n }]),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_GOAL' });
    expect((await asApp(() => repo.setSources(alice.userId, rumah.id, []))).sources).toEqual([]);
    await expect(asApp(() => repo.setSources(bob, rumah.id, []))).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it.each<[string, (fixture: LedgerFixture) => readonly GoalSourceInput[] | Promise<readonly GoalSourceInput[]>]>([
    [
      'one account twice',
      (f) => [
        { accountId: f.bca, mode: 'fixed', amountMinor: 1n },
        { accountId: f.bca, mode: 'fixed', amountMinor: 2n },
      ],
    ],
    ['a whole account another goal uses', (f) => [{ accountId: f.jago, mode: 'whole' }]],
    [
      'a fixed amount of an account another goal holds wholly',
      (f) => [{ accountId: f.bca, mode: 'fixed', amountMinor: 1n }],
    ],
    ['a zero fixed amount', (f) => [{ accountId: f.jago, mode: 'fixed', amountMinor: 0n }]],
    ['a fixed source without an amount', (f) => [{ accountId: f.jago, mode: 'fixed' }]],
    [
      'a whole account with an amount',
      async () => [{ accountId: await account(alice.userId), mode: 'whole', amountMinor: 5n }],
    ],
    [
      'an account in another currency',
      async () => [{ accountId: await account(alice.userId, { currency: 'USD' }), mode: 'whole' }],
    ],
    [
      'an archived account',
      async () => [{ accountId: await account(alice.userId, { status: 'archived' }), mode: 'whole' }],
    ],
  ])('refuses %s', async (_, sources) => {
    await asApp(() =>
      repo.create(
        alice.userId,
        input({
          name: 'Other',
          tag: null,
          sources: [
            { accountId: alice.bca, mode: 'whole' },
            { accountId: alice.jago, mode: 'fixed', amountMinor: 10n },
          ],
        }),
      ),
    );
    const list = await sources(alice);
    await expect(asApp(() => repo.create(alice.userId, input({ sources: list })))).rejects.toMatchObject({
      code: 'INVALID_GOAL',
    });
  });
});

describe('goals: deposit, withdraw, pay from goal (FR-G3, FR-G4)', () => {
  it('deposits as a labeled transfer and grows the destination allocation', async () => {
    const goal = await asApp(() => repo.create(alice.userId, input({ accountId: alice.jago })));
    const first = await asApp(() =>
      repo.deposit(alice.userId, goal.id, {
        clientId: randomUUID(),
        occurredAt: at('2026-10-15'),
        fromAccountId: alice.bca,
        amountMinor: 1_000_000n,
        note: 'Bonus proyek freelance',
      }),
    );
    expect(first.goal.sources).toMatchObject([{ accountId: alice.jago, mode: 'fixed', amountMinor: 1_000_000n }]);
    const second = await asApp(() =>
      repo.deposit(alice.userId, goal.id, {
        clientId: randomUUID(),
        occurredAt: at('2026-10-15'),
        fromAccountId: alice.bca,
        toAccountId: alice.jago,
        amountMinor: 500_000n,
      }),
    );
    expect(second.goal.savedMinor).toBe(1_500_000n);
    const detail = await asApp(() => createTransactions(test.db, options).get(alice.userId, first.transactionId));
    expect(detail).toMatchObject({ type: 'transfer', description: 'Dana Darurat', note: 'Bonus proyek freelance' });
    expect(detail.tags).toEqual(['dana-darurat']);
    expect(await goalTransactions('goal_id', goal.id)).toEqual([{ type: 'transfer' }, { type: 'transfer' }]);

    // A goal kept wholly in an account grows with its balance.
    await asApp(() => repo.setSources(alice.userId, goal.id, [{ accountId: alice.jago, mode: 'whole' }]));
    const whole = await asApp(() =>
      repo.deposit(alice.userId, goal.id, {
        clientId: randomUUID(),
        occurredAt: at('2026-10-15'),
        fromAccountId: alice.bca,
        amountMinor: 1_000n,
      }),
    );
    expect(whole.goal.sources).toMatchObject([{ mode: 'whole', valueMinor: 101_501_000n }]);
  });

  it('deposits to the first source without a "Simpan di" account, and refuses what it cannot hold', async () => {
    const bare = await asApp(() => repo.create(alice.userId, input({ tag: null })));
    const deposit = { clientId: randomUUID(), occurredAt: at('2026-10-15'), fromAccountId: alice.bca, amountMinor: 1n };
    await expect(asApp(() => repo.deposit(alice.userId, bare.id, deposit))).rejects.toMatchObject({
      code: 'INVALID_GOAL',
    });
    const other = await account(alice.userId);
    await asApp(() => repo.setSources(alice.userId, bare.id, [{ accountId: other, mode: 'fixed', amountMinor: 1n }]));
    expect((await asApp(() => repo.deposit(alice.userId, bare.id, deposit))).goal.savedMinor).toBe(2n);

    const holder = await asApp(() =>
      repo.create(
        alice.userId,
        input({ name: 'Holder', tag: null, sources: [{ accountId: alice.jago, mode: 'whole' }] }),
      ),
    );
    await expect(
      asApp(() => repo.deposit(alice.userId, bare.id, { ...deposit, clientId: randomUUID(), toAccountId: alice.jago })),
    ).rejects.toMatchObject({ code: 'INVALID_GOAL' });
    const usd = await account(alice.userId, { currency: 'USD' });
    await expect(
      asApp(() => repo.deposit(alice.userId, bare.id, { ...deposit, clientId: randomUUID(), toAccountId: usd })),
    ).rejects.toMatchObject({ code: 'INVALID_GOAL' });
    await asApp(() => repo.complete(alice.userId, holder.id, { stopPlans: false }));
    await expect(
      asApp(() => repo.deposit(alice.userId, holder.id, { ...deposit, clientId: randomUUID() })),
    ).rejects.toMatchObject({ code: 'INVALID_GOAL' });
    await expect(asApp(() => repo.deposit(bob, bare.id, deposit))).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('needs the DEK only for a note', async () => {
    const bare = createGoals(test.db);
    const goal = await asApp(() => bare.create(alice.userId, input({ accountId: alice.jago })));
    const deposit = { clientId: randomUUID(), occurredAt: at('2026-10-15'), fromAccountId: alice.bca, amountMinor: 1n };
    await expect(asApp(() => bare.deposit(alice.userId, goal.id, { ...deposit, note: 'x' }))).rejects.toBeInstanceOf(
      TypeError,
    );
    expect((await asApp(() => bare.deposit(alice.userId, goal.id, { ...deposit, note: '  ' }))).goal.savedMinor).toBe(
      1n,
    );
  });

  it('withdraws from a source account as a labeled transfer', async () => {
    const goal = await asApp(() =>
      repo.create(
        alice.userId,
        input({ sources: [{ accountId: alice.jago, mode: 'fixed', amountMinor: 3_000_000n }] }),
      ),
    );
    const out = (amountMinor: bigint, fromAccountId = alice.jago) =>
      asApp(() =>
        repo.withdraw(alice.userId, goal.id, {
          clientId: randomUUID(),
          occurredAt: at('2026-10-15'),
          fromAccountId,
          toAccountId: alice.bca,
          amountMinor,
        }),
      );
    expect((await out(2_000_000n)).goal.savedMinor).toBe(1_000_000n);
    await expect(out(1_000_001n)).rejects.toMatchObject({ code: 'INVALID_GOAL' });
    await expect(out(1n, alice.bca)).rejects.toMatchObject({ code: 'INVALID_GOAL' });
    expect((await out(1_000_000n)).goal.sources).toEqual([]);

    await asApp(() => repo.setSources(alice.userId, goal.id, [{ accountId: alice.jago, mode: 'whole' }]));
    expect((await out(5_000_000n)).goal.savedMinor).toBe(92_000_000n);
    expect(await goalTransactions('goal_id', goal.id)).toHaveLength(3);
  });

  it('pays from a goal: an expense linked to it, the allocation used up, the goal marked used', async () => {
    const goal = await asApp(() =>
      repo.create(alice.userId, input({ sources: [{ accountId: alice.jago, mode: 'fixed', amountMinor: 850_000n }] })),
    );
    const expense = (amountMinor: bigint) => ({
      type: 'expense' as const,
      clientId: randomUUID(),
      occurredAt: at('2026-10-15'),
      accountId: alice.jago,
      amountMinor,
      categoryId: alice.category('system:transport'),
      note: 'Samsat Jaksel',
    });
    const part = await asApp(() => repo.spend(alice.userId, goal.id, { draft: expense(50_000n), markUsed: false }));
    expect(part.goal).toMatchObject({ status: 'active', savedMinor: 800_000n });
    const used = await asApp(() => repo.spend(alice.userId, goal.id, { draft: expense(812_000n), markUsed: true }));
    expect(used.goal).toMatchObject({ status: 'used', completedAt: NOW, sources: [] });
    expect(await goalTransactions('paid_from_goal_id', goal.id)).toEqual([{ type: 'expense' }, { type: 'expense' }]);
    await expect(
      asApp(() => repo.spend(alice.userId, goal.id, { draft: expense(1n), markUsed: false })),
    ).rejects.toMatchObject({ code: 'INVALID_GOAL' });

    const other = await asApp(() => repo.create(alice.userId, input({ name: 'Other', tag: null })));
    await expect(
      asApp(() => repo.spend(alice.userId, other.id, { draft: { ...expense(1n), type: 'income' }, markUsed: false })),
    ).rejects.toMatchObject({ code: 'INVALID_GOAL' });
    // An expense from an account the goal does not hold leaves its sources alone.
    expect(
      (await asApp(() => repo.spend(alice.userId, other.id, { draft: expense(1n), markUsed: false }))).goal.sources,
    ).toEqual([]);
  });
});

describe('goals: completion and the remainder', () => {
  it('moves the remainder of a used goal to another goal or releases it', async () => {
    const stnk = await asApp(() =>
      repo.create(
        alice.userId,
        input({
          name: 'STNK',
          tag: null,
          sources: [
            { accountId: alice.jago, mode: 'fixed', amountMinor: 38_000n },
            { accountId: alice.bca, mode: 'fixed', amountMinor: 10_000n },
          ],
        }),
      ),
    );
    const motor = await asApp(() =>
      repo.create(
        alice.userId,
        input({ name: 'Motor', tag: null, sources: [{ accountId: alice.jago, mode: 'fixed', amountMinor: 720_000n }] }),
      ),
    );
    await expect(asApp(() => repo.moveRemainder(alice.userId, stnk.id, { toGoalId: motor.id }))).rejects.toMatchObject({
      code: 'INVALID_GOAL',
    });
    await asApp(() => repo.complete(alice.userId, stnk.id, { stopPlans: false }));
    await expect(asApp(() => repo.moveRemainder(alice.userId, stnk.id, { toGoalId: stnk.id }))).rejects.toMatchObject({
      code: 'INVALID_GOAL',
    });
    const [from, to] = await asApp(() => repo.moveRemainder(alice.userId, stnk.id, { toGoalId: motor.id }));
    expect(from).toMatchObject({ id: stnk.id, sources: [] });
    expect(to?.sources.map((source) => [source.accountId, source.amountMinor])).toEqual([
      [alice.jago, 758_000n],
      [alice.bca, 10_000n],
    ]);

    await asApp(() => repo.complete(alice.userId, motor.id, { stopPlans: false }));
    const [released] = await asApp(() => repo.moveRemainder(alice.userId, motor.id, { toGoalId: null }));
    expect(released).toMatchObject({ sources: [], savedMinor: 0n });
    const usd = await asApp(() => repo.create(alice.userId, input({ name: 'USD', tag: null, currency: 'USD' })));
    await expect(asApp(() => repo.moveRemainder(alice.userId, motor.id, { toGoalId: usd.id }))).rejects.toMatchObject({
      code: 'INVALID_GOAL',
    });
  });

  it('marks complete with the plans stopped, and undoes it', async () => {
    const goal = await asApp(() => repo.create(alice.userId, input({ accountId: alice.jago })));
    const withPlan = await asApp(() =>
      repo.addPlan(alice.userId, goal.id, {
        amountMinor: 43_000n,
        monthDay: 25,
        fromAccountId: alice.bca,
        startOn: '2026-10-25' as LocalDate,
      }),
    );
    const [plan] = withPlan.plans;
    const { goal: done, stoppedPlanIds } = await asApp(() => repo.complete(alice.userId, goal.id, { stopPlans: true }));
    expect(stoppedPlanIds).toEqual([plan?.id]);
    expect(done).toMatchObject({ status: 'completed', completedAt: NOW, monthlyPlanMinor: 0n });
    expect(done.plans[0]).toMatchObject({ active: false, recurrenceStatus: 'stopped' });
    await expect(asApp(() => repo.complete(alice.userId, goal.id, { stopPlans: true }))).rejects.toMatchObject({
      code: 'INVALID_GOAL',
    });
    const other = await asApp(() => repo.create(alice.userId, input({ name: 'Other', tag: null })));
    await expect(
      asApp(() => repo.reopen(alice.userId, other.id, { resumePlanIds: [plan?.id as string] })),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const reopened = await asApp(() => repo.reopen(alice.userId, goal.id, { resumePlanIds: [plan?.id as string] }));
    expect(reopened).toMatchObject({ status: 'active', completedAt: null, monthlyPlanMinor: 43_000n });
    expect(reopened.plans[0]).toMatchObject({ active: true, recurrenceStatus: 'active' });
    expect((await asApp(() => repo.reopen(alice.userId, other.id))).status).toBe('active');
    expect((await asApp(() => repo.complete(alice.userId, other.id, { stopPlans: true }))).stoppedPlanIds).toEqual([]);
  });
});

describe('goals: recurring contributions (plans on recurring transfers)', () => {
  const schedules = () => createSchedules(test.db, { now: () => NOW });
  const sentOf = async (recurrenceId: string) => {
    const recurrence = (await asApp(() => schedules().listRecurrences(alice.userId))).find(
      (row) => row.id === recurrenceId,
    );
    return [recurrence?.status, recurrence?.template.type === 'transfer' ? recurrence.template.sentMinor : null];
  };
  const occurrences = (recurrenceId: string) =>
    test.query<{ due: string; expected: string }>(
      `SELECT due_date::text AS due, expected_minor::text AS expected FROM scheduled_occurrences
       WHERE source_id = $1 ORDER BY due_date LIMIT 1`,
      [recurrenceId],
    );

  it('creates a monthly transfer for a goal and shares an existing one ("Sisihkan dana tidak rutin")', async () => {
    const liburan = await asApp(() =>
      repo.create(alice.userId, input({ name: 'Liburan', tag: 'liburan-bali', accountId: alice.jago })),
    );
    const servis = await asApp(() => repo.create(alice.userId, input({ name: 'Servis', tag: null })));
    const planned = await asApp(() =>
      repo.addPlan(alice.userId, liburan.id, {
        amountMinor: 867_000n,
        monthDay: 25,
        fromAccountId: alice.bca,
        startOn: '2026-10-25' as LocalDate,
        remindOffsetDays: null,
      }),
    );
    const [plan] = planned.plans;
    expect(plan).toMatchObject({
      amountMinor: 867_000n,
      active: true,
      monthDay: 25,
      fromAccountId: alice.bca,
      toAccountId: alice.jago,
      recurrenceStatus: 'active',
    });
    expect(planned.monthlyPlanMinor).toBe(867_000n);
    const recurrenceId = plan?.recurrenceId as string;
    const [recurrence] = await asApp(() => schedules().listRecurrences(alice.userId));
    expect(recurrence).toMatchObject({
      remindOffsetDays: null,
      template: { description: 'Liburan', tags: ['liburan-bali'] },
    });
    expect(await occurrences(recurrenceId)).toEqual([{ due: '2026-10-25', expected: '867000' }]);

    // The transfer is fully planned: sharing it needs room, so first make the transfer bigger.
    await expect(
      asApp(() => repo.addPlan(alice.userId, servis.id, { recurrenceId, amountMinor: 240_000n })),
    ).rejects.toMatchObject({ code: 'INVALID_GOAL' });
    await test.query(
      `UPDATE recurrences SET template = jsonb_set(jsonb_set(template, '{sentMinor}', '"1107000"'), '{receivedMinor}', '"1107000"') WHERE id = $1`,
      [recurrenceId],
    );
    const shared = await asApp(() => repo.addPlan(alice.userId, servis.id, { recurrenceId, amountMinor: 240_000n }));
    expect(shared.plans).toMatchObject([{ recurrenceId, amountMinor: 240_000n, toAccountId: alice.jago }]);
    await expect(
      asApp(() => repo.addPlan(alice.userId, servis.id, { recurrenceId, amountMinor: 1n })),
    ).rejects.toMatchObject({ code: 'INVALID_GOAL' });

    // Pausing one share lowers the transfer; pausing all stops it; one back resumes it.
    await asApp(() => repo.setPlanActive(alice.userId, shared.plans[0]?.id as string, false));
    expect(await sentOf(recurrenceId)).toEqual(['active', 867_000n]);
    expect(await occurrences(recurrenceId)).toEqual([{ due: '2026-10-25', expected: '867000' }]);
    expect((await asApp(() => repo.setPlanActive(alice.userId, plan?.id as string, false))).plans[0]).toMatchObject({
      active: false,
      recurrenceStatus: 'stopped',
    });
    expect(await occurrences(recurrenceId)).toEqual([]);
    await asApp(() => repo.setPlanActive(alice.userId, shared.plans[0]?.id as string, true));
    expect(await sentOf(recurrenceId)).toEqual(['active', 240_000n]);
    expect(await occurrences(recurrenceId)).toEqual([{ due: '2026-10-25', expected: '240000' }]);
    // Setting the same state again changes nothing.
    await asApp(() => repo.setPlanActive(alice.userId, shared.plans[0]?.id as string, true));
    expect(await sentOf(recurrenceId)).toEqual(['active', 240_000n]);

    // A new amount moves the transfer along; a paused plan's amount does not.
    await asApp(() => repo.updatePlan(alice.userId, shared.plans[0]?.id as string, { amountMinor: 300_000n }));
    expect(await sentOf(recurrenceId)).toEqual(['active', 300_000n]);
    await asApp(() => repo.updatePlan(alice.userId, plan?.id as string, { amountMinor: 900_000n }));
    expect(await sentOf(recurrenceId)).toEqual(['active', 300_000n]);
    await expect(
      asApp(() => repo.updatePlan(alice.userId, plan?.id as string, { amountMinor: 0n })),
    ).rejects.toMatchObject({ code: 'INVALID_GOAL' });
    await expect(asApp(() => repo.setPlanActive(bob, plan?.id as string, true))).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('keeps a partly planned transfer as it is and holds the shares within it', async () => {
    const goal = await asApp(() => repo.create(alice.userId, input({ tag: null })));
    const { id: recurrenceId } = await asApp(() =>
      schedules().createRecurrence(alice.userId, {
        template: {
          type: 'transfer',
          fromAccountId: alice.bca,
          toAccountId: alice.jago,
          sentMinor: 1_000_000n,
          receivedMinor: 1_000_000n,
        },
        freq: 'monthly',
        startOn: '2026-11-01' as LocalDate,
        monthDay: 1,
        end: { type: 'never' },
        remindOffsetDays: null,
      }),
    );
    const { plans } = await asApp(() => repo.addPlan(alice.userId, goal.id, { recurrenceId, amountMinor: 400_000n }));
    const planId = plans[0]?.id as string;
    await asApp(() => repo.updatePlan(alice.userId, planId, { amountMinor: 600_000n }));
    expect(await sentOf(recurrenceId)).toEqual(['active', 1_000_000n]);
    await expect(asApp(() => repo.updatePlan(alice.userId, planId, { amountMinor: 1_000_001n }))).rejects.toMatchObject(
      { code: 'INVALID_GOAL' },
    );
    await asApp(() => repo.setPlanActive(alice.userId, planId, false));
    expect(await sentOf(recurrenceId)).toEqual(['stopped', 1_000_000n]);
  });

  it('refuses contributions that are not a positive share of a transfer', async () => {
    const goal = await asApp(() => repo.create(alice.userId, input({ tag: null })));
    const { id: expenseRecurrence } = await asApp(() =>
      schedules().createRecurrence(alice.userId, {
        template: { type: 'expense', accountId: alice.bca, amountMinor: 1n, categoryId: null },
        freq: 'monthly',
        startOn: '2026-11-01' as LocalDate,
        monthDay: 1,
        end: { type: 'never' },
        remindOffsetDays: null,
      }),
    );
    await expect(
      asApp(() => repo.addPlan(alice.userId, goal.id, { recurrenceId: expenseRecurrence, amountMinor: 1n })),
    ).rejects.toMatchObject({ code: 'INVALID_GOAL' });
    await expect(
      asApp(() => repo.addPlan(alice.userId, goal.id, { recurrenceId: expenseRecurrence, amountMinor: 0n })),
    ).rejects.toMatchObject({ code: 'INVALID_GOAL' });
    // Without an account to send to.
    await expect(
      asApp(() =>
        repo.addPlan(alice.userId, goal.id, {
          amountMinor: 1n,
          monthDay: 1,
          fromAccountId: alice.bca,
          startOn: '2026-11-01' as LocalDate,
        }),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_GOAL' });
    await expect(asApp(() => repo.updatePlan(alice.userId, randomUUID(), { amountMinor: 1n }))).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('runs each plan in its months: a Nov–Apr fund joining the set-aside is not in October’s', async () => {
    const liburan = await asApp(() =>
      repo.create(alice.userId, input({ name: 'Liburan', kind: 'sinking', tag: null, accountId: alice.jago })),
    );
    const asuransi = await asApp(() =>
      repo.create(alice.userId, input({ name: 'Asuransi', kind: 'sinking', tag: null })),
    );
    const planned = await asApp(() =>
      repo.addPlan(alice.userId, liburan.id, {
        amountMinor: 867_000n,
        monthDay: 25,
        fromAccountId: alice.bca,
        startOn: '2026-10-25' as LocalDate,
        endMonth: '2027-03' as YearMonth,
      }),
    );
    expect(planned.plans[0]).toMatchObject({ startMonth: '2026-10', endMonth: '2027-03' });
    const recurrenceId = planned.plans[0]?.recurrenceId as string;
    await test.query(
      `UPDATE recurrences SET template = jsonb_set(jsonb_set(template, '{sentMinor}', '"1117000"'), '{receivedMinor}', '"1117000"') WHERE id = $1`,
      [recurrenceId],
    );
    const joined = await asApp(() =>
      repo.addPlan(alice.userId, asuransi.id, {
        recurrenceId,
        amountMinor: 250_000n,
        startMonth: '2026-11' as YearMonth,
        endMonth: '2027-04' as YearMonth,
      }),
    );
    expect(joined.plans[0]).toMatchObject({ startMonth: '2026-11', endMonth: '2027-04', toAccountId: alice.jago });
    // Fully planned now: October sends Liburan's share only, then both (the join rebuilt the coming occurrences).
    expect(
      await test.query(
        `SELECT due_date::text AS due, expected_minor::text AS expected FROM scheduled_occurrences
         WHERE source_id = $1 ORDER BY due_date`,
        [recurrenceId],
      ),
    ).toEqual([
      { due: '2026-10-25', expected: '867000' },
      { due: '2026-11-25', expected: '1117000' },
      { due: '2026-12-25', expected: '1117000' },
    ]);

    // Joining without months runs from this month on; months must be YYYY-MM and not end before they start.
    const other = await asApp(() => repo.create(alice.userId, input({ name: 'Other', tag: null })));
    for (const months of [
      { startMonth: '2026-11' as YearMonth, endMonth: '2026-10' as YearMonth },
      { startMonth: '2026-13' as YearMonth },
    ]) {
      await expect(
        asApp(() => repo.addPlan(alice.userId, other.id, { recurrenceId, amountMinor: 1n, ...months })),
      ).rejects.toMatchObject({ code: 'INVALID_GOAL' });
    }
    await test.query(
      `UPDATE recurrences SET template = jsonb_set(jsonb_set(template, '{sentMinor}', '"2000000"'), '{receivedMinor}', '"2000000"'),
         status = 'stopped', stopped_at = now() WHERE id = $1`,
      [recurrenceId],
    );
    // A stopped transfer keeps no occurrences to rebuild.
    const later = await asApp(() => repo.addPlan(alice.userId, other.id, { recurrenceId, amountMinor: 1n }));
    expect(later.plans[0]).toMatchObject({ startMonth: '2026-10', endMonth: null, recurrenceStatus: 'stopped' });
  });

  it('keeps other goals out of an account a goal holds wholly', async () => {
    const darurat = await asApp(() =>
      repo.create(alice.userId, input({ accountId: alice.jago, sources: [{ accountId: alice.jago, mode: 'whole' }] })),
    );
    const servis = await asApp(() =>
      repo.create(alice.userId, input({ name: 'Servis', tag: null, accountId: alice.jago })),
    );
    const own = await asApp(() =>
      repo.addPlan(alice.userId, darurat.id, {
        amountMinor: 500_000n,
        monthDay: 1,
        fromAccountId: alice.bca,
        startOn: '2026-11-01' as LocalDate,
      }),
    );
    const recurrenceId = own.plans[0]?.recurrenceId as string;
    await test.query(
      `UPDATE recurrences SET template = jsonb_set(jsonb_set(template, '{sentMinor}', '"900000"'), '{receivedMinor}', '"900000"') WHERE id = $1`,
      [recurrenceId],
    );
    await expect(
      asApp(() => repo.addPlan(alice.userId, servis.id, { recurrenceId, amountMinor: 100_000n })),
    ).rejects.toMatchObject({ code: 'INVALID_GOAL' });
    await expect(
      asApp(() =>
        repo.addPlan(alice.userId, servis.id, {
          amountMinor: 100_000n,
          monthDay: 25,
          fromAccountId: alice.bca,
          startOn: '2026-10-25' as LocalDate,
        }),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_GOAL' });
    // A deposit there would count for the holder: refused too.
    await expect(
      asApp(() =>
        repo.deposit(alice.userId, servis.id, {
          clientId: randomUUID(),
          occurredAt: at('2026-10-15'),
          fromAccountId: alice.bca,
          amountMinor: 1n,
        }),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_GOAL' });
  });

  it('credits money that reached an account for a goal: fixed amounts grow or are made, never whole or foreign', async () => {
    const goal = await asApp(() =>
      repo.create(
        alice.userId,
        input({ tag: null, sources: [{ accountId: alice.bca, mode: 'fixed', amountMinor: 100_000n }] }),
      ),
    );
    const mandiri = await account(alice.userId);
    const usd = await account(alice.userId, { currency: 'USD' });
    const holder = await asApp(() =>
      repo.create(alice.userId, input({ name: 'Holder', tag: null, sources: [{ accountId: mandiri, mode: 'whole' }] })),
    );
    const credit = (goalId: string, accountId: string, amountMinor: bigint) =>
      asApp(() =>
        withUser(test.db, alice.userId, (tx) => creditGoalIn(tx, alice.userId, goalId, accountId, amountMinor, NOW)),
      );
    await credit(goal.id, alice.bca, 50_000n);
    await credit(goal.id, alice.jago, 20_000n);
    await credit(goal.id, alice.jago, 0n);
    await credit(goal.id, mandiri, 10_000n);
    await credit(holder.id, mandiri, 10_000n);
    await credit(goal.id, usd, 10_000n);
    expect((await asApp(() => repo.get(alice.userId, goal.id))).sources).toMatchObject([
      { accountId: alice.bca, mode: 'fixed', amountMinor: 150_000n, sortOrder: 0 },
      { accountId: alice.jago, mode: 'fixed', amountMinor: 20_000n, sortOrder: 1 },
    ]);
    expect((await asApp(() => repo.get(alice.userId, holder.id))).sources).toMatchObject([
      { accountId: mandiri, mode: 'whole', amountMinor: null },
    ]);
  });

  it('removes a goal: its transactions stay unlinked, a transfer left without plans stops', async () => {
    // A fixed amount of Bank Jago, so another goal can be planned into it too.
    const goal = await asApp(() =>
      repo.create(
        alice.userId,
        input({ accountId: alice.jago, sources: [{ accountId: alice.jago, mode: 'fixed', amountMinor: 100_000n }] }),
      ),
    );
    const other = await asApp(() =>
      repo.create(alice.userId, input({ name: 'Other', tag: null, accountId: alice.jago })),
    );
    const own = await asApp(() =>
      repo.addPlan(alice.userId, goal.id, {
        amountMinor: 500_000n,
        monthDay: 1,
        fromAccountId: alice.bca,
        startOn: '2026-11-01' as LocalDate,
      }),
    );
    const ownRecurrence = own.plans[0]?.recurrenceId as string;
    const shared = await asApp(() =>
      repo.addPlan(alice.userId, other.id, {
        amountMinor: 300_000n,
        monthDay: 25,
        fromAccountId: alice.bca,
        startOn: '2026-10-25' as LocalDate,
      }),
    );
    const sharedRecurrence = shared.plans[0]?.recurrenceId as string;
    await test.query(
      `UPDATE recurrences SET template = jsonb_set(jsonb_set(template, '{sentMinor}', '"500000"'), '{receivedMinor}', '"500000"') WHERE id = $1`,
      [sharedRecurrence],
    );
    await test.query(`UPDATE goal_contribution_plans SET amount_minor = 200000 WHERE recurrence_id = $1`, [
      sharedRecurrence,
    ]);
    await asApp(() => repo.addPlan(alice.userId, goal.id, { recurrenceId: sharedRecurrence, amountMinor: 300_000n }));
    await asApp(() =>
      repo.deposit(alice.userId, goal.id, {
        clientId: randomUUID(),
        occurredAt: at('2026-10-15'),
        fromAccountId: alice.bca,
        amountMinor: 1n,
      }),
    );
    await asApp(() =>
      repo.spend(alice.userId, goal.id, {
        draft: {
          type: 'expense',
          clientId: randomUUID(),
          occurredAt: at('2026-10-15'),
          accountId: alice.jago,
          amountMinor: 1n,
          categoryId: null,
        },
        markUsed: false,
      }),
    );
    await asApp(() => repo.remove(alice.userId, goal.id));
    expect(
      await test.query(
        'SELECT count(*)::int AS n FROM transactions WHERE goal_id IS NOT NULL OR paid_from_goal_id IS NOT NULL',
      ),
    ).toEqual([{ n: 0 }]);
    expect(await test.query('SELECT count(*)::int AS n FROM transactions')).toEqual([{ n: 2 }]);
    expect(await sentOf(ownRecurrence)).toEqual(['stopped', 500_000n]);
    expect(await sentOf(sharedRecurrence)).toEqual(['active', 200_000n]);
    expect((await asApp(() => repo.list(alice.userId))).map((row) => row.name)).toEqual(['Other']);
    await expect(asApp(() => repo.remove(alice.userId, goal.id))).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('goals: investment assets as sources (FR-G2)', () => {
  /** An asset on a fresh investment platform in `currency`, holding `units` bought for `amountMinor`. */
  async function asset(currency: string, symbol: string, price: string, units: string, amountMinor: bigint) {
    const [platform] = await test.query<{ id: string }>(
      `INSERT INTO accounts (user_id, type, provider_name, display_name, currency, opening_date, color, include_in_available)
       VALUES ($1, 'investment', $2, $3, $4, '2026-01-01', 'cyan', false) RETURNING id`,
      [alice.userId, symbol, symbol, currency],
    );
    const investments = createInvestments(test.db, options);
    const created = await asApp(() =>
      investments.createAsset(alice.userId, {
        accountId: platform?.id as string,
        symbol,
        name: symbol,
        assetClass: 'us_stocks',
        market: 'us_equity',
        manualPrice: price,
        manualPriceAt: NOW,
      }),
    );
    await asApp(() =>
      investments.adjustHoldings(alice.userId, {
        clientId: randomUUID(),
        assetId: created.id,
        occurredAt: at('2026-08-31'),
        units,
        reason: 'unrecorded_buy',
        amountMinor,
        fxRate: '1',
      }),
    );
    return created.id;
  }

  it('counts each goal’s share of the asset value (SPY 60/40 → 8.100.000 / 5.400.000) and refuses over 100%', async () => {
    await test.query(
      `INSERT INTO fx_rates (user_id, base, quote, rate, provider, rate_type, as_of) VALUES ($1, 'USD', 'IDR', 16350, 'manual', 'manual', '2026-10-15')`,
      [alice.userId],
    );
    const spy = await asset('USD', 'SPY', '690.10', '1.196475979415', 69_725n);
    const dp = await asApp(() =>
      repo.create(
        alice.userId,
        input({
          name: 'DP Rumah',
          targetMode: 'fixed',
          targetMonths: null,
          assetSources: [{ assetId: spy, mode: 'percent', pctBps: 6000 }],
        }),
      ),
    );
    const pensiun = await asApp(() =>
      repo.create(alice.userId, input({ name: 'Dana Pensiun', targetMode: 'fixed', targetMonths: null })),
    );
    const view = await asApp(() =>
      repo.setAssetSources(alice.userId, pensiun.id, [{ assetId: spy, mode: 'percent', pctBps: 4000 }]),
    );
    expect(view.assetSources).toEqual([
      expect.objectContaining({ assetId: spy, symbol: 'SPY', mode: 'percent', bps: 4000, valueMinor: 5_400_000n }),
    ]);
    expect(view.savedMinor).toBe(5_400_000n);
    expect((await asApp(() => repo.get(alice.userId, dp.id))).assetSources[0]?.valueMinor).toBe(8_100_000n);
    const refuse = (sources: Parameters<GoalsRepository['setAssetSources']>[2], goalId = pensiun.id) =>
      expect(asApp(() => repo.setAssetSources(alice.userId, goalId, sources))).rejects.toMatchObject({
        code: 'INVALID_GOAL',
      });
    await refuse([{ assetId: spy, mode: 'percent', pctBps: 4001 }]);
    await refuse([{ assetId: spy, mode: 'whole' }]);
    await refuse([{ assetId: spy, mode: 'whole', pctBps: 10 }]);
    await refuse([{ assetId: spy, mode: 'percent', pctBps: 0 }]);
    await refuse([
      { assetId: spy, mode: 'percent', pctBps: 1 },
      { assetId: spy, mode: 'percent', pctBps: 1 },
    ]);
    await refuse([{ assetId: randomUUID(), mode: 'whole' }]);
    const usd = await asApp(() =>
      repo.create(alice.userId, input({ name: 'USD', currency: 'USD', targetMode: 'fixed', targetMonths: null })),
    );
    await refuse([{ assetId: spy, mode: 'percent', pctBps: 1 }], usd.id);
    // Editing the account sources leaves the asset sources alone.
    await asApp(() =>
      repo.setSources(alice.userId, pensiun.id, [{ accountId: alice.bca, mode: 'fixed', amountMinor: 1_000n }]),
    );
    expect((await asApp(() => repo.get(alice.userId, pensiun.id))).savedMinor).toBe(5_401_000n);
  });

  it('hands asset sources on with the remainder: moved, merged as a percentage, or merged into the whole asset', async () => {
    const idx = await asset('IDR', 'IDX30', '1250', '800', 978_000n);
    const ori = await asset('IDR', 'ORI', '1', '1500000', 1_482_000n);
    const bbca = await asset('IDR', 'BBCA', '8000', '300', 2_305_000n);
    // No rate to IDR: the asset counts nothing yet.
    const vwce = await asset('EUR', 'VWCE', '130', '1', 13_000n);
    const make = async (name: string, sources: Parameters<GoalsRepository['setAssetSources']>[2]) =>
      asApp(() =>
        repo.create(alice.userId, input({ name, targetMode: 'fixed', targetMonths: null, assetSources: sources })),
      );
    const done = await make('Selesai', [
      { assetId: idx, mode: 'percent', pctBps: 3000 },
      { assetId: ori, mode: 'percent', pctBps: 5000 },
      { assetId: bbca, mode: 'whole' },
    ]);
    const target = await make('Tujuan', [
      { assetId: idx, mode: 'percent', pctBps: 2000 },
      { assetId: ori, mode: 'percent', pctBps: 5000 },
      { assetId: vwce, mode: 'whole' },
    ]);
    expect((await asApp(() => repo.get(alice.userId, target.id))).assetSources.map((row) => row.valueMinor)).toEqual([
      200_000n,
      750_000n,
      0n,
    ]);
    await expect(
      asApp(() => repo.setAssetSources(alice.userId, target.id, [{ assetId: bbca, mode: 'percent', pctBps: 1 }])),
    ).rejects.toMatchObject({ code: 'INVALID_GOAL' });
    await asApp(() => repo.complete(alice.userId, done.id, { stopPlans: false }));
    await asApp(() => repo.moveRemainder(alice.userId, done.id, { toGoalId: target.id }));
    const moved = await asApp(() => repo.get(alice.userId, target.id));
    expect(moved.assetSources.map((row) => [row.symbol, row.mode, row.bps]).sort()).toEqual([
      ['BBCA', 'whole', 10_000],
      ['IDX30', 'percent', 5000],
      ['ORI', 'whole', 10_000],
      ['VWCE', 'whole', 10_000],
    ]);
    expect((await asApp(() => repo.get(alice.userId, done.id))).assetSources).toEqual([]);
  });

  it('sets every goal’s share of one asset at once (60/40 → 40/60 in one step), keeping each goal’s source order', async () => {
    const spy = await asset('IDR', 'SPY', '1000', '10', 9_000n);
    const qqq = await asset('IDR', 'QQQ', '1000', '10', 9_000n);
    const make = (name: string, sources: Parameters<GoalsRepository['setAssetSources']>[2] = []) =>
      asApp(() =>
        repo.create(alice.userId, input({ name, targetMode: 'fixed', targetMonths: null, assetSources: sources })),
      );
    const dp = await make('DP Rumah', [
      { assetId: qqq, mode: 'percent', pctBps: 1000 },
      { assetId: spy, mode: 'percent', pctBps: 6000 },
    ]);
    const pensiun = await make('Dana Pensiun', [{ assetId: spy, mode: 'percent', pctBps: 4000 }]);
    const liburan = await make('Liburan');
    const sourcesOf = async (goalId: string) =>
      (
        await test.query<{ symbol: string; mode: string; pct_bps: number | null; sort_order: number }>(
          `SELECT a.symbol, s.mode, s.pct_bps, s.sort_order FROM goal_funding_sources s
             JOIN assets a ON a.id = s.asset_id WHERE s.goal_id = $1 ORDER BY s.sort_order`,
          [goalId],
        )
      ).map((row) => [row.symbol, row.mode, row.pct_bps, row.sort_order]);
    await asApp(() =>
      repo.setAssetAllocations(alice.userId, spy, [
        { goalId: dp.id, mode: 'percent', pctBps: 4000 },
        { goalId: pensiun.id, mode: 'percent', pctBps: 6000 },
      ]),
    );
    expect(await sourcesOf(dp.id)).toEqual([
      ['QQQ', 'percent', 1000, 0],
      ['SPY', 'percent', 4000, 1],
    ]);
    expect(await sourcesOf(pensiun.id)).toEqual([['SPY', 'percent', 6000, 0]]);
    expect((await asApp(() => repo.get(alice.userId, pensiun.id))).assetSources[0]).toMatchObject({ bps: 6000 });
    // A goal new to the asset goes after its other asset sources; a goal left out loses its share.
    await asApp(() => repo.setAssetAllocations(alice.userId, qqq, [{ goalId: liburan.id, mode: 'whole' }]));
    await asApp(() =>
      repo.setAssetAllocations(alice.userId, spy, [
        { goalId: liburan.id, mode: 'percent', pctBps: 2500 },
        { goalId: dp.id, mode: 'percent', pctBps: 7500 },
      ]),
    );
    expect(await sourcesOf(liburan.id)).toEqual([
      ['QQQ', 'whole', null, 0],
      ['SPY', 'percent', 2500, 1],
    ]);
    expect(await sourcesOf(dp.id)).toEqual([['SPY', 'percent', 7500, 1]]);
    expect(await sourcesOf(pensiun.id)).toEqual([]);
    const refuse = (sources: Parameters<GoalsRepository['setAssetAllocations']>[2], code = 'INVALID_GOAL') =>
      expect(asApp(() => repo.setAssetAllocations(alice.userId, spy, sources))).rejects.toMatchObject({ code });
    await refuse([
      { goalId: dp.id, mode: 'percent', pctBps: 6000 },
      { goalId: pensiun.id, mode: 'percent', pctBps: 4001 },
    ]);
    await refuse([
      { goalId: dp.id, mode: 'percent', pctBps: 10 },
      { goalId: dp.id, mode: 'percent', pctBps: 10 },
    ]);
    await refuse([{ goalId: dp.id, mode: 'whole', pctBps: 10 }]);
    await refuse([{ goalId: dp.id, mode: 'percent' }]);
    await refuse([{ goalId: randomUUID(), mode: 'whole' }]);
    const usd = await asApp(() =>
      repo.create(alice.userId, input({ name: 'USD', currency: 'USD', targetMode: 'fixed', targetMonths: null })),
    );
    await refuse([{ goalId: usd.id, mode: 'whole' }]);
    await expect(asApp(() => repo.setAssetAllocations(alice.userId, randomUUID(), []))).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(await sourcesOf(dp.id)).toEqual([['SPY', 'percent', 7500, 1]]);
    // Nothing listed: the asset funds no goal.
    await asApp(() => repo.setAssetAllocations(alice.userId, spy, []));
    expect([await sourcesOf(dp.id), await sourcesOf(liburan.id)]).toEqual([[], [['QQQ', 'whole', null, 0]]]);
  });
});
