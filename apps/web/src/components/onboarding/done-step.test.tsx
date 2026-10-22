// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { accountView } from '../../../test/accounts.ts';
import { onboardingView } from '../../../test/onboarding.ts';
import { renderApp } from '../../../test/render.tsx';
import type { OnboardingView } from '../../server/fn/onboarding.ts';
import { DoneStep } from './done-step.tsx';

const server = vi.hoisted(() => ({ finishOnboarding: vi.fn() }));
vi.mock('../../server/fn/onboarding.ts', () => server);

const jago = accountView({ displayName: 'Bank Jago', balanceMinor: 8_125_000n });
const GOAL: NonNullable<OnboardingView['goal']> = {
  id: 'goal',
  name: 'Dana Darurat',
  icon: 'shield',
  color: 'blue',
  targetMinor: 54_000_000n,
  currency: 'IDR',
  deadlineMonth: null,
  tag: 'dana-darurat',
  accountId: jago.id,
  sortOrder: 0,
  archivedAt: null,
  kind: 'savings',
  targetMode: 'fixed',
  targetMonths: null,
  status: 'active',
  completedAt: null,
  sources: [],
  assetSources: [],
  savedMinor: 0n,
  plans: [],
  monthlyPlanMinor: 0n,
};

async function renderStep(overrides: Partial<OnboardingView> = {}) {
  const onFinished = vi.fn();
  const view = onboardingView({
    progress: { step: 'done', completedAt: null, baseCurrency: 'IDR' },
    extraCurrencies: ['USD', 'SGD'],
    accounts: {
      baseCurrency: 'IDR',
      accounts: [accountView(), jago, accountView(), accountView({ status: 'archived' })],
      availableMinor: 51_347_000n,
      missingRates: [],
    },
    goal: GOAL,
    ...overrides,
  });
  const result = await renderApp(<DoneStep view={view} onFinished={onFinished} />);
  return { ...result, onFinished };
}

beforeEach(() => {
  server.finishOnboarding.mockResolvedValue({ ok: true, value: {} });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('DoneStep', () => {
  it('sums up what was set up and completes the onboarding with "Ke Ringkasan"', async () => {
    const { screen, onFinished } = await renderStep({ signIn: { google: true, password: true } });
    const summary = screen.getByRole('list', { name: 'Yang sudah diatur' });
    await expect.element(summary.getByText('Profil · IDR + USD, SGD')).toBeVisible();
    await expect.element(summary.getByText('email terverifikasi · Google')).toBeVisible();
    await expect.element(summary.getByText('Periode bulanan mulai tgl 1')).toBeVisible();
    await expect.element(summary.getByText('Okt = 1–31 Okt')).toBeVisible();
    await expect.element(summary.getByText('3 rekening · saldo tersedia')).toBeVisible();
    await expect.element(summary.getByText('Rp51.347.000')).toBeVisible();
    await expect.element(summary.getByText('Dana Darurat · Bank Jago')).toBeVisible();
    await expect.element(summary.getByText('Rp8.125.000')).toBeVisible();
    await expect.element(summary.getByText('54.000.000')).toBeVisible();
    // A password exists: no "Kata sandi" card.
    expect(summary.getByText('Kata sandi (opsional)').query()).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Ke Ringkasan' }));
    expect(server.finishOnboarding).toHaveBeenCalledWith();
    expect(onFinished).toHaveBeenCalledWith('overview');
  });

  it('offers a password to Google-only accounts, and shows a goal without its account', async () => {
    const { screen, onFinished } = await renderStep({
      signIn: { google: true, password: false },
      extraCurrencies: [],
      goal: { ...GOAL, accountId: null },
    });
    await expect.element(screen.getByText('Profil · IDR')).toBeVisible();
    await expect.element(screen.getByText('Dana Darurat', { exact: true })).toBeVisible();
    await expect.element(screen.getByText('masuk tanpa Google')).toBeVisible();
    server.finishOnboarding.mockResolvedValueOnce({ ok: false, code: 'FORBIDDEN' });
    await userEvent.click(screen.getByRole('button', { name: 'Atur sekarang' }));
    await expect.element(screen.getByRole('alert')).toBeVisible();
    expect(onFinished).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Atur sekarang' }));
    expect(onFinished).toHaveBeenCalledWith('password');
  });

  it('shows the email of an email account and leaves out a skipped goal', async () => {
    const { screen } = await renderStep({ goal: null });
    await expect.element(screen.getByText('avtara.k@gmail.com')).toBeVisible();
    expect(screen.getByText(/Dana Darurat/).query()).toBeNull();
  });
});
