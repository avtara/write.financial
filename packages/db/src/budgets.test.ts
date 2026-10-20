// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from 'node:crypto';
import type { YearMonth } from '@wf/domain/period';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { fixtureGetDek, ledgerFixture, type LedgerFixture } from '../test/ledger-fixture.ts';
import { PGLITE_HOOK_TIMEOUT, startMigrated, type TestDatabase } from '../test/pglite.ts';
import { createBudgets, type BudgetLineView, type BudgetsRepository } from './budgets.ts';
import { createCategories } from './categories.ts';
import { createPeriods } from './periods.ts';

let test: TestDatabase;
let ledger: LedgerFixture;
let userId: string;
let food: string;
let rent: string;
let shopping: string;

const asApp = <T>(fn: () => Promise<T>) => test.as('wf_app', fn);
const clock = (date: string) => () => new Date(`${date}T05:00:00Z`);
/** The repositories at 12.00 WIB on `date`. */
const budgetsAt = (date: string) => createBudgets(test.db, { now: clock(date) });
const periodsAt = (date: string) => createPeriods(test.db, { now: clock(date) });
let budgets: BudgetsRepository;
const ym = (value: string) => value as YearMonth;

/** The id of the period row containing `date` (materialized up to it). */
async function periodOn(date: string, user = userId): Promise<string> {
  return (await asApp(() => periodsAt(date).list(user))).current.id as string;
}

const lineOf = (lines: readonly BudgetLineView[], categoryId: string) =>
  lines.find((line) => line.categoryId === categoryId);

beforeAll(async () => {
  test = await startMigrated();
  budgets = budgetsAt('2026-10-15');
}, PGLITE_HOOK_TIMEOUT);

afterAll(async () => {
  await test.close();
});

beforeEach(async () => {
  await test.query('DELETE FROM users');
  ledger = await ledgerFixture(test, 'avtara@example.test');
  userId = ledger.userId;
  food = ledger.category('system:food');
  rent = ledger.category('system:rent');
  shopping = ledger.category('system:shopping');
});

describe('status', () => {
  it('without a budget: no lines, all spending unbudgeted', async () => {
    await ledger.entry('expense', '2026-10-05', 100_000n, food);
    await ledger.entry('expense', '2026-10-06', 50_000n, null);
    await ledger.entry('income', '2026-10-01', 10_000_000n, ledger.category('system:salary'));
    const status = await asApp(() => budgets.status(userId));
    expect(status).toMatchObject({
      period: { label: '2026-10', start: '2026-10-01', end: '2026-10-31' },
      today: '2026-10-15',
      readOnly: false,
      baseCurrency: 'IDR',
      version: null,
      lines: [],
      groups: [],
      totals: { limitMinor: 0n, spentMinor: 0n, unbudgetedSpentMinor: 150_000n },
      attention: [],
      dismissedCount: 0,
      nextTransition: null,
    });

    // A transition next period without a budget prorates nothing.
    await asApp(() => periodsAt('2026-10-15').changeStartDay(userId, { day: 25, apply: 'next_period' }));
    expect((await asApp(() => budgets.status(userId))).nextTransition).toEqual({
      period: { kind: 'transition', label: '2026-11', start: '2026-11-01', end: '2026-11-24', days: 24 },
      limitMinor: 0n,
      proratedMinor: 0n,
    });
  });

  it('lines with states, overrides, dismissals, groups, and attention', async () => {
    const kopi = (
      await asApp(() =>
        createCategories(test.db, { getDek: fixtureGetDek }).create(userId, {
          kind: 'expense',
          group: 'wants',
          name: 'Kopi',
          icon: 'coffee',
          color: 'brown',
        }),
      )
    ).id;
    const bankFee = ledger.category('system:bank_fee');
    await asApp(() =>
      budgets.saveVersion(userId, {
        effectiveFrom: ym('2026-10'),
        expectedIncomeMinor: 20_000_000n,
        lines: [
          { categoryId: rent, limitMinor: 2_000_000n },
          { categoryId: food, limitMinor: 1_000_000n, alertPct: 80 },
          { categoryId: shopping, limitMinor: 500_000n },
          { categoryId: kopi, limitMinor: 300_000n },
          { categoryId: bankFee, limitMinor: 7_000n },
        ],
      }),
    );
    await ledger.entry('expense', '2026-10-01', 2_000_000n, rent);
    await ledger.entry('expense', '2026-10-03', 850_000n, food);
    await ledger.entry('expense', '2026-10-04', 600_000n, shopping);
    await ledger.entry('expense', '2026-10-05', 70_000n, ledger.category('system:transport'));
    await ledger.transfer('2026-10-06', 1_000_000n, { minor: 6_500n, categoryId: bankFee });
    const october = await periodOn('2026-10-15');
    await asApp(() =>
      budgets.moveLeftover(userId, october, {
        targetCategoryId: shopping,
        sources: [{ categoryId: kopi, amountMinor: 50_000n }],
      }),
    );
    await asApp(() => budgets.dismissAlert(userId, october, food));
    // Twice is fine.
    await asApp(() => budgets.dismissAlert(userId, october, food));

    const status = await asApp(() => budgets.status(userId, { periodId: october }));
    expect(status.version).toEqual({
      id: expect.any(String) as string,
      effectiveFrom: '2026-10',
      expectedIncomeMinor: 20_000_000n,
    });
    expect(status.lines.map((line) => line.categoryId)).toEqual([rent, food, shopping, kopi, bankFee]);
    expect(lineOf(status.lines, rent)).toMatchObject({
      builtInKey: 'system:rent',
      group: 'needs',
      kind: 'expense',
      state: 'paid',
      isFixed: true,
      safeDailyMinor: null,
      count: 1,
      dismissed: false,
    });
    expect(lineOf(status.lines, food)).toMatchObject({ state: 'warning', alertPct: 80, dismissed: true });
    expect(lineOf(status.lines, shopping)).toMatchObject({
      state: 'over',
      baseLimitMinor: 500_000n,
      overridesMinor: 50_000n,
      limitMinor: 550_000n,
      spentMinor: 600_000n,
    });
    expect(lineOf(status.lines, kopi)).toMatchObject({
      builtInKey: null,
      name: 'Kopi',
      state: 'unused',
      limitMinor: 250_000n,
      overridesMinor: -50_000n,
      count: 0,
    });
    expect(lineOf(status.lines, bankFee)).toMatchObject({
      group: 'financial',
      kind: 'fee',
      state: 'warning',
      spentMinor: 6_500n,
      count: 1,
    });
    expect(status.groups).toEqual([
      { group: 'needs', limitMinor: 3_000_000n, spentMinor: 2_850_000n, usedBps: 9500, lineCount: 2, overCount: 0 },
      { group: 'wants', limitMinor: 800_000n, spentMinor: 600_000n, usedBps: 7500, lineCount: 2, overCount: 1 },
      { group: 'financial', limitMinor: 7_000n, spentMinor: 6_500n, usedBps: 9286, lineCount: 1, overCount: 0 },
    ]);
    expect(status.totals).toMatchObject({
      limitMinor: 3_807_000n,
      spentMinor: 3_456_500n,
      unbudgetedSpentMinor: 70_000n,
    });
    expect(status.attention).toEqual([
      { categoryId: shopping, reason: 'over' },
      { categoryId: bankFee, reason: 'warning' },
    ]);
    expect(status.dismissedCount).toBe(1);

    await asApp(() => budgets.restoreAlert(userId, october, food));
    expect(lineOf((await asApp(() => budgets.status(userId))).lines, food)?.dismissed).toBe(false);
  });

  it('prorates a transition period and announces the next one', async () => {
    await asApp(() =>
      budgets.saveVersion(userId, {
        effectiveFrom: ym('2026-10'),
        lines: [
          { categoryId: food, limitMinor: 1_000_000n },
          { categoryId: rent, limitMinor: 2_000_000n },
        ],
      }),
    );
    await asApp(() => periodsAt('2026-10-15').changeStartDay(userId, { day: 25, apply: 'next_period' }));
    const october = await asApp(() => budgets.status(userId));
    expect(october.nextTransition).toEqual({
      period: { kind: 'transition', label: '2026-11', start: '2026-11-01', end: '2026-11-24', days: 24 },
      limitMinor: 3_000_000n,
      proratedMinor: 2_400_000n,
    });

    const november = await asApp(() => budgetsAt('2026-11-10').status(userId));
    expect(november.period).toMatchObject({ kind: 'transition', start: '2026-11-01', end: '2026-11-24' });
    expect(lineOf(november.lines, food)).toMatchObject({ baseLimitMinor: 1_000_000n, limitMinor: 800_000n });
    expect(lineOf(november.lines, rent)).toMatchObject({ baseLimitMinor: 2_000_000n, limitMinor: 1_600_000n });
    expect(november.nextTransition).toBeNull();

    // An earlier period: the next one is a row (the transition).
    const again = await asApp(() => budgetsAt('2026-11-10').status(userId, { periodId: october.period.id as string }));
    expect(again.nextTransition?.period).toMatchObject({ kind: 'transition', start: '2026-11-01' });
  });

  it('refuses an unknown period and another user’s period', async () => {
    await expect(asApp(() => budgets.status(userId, { periodId: randomUUID() }))).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    const other = await ledgerFixture(test, 'other@example.test');
    const theirs = await periodOn('2026-10-15', other.userId);
    await expect(asApp(() => budgets.status(userId, { periodId: theirs }))).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('uses the current time by default', async () => {
    const status = await asApp(() => createBudgets(test.db).status(userId));
    expect(status.period.start <= status.today && status.today <= status.period.end).toBe(true);
  });
});

describe('history', () => {
  it('lists versions newest first with their changes against the version before', async () => {
    expect(await asApp(() => budgets.history(userId))).toEqual([]);
    const bills = ledger.category('system:bills');
    const first = await asApp(() =>
      budgets.saveVersion(userId, {
        effectiveFrom: ym('2026-10'),
        lines: [
          { categoryId: food, limitMinor: 1_000_000n },
          { categoryId: rent, limitMinor: 2_000_000n },
          { categoryId: bills, limitMinor: 500_000n },
        ],
      }),
    );
    const second = await asApp(() =>
      budgets.saveVersion(userId, {
        effectiveFrom: ym('2026-11'),
        lines: [
          { categoryId: food, limitMinor: 1_200_000n },
          { categoryId: bills, limitMinor: 500_000n },
          { categoryId: shopping, limitMinor: 300_000n },
        ],
      }),
    );
    const history = await asApp(() => budgets.history(userId));
    expect(history).toMatchObject([
      { versionId: second.id, effectiveFrom: '2026-11', totalMinor: 2_000_000n, lineCount: 3 },
      { versionId: first.id, effectiveFrom: '2026-10', totalMinor: 3_500_000n, lineCount: 3, changes: null },
    ]);
    const at = expect.any(Date) as Date;
    expect(history[0]?.changes).toHaveLength(3);
    expect(history[0]?.changes).toEqual(
      expect.arrayContaining([
        { categoryId: food, change: 'updated', fromMinor: 1_000_000n, toMinor: 1_200_000n, at },
        { categoryId: shopping, change: 'added', fromMinor: null, toMinor: 300_000n, at },
        { categoryId: rent, change: 'removed', fromMinor: 2_000_000n, toMinor: null, at },
      ]),
    );
  });
});

describe('saveVersion', () => {
  it('refuses invalid input', async () => {
    const save = (input: Parameters<typeof budgets.saveVersion>[1]) => asApp(() => budgets.saveVersion(userId, input));
    const october = ym('2026-10');
    for (const input of [
      { effectiveFrom: ym('2026-13'), lines: [] },
      { effectiveFrom: october, expectedIncomeMinor: -1n, lines: [] },
      {
        effectiveFrom: october,
        lines: [
          { categoryId: food, limitMinor: 1n },
          { categoryId: food, limitMinor: 2n },
        ],
      },
      { effectiveFrom: october, lines: [{ categoryId: food, limitMinor: -1n }] },
      { effectiveFrom: october, lines: [{ categoryId: food, limitMinor: 1n, alertPct: 70 as 80 }] },
    ]) {
      await expect(save(input)).rejects.toMatchObject({ code: 'INVALID_BUDGET' });
    }
    for (const categoryId of [ledger.category('system:salary'), randomUUID()]) {
      await expect(save({ effectiveFrom: october, lines: [{ categoryId, limitMinor: 1n }] })).rejects.toMatchObject({
        code: 'INVALID_CATEGORY',
      });
    }
    expect(await save({ effectiveFrom: october, expectedIncomeMinor: null, lines: [] })).toEqual({
      id: expect.any(String) as string,
      effectiveFrom: '2026-10',
      expectedIncomeMinor: null,
      totalMinor: 0n,
      lines: [],
    });
  });

  it('inserts, updates, and deletes lines; the expected income stays when not given', async () => {
    const first = await asApp(() =>
      budgets.saveVersion(userId, {
        effectiveFrom: ym('2026-10'),
        expectedIncomeMinor: 20_000_000n,
        lines: [
          { categoryId: food, limitMinor: 1_000_000n, rollover: true, isFixed: false, alertPct: 50 },
          { categoryId: rent, limitMinor: 2_000_000n },
        ],
      }),
    );
    expect(first).toMatchObject({ effectiveFrom: '2026-10', expectedIncomeMinor: 20_000_000n, totalMinor: 3_000_000n });
    expect(first.lines).toMatchObject([
      { categoryId: food, rollover: true, isFixed: false, alertPct: 50, sortOrder: 0 },
      // Fixed by default like its category.
      { categoryId: rent, rollover: false, isFixed: true, alertPct: 85, sortOrder: 1 },
    ]);

    const second = await asApp(() =>
      budgets.saveVersion(userId, {
        effectiveFrom: ym('2026-10'),
        lines: [
          { categoryId: food, limitMinor: 1_000_000n, rollover: true, isFixed: false, alertPct: 50 },
          { categoryId: shopping, limitMinor: 400_000n },
          { categoryId: rent, limitMinor: 2_100_000n },
        ],
      }),
    );
    expect(second.id).toBe(first.id);
    expect(second.expectedIncomeMinor).toBe(20_000_000n);
    expect(second.lines.map((line) => [line.categoryId, line.limitMinor])).toEqual([
      [food, 1_000_000n],
      [shopping, 400_000n],
      [rent, 2_100_000n],
    ]);
    // Unchanged lines are not rewritten.
    expect(second.lines[0]?.updatedAt).toEqual(first.lines[0]?.updatedAt);

    const third = await asApp(() =>
      budgets.saveVersion(userId, {
        effectiveFrom: ym('2026-10'),
        expectedIncomeMinor: null,
        lines: [{ categoryId: shopping, limitMinor: 400_000n }],
      }),
    );
    expect(third).toMatchObject({ expectedIncomeMinor: null, totalMinor: 400_000n });
    expect(third.lines.map((line) => line.categoryId)).toEqual([shopping]);

    // Onboarding step 2: only the expected income; the lines stay.
    const income = await asApp(() =>
      budgets.saveVersion(userId, { effectiveFrom: ym('2026-10'), expectedIncomeMinor: 25_800_000n }),
    );
    expect(income).toMatchObject({ id: first.id, expectedIncomeMinor: 25_800_000n, totalMinor: 400_000n });
    expect(income.lines.map((line) => line.categoryId)).toEqual([shopping]);
  });

  it('refuses a change that reaches a closed period; the next version bounds it', async () => {
    const september = await periodOn('2026-09-10');
    await asApp(() =>
      budgetsAt('2026-09-10').saveVersion(userId, {
        effectiveFrom: ym('2026-09'),
        expectedIncomeMinor: 5_000_000n,
        lines: [{ categoryId: food, limitMinor: 1_000_000n }],
      }),
    );
    await asApp(() => periodsAt('2026-10-15').lock(userId, september));
    await expect(
      asApp(() => budgets.saveVersion(userId, { effectiveFrom: ym('2026-09'), lines: [] })),
    ).rejects.toMatchObject({ code: 'PERIOD_CLOSED' });
    // August ends before September's version: allowed (and starts empty, nothing in force before it).
    expect(await asApp(() => budgets.saveVersion(userId, { effectiveFrom: ym('2026-08'), lines: [] }))).toMatchObject({
      effectiveFrom: '2026-08',
      expectedIncomeMinor: null,
      lines: [],
    });
    // October starts as a copy of September's version.
    const october = await asApp(() =>
      budgets.saveVersion(userId, {
        effectiveFrom: ym('2026-10'),
        lines: [
          { categoryId: food, limitMinor: 1_000_000n },
          { categoryId: rent, limitMinor: 2_000_000n },
        ],
      }),
    );
    expect(october).toMatchObject({
      effectiveFrom: '2026-10',
      expectedIncomeMinor: 5_000_000n,
      totalMinor: 3_000_000n,
    });
  });
});

describe('setLine', () => {
  it('creates the version of the period with the lines it adds and changes', async () => {
    const october = await periodOn('2026-10-15');
    const subscriptions = ledger.category('system:subscriptions');
    // The version in force (September) has no lines: the copy starts empty.
    await asApp(() => budgets.saveVersion(userId, { effectiveFrom: ym('2026-09'), lines: [] }));
    const created = await asApp(() => budgets.setLine(userId, october, { categoryId: food, limitMinor: 1_000_000n }));
    expect(created).toMatchObject({ effectiveFrom: '2026-10', expectedIncomeMinor: null, totalMinor: 1_000_000n });
    expect(created.lines).toMatchObject([
      { categoryId: food, limitMinor: 1_000_000n, rollover: false, isFixed: false, alertPct: 85, sortOrder: 0 },
    ]);

    await expect(asApp(() => budgets.setLine(userId, october, { categoryId: subscriptions }))).rejects.toMatchObject({
      code: 'INVALID_BUDGET',
      message: 'A new budget line needs a limit',
    });
    const added = await asApp(() =>
      budgets.setLine(userId, october, { categoryId: subscriptions, limitMinor: 200_000n }),
    );
    expect(added.lines[1]).toMatchObject({ categoryId: subscriptions, isFixed: true, sortOrder: 1 });
    const explicit = await asApp(() =>
      budgets.setLine(userId, october, {
        categoryId: shopping,
        limitMinor: 300_000n,
        rollover: true,
        isFixed: true,
        alertPct: 100,
      }),
    );
    expect(explicit.lines[2]).toMatchObject({ categoryId: shopping, rollover: true, isFixed: true, alertPct: 100 });

    const options = await asApp(() =>
      budgets.setLine(userId, october, { categoryId: food, rollover: true, isFixed: true, alertPct: 50 }),
    );
    expect(options.lines[0]).toMatchObject({ limitMinor: 1_000_000n, rollover: true, isFixed: true, alertPct: 50 });
    const limit = await asApp(() => budgets.setLine(userId, october, { categoryId: food, limitMinor: 1_500_000n }));
    expect(limit.lines[0]).toMatchObject({ limitMinor: 1_500_000n, rollover: true, alertPct: 50 });
    expect(limit.id).toBe(created.id);
  });

  it('copies the version in force and leaves it unchanged', async () => {
    const october = await periodOn('2026-10-15');
    const september = await asApp(() =>
      budgets.saveVersion(userId, {
        effectiveFrom: ym('2026-09'),
        expectedIncomeMinor: 10_000_000n,
        lines: [
          { categoryId: food, limitMinor: 1_000_000n },
          { categoryId: rent, limitMinor: 2_000_000n },
        ],
      }),
    );
    const version = await asApp(() => budgets.setLine(userId, october, { categoryId: food, limitMinor: 1_200_000n }));
    expect(version).toMatchObject({
      effectiveFrom: '2026-10',
      expectedIncomeMinor: 10_000_000n,
      totalMinor: 3_200_000n,
    });
    const history = await asApp(() => budgets.history(userId));
    expect(history.map((entry) => [entry.versionId, entry.totalMinor])).toEqual([
      [version.id, 3_200_000n],
      [september.id, 3_000_000n],
    ]);
  });

  it('refuses invalid lines, unknown and closed periods', async () => {
    const september = await periodOn('2026-09-10');
    const october = await periodOn('2026-10-15');
    await expect(
      asApp(() => budgets.setLine(userId, october, { categoryId: food, limitMinor: 1n, alertPct: 10 as 50 })),
    ).rejects.toMatchObject({ code: 'INVALID_BUDGET' });
    await expect(
      asApp(() => budgets.setLine(userId, october, { categoryId: ledger.category('system:salary'), limitMinor: 1n })),
    ).rejects.toMatchObject({ code: 'INVALID_CATEGORY' });
    await expect(
      asApp(() => budgets.setLine(userId, randomUUID(), { categoryId: food, limitMinor: 1n })),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await asApp(() => periodsAt('2026-10-15').lock(userId, september));
    await expect(
      asApp(() => budgets.setLine(userId, september, { categoryId: food, limitMinor: 1n })),
    ).rejects.toMatchObject({ code: 'PERIOD_CLOSED' });
  });
});

describe('removeLine', () => {
  it('removes a line from the period on, and refuses a category without one', async () => {
    const october = await periodOn('2026-10-15');
    // Nothing in force yet.
    await expect(asApp(() => budgets.removeLine(userId, october, food))).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await asApp(() =>
      budgets.saveVersion(userId, {
        effectiveFrom: ym('2026-10'),
        lines: [
          { categoryId: food, limitMinor: 1_000_000n },
          { categoryId: rent, limitMinor: 2_000_000n },
        ],
      }),
    );
    const version = await asApp(() => budgets.removeLine(userId, october, food));
    expect(version.lines.map((line) => line.categoryId)).toEqual([rent]);
    await expect(asApp(() => budgets.removeLine(userId, october, food))).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('leaves out the lines of deleted categories', async () => {
    const kopi = (
      await asApp(() =>
        createCategories(test.db, { getDek: fixtureGetDek }).create(userId, {
          kind: 'expense',
          group: 'wants',
          name: 'Kopi',
          icon: 'coffee',
          color: 'brown',
        }),
      )
    ).id;
    await asApp(() =>
      budgets.saveVersion(userId, {
        effectiveFrom: ym('2026-10'),
        lines: [
          { categoryId: food, limitMinor: 1_000_000n },
          { categoryId: kopi, limitMinor: 200_000n },
        ],
      }),
    );
    await asApp(() => createCategories(test.db, { getDek: fixtureGetDek }).remove(userId, kopi));
    expect((await asApp(() => budgets.status(userId))).lines.map((line) => line.categoryId)).toEqual([food]);
  });
});

describe('fillFromAverage', () => {
  it('suggests nothing without transactions', async () => {
    const october = await periodOn('2026-10-15');
    expect(await asApp(() => budgets.fillFromAverage(userId, october))).toEqual([]);
    await expect(asApp(() => budgets.fillFromAverage(userId, randomUUID()))).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('averages the expense categories over the last three periods', async () => {
    const transport = ledger.category('system:transport');
    // Before the three periods counted: only moves the first transaction day back.
    await ledger.entry('expense', '2026-05-10', 90_000n, food);
    await ledger.entry('expense', '2026-07-10', 200_000n, food);
    await ledger.entry('expense', '2026-08-10', 300_000n, food);
    await ledger.entry('expense', '2026-09-10', 400_000n, food);
    await ledger.entry('expense', '2026-09-11', 150_000n, transport);
    await ledger.entry('expense', '2026-09-12', 40_000n, null);
    await ledger.entry('income', '2026-09-01', 10_000_000n, ledger.category('system:salary'));
    // The period itself does not count.
    await ledger.entry('expense', '2026-10-02', 5_000_000n, food);
    const october = await periodOn('2026-10-15');
    expect(await asApp(() => budgets.fillFromAverage(userId, october))).toEqual([
      { categoryId: food, averageMinor: 300_000n },
      { categoryId: transport, averageMinor: 50_000n },
    ]);
  });

  it('counts only the periods since the first transaction', async () => {
    await ledger.entry('expense', '2026-09-10', 400_000n, food);
    const october = await periodOn('2026-10-15');
    expect(await asApp(() => budgets.fillFromAverage(userId, october))).toEqual([
      { categoryId: food, averageMinor: 400_000n },
    ]);
  });
});

describe('moveLeftover and undoMove', () => {
  it('moves leftover between lines and undoes the move', async () => {
    await asApp(() =>
      budgets.saveVersion(userId, {
        effectiveFrom: ym('2026-10'),
        lines: [
          { categoryId: food, limitMinor: 1_000_000n },
          { categoryId: shopping, limitMinor: 500_000n },
        ],
      }),
    );
    await ledger.entry('expense', '2026-10-03', 200_000n, food);
    const october = await periodOn('2026-10-15');
    const move = await asApp(() =>
      budgets.moveLeftover(userId, october, {
        targetCategoryId: shopping,
        sources: [{ categoryId: food, amountMinor: 300_000n }],
      }),
    );
    expect(move.deltas).toEqual(
      expect.arrayContaining([
        { categoryId: shopping, deltaMinor: 300_000n },
        { categoryId: food, deltaMinor: -300_000n },
      ]),
    );
    let status = await asApp(() => budgets.status(userId));
    expect(lineOf(status.lines, shopping)?.limitMinor).toBe(800_000n);
    expect(lineOf(status.lines, food)?.limitMinor).toBe(700_000n);

    expect(await asApp(() => budgets.undoMove(userId, move.moveId))).toEqual({ removed: 2 });
    status = await asApp(() => budgets.status(userId));
    expect(lineOf(status.lines, shopping)?.limitMinor).toBe(500_000n);
    await expect(asApp(() => budgets.undoMove(userId, move.moveId))).rejects.toMatchObject({ code: 'NOT_FOUND' });

    for (const sources of [[], [{ categoryId: food, amountMinor: 900_000n }]]) {
      await expect(
        asApp(() => budgets.moveLeftover(userId, october, { targetCategoryId: shopping, sources })),
      ).rejects.toMatchObject({ code: 'INVALID_BUDGET' });
    }
    await expect(
      asApp(() =>
        budgets.moveLeftover(userId, october, {
          targetCategoryId: rent,
          sources: [{ categoryId: food, amountMinor: 1n }],
        }),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_BUDGET', message: 'The target is not in the budget' });
  });

  it('refuses to move or undo in a closed period', async () => {
    const september = await periodOn('2026-09-10');
    await asApp(() =>
      budgetsAt('2026-09-10').saveVersion(userId, {
        effectiveFrom: ym('2026-09'),
        lines: [
          { categoryId: food, limitMinor: 1_000_000n },
          { categoryId: shopping, limitMinor: 500_000n },
        ],
      }),
    );
    const move = await asApp(() =>
      budgetsAt('2026-09-10').moveLeftover(userId, september, {
        targetCategoryId: shopping,
        sources: [{ categoryId: food, amountMinor: 100_000n }],
      }),
    );
    await asApp(() => periodsAt('2026-10-15').lock(userId, september));
    await expect(
      asApp(() =>
        budgets.moveLeftover(userId, september, {
          targetCategoryId: shopping,
          sources: [{ categoryId: food, amountMinor: 100_000n }],
        }),
      ),
    ).rejects.toMatchObject({ code: 'PERIOD_CLOSED' });
    await expect(asApp(() => budgets.undoMove(userId, move.moveId))).rejects.toMatchObject({ code: 'PERIOD_CLOSED' });
  });
});

describe('dismissAlert and restoreAlert', () => {
  it('refuses closed and unknown periods and income categories', async () => {
    const september = await periodOn('2026-09-10');
    const october = await periodOn('2026-10-15');
    await expect(
      asApp(() => budgets.dismissAlert(userId, october, ledger.category('system:salary'))),
    ).rejects.toMatchObject({ code: 'INVALID_CATEGORY' });
    await asApp(() => periodsAt('2026-10-15').lock(userId, september));
    await expect(asApp(() => budgets.dismissAlert(userId, september, food))).rejects.toMatchObject({
      code: 'PERIOD_CLOSED',
    });
    await expect(asApp(() => budgets.restoreAlert(userId, randomUUID(), food))).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});
