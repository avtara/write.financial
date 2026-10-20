// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { accountView } from '../../../test/accounts.ts';
import { onboardingView } from '../../../test/onboarding.ts';
import { renderApp } from '../../../test/render.tsx';
import type { OnboardingView } from '../../server/fn/onboarding.ts';
import { GoalStep } from './goal-step.tsx';

const server = vi.hoisted(() => ({ saveOnboardingGoal: vi.fn(), skipOnboardingGoal: vi.fn() }));
vi.mock('../../server/fn/onboarding.ts', () => ({
  ...server,
  GOAL_PRESETS: {
    emergency: { icon: 'shield', color: 'blue' },
    vacation: { icon: 'plane', color: 'violet' },
    house: { icon: 'house', color: 'green' },
  },
}));

const bca = accountView({ displayName: 'BCA Tahapan', isDefaultQuickEntry: true });
const jago = accountView({ displayName: 'Bank Jago' });
const usd = accountView({ displayName: 'Gotrade', currency: 'USD', type: 'investment' });
const card = accountView({ displayName: 'Kartu', type: 'credit_card' });

async function renderStep(overrides: Partial<OnboardingView> = {}) {
  const onSaved = vi.fn();
  const view = onboardingView({
    expectedIncomeMinor: 25_800_000n,
    accounts: { baseCurrency: 'IDR', accounts: [bca, jago, usd], availableMinor: 0n, missingRates: [] },
    ...overrides,
  });
  const result = await renderApp(<GoalStep view={view} onSaved={onSaved} />);
  return { ...result, onSaved };
}

beforeEach(() => {
  server.saveOnboardingGoal.mockResolvedValue({ ok: true, value: {} });
  server.skipOnboardingGoal.mockResolvedValue({ ok: true, value: {} });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('GoalStep', () => {
  it('suggests an emergency fund of 3× spending kept in Bank Jago, with a monthly contribution from BCA', async () => {
    const { screen, onSaved } = await renderStep();
    await expect.element(screen.getByRole('radio', { name: /Dana Darurat/ })).toBeChecked();
    await expect.element(screen.getByText('3× pengeluaran ≈ Rp54.000.000')).toBeVisible();
    await expect.element(screen.getByRole('textbox', { name: 'Target' })).toHaveValue('54.000.000');
    await expect.element(screen.getByRole('combobox', { name: 'Simpan di' })).toHaveValue(jago.id);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Setoran rutin' }));
    await userEvent.fill(screen.getByRole('textbox', { name: 'Jumlah setoran' }), '500.000');
    await expect.element(screen.getByRole('combobox', { name: 'Dari' })).toHaveValue(bca.id);
    // Only accounts in the goal account's currency, not the goal account itself.
    expect(screen.getByRole('combobox', { name: 'Dari' }).element().textContent).not.toMatch(/Gotrade|Bank Jago/);
    await expect.element(screen.getByText('Rp500.000 tiap tgl 1 dari BCA Tahapan', { exact: false })).toBeVisible();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Tanggal' }), '25');
    await userEvent.click(screen.getByRole('button', { name: 'Buat tujuan' }));
    expect(server.saveOnboardingGoal).toHaveBeenCalledWith({
      data: {
        preset: 'emergency',
        name: 'Dana Darurat',
        targetMinor: 54_000_000n,
        accountId: jago.id,
        contribution: { amountMinor: 500_000n, monthDay: 25, fromAccountId: bca.id },
      },
    });
    expect(onSaved).toHaveBeenCalled();
  });

  it('starts the other presets without a target and asks for what a contribution needs', async () => {
    const { screen, onSaved } = await renderStep({ expectedIncomeMinor: null });
    await expect.element(screen.getByText('3× pengeluaran bulanan')).toBeVisible();
    await userEvent.click(screen.getByText('Liburan'));
    await expect.element(screen.getByRole('textbox', { name: 'Target' })).toHaveValue('');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Simpan di' }), '');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Setoran rutin' }));
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Dari' }), '');
    await userEvent.click(screen.getByRole('button', { name: 'Buat tujuan' }));
    await expect.element(screen.getByText('Isi target, misalnya 54.000.000.')).toBeVisible();
    await expect.element(screen.getByText('Pilih rekening tempat tujuan disimpan.')).toBeVisible();
    await expect.element(screen.getByText('Isi jumlah setoran, misalnya 500.000.')).toBeVisible();
    await expect.element(screen.getByText('Pilih rekening asal setoran.')).toBeVisible();
    expect(server.saveOnboardingGoal).not.toHaveBeenCalled();
    // Without the contribution the goal needs only its target.
    await userEvent.click(screen.getByRole('checkbox', { name: 'Setoran rutin' }));
    await userEvent.click(screen.getByText('DP Rumah'));
    await userEvent.fill(screen.getByRole('textbox', { name: 'Target' }), '150.000.000');
    server.saveOnboardingGoal.mockResolvedValueOnce({ ok: false, code: 'INVALID_GOAL' });
    await userEvent.click(screen.getByRole('button', { name: 'Buat tujuan' }));
    expect(server.saveOnboardingGoal).toHaveBeenCalledWith({
      data: { preset: 'house', name: 'DP Rumah', targetMinor: 150_000_000n, accountId: null, contribution: null },
    });
    await expect.element(screen.getByRole('alert')).toBeVisible();
    expect(onSaved).not.toHaveBeenCalled();
    await userEvent.click(screen.getByText('Dana Darurat'));
    await expect.element(screen.getByRole('textbox', { name: 'Target' })).toHaveValue('');
  });

  it('skips with "Lewati"', async () => {
    // Without accounts there is nothing to keep the goal in; the card account is no place for savings.
    const { screen, onSaved } = await renderStep({
      accounts: { baseCurrency: 'IDR', accounts: [card], availableMinor: 0n, missingRates: [] },
    });
    await expect.element(screen.getByRole('combobox', { name: 'Simpan di' })).toHaveValue('');
    await userEvent.click(screen.getByRole('button', { name: 'Lewati' }));
    expect(server.skipOnboardingGoal).toHaveBeenCalledWith();
    expect(onSaved).toHaveBeenCalled();
  });

  it('moves on when the goal exists already', async () => {
    server.skipOnboardingGoal.mockResolvedValueOnce({ ok: false, code: 'FORBIDDEN' });
    const { screen, onSaved } = await renderStep({
      accounts: { baseCurrency: 'IDR', accounts: [], availableMinor: 0n, missingRates: [] },
      goal: {
        id: 'goal',
        name: 'Dana Darurat',
        icon: 'shield',
        color: 'blue',
        targetMinor: 54_000_000n,
        currency: 'IDR',
        deadlineMonth: null,
        tag: 'dana-darurat',
        accountId: null,
        sortOrder: 0,
        archivedAt: null,
      },
    });
    await expect.element(screen.getByText('Tujuan Dana Darurat sudah dibuat.')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Lanjut' }));
    await expect.element(screen.getByRole('alert')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Lanjut' }));
    expect(onSaved).toHaveBeenCalled();
  });
});
