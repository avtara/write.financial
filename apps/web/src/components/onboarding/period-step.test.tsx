// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { onboardingView } from '../../../test/onboarding.ts';
import { renderApp } from '../../../test/render.tsx';
import { PeriodStep } from './period-step.tsx';

const server = vi.hoisted(() => ({ saveOnboardingPeriod: vi.fn() }));
vi.mock('../../server/fn/onboarding.ts', () => server);

afterEach(() => {
  vi.clearAllMocks();
});

async function renderStep(view = onboardingView()) {
  const onSaved = vi.fn();
  const result = await renderApp(<PeriodStep view={view} onSaved={onSaved} />);
  return { ...result, onSaved };
}

describe('PeriodStep', () => {
  it('previews the period of the payday and saves it with the income', async () => {
    server.saveOnboardingPeriod.mockResolvedValue({ ok: true, value: { step: 'accounts' } });
    const { screen, onSaved } = await renderStep();
    await expect.element(screen.getByRole('heading', { name: 'Kapan bulanmu dimulai?' })).toBeVisible();
    await expect.element(screen.getByRole('radio', { name: 'Tanggal 1' })).toBeChecked();
    await expect.element(screen.getByText('Dipakai sebagai awal periode bulanan · Okt 2026 = 1–31 Okt')).toBeVisible();
    await userEvent.click(screen.getByText('25', { exact: true }));
    await expect.element(screen.getByRole('radio', { name: 'Tanggal 25' })).toBeChecked();
    await expect
      .element(screen.getByText('Dipakai sebagai awal periode bulanan · Okt 2026 = 25 Sep – 24 Okt'))
      .toBeVisible();
    await userEvent.fill(screen.getByRole('textbox', { name: 'Pemasukan bulanan rata-rata' }), '25.800.000');
    await userEvent.click(screen.getByRole('button', { name: 'Lanjut' }));
    expect(server.saveOnboardingPeriod).toHaveBeenCalledWith({ data: { day: 25, expectedIncomeMinor: 25_800_000n } });
    expect(onSaved).toHaveBeenCalled();
  });

  it('takes any day 1–28 from "Pilih 1–28…", starting from the saved one, and links back', async () => {
    server.saveOnboardingPeriod.mockResolvedValue({ ok: false, code: 'INVALID_PERIOD' });
    const { screen, onSaved } = await renderStep(
      onboardingView({ startDay: 14 as never, expectedIncomeMinor: 10_000_000n }),
    );
    await expect.element(screen.getByText('Tanggal 14', { exact: true }).first()).toBeVisible();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Pilih tanggal lain (1–28)' }), '7');
    await expect.element(screen.getByText('Nov 2026 = 7 Okt – 6 Nov', { exact: false })).toBeVisible();
    await expect.element(screen.getByRole('link', { name: 'Kembali' })).toHaveAttribute('href', '/onboarding/profile');
    await userEvent.click(screen.getByRole('button', { name: 'Lanjut' }));
    expect(server.saveOnboardingPeriod).toHaveBeenCalledWith({ data: { day: 7, expectedIncomeMinor: 10_000_000n } });
    await expect.element(screen.getByRole('alert')).toBeVisible();
    expect(onSaved).not.toHaveBeenCalled();
  });
});
