// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from 'node:crypto';
import { generateDek } from '@wf/crypto/envelope';
import { netWorth } from '@wf/domain/ledger';
import type { LocalDate } from '@wf/domain/period';
import { DESIGN_SEED, seedClosingBalances, type DesignSeed, type SeedTransaction } from '@wf/domain/seed';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { insertUser, PGLITE_HOOK_TIMEOUT, startMigrated, type TestDatabase } from '../test/pglite.ts';
import { createAccounts } from './accounts.ts';
import { createGoals } from './goals.ts';
import { createReceivables } from './receivables.ts';
import { createReview } from './review.ts';
import { createSchedules } from './schedules.ts';
import { SeedMismatchError, seedAutomation, seedLedger, SeedTargetNotEmptyError } from './seed.ts';
import { createTransactionQuery } from './transaction-query.ts';

let test: TestDatabase;
let userId: string;
const dek = generateDek();
const options = { getDek: () => Promise.resolve(dek), now: () => new Date('2026-10-15T10:00:00Z') };
const asApp = <T>(fn: () => Promise<T>) => test.as('wf_app', fn);

/** A one-account seed for the failure cases. */
const tiny = (overrides: Partial<DesignSeed>): DesignSeed => ({
  ...DESIGN_SEED,
  accounts: DESIGN_SEED.accounts.slice(0, 1),
  transactions: [],
  septemberTransactions: [],
  closedPeriods: [],
  budgets: [],
  goals: [],
  fxRates: [],
  subscriptions: [],
  recurrences: [],
  receivables: [],
  ...overrides,
});

beforeAll(async () => {
  test = await startMigrated();
}, PGLITE_HOOK_TIMEOUT);

afterAll(async () => {
  await test.close();
});

beforeEach(async () => {
  await test.query('DELETE FROM users');
  userId = await insertUser(test, 'avtara@example.test');
});

// Seeding 128 transactions through the repositories on PGlite takes several seconds on a loaded CI runner.
describe('seedLedger', { timeout: PGLITE_HOOK_TIMEOUT }, () => {
  it('reproduces the design balances and the Rp55.023.000 available balance', async () => {
    // A category of the user's own is left alone.
    await test.query(
      `INSERT INTO categories (user_id, kind, "group", name, icon, color) VALUES ($1, 'expense', 'wants', 'Kopi', 'coffee', 'brown')`,
      [userId],
    );
    const result = await asApp(() => seedLedger(test.db, userId, { getDek: options.getDek }));
    expect(result).toEqual({
      balances: seedClosingBalances(DESIGN_SEED),
      transactions: 249,
      closedPeriods: 1,
      goals: DESIGN_SEED.goals.length,
      receivables: 5,
      subscriptions: 11,
      recurrences: 4,
      availableMinor: 55_023_000n,
    });
    expect(
      await test.query(
        `SELECT type, count(*)::int AS n FROM transactions WHERE deleted_at IS NULL GROUP BY type ORDER BY type`,
      ),
    ).toEqual([
      { type: 'expense', n: 235 },
      { type: 'income', n: 8 },
      { type: 'transfer', n: 6 },
    ]);
    // September is the first period row and closed; October follows, open.
    expect(
      await test.query(
        `SELECT label, start_date::text AS start, end_date::text AS end, status, closed_at FROM periods ORDER BY start_date`,
      ),
    ).toEqual([
      {
        label: '2026-09',
        start: '2026-09-01',
        end: '2026-09-30',
        status: 'closed',
        closed_at: new Date('2026-10-01T00:05:00+07:00'),
      },
      { label: '2026-10', start: '2026-10-01', end: '2026-10-31', status: 'open', closed_at: null },
    ]);
    expect(
      await test.query(
        `SELECT v.effective_from, count(l.id)::int AS lines, sum(l.limit_minor)::text AS total
         FROM budget_versions v JOIN budget_lines l ON l.version_id = v.id GROUP BY v.effective_from`,
      ),
    ).toEqual([{ effective_from: '2026-09', lines: 10, total: '18750000' }]);
    expect(await test.query('SELECT period_start_day FROM user_preferences')).toEqual([{ period_start_day: 1 }]);
    expect(await test.query('SELECT base_currency, timezone FROM users')).toEqual([
      { base_currency: 'IDR', timezone: 'Asia/Jakarta' },
    ]);
    expect(await test.query('SELECT count(*)::int AS n FROM users WHERE onboarding_completed_at IS NOT NULL')).toEqual([
      { n: 1 },
    ]);
  });

  it('M3: subscriptions, recurring transfers, and what the jobs created by 15 Okt; balances untouched', async () => {
    const result = await asApp(() => seedLedger(test.db, userId, options));
    expect(result.availableMinor).toBe(55_023_000n);
    expect(result.balances).toEqual(seedClosingBalances(DESIGN_SEED));
    // The jobs as the worker would have run them: iCloud+ (9 Okt) is overdue, September's leftover is proposed.
    expect(await test.as('wf_worker', () => seedAutomation(test.db, userId, options))).toEqual({ reviewItems: 2 });
    // A rerun (a restarted worker) creates nothing more.
    expect(await test.as('wf_worker', () => seedAutomation(test.db, userId, options))).toEqual({ reviewItems: 0 });

    const overview = await asApp(() => createSchedules(test.db, options).listSubscriptions(userId));
    expect(overview.counts).toEqual({ active: 7, paused: 1, cancelled: 3 });
    expect(overview.totals).toEqual({
      monthlyMinor: 904_900n,
      yearlyMinor: 11_519_700n,
      approxYearlyMinor: 11_520_000n,
    });
    expect(overview.remainingThisMonth).toEqual({
      totalMinor: 660_900n,
      count: 4,
      firstDue: '2026-10-18',
      lastDue: '2026-10-28',
    });
    expect(overview.cancelledSavedMinor).toBe(1_195_000n);
    const netflix = overview.subscriptions.find((subscription) => subscription.name === 'Netflix');
    expect(netflix).toMatchObject({ nextBillingDate: '2026-10-18', paidCount: 1, remindDaysBefore: 1 });
    // H-1 at 09.00 WIB.
    expect(
      await test.query(
        `SELECT o.due_date::text AS due, o.status, o.remind_at FROM scheduled_occurrences o
         JOIN subscriptions s ON s.id = o.source_id WHERE s.name = 'Netflix' ORDER BY o.due_date LIMIT 2`,
      ),
    ).toEqual([
      { due: '2026-09-18', status: 'confirmed', remind_at: null },
      { due: '2026-10-18', status: 'scheduled', remind_at: new Date('2026-10-17T02:00:00Z') },
    ]);
    const recurrences = await asApp(() => createSchedules(test.db, options).listRecurrences(userId));
    expect(recurrences.map((recurrence) => [recurrence.monthDay, recurrence.nextDue?.dueDate])).toEqual(
      expect.arrayContaining([
        [1, '2026-11-01'],
        [14, '2026-11-14'],
        [25, '2026-10-25'],
      ]),
    );

    const review = createReview(test.db, { getDek: options.getDek, now: options.now });
    const { items } = await asApp(() => review.list(userId));
    expect(items.map((item) => [item.reason, item.payload.kind])).toEqual(
      expect.arrayContaining([
        ['due_occurrence', 'transaction'],
        ['period_close_proposal', 'leftover'],
      ]),
    );
    const leftover = items.find((item) => item.payload.kind === 'leftover');
    expect(leftover?.payload).toMatchObject({ kind: 'leftover', amountMinor: 1_150_000n });
    // Nothing applied before a confirmation (D14).
    expect(await test.query('SELECT count(*)::int AS n FROM transactions')).toEqual([{ n: 249 }]);
    expect(await test.query('SELECT count(*)::int AS n FROM budget_period_overrides')).toEqual([{ n: 0 }]);
  });

  it('M4: goals with their sources and plans, Rp542.500 of receivables, and the Section 19 exit scenario', async () => {
    const result = await asApp(() => seedLedger(test.db, userId, options));
    expect(result.balances).toEqual(seedClosingBalances(DESIGN_SEED));
    expect(result.availableMinor).toBe(55_023_000n);
    // Receivables are recorded without ledger transactions: the Section 00 counts and flows stay.
    expect(await test.query('SELECT count(*)::int AS n FROM transactions')).toEqual([{ n: 249 }]);

    const goals = createGoals(test.db, options);
    expect(
      (await asApp(() => goals.list(userId))).map((goal) => [
        goal.name,
        goal.kind,
        goal.targetMode,
        goal.savedMinor,
        goal.monthlyPlanMinor,
      ]),
    ).toEqual([
      ['Dana Darurat', 'savings', 'monthly_expenses', 8_125_000n, 3_500_000n],
      ['DP Rumah', 'savings', 'fixed', 5_000_000n, 0n],
      ['Dana Pensiun', 'savings', 'fixed', 0n, 0n],
      ['Liburan Bali', 'sinking', 'fixed', 2_800_000n, 867_000n],
      ['Servis motor', 'sinking', 'fixed', 720_000n, 240_000n],
      ['Perpanjang STNK', 'sinking', 'fixed', 680_000n, 43_000n],
    ]);
    // Accounts page: "Rp17.300.000 dialokasikan ke tabungan · bebas Rp37.700.000" (the design rounds 17.325.000).
    const allocations = await asApp(() => goals.allocations(userId));
    expect(allocations.reduce((sum, row) => sum + row.allocatedMinor, 0n)).toBe(17_325_000n);
    expect(allocations.map((row) => [row.allocatedMinor, row.goalIds.length]).sort()).toEqual([
      [8_125_000n, 1],
      [9_200_000n, 4],
    ]);

    const receivables = createReceivables(test.db, options);
    const before = await asApp(() => receivables.list(userId));
    expect(before.outstandingMinor).toBe(542_500n);
    expect(before.active.map((row) => [row.counterparty, row.remainingMinor, row.dueDate])).toEqual([
      ['Nadia', 242_500n, '2026-10-18'],
      ['Raka Pratama', 300_000n, '2026-10-31'],
    ]);
    expect(before.history.map((row) => [row.counterparty, row.settledAt])).toEqual([
      ['Dimas', new Date('2026-10-02T12:00:00+07:00')],
      ['Sari', new Date('2026-09-21T12:00:00+07:00')],
    ]);
    expect(before.people).toEqual(['Nadia', 'Raka Pratama', 'Dimas', 'Sari', 'Bima Aditya']);
    // Nadia's H-1 reminder: 17 Okt 09.00 WIB.
    expect(
      await test.query(
        `SELECT due_date::text AS due, remind_at FROM scheduled_occurrences WHERE source_type = 'receivable'`,
      ),
    ).toEqual([{ due: '2026-10-18', remind_at: new Date('2026-10-17T02:00:00Z') }]);

    // Section 19 exit: lend Bima Rp500.000 from BCA → Rp1.042.500, BCA 42.310.000, October expenses stay 16.500.000.
    const accounts = createAccounts(test.db, options);
    const accountOf = async (name: string) =>
      (await asApp(() => accounts.list(userId))).accounts.find((account) => account.displayName === name);
    const bca = await accountOf('BCA Tahapan');
    const gopay = await accountOf('GoPay');
    const query = createTransactionQuery(test.db, { getDek: options.getDek });
    const october = { from: '2026-10-01' as LocalDate, to: '2026-10-31' as LocalDate };
    const flowsBefore = await asApp(() => query.summary(userId, october));
    expect([flowsBefore.inMinor, flowsBefore.outMinor]).toEqual([26_000_000n, 16_500_000n]);
    await asApp(() =>
      receivables.record(userId, {
        clientId: randomUUID(),
        counterparty: 'Bima Aditya',
        amountMinor: 500_000n,
        fromAccountId: bca?.id as string,
        source: 'loan',
        description: null,
        note: 'Pinjam untuk servis motor',
        lentAt: options.now(),
        dueDate: '2026-10-31' as LocalDate,
        remind: true,
      }),
    );
    expect((await asApp(() => receivables.list(userId))).outstandingMinor).toBe(1_042_500n);
    expect((await accountOf('BCA Tahapan'))?.balanceMinor).toBe(42_310_000n);
    const overview = await asApp(() => accounts.list(userId));
    expect(overview.availableMinor).toBe(54_523_000n);
    // Net worth is unchanged by lending (design investments Rp61.420.000; the dialog's "116.443.000 tetap" leaves the
    // receivables out, with them it is 116.985.500 before and after).
    const worth = (available: bigint, receivablesOutstanding: bigint) =>
      netWorth({ available, investments: 61_420_000n, receivablesOutstanding, debtRemaining: 0n });
    expect(worth(overview.availableMinor, 1_042_500n)).toBe(worth(55_023_000n, 542_500n));
    expect(worth(55_023_000n, 542_500n)).toBe(116_985_500n);
    expect((await asApp(() => query.summary(userId, october))).outMinor).toBe(16_500_000n);

    // Receive Raka Rp200.000 into GoPay → remaining 100.000 (75% back), GoPay 612.000, October income unchanged.
    const raka = before.active.find((row) => row.counterparty === 'Raka Pratama');
    const paid = await asApp(() =>
      receivables.receivePayment(userId, raka?.id as string, {
        clientId: randomUUID(),
        amountMinor: 200_000n,
        accountId: gopay?.id as string,
        receivedAt: options.now(),
      }),
    );
    expect([paid.remainingMinor, paid.repaidBps, paid.status, paid.dueDate]).toEqual([
      100_000n,
      7_500,
      'partial',
      '2026-10-31',
    ]);
    expect((await accountOf('GoPay'))?.balanceMinor).toBe(612_000n);
    expect((await asApp(() => query.summary(userId, october))).inMinor).toBe(26_000_000n);
  });

  it('M3: fails on a bill, goal, or closed period the fixture does not have', async () => {
    const [subscription] = DESIGN_SEED.subscriptions;
    const [, , , sisihkan] = DESIGN_SEED.recurrences;
    if (subscription === undefined || sisihkan === undefined) throw new Error('fixture changed');
    await expect(
      asApp(() => seedLedger(test.db, userId, { ...options, seed: tiny({ subscriptions: [subscription] }) })),
    ).rejects.toBeInstanceOf(SeedMismatchError);
    const other = await insertUser(test, 'other@example.test');
    await expect(
      asApp(() =>
        seedLedger(test.db, other, {
          ...options,
          seed: tiny({
            accounts: DESIGN_SEED.accounts,
            recurrences: [{ ...sisihkan, allocations: [{ goal: 'Nope', amountMinor: 1n }] }],
          }),
        }),
      ),
    ).rejects.toBeInstanceOf(SeedMismatchError);
    const third = await insertUser(test, 'third@example.test');
    await asApp(() => seedLedger(test.db, third, { ...options, seed: tiny({}) }));
    // The real clock by default; nothing is due for a ledger without schedules.
    expect(
      await test.as('wf_worker', () => seedAutomation(test.db, third, { getDek: options.getDek, seed: tiny({}) })),
    ).toEqual({ reviewItems: 0 });
    await expect(
      test.as('wf_worker', () =>
        seedAutomation(test.db, third, {
          ...options,
          seed: tiny({ closedPeriods: [{ start: '2026-08-01', end: '2026-08-31', closedAt: '2026-09-01T00:05:00Z' }] }),
        }),
      ),
    ).rejects.toBeInstanceOf(SeedMismatchError);
  });

  it('only fills an empty ledger', async () => {
    await asApp(() => seedLedger(test.db, userId, { ...options, seed: tiny({}) }));
    await expect(asApp(() => seedLedger(test.db, userId, options))).rejects.toBeInstanceOf(SeedTargetNotEmptyError);
  });

  it('replaces the period rows an app visit created before the seed, so September can be closed', async () => {
    // The first visit's period (October) became the first row; September could not precede it.
    await test.query(
      `INSERT INTO periods (user_id, label, start_date, end_date, days) VALUES ($1, '2026-10', '2026-10-01', '2026-10-31', 31)`,
      [userId],
    );
    const closedAt = '2026-10-01T00:05:00+07:00';
    const seed = tiny({ closedPeriods: [{ start: '2026-09-01', end: '2026-09-30', closedAt }] });
    await expect(asApp(() => seedLedger(test.db, userId, { ...options, seed }))).resolves.toMatchObject({
      closedPeriods: 1,
    });
    expect(await test.query(`SELECT label, status FROM periods ORDER BY start_date`)).toEqual([
      { label: '2026-09', status: 'closed' },
      { label: '2026-10', status: 'open' },
    ]);
  });

  it('fails on a fixture that references a missing category or account', async () => {
    const [account] = DESIGN_SEED.accounts;
    const expense = DESIGN_SEED.transactions.find(
      (entry): entry is Exclude<SeedTransaction, { kind: 'transfer' }> => entry.kind === 'expense',
    );
    if (account === undefined || expense === undefined) throw new Error('fixture changed');
    await expect(
      asApp(() =>
        seedLedger(test.db, userId, { ...options, seed: tiny({ transactions: [{ ...expense, accountKey: 'nope' }] }) }),
      ),
    ).rejects.toBeInstanceOf(SeedMismatchError);

    const other = await insertUser(test, 'other@example.test');
    // A user who deleted a built-in category does not get it back from the seed.
    await test.query(
      `INSERT INTO categories (user_id, kind, "group", name, icon, color, deleted_at)
       VALUES ($1, 'expense', 'needs', 'system:food', 'utensils', 'orange', now())`,
      [other],
    );
    const food = { ...expense, accountKey: account.key, categoryKey: 'system:food' as const };
    await expect(
      asApp(() => seedLedger(test.db, other, { ...options, seed: tiny({ transactions: [food] }) })),
    ).rejects.toBeInstanceOf(SeedMismatchError);
  });

  it('fails on a closed period that is not a period of the ledger', async () => {
    const closedAt = '2026-10-01T00:05:00+07:00';
    // Not on the start day: the period row containing 30 Sep starts on the 1st.
    await expect(
      asApp(() =>
        seedLedger(test.db, userId, {
          ...options,
          seed: tiny({ closedPeriods: [{ start: '2026-09-02', end: '2026-09-30', closedAt }] }),
        }),
      ),
    ).rejects.toBeInstanceOf(SeedMismatchError);
    // Before the first period row (September): a computed period, without a row to lock.
    const other = await insertUser(test, 'other@example.test');
    await expect(
      asApp(() =>
        seedLedger(test.db, other, {
          ...options,
          seed: tiny({
            closedPeriods: [
              { start: '2026-09-01', end: '2026-09-30', closedAt },
              { start: '2026-08-01', end: '2026-08-31', closedAt },
            ],
          }),
        }),
      ),
    ).rejects.toBeInstanceOf(SeedMismatchError);
  });
});
