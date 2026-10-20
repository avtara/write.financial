// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Loads the design persona (`DESIGN_SEED`: September 2026 closed, 1–15 Oktober 2026) into an existing user's empty
 * ledger through the repositories, as the app would: manual rates, built-in categories, accounts, 121 September and
 * 128 October transactions, the period start day, the budget, the closed September period, goals, and (M3) the
 * subscriptions and recurring transfers with their earlier bills linked to the seed transactions that paid them. Used
 * by `wf-db seed --email <user>` and the exit E2Es. The result has every account's balance by seed key, to compare
 * with `seedClosingBalances`. {@link seedAutomation} then runs, as the worker, what the scheduled jobs would have
 * produced by now (review items for due bills, the September close proposals).
 */
import { randomUUID } from 'node:crypto';
import type { Dek } from '@wf/crypto/envelope';
import type { BuiltInCategoryKey } from '@wf/domain/categories';
import { DESIGN_SEED, type DesignSeed } from '@wf/domain/seed';
import { parseLocalDate, periodStartDay, type YearMonth } from '@wf/domain/period';
import { eq, sql } from 'drizzle-orm';
import { createAccounts } from './accounts.ts';
import { createBudgets } from './budgets.ts';
import { createCategories } from './categories.ts';
import { firstRow, withUser, type Database } from './db.ts';
import { createFxRates } from './fx-rates.ts';
import { createGoals } from './goals.ts';
import { recordPastChargeIn, type ScheduleSourceType } from './occurrences.ts';
import { createOccurrenceJobs } from './occurrence-jobs.ts';
import { createPeriodClose } from './period-close.ts';
import { createPeriods, ensureIn } from './periods.ts';
import { createPreferences } from './preferences.ts';
import { createSchedules } from './schedules.ts';
import { accounts, users } from './schema.ts';
import { createTransactions } from './transactions.ts';

export interface SeedResult {
  /** Balance per seed account key, in the account currency. */
  readonly balances: ReadonlyMap<string, bigint>;
  /** September and October together (121 + 128). */
  readonly transactions: number;
  /** Periods closed by the seed (September). */
  readonly closedPeriods: number;
  readonly goals: number;
  /** Subscriptions in any state (7 active, 1 paused, 3 cancelled). */
  readonly subscriptions: number;
  readonly recurrences: number;
  /** "Saldo tersedia" after seeding (Rp55.023.000 for the design seed). */
  readonly availableMinor: bigint;
}

/** The user already has accounts: seeding only fills an empty ledger. */
export class SeedTargetNotEmptyError extends Error {
  override readonly name = 'SeedTargetNotEmptyError';
  constructor() {
    super('The user already has accounts; the seed only loads into an empty ledger');
  }
}

/** The fixture references a category or account the user's ledger does not have. */
export class SeedMismatchError extends Error {
  override readonly name = 'SeedMismatchError';
}

export interface SeedOptions {
  readonly getDek: (userId: string) => Promise<Dek>;
  readonly now?: () => Date;
  /** Defaults to {@link DESIGN_SEED}. */
  readonly seed?: DesignSeed;
}

export async function seedLedger(db: Database, userId: string, options: SeedOptions): Promise<SeedResult> {
  const { getDek, now = () => new Date(), seed = DESIGN_SEED } = options;
  await withUser(db, userId, async (tx) => {
    const [existing] = await tx.select({ id: accounts.id }).from(accounts).limit(1);
    if (existing !== undefined) throw new SeedTargetNotEmptyError();
    await tx
      .update(users)
      .set({
        baseCurrency: seed.baseCurrency,
        timezone: seed.timezone,
        onboardingCompletedAt: sql`coalesce(${users.onboardingCompletedAt}, ${now().toISOString()}::timestamptz)`,
        updatedAt: now(),
      })
      .where(eq(users.id, userId));
  });

  const fxRates = createFxRates(db);
  for (const rate of seed.fxRates) {
    await fxRates.upsertManual(userId, { ...rate, asOf: parseLocalDate(rate.asOf) });
  }

  const categories = createCategories(db, { getDek });
  await categories.ensureBuiltIns(userId);
  const categoryIds = new Map(
    (await categories.list(userId)).flatMap((category) =>
      category.builtInKey === null ? [] : [[category.builtInKey, category.id] as const],
    ),
  );
  const categoryOf = (key: BuiltInCategoryKey) => {
    const id = categoryIds.get(key);
    if (id === undefined) throw new SeedMismatchError(`Built-in category ${key} is missing`);
    return id;
  };

  const accountRepo = createAccounts(db, { now });
  const accountIds = new Map<string, string>();
  for (const { key, openingDate, ...account } of seed.accounts) {
    const created = await accountRepo.create(userId, { ...account, openingDate: parseLocalDate(openingDate) });
    accountIds.set(key, created.id);
  }
  const accountOf = (key: string) => {
    const id = accountIds.get(key);
    if (id === undefined) throw new SeedMismatchError(`Seed account ${key} is missing`);
    return id;
  };

  const transactions = createTransactions(db, { getDek, now });
  /** Transaction id by `occurredAt` and merchant (expenses) or destination account key (transfers): what bills they paid. */
  const paidBy = new Map<string, string>();
  for (const entry of [...seed.septemberTransactions, ...seed.transactions]) {
    const common = {
      clientId: randomUUID(),
      occurredAt: new Date(entry.occurredAt),
      description: entry.description,
      tags: entry.tags,
    };
    const { id } = await transactions.create(
      userId,
      entry.kind === 'transfer'
        ? {
            ...common,
            type: 'transfer',
            fromAccountId: accountOf(entry.fromAccountKey),
            toAccountId: accountOf(entry.toAccountKey),
            sentMinor: entry.sentMinor,
            receivedMinor: entry.receivedMinor,
          }
        : {
            ...common,
            type: entry.kind,
            accountId: accountOf(entry.accountKey),
            amountMinor: entry.amountMinor,
            categoryId: categoryOf(entry.categoryKey),
            merchant: entry.merchant,
          },
    );
    paidBy.set(`${entry.occurredAt}|${entry.kind === 'transfer' ? entry.toAccountKey : entry.merchant}`, id);
  }

  // M2: periods start on the 1st, the budget in force since September, and September closed (FR-P3: closing makes
  // it read-only, so it comes after its transactions and budget).
  await createPreferences(db).update(userId, { periodStartDay: periodStartDay(seed.periodStartDay) });
  const budgets = createBudgets(db, { now });
  for (const version of seed.budgets) {
    await budgets.saveVersion(userId, {
      effectiveFrom: version.effectiveFrom as YearMonth,
      expectedIncomeMinor: version.expectedIncomeMinor,
      lines: version.lines.map(({ categoryKey, ...line }) => ({ ...line, categoryId: categoryOf(categoryKey) })),
    });
  }
  for (const closed of seed.closedPeriods) {
    const end = parseLocalDate(closed.end);
    const closedAt = new Date(closed.closedAt);
    const periods = createPeriods(db, { now: () => closedAt });
    // The closed period is the user's first period row.
    await withUser(db, userId, (tx) => ensureIn(tx, userId, end, periodStartDay(seed.periodStartDay)));
    const [period] = await periods.covering(userId, { from: end, to: end });
    if (period?.id == null || period.start !== closed.start) throw new SeedMismatchError(`No period ${closed.start}`);
    await periods.lock(userId, period.id);
  }

  const goals = createGoals(db);
  const goalIds = new Map<string, string>();
  for (const goal of seed.goals) {
    // Fixture months are `YYYY-MM`; goals.create validates them.
    const created = await goals.create(userId, { ...goal, deadlineMonth: goal.deadlineMonth as YearMonth | null });
    goalIds.set(goal.name, created.id);
  }

  // M3: subscriptions and recurring transfers. Paused and cancelled ones are created and changed on the day it
  // happened, so their dates are the design's; earlier bills point at the seed transactions that paid them.
  const schedules = createSchedules(db, { now });
  const schedulesOn = (date: string) => createSchedules(db, { now: () => new Date(`${date}T12:00:00+07:00`) });
  const linkPaid = async (
    sourceType: ScheduleSourceType,
    sourceId: string,
    bill: { readonly dueDate: string; readonly occurredAt: string },
    payee: string,
    amountMinor: bigint,
  ) => {
    const transactionId = paidBy.get(`${bill.occurredAt}|${payee}`);
    if (transactionId === undefined) throw new SeedMismatchError(`No seed transaction paid ${payee} ${bill.dueDate}`);
    await withUser(db, userId, (tx) =>
      recordPastChargeIn(tx, userId, {
        sourceType,
        sourceId,
        dueDate: parseLocalDate(bill.dueDate),
        transactionId,
        amountMinor,
        currency: seed.baseCurrency,
      }),
    );
  };
  for (const { state, paid, accountKey, categoryKey, usageRating, ...subscription } of seed.subscriptions) {
    const changedOn = state.status === 'paused' ? state.pausedOn : state.status === 'cancelled' ? state.endsOn : null;
    const repo = changedOn === null ? schedules : schedulesOn(changedOn);
    const { id } = await repo.createSubscription(userId, {
      ...subscription,
      nextBillingDate: parseLocalDate(state.status === 'paused' ? state.pausedOn : subscription.nextBillingDate),
      startedOn: parseLocalDate(subscription.startedOn),
      payFromAccountId: accountOf(accountKey),
      categoryId: categoryOf(categoryKey),
    });
    if (state.status === 'paused') {
      await repo.pause(userId, id, { until: parseLocalDate(state.pausedUntil) }, { remindDaysBefore: 3 });
    } else if (state.status === 'cancelled') {
      await repo.cancel(userId, id, state.cancelMode);
    }
    if (usageRating !== null) await schedules.rateUsage(userId, id, usageRating);
    for (const bill of paid) await linkPaid('subscription', id, bill, subscription.name, subscription.priceMinor);
  }
  const goalOf = (name: string) => {
    const goalId = goalIds.get(name);
    if (goalId === undefined) throw new SeedMismatchError(`Seed goal ${name} is missing`);
    return goalId;
  };
  for (const recurrence of seed.recurrences) {
    const { id } = await schedules.createRecurrence(userId, {
      template: {
        type: 'transfer',
        fromAccountId: accountOf(recurrence.fromAccountKey),
        toAccountId: accountOf(recurrence.toAccountKey),
        sentMinor: recurrence.sentMinor,
        receivedMinor: recurrence.receivedMinor,
        description: recurrence.description,
        tags: recurrence.tags,
        allocations: recurrence.allocations.map(({ goal, amountMinor }) => ({ goalId: goalOf(goal), amountMinor })),
      },
      freq: 'monthly',
      startOn: parseLocalDate(recurrence.startOn),
      monthDay: recurrence.monthDay,
      end: { type: 'never' },
      remindOffsetDays: recurrence.remindOffsetDays,
    });
    for (const bill of recurrence.paid) {
      await linkPaid('recurrence', id, bill, recurrence.toAccountKey, recurrence.sentMinor);
    }
  }

  const overview = await accountRepo.list(userId);
  const balanceOf = (id: string) =>
    firstRow(
      overview.accounts.filter((account) => account.id === id),
      'accounts',
    ).balanceMinor;
  return {
    balances: new Map([...accountIds].map(([key, id]) => [key, balanceOf(id)])),
    transactions: seed.septemberTransactions.length + seed.transactions.length,
    closedPeriods: seed.closedPeriods.length,
    goals: seed.goals.length,
    subscriptions: seed.subscriptions.length,
    recurrences: seed.recurrences.length,
    availableMinor: overview.availableMinor,
  };
}

export interface SeedAutomationResult {
  /** Review items the jobs created (due/overdue bills, the September close proposals). */
  readonly reviewItems: number;
}

/**
 * What the worker's scheduled jobs would have created by `now` for a freshly seeded user: the daily occurrences job
 * (due and overdue bills → review items; iCloud+ 9 Okt is overdue on 15 Okt) and the period-close proposals of the
 * seed's closed periods ("pindah sisa Rp1.150.000 ke Dana Darurat"). Must run on a `wf_worker` connection, as the
 * worker does (D14: it creates review items and notifications, never transactions or budget rows).
 */
export async function seedAutomation(
  workerDb: Database,
  userId: string,
  options: Pick<SeedOptions, 'getDek' | 'now' | 'seed'>,
): Promise<SeedAutomationResult> {
  const { getDek, now = () => new Date(), seed = DESIGN_SEED } = options;
  const advanced = await createOccurrenceJobs(workerDb, { getDek }).advance(userId, now());
  const periodClose = createPeriodClose(workerDb, { getDek });
  const periods = createPeriods(workerDb, { now });
  let proposals = 0;
  for (const closed of seed.closedPeriods) {
    const end = parseLocalDate(closed.end);
    const [period] = await periods.covering(userId, { from: end, to: end });
    if (period?.id == null) throw new SeedMismatchError(`No period ${closed.start}`);
    proposals += (await periodClose.propose(userId, period.id, now())).created;
  }
  return { reviewItems: advanced.due + proposals };
}
