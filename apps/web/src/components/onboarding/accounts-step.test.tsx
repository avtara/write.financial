// SPDX-License-Identifier: AGPL-3.0-only
import type { AccountView } from '@wf/db/accounts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { accountView } from '../../../test/accounts.ts';
import { onboardingView } from '../../../test/onboarding.ts';
import { renderApp } from '../../../test/render.tsx';
import { AccountsStep } from './accounts-step.tsx';

const server = vi.hoisted(() => ({
  saveOnboardingAccounts: vi.fn(),
  archiveAccount: vi.fn(),
  deleteAccount: vi.fn(),
  createAccount: vi.fn(),
  updateAccount: vi.fn(),
  setAccountLogo: vi.fn(),
  removeAccountLogo: vi.fn(),
}));
vi.mock('../../server/fn/onboarding.ts', () => ({ saveOnboardingAccounts: server.saveOnboardingAccounts }));
vi.mock('../../server/fn/accounts.ts', () => ({
  archiveAccount: server.archiveAccount,
  deleteAccount: server.deleteAccount,
  createAccount: server.createAccount,
  updateAccount: server.updateAccount,
  setAccountLogo: server.setAccountLogo,
  removeAccountLogo: server.removeAccountLogo,
}));

async function renderStep(accounts: AccountView[] = []) {
  const onSaved = vi.fn();
  const view = onboardingView({ accounts: { baseCurrency: 'IDR', accounts, availableMinor: 0n, missingRates: [] } });
  const result = await renderApp(<AccountsStep view={view} onSaved={onSaved} />);
  return { ...result, onSaved };
}

beforeEach(async () => {
  // The account dialog is 560 px wide.
  await page.viewport(1280, 900);
  server.saveOnboardingAccounts.mockResolvedValue({ ok: true, value: {} });
  server.archiveAccount.mockResolvedValue({ ok: true, value: {} });
  server.deleteAccount.mockResolvedValue({ ok: true, value: { deletedTransactions: 0 } });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('AccountsStep', () => {
  it('adds the design accounts from the chips with the keyboard, totals them, and saves them', async () => {
    const { screen, onSaved } = await renderStep();
    await expect.element(screen.getByText('Belum ada rekening — tambah dari pilihan di bawah.')).toBeVisible();
    for (const [chip, name, balance] of [
      ['BCA', 'BCA Tahapan', '42810000'],
      ['Bank Jago', null, '8125000'],
      ['GoPay', null, '412000'],
    ] as const) {
      screen
        .getByRole('button', { name: `Tambah ${chip}` })
        .element()
        .focus();
      await userEvent.keyboard('{Enter}');
      // The new row's name has the focus, selected.
      await expect.element(screen.getByRole('textbox', { name: 'Nama rekening' }).last()).toHaveFocus();
      if (name !== null) await userEvent.keyboard(name);
      await userEvent.keyboard('{Tab}');
      await userEvent.keyboard(balance);
    }
    await userEvent.keyboard('{Tab}');
    await expect.element(screen.getByText('Rp51.347.000')).toBeVisible();
    // The chips move on to the next providers.
    await expect.element(screen.getByRole('button', { name: 'Tambah Mandiri' })).toBeVisible();
    await expect.element(screen.getByRole('button', { name: 'Tambah OVO' })).toBeVisible();
    await expect.element(screen.getByRole('button', { name: 'Tambah Tunai' })).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Lanjut' }));
    expect(server.saveOnboardingAccounts).toHaveBeenCalledWith({
      data: {
        accounts: [
          {
            type: 'bank',
            providerName: 'BCA',
            displayName: 'BCA Tahapan',
            currency: 'IDR',
            openingBalanceMinor: 42_810_000n,
            color: 'blue',
          },
          {
            type: 'bank',
            providerName: 'Bank Jago',
            displayName: 'Bank Jago',
            currency: 'IDR',
            openingBalanceMinor: 8_125_000n,
            color: 'orange',
          },
          {
            type: 'ewallet',
            providerName: 'GoPay',
            displayName: 'GoPay',
            currency: 'IDR',
            openingBalanceMinor: 412_000n,
            color: 'green',
          },
        ],
      },
    });
    expect(onSaved).toHaveBeenCalled();
  });

  it('asks for a name and a balance, and shows server refusals', async () => {
    const { screen, onSaved } = await renderStep();
    await userEvent.click(screen.getByRole('button', { name: 'Tambah GoPay' }));
    await userEvent.fill(screen.getByRole('textbox', { name: 'Nama rekening' }), '');
    await userEvent.click(screen.getByRole('button', { name: 'Lanjut' }));
    expect(server.saveOnboardingAccounts).not.toHaveBeenCalled();
    await expect.element(screen.getByRole('textbox', { name: 'Nama rekening' })).toHaveFocus();
    await expect
      .element(screen.getByRole('textbox', { name: 'Nama rekening' }))
      .toHaveAttribute('aria-invalid', 'true');
    // Named by its type while it has no name.
    await expect
      .element(screen.getByRole('textbox', { name: 'Saldo hari ini E-Wallet' }))
      .toHaveAttribute('aria-invalid', 'true');
    await userEvent.fill(screen.getByRole('textbox', { name: 'Nama rekening' }), 'GoPay');
    await userEvent.fill(screen.getByRole('textbox', { name: 'Saldo hari ini GoPay' }), '0');
    server.saveOnboardingAccounts.mockResolvedValueOnce({ ok: false, code: 'INVALID_ACCOUNT' });
    await userEvent.click(screen.getByRole('button', { name: 'Lanjut' }));
    await expect.element(screen.getByRole('alert')).toBeVisible();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('keeps saved accounts: locked ones read-only, foreign ones at their base value, investments outside the total', async () => {
    const bca = accountView({ displayName: 'BCA Tahapan', providerName: 'BCA', openingBalanceMinor: 1_000_000n });
    const locked = accountView({
      displayName: 'Mandiri',
      locked: true,
      balanceMinor: 2_000_000n,
      balanceBaseMinor: 2_000_000n,
    });
    const card = accountView({ displayName: 'Kartu', type: 'credit_card', includeInAvailable: false });
    const usd = accountView({
      displayName: 'Wise',
      currency: 'USD',
      balanceBaseMinor: 1_635_000n,
      openingBalanceMinor: 10_000n,
    });
    const fund = accountView({ displayName: 'Bibit', type: 'investment', includeInAvailable: false });
    const archived = accountView({ displayName: 'Lama', status: 'archived' });
    const noRate = accountView({ displayName: 'Rupee', currency: 'INR', balanceBaseMinor: null, locked: true });
    const { screen } = await renderStep([bca, locked, card, usd, fund, archived, noRate]);
    await expect.element(screen.getByRole('textbox', { name: 'Saldo hari ini BCA Tahapan' })).toHaveValue('1.000.000');
    expect(screen.getByRole('textbox', { name: 'Saldo hari ini Mandiri' }).query()).toBeNull();
    await expect.element(screen.getByText('Rp2.000.000')).toBeVisible();
    expect(screen.getByText('Lama').query()).toBeNull();
    // 1.000.000 + 2.000.000 (locked, as is) + 1.635.000 (USD in IDR).
    await expect.element(screen.getByText('Rp4.635.000')).toBeVisible();
    // "Detail" of a locked account keeps its opening balance as saved.
    await userEvent.click(screen.getByRole('button', { name: 'Detail Mandiri' }));
    await expect.element(page.getByRole('dialog', { name: 'Edit rekening' })).toBeVisible();
    await userEvent.keyboard('{Escape}');
    await userEvent.click(screen.getByRole('button', { name: 'Lanjut' }));
    expect(server.saveOnboardingAccounts).toHaveBeenCalledWith({
      data: {
        accounts: [
          expect.objectContaining({ id: bca.id, displayName: 'BCA Tahapan' }),
          expect.objectContaining({ id: usd.id, currency: 'USD', openingBalanceMinor: 10_000n }),
          expect.objectContaining({ id: fund.id, type: 'investment' }),
        ],
      },
    });
  });

  it('removes a new row at once and a saved account for good', async () => {
    const bca = accountView({ displayName: 'BCA Tahapan' });
    const { screen } = await renderStep([bca]);
    await userEvent.click(screen.getByRole('button', { name: 'Tambah GoPay' }));
    await userEvent.click(screen.getByRole('button', { name: 'Hapus GoPay' }));
    expect(screen.getByRole('textbox', { name: 'Saldo hari ini GoPay' }).query()).toBeNull();
    expect(server.archiveAccount).not.toHaveBeenCalled();

    server.deleteAccount.mockResolvedValueOnce({ ok: false, code: 'ACCOUNT_NOT_ARCHIVED' });
    await userEvent.click(screen.getByRole('button', { name: 'Hapus BCA Tahapan' }));
    await expect.element(screen.getByRole('alert')).toBeVisible();
    server.archiveAccount.mockResolvedValueOnce({ ok: false, code: 'NOT_FOUND' });
    await userEvent.click(screen.getByRole('button', { name: 'Hapus BCA Tahapan' }));
    expect(server.deleteAccount).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Hapus BCA Tahapan' }));
    expect(server.archiveAccount).toHaveBeenCalledWith({ data: { id: bca.id } });
    expect(server.deleteAccount).toHaveBeenLastCalledWith({ data: { id: bca.id } });
    await expect.element(screen.getByText('Belum ada rekening — tambah dari pilihan di bawah.')).toBeVisible();
  });

  it('opens the full account form for "Lainnya…" and "Detail", and takes the saved account', async () => {
    const saved = accountView({ displayName: 'SeaBank', providerName: 'SeaBank', openingBalanceMinor: 300_000n });
    const edited = accountView({ displayName: 'OVO Utama', type: 'ewallet', providerName: 'OVO' });
    const showing = accountView({ displayName: 'Jenius', showAsCard: true });
    server.createAccount.mockResolvedValue({ ok: true, value: saved });
    server.updateAccount.mockResolvedValue({ ok: true, value: { ...showing, displayName: 'Jenius Utama' } });
    const { screen } = await renderStep([showing]);

    await userEvent.click(screen.getByRole('button', { name: 'Lainnya…' }));
    const dialog = page.getByRole('dialog', { name: 'Rekening baru' });
    await expect.element(dialog).toBeVisible();
    await userEvent.click(dialog.getByRole('button', { name: 'Batal' }));
    expect(dialog.query()).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Lainnya…' }));
    await userEvent.fill(dialog.getByRole('textbox', { name: 'Nama bank / penyedia' }), 'SeaBank');
    await userEvent.fill(dialog.getByRole('textbox', { name: 'Nama tampilan' }), 'SeaBank');
    await userEvent.fill(dialog.getByRole('textbox', { name: 'Saldo awal' }), '300.000');
    await userEvent.click(dialog.getByRole('button', { name: 'Tambah rekening' }));
    await expect.element(screen.getByRole('textbox', { name: 'Saldo hari ini SeaBank' })).toHaveValue('300.000');

    // "Detail" of a new row starts from what was typed, and the saved account replaces the row.
    server.createAccount.mockResolvedValueOnce({ ok: true, value: edited });
    await userEvent.click(screen.getByRole('button', { name: 'Tambah BCA' }));
    await userEvent.fill(screen.getByRole('textbox', { name: 'Nama rekening' }).last(), 'OVO Utama');
    await userEvent.click(screen.getByRole('button', { name: 'Detail OVO Utama' }));
    await expect.element(dialog.getByRole('textbox', { name: 'Nama tampilan' })).toHaveValue('OVO Utama');
    await userEvent.fill(dialog.getByRole('textbox', { name: 'Saldo awal' }), '50.000');
    await userEvent.click(dialog.getByRole('button', { name: 'Tambah rekening' }));
    await expect.element(screen.getByRole('textbox', { name: 'Saldo hari ini OVO Utama' })).toBeVisible();

    // "Detail" of a saved account edits it (the other card holders count toward the limit).
    await userEvent.click(screen.getByRole('button', { name: 'Detail Jenius' }));
    const edit = page.getByRole('dialog', { name: 'Edit rekening' });
    await expect.element(edit).toBeVisible();
    await userEvent.click(edit.getByRole('button', { name: 'Simpan perubahan' }));
    await expect.element(screen.getByRole('textbox', { name: 'Saldo hari ini Jenius Utama' })).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Detail Jenius Utama' }));
    await userEvent.keyboard('{Escape}');
    expect(edit.query()).toBeNull();
  });
});
