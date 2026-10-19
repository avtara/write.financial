// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Loads the design persona (`DESIGN_SEED`: September 2026 closed, 1–15 Oktober 2026) into an existing user's empty
 * ledger through the repositories, as the app would: manual rates, built-in categories, accounts, 121 September and
 * 128 October transactions, the period start day, the budget, the closed September period, and goals. Used by
 * `wf-db seed --email <user>` and the exit E2Es. The result has every account's balance by seed key, to compare with
 * `seedClosingBalances`.
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
import { createPeriods, ensureIn } from './periods.ts';
import { createPreferences } from './preferences.ts';
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

  const categories = createCategories(db);
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
  for (const entry of [...seed.septemberTransactions, ...seed.transactions]) {
    const common = {
      clientId: randomUUID(),
      occurredAt: new Date(entry.occurredAt),
      description: entry.description,
      tags: entry.tags,
    };
    await transactions.create(
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
  for (const goal of seed.goals) {
    // Fixture months are `YYYY-MM`; goals.create validates them.
    await goals.create(userId, { ...goal, deadlineMonth: goal.deadlineMonth as YearMonth | null });
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
    availableMinor: overview.availableMinor,
  };
}
