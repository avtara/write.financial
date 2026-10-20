// SPDX-License-Identifier: AGPL-3.0-only
/**
 * FR-A4 onboarding (`/onboarding/$step`, design Section 16 `vSYBL`). Each step saves what it set up through the
 * existing repositories and moves the resume step forward, so a refresh or another device continues where the user
 * left off; "Ke Ringkasan" completes it. The user always comes from the session, and once the onboarding is completed
 * its writes are refused (`FORBIDDEN`).
 *
 * Where the data goes: profile → `users` (name, nickname, language, time zone, base currency); "Mata uang tambahan" →
 * `user_preferences.extra_currencies`; payday → the M2 period start day (`periods.changeStartDay`, recalculating the
 * current period); "Pemasukan bulanan rata-rata" → the expected income of the budget version of the current period
 * (the "Atur anggaran" sheet shows it); accounts → `accounts` (opening balance dated today); the first goal →
 * `goals` (with its "Simpan di" account) and its "Setoran rutin" → an M3 monthly transfer recurrence, whose
 * occurrences only ever reach the ledger through the Review queue (D14).
 */
import { createServerFn } from '@tanstack/react-start';
import type { AuthSession } from '@wf/auth/auth';
import type { AccountsOverview } from '@wf/db/accounts';
import type { GoalView } from '@wf/db/goals';
import { localDateOf } from '@wf/db/ledger-core';
import { LedgerError } from '@wf/db/ledger-errors';
import type { OnboardingProgress } from '@wf/db/onboarding';
import type { PeriodView } from '@wf/db/periods';
import type { Profile } from '@wf/db/profiles';
import { ACCOUNT_TYPES } from '@wf/domain/ledger';
import type { LocalDate, PeriodStartDay } from '@wf/domain/period';
import { LOCALES } from '@wf/i18n/locale';
import * as z from 'zod';
import { isColor } from '../../lib/colors.ts';
import { attempt, ForbiddenError, requireSession, type Result } from '../access.ts';
import type { RequestContext } from '../request-middleware.ts';
import { services, type Services } from '../runtime.ts';

const id = z.uuid();
const currency = z.string().regex(/^[A-Z]{3}$/);
/** At most what `user_preferences_extra_currencies_check` allows. */
export const MAX_EXTRA_CURRENCIES = 20;
/** More accounts than anyone enters in onboarding; keeps a request bounded. */
const MAX_ACCOUNTS = 30;

/** Step 4 presets: the stored icon and color of each (design `RRyTG`). */
export const GOAL_PRESETS = {
  emergency: { icon: 'shield', color: 'blue' },
  vacation: { icon: 'plane', color: 'violet' },
  house: { icon: 'house', color: 'green' },
} as const;
export type GoalPreset = keyof typeof GOAL_PRESETS;

export interface OnboardingView {
  readonly progress: OnboardingProgress;
  readonly profile: Profile;
  readonly email: string;
  readonly emailVerified: boolean;
  /** How the user signs in: Google prefills step 1; Google-only users get the "Kata sandi (opsional)" card. */
  readonly signIn: { readonly google: boolean; readonly password: boolean };
  readonly extraCurrencies: readonly string[];
  /** Today in the user's time zone (opening balances are dated today). */
  readonly today: LocalDate;
  readonly startDay: PeriodStartDay;
  /** The period containing today ("Okt 2026 = 1–31 Okt"). */
  readonly period: PeriodView;
  /** "Pemasukan bulanan rata-rata": the expected income of the current budget version. */
  readonly expectedIncomeMinor: bigint | null;
  readonly accounts: AccountsOverview;
  /** The first goal (step 4 creates at most one). */
  readonly goal: GoalView | null;
}

/** Runs `action` for the signed-in user; `writes` refuses users who already completed the onboarding. */
function forUser<T>(
  context: Pick<RequestContext, 'session' | 'headers'>,
  writes: boolean,
  action: (userId: string, all: Services, today: LocalDate, user: AuthSession['user']) => Promise<T>,
): Promise<Result<T>> {
  return services().then((all) =>
    attempt(async () => {
      const { user } = await requireSession(context.session, {}, all.now());
      if (writes && user.onboardingCompletedAt != null) throw new ForbiddenError();
      return action(user.id, all, localDateOf(all.now(), user.timezone ?? 'Asia/Jakarta'), user);
    }),
  );
}

/** Everything the five steps show, in one read. */
export const getOnboarding = createServerFn({ method: 'GET' }).handler(({ context }): Promise<Result<OnboardingView>> =>
  forUser(context, false, async (userId, all, today, user) => {
    const [progress, profile, preferences, periods, budget, accounts, goals, providers] = await Promise.all([
      all.onboarding.progress(userId),
      all.profiles.get(userId),
      all.preferences.get(userId),
      all.periods.list(userId),
      all.budgets.status(userId),
      all.accounts.list(userId),
      all.goals.list(userId),
      all.auth.api.listUserAccounts({ headers: context.headers }),
    ]);
    const methods = providers.map((provider) => provider.providerId);
    return {
      progress,
      profile,
      email: user.email,
      emailVerified: user.emailVerified,
      signIn: { google: methods.includes('google'), password: methods.includes('credential') },
      extraCurrencies: preferences.extraCurrencies,
      today,
      startDay: periods.startDay,
      period: periods.current,
      expectedIncomeMinor: budget.version?.expectedIncomeMinor ?? null,
      accounts,
      goal: goals.find((goal) => goal.archivedAt === null) ?? null,
    };
  }),
);

/** Step 1 "Profil": name, preferred name, language, time zone, base currency, additional currencies. */
export const saveOnboardingProfile = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      name: z.string().max(200),
      nickname: z.string().max(200).nullable(),
      locale: z.enum(LOCALES),
      timezone: z.string().max(100),
      baseCurrency: currency,
      extraCurrencies: z.array(currency).max(MAX_EXTRA_CURRENCIES),
    }),
  )
  .handler(({ context, data }): Promise<Result<OnboardingProgress>> =>
    forUser(context, true, async (userId, all) => {
      const { baseCurrency, extraCurrencies, ...profile } = data;
      await all.profiles.update(userId, profile);
      await all.onboarding.setBaseCurrency(userId, baseCurrency);
      const extras = [...new Set(extraCurrencies)].filter((code) => code !== baseCurrency);
      await all.preferences.update(userId, { extraCurrencies: extras });
      return all.onboarding.completeStep(userId, 'profile');
    }),
  );

/**
 * Step 2 "Periode": the payday becomes the period start day (the current period is recalculated: a new user has no
 * transactions to move), and the average income the expected income of the current period's budget version.
 */
export const saveOnboardingPeriod = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      day: z.number().int().min(1).max(28),
      expectedIncomeMinor: z.bigint().nonnegative().nullable(),
    }),
  )
  .handler(({ context, data }): Promise<Result<OnboardingProgress>> =>
    forUser(context, true, async (userId, all) => {
      const before = await all.periods.list(userId);
      if (before.startDay !== data.day) {
        await all.periods.changeStartDay(userId, { day: data.day, apply: 'recalculate', mode: 'fixed_day' });
      }
      // No income and no budget yet: nothing to store (an empty budget version would hide one set up later).
      if (data.expectedIncomeMinor !== null || (await all.budgets.status(userId)).version !== null) {
        const { current } = await all.periods.list(userId);
        await all.budgets.saveVersion(userId, {
          effectiveFrom: current.label,
          expectedIncomeMinor: data.expectedIncomeMinor,
        });
      }
      return all.onboarding.completeStep(userId, 'period');
    }),
  );

/** A quick row of step 3: new (no `id`) or one already saved (its name and today's balance may change). */
const accountRow = z.object({
  id: id.optional(),
  type: z.enum(ACCOUNT_TYPES),
  providerName: z.string().trim().min(1).max(80),
  displayName: z.string().trim().min(1).max(40),
  currency,
  openingBalanceMinor: z.bigint(),
  color: z.string().refine(isColor),
});

/** Step 3 "Rekening": creates the new rows with today's balance as the opening balance and updates the saved ones. */
export const saveOnboardingAccounts = createServerFn({ method: 'POST' })
  .validator(z.object({ accounts: z.array(accountRow).max(MAX_ACCOUNTS) }))
  .handler(({ context, data }): Promise<Result<AccountsOverview>> =>
    forUser(context, true, async (userId, all, today) => {
      const saved = new Map((await all.accounts.list(userId)).accounts.map((account) => [account.id, account]));
      for (const { id: accountId, ...row } of data.accounts) {
        if (accountId === undefined) {
          await all.accounts.create(userId, { ...row, openingDate: today });
          continue;
        }
        const account = saved.get(accountId);
        if (account === undefined) throw new LedgerError('NOT_FOUND', 'No such account');
        const patch = {
          ...(row.displayName === account.displayName ? {} : { displayName: row.displayName }),
          ...(row.openingBalanceMinor === account.openingBalanceMinor
            ? {}
            : { openingBalanceMinor: row.openingBalanceMinor }),
        };
        if (Object.keys(patch).length > 0) await all.accounts.update(userId, accountId, patch);
      }
      await all.onboarding.completeStep(userId, 'accounts');
      return all.accounts.list(userId);
    }),
  );

/** Step 4 "Tujuan": the first savings goal, optionally with its monthly contribution ("Setoran rutin"). */
export const saveOnboardingGoal = createServerFn({ method: 'POST' })
  .validator(
    z
      .object({
        preset: z.enum(Object.keys(GOAL_PRESETS) as [GoalPreset, ...GoalPreset[]]),
        name: z.string().trim().min(1).max(40),
        targetMinor: z.bigint().positive(),
        accountId: id.nullable(),
        contribution: z
          .object({ amountMinor: z.bigint().positive(), monthDay: z.number().int().min(1).max(28), fromAccountId: id })
          .nullable(),
      })
      .refine((goal) => goal.contribution === null || goal.accountId !== null, {
        message: 'A contribution needs the goal account',
      }),
  )
  .handler(({ context, data }): Promise<Result<GoalView>> =>
    forUser(context, true, async (userId, all, today) => {
      // One goal: a retried request (or a second tab) does not create another.
      const existing = (await all.goals.list(userId)).find((goal) => goal.archivedAt === null);
      if (existing !== undefined) {
        await all.onboarding.completeStep(userId, 'goal');
        return existing;
      }
      const { contribution, accountId } = data;
      if (contribution !== null) {
        // Checked before the goal exists, so a refused contribution leaves nothing behind.
        const { accounts } = await all.accounts.list(userId);
        const currencyOf = (account: string | null) => accounts.find((candidate) => candidate.id === account)?.currency;
        const from = currencyOf(contribution.fromAccountId);
        if (from === undefined || from !== currencyOf(accountId)) {
          throw new LedgerError(
            'INVALID_RECURRENCE',
            'The contribution needs two of the user’s accounts in one currency',
          );
        }
      }
      const { baseCurrency } = await all.onboarding.progress(userId);
      const goal = await all.goals.create(userId, {
        ...GOAL_PRESETS[data.preset],
        name: data.name,
        targetMinor: data.targetMinor,
        currency: baseCurrency,
        deadlineMonth: null,
        tag: data.name,
        accountId,
      });
      if (contribution !== null && accountId !== null) {
        await all.schedules.createRecurrence(userId, {
          template: {
            type: 'transfer',
            fromAccountId: contribution.fromAccountId,
            toAccountId: accountId,
            sentMinor: contribution.amountMinor,
            receivedMinor: contribution.amountMinor,
            description: goal.name,
            tags: goal.tag === null ? [] : [goal.tag],
          },
          freq: 'monthly',
          monthDay: contribution.monthDay,
          startOn: today,
          end: { type: 'never' },
          remindOffsetDays: null,
        });
      }
      await all.onboarding.completeStep(userId, 'goal');
      return goal;
    }),
  );

/** Step 4 "Lewati": no goal now. */
export const skipOnboardingGoal = createServerFn({ method: 'POST' }).handler(
  ({ context }): Promise<Result<OnboardingProgress>> =>
    forUser(context, true, (userId, all) => all.onboarding.completeStep(userId, 'goal')),
);

/** Step 5 "Ke Ringkasan": the onboarding is completed and never shows again. */
export const finishOnboarding = createServerFn({ method: 'POST' }).handler(
  ({ context }): Promise<Result<OnboardingProgress>> =>
    forUser(context, true, (userId, all) => all.onboarding.finish(userId)),
);
