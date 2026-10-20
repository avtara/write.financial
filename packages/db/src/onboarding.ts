// SPDX-License-Identifier: AGPL-3.0-only
/**
 * FR-A4 onboarding progress on `users`: the step to resume at (`onboarding_step`, 1–5), the completion
 * (`onboarding_completed_at`), and step 1's base currency. The data of the other steps goes through their own
 * repositories (profiles, preferences, periods, budgets, accounts, goals, schedules).
 */
import { stepAt, stepNumber, type OnboardingStep } from '@wf/domain/onboarding';
import { eq, sql } from 'drizzle-orm';
import type { PgUpdateSetSource } from 'drizzle-orm/pg-core';
import { firstRow, withUser, type Database, type Transaction } from './db.ts';
import { LedgerError } from './ledger-errors.ts';
import { accounts, users } from './schema.ts';

export interface OnboardingProgress {
  /** The first step not completed yet (`done` once the goal step is completed or skipped). */
  readonly step: OnboardingStep;
  /** Set by "Ke Ringkasan"; from then on the onboarding never shows again. */
  readonly completedAt: Date | null;
  readonly baseCurrency: string;
}

export interface OnboardingRepository {
  progress: (userId: string) => Promise<OnboardingProgress>;
  /** Marks `step` completed: the resume step moves past it, never back (going "Kembali" and on again is harmless). */
  completeStep: (userId: string, step: Exclude<OnboardingStep, 'done'>) => Promise<OnboardingProgress>;
  /** "Ke Ringkasan": completes the onboarding; a second call keeps the first time. */
  finish: (userId: string) => Promise<OnboardingProgress>;
  /**
   * Step 1 "Mata uang utama" (an ISO 4217 code). Changing it once the user has an account is out of scope (FR-ST1).
   * @throws {LedgerError} `ACCOUNT_LOCKED` for a different currency when an account exists
   */
  setBaseCurrency: (userId: string, currency: string) => Promise<OnboardingProgress>;
}

const COLUMNS = {
  step: users.onboardingStep,
  completedAt: users.onboardingCompletedAt,
  baseCurrency: users.baseCurrency,
};

async function progressIn(tx: Transaction, userId: string, values?: PgUpdateSetSource<typeof users>) {
  const query =
    values === undefined
      ? tx.select(COLUMNS).from(users).where(eq(users.id, userId))
      : tx
          .update(users)
          .set({ ...values, updatedAt: sql`now()` })
          .where(eq(users.id, userId))
          .returning(COLUMNS);
  const row = firstRow(await query, 'users');
  return { ...row, step: stepAt(row.step) };
}

/** On a `wf_app` connection. */
export function createOnboarding(db: Database, options: { readonly now?: () => Date } = {}): OnboardingRepository {
  const now = options.now ?? (() => new Date());
  return {
    progress: (userId) => withUser(db, userId, (tx) => progressIn(tx, userId)),

    completeStep: (userId, step) =>
      withUser(db, userId, (tx) =>
        progressIn(tx, userId, { onboardingStep: sql`greatest(${users.onboardingStep}, ${stepNumber(step) + 1})` }),
      ),

    finish: (userId) =>
      withUser(db, userId, (tx) =>
        progressIn(tx, userId, {
          onboardingCompletedAt: sql`coalesce(${users.onboardingCompletedAt}, ${now().toISOString()}::timestamptz)`,
        }),
      ),

    setBaseCurrency: (userId, currency) =>
      withUser(db, userId, async (tx) => {
        const current = await progressIn(tx, userId);
        if (current.baseCurrency === currency) return current;
        const [account] = await tx.select({ id: accounts.id }).from(accounts).limit(1);
        if (account !== undefined) {
          throw new LedgerError('ACCOUNT_LOCKED', 'The base currency is fixed once an account exists');
        }
        return progressIn(tx, userId, { baseCurrency: currency });
      }),
  };
}
