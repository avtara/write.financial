// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeSession } from '../../../test/fixtures.ts';
import { call, requestContext, validatorOf } from '../../../test/server-fn.ts';
import {
  finishOnboarding,
  getOnboarding,
  saveOnboardingAccounts,
  saveOnboardingGoal,
  saveOnboardingPeriod,
  saveOnboardingProfile,
  skipOnboardingGoal,
} from './onboarding.ts';

const BCA = '0192a6c0-0000-7000-8000-0000000000b1';
const JAGO = '0192a6c0-0000-7000-8000-0000000000b2';
const USD = '0192a6c0-0000-7000-8000-0000000000b3';

interface SavedAccount {
  readonly id: string;
  readonly displayName: string;
  readonly openingBalanceMinor: bigint;
  readonly currency: string;
}

const fake = vi.hoisted(() => {
  const progress = (step: string) => Promise.resolve({ step, completedAt: null, baseCurrency: 'IDR' });
  const account = (id: string, displayName: string, openingBalanceMinor: bigint, currency = 'IDR'): SavedAccount => ({
    id,
    displayName,
    openingBalanceMinor,
    currency,
  });
  return {
    progress,
    ledgerError: (code: string) => Object.assign(new Error(code), { code }),
    saved: [] as SavedAccount[],
    account,
    goals: [] as { id: string; name: string; tag: string | null; archivedAt: Date | null }[],
    providers: [{ providerId: 'google' }],
    onboarding: {
      progress: vi.fn(() => progress('profile')),
      completeStep: vi.fn((_: string, step: string) => progress(`after ${step}`)),
      finish: vi.fn(() => Promise.resolve({ step: 'done', completedAt: new Date(0), baseCurrency: 'IDR' })),
      setBaseCurrency: vi.fn(() => progress('profile')),
    },
    profiles: {
      get: vi.fn(() =>
        Promise.resolve({ name: 'Avtara K.', nickname: 'Avtara', locale: 'id', timezone: 'Asia/Jakarta' }),
      ),
      update: vi.fn(() => Promise.resolve({})),
    },
    preferences: {
      get: vi.fn(() => Promise.resolve({ extraCurrencies: ['USD'] })),
      update: vi.fn(() => Promise.resolve({})),
    },
    periods: {
      list: vi.fn(() => Promise.resolve({ startDay: 1, current: { label: '2026-10' } })),
      changeStartDay: vi.fn(() => Promise.resolve({})),
    },
    budgets: {
      status: vi.fn((): Promise<{ version: object | null }> =>
        Promise.resolve({ version: { expectedIncomeMinor: 25_800_000n } }),
      ),
      saveVersion: vi.fn(() => Promise.resolve({})),
    },
    accounts: {
      list: vi.fn(() => Promise.resolve({ baseCurrency: 'IDR', accounts: fake.saved, availableMinor: 0n })),
      create: vi.fn(() => Promise.resolve({})),
      update: vi.fn(() => Promise.resolve({})),
    },
    goalsRepo: {
      list: vi.fn(() => Promise.resolve(fake.goals)),
      create: vi.fn((_: string, input: { name: string; tag: string | null }) =>
        Promise.resolve({ id: 'goal', name: input.name, tag: input.tag === null ? null : 'dana-darurat' }),
      ),
    },
    schedules: { createRecurrence: vi.fn(() => Promise.resolve({})) },
    listUserAccounts: vi.fn(() => Promise.resolve(fake.providers)),
  };
});

// vi.mock factories run before imports; they load the shared helper themselves.
vi.mock('@tanstack/react-start', async () => (await import('../../../test/server-fn.ts')).serverFnModule());
vi.mock('../runtime.ts', () => ({
  services: () =>
    Promise.resolve({
      onboarding: fake.onboarding,
      profiles: fake.profiles,
      preferences: fake.preferences,
      periods: fake.periods,
      budgets: fake.budgets,
      accounts: fake.accounts,
      goals: fake.goalsRepo,
      schedules: fake.schedules,
      auth: { api: { listUserAccounts: fake.listUserAccounts } },
      // 15 Okt 2026 16.42 WIB.
      now: () => new Date('2026-10-15T09:42:00Z'),
    }),
}));

const onboarding = () => fakeSession({ onboarded: false });
const USER_ID = onboarding().user.id;
const signedIn = () => requestContext(onboarding());

beforeEach(() => {
  vi.clearAllMocks();
  fake.saved = [];
  fake.goals = [];
  fake.providers = [{ providerId: 'google' }];
});

describe('getOnboarding', () => {
  it('reads every step in one go, with the sign-in methods and today in the user time zone', async () => {
    const headers = new Headers({ cookie: 'session' });
    fake.goals = [
      { id: 'old', name: 'Lama', tag: null, archivedAt: new Date(0) },
      { id: 'goal', name: 'Dana Darurat', tag: 'dana-darurat', archivedAt: null },
    ];
    const result = await call(getOnboarding, { context: requestContext(onboarding(), 'id', headers) });
    expect(result).toEqual({
      ok: true,
      value: {
        progress: { step: 'profile', completedAt: null, baseCurrency: 'IDR' },
        profile: { name: 'Avtara K.', nickname: 'Avtara', locale: 'id', timezone: 'Asia/Jakarta' },
        email: 'avtara@example.test',
        emailVerified: true,
        signIn: { google: true, password: false },
        extraCurrencies: ['USD'],
        today: '2026-10-15',
        startDay: 1,
        period: { label: '2026-10' },
        expectedIncomeMinor: 25_800_000n,
        accounts: { baseCurrency: 'IDR', accounts: [], availableMinor: 0n },
        goal: { id: 'goal', name: 'Dana Darurat', tag: 'dana-darurat', archivedAt: null },
      },
    });
    expect(fake.listUserAccounts).toHaveBeenCalledWith({ headers });
  });

  it('works without a budget version, a goal, Google, or a verified email', async () => {
    fake.providers = [{ providerId: 'credential' }];
    fake.budgets.status.mockResolvedValueOnce({ version: null });
    const session = onboarding();
    const result = await call(getOnboarding, {
      context: requestContext({ ...session, user: { ...session.user, emailVerified: false, timezone: undefined } }),
    });
    expect(result).toMatchObject({
      ok: true,
      value: {
        signIn: { google: false, password: true },
        emailVerified: false,
        expectedIncomeMinor: null,
        goal: null,
        today: '2026-10-15',
      },
    });
  });

  it('refuses signed-out visitors', async () => {
    expect(await call(getOnboarding, { context: requestContext(null) })).toEqual({
      ok: false,
      code: 'UNAUTHENTICATED',
    });
  });
});

describe('step writes', () => {
  it('saves the profile, the base currency, and the additional currencies (without the base, once each)', async () => {
    const data = {
      name: 'Avtara K.',
      nickname: 'Avtara',
      locale: 'id',
      timezone: 'Asia/Jakarta',
      baseCurrency: 'IDR',
      extraCurrencies: ['USD', 'SGD', 'USD', 'IDR'],
    };
    expect(await call(saveOnboardingProfile, { context: signedIn(), data })).toEqual({
      ok: true,
      value: { step: 'after profile', completedAt: null, baseCurrency: 'IDR' },
    });
    expect(fake.profiles.update).toHaveBeenCalledWith(USER_ID, {
      name: 'Avtara K.',
      nickname: 'Avtara',
      locale: 'id',
      timezone: 'Asia/Jakarta',
    });
    expect(fake.onboarding.setBaseCurrency).toHaveBeenCalledWith(USER_ID, 'IDR');
    expect(fake.preferences.update).toHaveBeenCalledWith(USER_ID, { extraCurrencies: ['USD', 'SGD'] });
    expect(fake.onboarding.completeStep).toHaveBeenCalledWith(USER_ID, 'profile');
    const validator = validatorOf(saveOnboardingProfile);
    expect(validator.safeParse({ ...data, baseCurrency: 'idr' }).success).toBe(false);
    expect(validator.safeParse({ ...data, extraCurrencies: Array.from({ length: 21 }, () => 'USD') }).success).toBe(
      false,
    );
  });

  it('refuses every write once the onboarding is completed', async () => {
    const done = requestContext(fakeSession());
    expect(await call(skipOnboardingGoal, { context: done })).toEqual({ ok: false, code: 'FORBIDDEN' });
    expect(await call(finishOnboarding, { context: done })).toEqual({ ok: false, code: 'FORBIDDEN' });
    expect(fake.onboarding.completeStep).not.toHaveBeenCalled();
    expect(fake.onboarding.finish).not.toHaveBeenCalled();
  });

  it('sets the payday as the period start day (recalculating the current period) and the expected income', async () => {
    fake.periods.list
      .mockResolvedValueOnce({ startDay: 1, current: { label: '2026-10' } })
      .mockResolvedValueOnce({ startDay: 25, current: { label: '2026-11' } });
    expect(
      await call(saveOnboardingPeriod, { context: signedIn(), data: { day: 25, expectedIncomeMinor: 25_800_000n } }),
    ).toMatchObject({ ok: true, value: { step: 'after period' } });
    expect(fake.periods.changeStartDay).toHaveBeenCalledWith(USER_ID, {
      day: 25,
      apply: 'recalculate',
      mode: 'fixed_day',
    });
    expect(fake.budgets.saveVersion).toHaveBeenCalledWith(USER_ID, {
      effectiveFrom: '2026-11',
      expectedIncomeMinor: 25_800_000n,
    });
  });

  it('keeps the start day when the payday is the one in use', async () => {
    await call(saveOnboardingPeriod, { context: signedIn(), data: { day: 1, expectedIncomeMinor: null } });
    expect(fake.periods.changeStartDay).not.toHaveBeenCalled();
    expect(fake.budgets.saveVersion).toHaveBeenCalledWith(USER_ID, {
      effectiveFrom: '2026-10',
      expectedIncomeMinor: null,
    });
    expect(validatorOf(saveOnboardingPeriod).safeParse({ day: 29, expectedIncomeMinor: null }).success).toBe(false);
    // Without an income and without a budget there is no version to write.
    fake.budgets.status.mockResolvedValueOnce({ version: null });
    fake.budgets.saveVersion.mockClear();
    expect(
      await call(saveOnboardingPeriod, { context: signedIn(), data: { day: 1, expectedIncomeMinor: null } }),
    ).toMatchObject({ ok: true });
    expect(fake.budgets.saveVersion).not.toHaveBeenCalled();
  });

  it('creates new account rows dated today and changes only what changed on saved ones', async () => {
    fake.saved = [fake.account(BCA, 'BCA', 0n), fake.account(JAGO, 'Bank Jago', 8_125_000n)];
    const row = { type: 'bank', providerName: 'BCA', currency: 'IDR', color: 'blue' };
    const result = await call(saveOnboardingAccounts, {
      context: signedIn(),
      data: {
        accounts: [
          { ...row, id: BCA, displayName: 'BCA Tahapan', openingBalanceMinor: 42_810_000n },
          { ...row, id: JAGO, providerName: 'Bank Jago', displayName: 'Bank Jago', openingBalanceMinor: 8_125_000n },
          { ...row, type: 'ewallet', providerName: 'GoPay', displayName: 'GoPay', openingBalanceMinor: 412_000n },
        ],
      },
    });
    expect(result).toMatchObject({ ok: true, value: { baseCurrency: 'IDR' } });
    expect(fake.accounts.update).toHaveBeenCalledTimes(1);
    expect(fake.accounts.update).toHaveBeenCalledWith(USER_ID, BCA, {
      displayName: 'BCA Tahapan',
      openingBalanceMinor: 42_810_000n,
    });
    expect(fake.accounts.create).toHaveBeenCalledWith(USER_ID, {
      type: 'ewallet',
      providerName: 'GoPay',
      displayName: 'GoPay',
      currency: 'IDR',
      openingBalanceMinor: 412_000n,
      color: 'blue',
      openingDate: '2026-10-15',
    });
    expect(fake.onboarding.completeStep).toHaveBeenCalledWith(USER_ID, 'accounts');
  });

  it('changes a saved account name or balance alone, and refuses an unknown account', async () => {
    fake.saved = [fake.account(BCA, 'BCA', 0n)];
    const row = { id: BCA, type: 'bank', providerName: 'BCA', currency: 'IDR', color: 'blue' };
    await call(saveOnboardingAccounts, {
      context: signedIn(),
      data: { accounts: [{ ...row, displayName: 'BCA', openingBalanceMinor: 5n }] },
    });
    expect(fake.accounts.update).toHaveBeenLastCalledWith(USER_ID, BCA, { openingBalanceMinor: 5n });
    expect(
      await call(saveOnboardingAccounts, {
        context: signedIn(),
        data: { accounts: [{ ...row, id: JAGO, displayName: 'Jago', openingBalanceMinor: 0n }] },
      }),
    ).toEqual({ ok: false, code: 'NOT_FOUND' });
    // Only the first call completed the step.
    expect(fake.onboarding.completeStep).toHaveBeenCalledTimes(1);
    expect(
      validatorOf(saveOnboardingAccounts).safeParse({
        accounts: [{ ...row, displayName: ' ', openingBalanceMinor: 0n }],
      }).success,
    ).toBe(false);
  });
});

describe('saveOnboardingGoal', () => {
  const goal = {
    preset: 'emergency',
    name: 'Dana Darurat',
    targetMinor: 54_000_000n,
    accountId: JAGO,
    contribution: { amountMinor: 500_000n, monthDay: 1, fromAccountId: BCA },
  };

  it('creates the goal in the base currency, tagged with its name, and its monthly contribution for review', async () => {
    fake.saved = [fake.account(BCA, 'BCA Tahapan', 0n), fake.account(JAGO, 'Bank Jago', 0n)];
    expect(await call(saveOnboardingGoal, { context: signedIn(), data: goal })).toEqual({
      ok: true,
      value: { id: 'goal', name: 'Dana Darurat', tag: 'dana-darurat' },
    });
    expect(fake.goalsRepo.create).toHaveBeenCalledWith(USER_ID, {
      icon: 'shield',
      color: 'blue',
      name: 'Dana Darurat',
      targetMinor: 54_000_000n,
      currency: 'IDR',
      deadlineMonth: null,
      tag: 'Dana Darurat',
      accountId: JAGO,
    });
    expect(fake.schedules.createRecurrence).toHaveBeenCalledWith(USER_ID, {
      template: {
        type: 'transfer',
        fromAccountId: BCA,
        toAccountId: JAGO,
        sentMinor: 500_000n,
        receivedMinor: 500_000n,
        description: 'Dana Darurat',
        tags: ['dana-darurat'],
      },
      freq: 'monthly',
      monthDay: 1,
      startOn: '2026-10-15',
      end: { type: 'never' },
      remindOffsetDays: null,
    });
    expect(fake.onboarding.completeStep).toHaveBeenCalledWith(USER_ID, 'goal');
  });

  it('creates a goal without a contribution, account, or tag', async () => {
    fake.goalsRepo.create.mockResolvedValueOnce({ id: 'goal', name: 'Liburan', tag: null });
    await call(saveOnboardingGoal, {
      context: signedIn(),
      data: { ...goal, preset: 'vacation', name: 'Liburan', accountId: null, contribution: null },
    });
    expect(fake.goalsRepo.create).toHaveBeenCalledWith(
      USER_ID,
      expect.objectContaining({ icon: 'plane', accountId: null }),
    );
    expect(fake.schedules.createRecurrence).not.toHaveBeenCalled();
  });

  it('tags the contribution with nothing when the goal has no tag', async () => {
    fake.saved = [fake.account(BCA, 'BCA', 0n), fake.account(JAGO, 'Jago', 0n)];
    fake.goalsRepo.create.mockResolvedValueOnce({ id: 'goal', name: 'DP Rumah', tag: null });
    await call(saveOnboardingGoal, { context: signedIn(), data: { ...goal, preset: 'house', name: 'DP Rumah' } });
    expect(fake.schedules.createRecurrence).toHaveBeenCalledWith(
      USER_ID,
      expect.objectContaining({ template: expect.objectContaining({ tags: [] }) as object }),
    );
  });

  it('refuses a contribution between currencies, or without the goal account', async () => {
    fake.saved = [fake.account(USD, 'Gotrade', 0n, 'USD'), fake.account(JAGO, 'Jago', 0n)];
    expect(
      await call(saveOnboardingGoal, {
        context: signedIn(),
        data: { ...goal, contribution: { ...goal.contribution, fromAccountId: USD } },
      }),
    ).toEqual({ ok: false, code: 'INVALID_RECURRENCE' });
    // Another user's (or an unknown) account is no account of this user either.
    expect(
      await call(saveOnboardingGoal, {
        context: signedIn(),
        data: { ...goal, contribution: { ...goal.contribution, fromAccountId: BCA } },
      }),
    ).toEqual({ ok: false, code: 'INVALID_RECURRENCE' });
    expect(fake.goalsRepo.create).not.toHaveBeenCalled();
    expect(fake.schedules.createRecurrence).not.toHaveBeenCalled();
    expect(validatorOf(saveOnboardingGoal).safeParse({ ...goal, accountId: null }).success).toBe(false);
    expect(validatorOf(saveOnboardingGoal).safeParse({ ...goal, preset: 'car' }).success).toBe(false);
  });

  it('creates one goal only: a repeated request moves on with the existing one', async () => {
    fake.goals = [{ id: 'first', name: 'Dana Darurat', tag: 'dana-darurat', archivedAt: null }];
    expect(await call(saveOnboardingGoal, { context: signedIn(), data: goal })).toMatchObject({
      ok: true,
      value: { id: 'first' },
    });
    expect(fake.goalsRepo.create).not.toHaveBeenCalled();
    expect(fake.onboarding.completeStep).toHaveBeenCalledWith(USER_ID, 'goal');
  });
});

describe('skip and finish', () => {
  it('skips the goal step and completes the onboarding', async () => {
    expect(await call(skipOnboardingGoal, { context: signedIn() })).toMatchObject({
      ok: true,
      value: { step: 'after goal' },
    });
    expect(fake.onboarding.completeStep).toHaveBeenCalledWith(USER_ID, 'goal');
    expect(await call(finishOnboarding, { context: signedIn() })).toMatchObject({ ok: true, value: { step: 'done' } });
    expect(fake.onboarding.finish).toHaveBeenCalledWith(USER_ID);
  });
});
