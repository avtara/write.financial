// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { userEvent } from 'vitest/browser';
import { accountView } from '../../../test/accounts.ts';
import { onboardingView } from '../../../test/onboarding.ts';
import { DEFAULT_PREFERENCES, renderApp } from '../../../test/render.tsx';
import type { OnboardingView } from '../../server/fn/onboarding.ts';
import { PreferencesProvider } from '../preferences.tsx';
import { ProfileStep } from './profile-step.tsx';

const server = vi.hoisted(() => ({
  saveOnboardingProfile: vi.fn(),
  getReferenceRate: vi.fn(),
}));
vi.mock('../../server/fn/onboarding.ts', () => ({
  MAX_EXTRA_CURRENCIES: 3,
  saveOnboardingProfile: server.saveOnboardingProfile,
}));
vi.mock('../../server/fn/ledger.ts', () => ({ getReferenceRate: server.getReferenceRate }));

const rate = (base: string, value: string, provider = 'frankfurter') => ({
  ok: true,
  value: { base, quote: 'IDR', rate: value, provider, rateType: 'bi_transaction', asOf: '2026-10-15' },
});

async function renderStep(view: OnboardingView = onboardingView()) {
  const onSaved = vi.fn();
  const result = await renderApp(<ProfileStep view={view} onSaved={onSaved} />);
  return { ...result, onSaved };
}

beforeEach(() => {
  server.saveOnboardingProfile.mockResolvedValue({ ok: true, value: { step: 'period' } });
  server.getReferenceRate.mockImplementation(({ data }: { data: { base: string } }) =>
    Promise.resolve(
      data.base === 'USD'
        ? rate('USD', '16350', 'open-er-api')
        : data.base === 'EUR'
          ? { ok: false, code: 'INTERNAL' }
          : { ok: true, value: null },
    ),
  );
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('ProfileStep', () => {
  it('shows a Google account prefilled, with the greeting preview, and saves the profile', async () => {
    const { screen, onSaved } = await renderStep(
      onboardingView({ signIn: { google: true, password: false }, extraCurrencies: ['USD'] }),
    );
    await expect.element(screen.getByRole('heading', { name: 'Halo, Avtara! Lengkapi profilmu' })).toBeVisible();
    await expect
      .element(screen.getByText('Diisi dari akun Google — cek dan sesuaikan.', { exact: false }))
      .toBeVisible();
    await expect.element(screen.getByText('Email terverifikasi otomatis')).toBeVisible();
    await expect.element(screen.getByText('dari Google')).toBeVisible();
    // The preferred name is suggested from the full name.
    await expect.element(screen.getByRole('textbox', { name: 'Nama sapaan' })).toHaveValue('Avtara');
    await userEvent.fill(screen.getByRole('textbox', { name: 'Nama sapaan' }), 'Tara');
    await expect.element(screen.getByText('“Selamat sore, Tara”')).toBeVisible();
    // Today's rate, with the attribution ExchangeRate-API requires.
    await expect
      .element(screen.getByRole('region', { name: 'Kurs acuan hari ini' }).getByText('Rp16.350'))
      .toBeVisible();
    await expect.element(screen.getByText('Rates By Exchange Rate API')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Lanjut' }));
    expect(server.saveOnboardingProfile).toHaveBeenCalledWith({
      data: {
        name: 'Avtara K.',
        nickname: 'Tara',
        locale: 'id',
        timezone: expect.any(String) as string,
        baseCurrency: 'IDR',
        extraCurrencies: ['USD'],
      },
    });
    expect(onSaved).toHaveBeenCalled();
  });

  it('asks for a name, and keeps an empty preferred name empty', async () => {
    const { screen } = await renderStep(onboardingView({ profile: { ...onboardingView().profile, nickname: 'Av' } }));
    await expect.element(screen.getByText('Masuk dengan email & kata sandi')).toBeVisible();
    expect(screen.getByText('Email terverifikasi otomatis').query()).toBeNull();
    await userEvent.fill(screen.getByRole('textbox', { name: 'Nama lengkap' }), '  ');
    await userEvent.click(screen.getByRole('button', { name: 'Lanjut' }));
    await expect.element(screen.getByText('Wajib diisi.')).toBeVisible();
    expect(server.saveOnboardingProfile).not.toHaveBeenCalled();
    await userEvent.fill(screen.getByRole('textbox', { name: 'Nama lengkap' }), 'Budi Santoso');
    await userEvent.fill(screen.getByRole('textbox', { name: 'Nama sapaan' }), '');
    await userEvent.click(screen.getByRole('button', { name: 'Lanjut' }));
    expect(server.saveOnboardingProfile).toHaveBeenCalledWith({
      data: expect.objectContaining({ name: 'Budi Santoso', nickname: null }) as object,
    });
  });

  it('adds and removes additional currencies, never the base one, up to the limit', async () => {
    const { screen } = await renderStep(onboardingView({ profile: { ...onboardingView().profile, timezone: 'UTC' } }));
    const add = screen.getByRole('combobox', { name: 'Tambah mata uang' });
    await userEvent.selectOptions(add, 'USD');
    await userEvent.selectOptions(add, 'SGD');
    await expect.element(screen.getByText('belum ada kurs')).toBeVisible();
    expect(add.element().querySelector('option[value="IDR"]')).toBeNull();
    await userEvent.selectOptions(add, 'EUR');
    // At the limit (3 here) there is nothing to add.
    expect(screen.getByRole('combobox', { name: 'Tambah mata uang' }).query()).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Hapus SGD' }));
    // A new base currency leaves the additional ones.
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Mata uang utama' }), 'EUR');
    // The device's time zone is offered on the first visit; picking one keeps it.
    await expect.element(screen.getByText('dari perangkat')).toBeVisible();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Zona waktu' }), 'Asia/Makassar');
    expect(screen.getByText('dari perangkat').query()).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Lanjut' }));
    expect(server.saveOnboardingProfile).toHaveBeenCalledWith({
      data: expect.objectContaining({
        baseCurrency: 'EUR',
        extraCurrencies: ['USD'],
        timezone: 'Asia/Makassar',
      }) as object,
    });
  });

  it('shows the rate while it loads', async () => {
    server.getReferenceRate.mockReturnValue(Promise.withResolvers().promise);
    // A stored code outside the offered list keeps its code as the name.
    const { screen } = await renderStep(onboardingView({ extraCurrencies: ['XAU'] }));
    await expect.element(screen.getByText('memuat…')).toBeVisible();
    await expect.element(screen.getByText('XAU').last()).toBeVisible();
  });

  it('keeps the base currency once an account exists, and explains refusals', async () => {
    const { screen } = await renderStep(
      onboardingView({
        progress: { step: 'accounts', completedAt: null, baseCurrency: 'IDR' },
        // A zone the runtime does not list stays selectable.
        profile: { ...onboardingView().profile, timezone: 'UTC' },
        accounts: { baseCurrency: 'IDR', accounts: [accountView()], availableMinor: 0n, missingRates: [] },
      }),
    );
    await expect.element(screen.getByRole('combobox', { name: 'Mata uang utama' })).toBeDisabled();
    await expect.element(screen.getByRole('combobox', { name: 'Zona waktu' })).toHaveValue('UTC');
    expect(screen.getByText('dari perangkat').query()).toBeNull();
    await expect
      .element(screen.getByText('Sudah ada rekening — mata uang utama tidak bisa diubah lagi.'))
      .toBeVisible();
    server.saveOnboardingProfile.mockResolvedValueOnce({ ok: false, code: 'ACCOUNT_LOCKED' });
    await userEvent.click(screen.getByRole('button', { name: 'Lanjut' }));
    const locked = screen.getByText('Sudah ada rekening — mata uang utama tidak bisa diubah lagi.');
    // The hint and the form error.
    await expect.poll(() => locked.elements().length).toBe(2);
    server.saveOnboardingProfile.mockResolvedValueOnce({ ok: false, code: 'INVALID_PROFILE' });
    await userEvent.click(screen.getByRole('button', { name: 'Lanjut' }));
    await expect.poll(() => locked.elements().length).toBe(1);
    await expect.element(screen.getByRole('alert')).toBeVisible();
  });

  it('renders on the server without the device time zone', () => {
    const html = renderToString(
      <PreferencesProvider initial={DEFAULT_PREFERENCES}>
        <ProfileStep
          view={onboardingView({ profile: { ...onboardingView().profile, timezone: 'UTC' } })}
          onSaved={vi.fn()}
        />
      </PreferencesProvider>,
    );
    expect(html).toContain('Halo, Avtara!');
    expect(html).not.toContain('dari perangkat');
  });

  it('switches the language at once', async () => {
    const { screen } = await renderStep();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Bahasa' }).last(), 'en');
    await expect.element(screen.getByRole('heading', { name: 'Hi, Avtara! Complete your profile' })).toBeVisible();
  });
});
