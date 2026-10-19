// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Loads the design persona (`DESIGN_SEED`, 1–15 Oktober 2026) into an existing user's empty ledger through the
 * repositories, as the app would: manual rates, built-in categories, accounts, 128 transactions, and goals. Used by
 * `wf-db seed --email <user>` and the M1 exit E2E. The result has every account's balance by seed key, to compare
 * with `seedClosingBalances`.
 */
import { randomUUID } from 'node:crypto';
import type { Dek } from '@wf/crypto/envelope';
import type { BuiltInCategoryKey } from '@wf/domain/categories';
import { DESIGN_SEED, type DesignSeed } from '@wf/domain/seed';
import { parseLocalDate, type YearMonth } from '@wf/domain/period';
import { eq, sql } from 'drizzle-orm';
import { createAccounts } from './accounts.ts';
import { createCategories } from './categories.ts';
import { firstRow, withUser, type Database } from './db.ts';
import { createFxRates } from './fx-rates.ts';
import { createGoals } from './goals.ts';
import { accounts, users } from './schema.ts';
import { createTransactions } from './transactions.ts';

export interface SeedResult {
  /** Balance per seed account key, in the account currency. */
  readonly balances: ReadonlyMap<string, bigint>;
  readonly transactions: number;
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
  for (const entry of seed.transactions) {
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
    transactions: seed.transactions.length,
    goals: seed.goals.length,
    availableMinor: overview.availableMinor,
  };
}
