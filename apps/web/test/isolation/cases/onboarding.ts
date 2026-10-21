// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Isolation cases for the server functions in `src/server/fn/onboarding.ts`, run by
 * `src/server/fn/isolation.integration.test.ts`.
 */
import { expect } from 'vitest';
import type { Result } from '../../../src/server/access.ts';
import type { OnboardingView } from '../../../src/server/fn/onboarding.ts';
import {
  aAccountId,
  aBudgetRows,
  aId,
  aLedger,
  as,
  B,
  bAccountId,
  bAccountNames,
  bId,
  type Case,
  count,
  FORBIDDEN,
  idsOf,
  type Name,
  notFoundForB,
  ok,
  onboardingRows,
  services,
  UNAUTHENTICATED,
} from '../harness.ts';

export const cases = {
  // FR-A4 (last: they move B through and out of the onboarding; A, the admin, never started it).
  getOnboarding: {
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const ofB = await as<Result<OnboardingView>>('B', 'getOnboarding');
      if (!ofB.ok) throw new Error(`getOnboarding failed: ${ofB.code}`);
      expect(ofB.value).toMatchObject({
        email: B.email,
        progress: { step: 'profile', completedAt: null },
        signIn: { google: false, password: true },
      });
      expect(ofB.value.accounts.accounts.map((account) => account.id)).toEqual(
        await idsOf('accounts', bId, `status = 'active'`),
      );
    },
  },
  saveOnboardingProfile: {
    input: () => ({
      name: 'Budi S.',
      nickname: 'Budi',
      locale: 'id',
      timezone: 'Asia/Jakarta',
      baseCurrency: 'IDR',
      extraCurrencies: ['USD', 'SGD'],
    }),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      const a = await onboardingRows(aId);
      expect(await as('B', 'saveOnboardingProfile', input)).toMatchObject(ok({ step: 'period' }));
      expect(await onboardingRows(bId)).toMatchObject({
        user: { onboarding_step: 2, base_currency: 'IDR', nickname: 'Budi' },
        extras: [{ extra_currencies: ['USD', 'SGD'] }],
      });
      // B has accounts: another base currency is refused (FR-ST1).
      expect(await as('B', 'saveOnboardingProfile', { ...(input as object), baseCurrency: 'SGD' })).toEqual({
        ok: false,
        code: 'ACCOUNT_LOCKED',
      });
      expect(await onboardingRows(aId)).toEqual(a);
    },
  },
  saveOnboardingPeriod: {
    input: () => ({ day: 1, expectedIncomeMinor: 25_800_000n }),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      const a = { budget: await aBudgetRows(), onboarding: await onboardingRows(aId) };
      expect(await as('B', 'saveOnboardingPeriod', input)).toMatchObject(ok({ step: 'accounts' }));
      const { current } = await services.periods.list(bId);
      expect(await services.budgets.status(bId)).toMatchObject({
        version: { effectiveFrom: current.label, expectedIncomeMinor: 25_800_000n },
      });
      expect({ budget: await aBudgetRows(), onboarding: await onboardingRows(aId) }).toEqual(a);
    },
  },
  saveOnboardingAccounts: {
    input: () => ({
      accounts: [
        {
          id: aAccountId,
          type: 'bank',
          providerName: 'BCA',
          displayName: 'Pwned',
          currency: 'IDR',
          openingBalanceMinor: 1n,
          color: 'blue',
        },
      ],
    }),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      const before = await aLedger();
      await notFoundForB('saveOnboardingAccounts', input);
      const row = { type: 'ewallet', providerName: 'GoPay', currency: 'IDR', color: 'green' };
      expect(
        await as('B', 'saveOnboardingAccounts', {
          accounts: [{ ...row, displayName: 'GoPay B', openingBalanceMinor: 412_000n }],
        }),
      ).toMatchObject(ok({ baseCurrency: 'IDR' }));
      expect(await bAccountNames()).toContain('GoPay B:active');
      expect(await onboardingRows(bId)).toMatchObject({ user: { onboarding_step: 4 } });
      expect(await aLedger()).toEqual(before);
    },
  },
  saveOnboardingGoal: {
    input: () => ({
      preset: 'emergency',
      name: 'Dana Darurat',
      targetMinor: 54_000_000n,
      accountId: aAccountId,
      contribution: null,
    }),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      const a = await onboardingRows(aId);
      // A's account is no account of B's: neither "Simpan di" nor the source of a contribution.
      expect(await as('B', 'saveOnboardingGoal', input)).toEqual({ ok: false, code: 'INVALID_GOAL' });
      expect(
        await as('B', 'saveOnboardingGoal', {
          ...(input as object),
          accountId: bAccountId,
          contribution: { amountMinor: 500_000n, monthDay: 1, fromAccountId: aAccountId },
        }),
      ).toEqual({ ok: false, code: 'INVALID_RECURRENCE' });
      expect(await count('goals', `user_id = '${bId}'`)).toBe(0);
      const gopay = (await idsOf('accounts', bId, `display_name = 'GoPay B'`))[0];
      expect(
        await as('B', 'saveOnboardingGoal', {
          ...(input as object),
          accountId: bAccountId,
          contribution: { amountMinor: 50_000n, monthDay: 1, fromAccountId: gopay },
        }),
      ).toMatchObject(ok({ name: 'Dana Darurat', accountId: bAccountId }));
      const rows = await onboardingRows(bId);
      expect(rows.goals).toHaveLength(1);
      expect(rows.recurrences.at(-1)).toMatchObject({
        template: expect.objectContaining({
          type: 'transfer',
          fromAccountId: gopay,
          toAccountId: bAccountId,
        }) as object,
      });
      expect(await onboardingRows(aId)).toEqual(a);
    },
  },
  skipOnboardingGoal: {
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const a = await onboardingRows(aId);
      expect(await as('B', 'skipOnboardingGoal')).toMatchObject(ok({ step: 'done', completedAt: null }));
      expect(await onboardingRows(aId)).toEqual(a);
    },
  },
  finishOnboarding: {
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const a = await onboardingRows(aId);
      expect(await as('B', 'finishOnboarding')).toMatchObject(
        ok({ step: 'done', completedAt: expect.any(Date) as Date }),
      );
      expect((await onboardingRows(bId)).user?.['onboarding_completed_at']).toBeInstanceOf(Date);
      expect(await onboardingRows(aId)).toEqual(a);
      expect((await onboardingRows(aId)).user?.['onboarding_completed_at']).toBeNull();
      // Completed: the onboarding writes are closed to B.
      expect(await as('B', 'skipOnboardingGoal')).toEqual(FORBIDDEN);
    },
  },
} satisfies Partial<Record<Name, Case>>;
