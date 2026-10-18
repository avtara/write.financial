// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { fail, fakeAuthActions, ok } from '../../../test/fake-auth.ts';
import { renderApp } from '../../../test/render.tsx';
import type { AuthActions } from '../../lib/auth-client.ts';
import { AuthActionsProvider } from '../auth-actions.tsx';
import { TwoFactorCard, type TwoFactorCardProps } from './two-factor-card.tsx';

// Imported through the re-authentication dialog; not called here.
vi.mock('../../server/fn/account.ts', () => ({ revokeDevice: vi.fn() }));

const CODES = Array.from({ length: 10 }, (_, index) => `code-${String(index)}`);
const PASSKEYS = [
  { id: 'pk-1', name: 'MacBook Pro', createdAt: new Date('2026-10-01T03:00:00Z') },
  { id: 'pk-2', name: null, createdAt: new Date('2026-10-02T03:00:00Z') },
];

async function renderCard(props: Partial<TwoFactorCardProps>, actions: Partial<AuthActions> = {}) {
  const reauthenticate = vi.fn(() => Promise.resolve(true));
  const result = await renderApp(
    <AuthActionsProvider actions={fakeAuthActions(actions)}>
      <TwoFactorCard
        twoFactorEnabled={false}
        hasPassword
        isAdmin={false}
        passkeys={[]}
        reauthenticate={reauthenticate}
        {...props}
      />
    </AuthActionsProvider>,
  );
  const invalidate = vi.spyOn(result.router, 'invalidate');
  return { ...result, invalidate, reauthenticate };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('TwoFactorCard', () => {
  it('turns the authenticator on in a dialog, and adds a passkey with a name', async () => {
    const addPasskey = vi
      .fn<AuthActions['addPasskey']>()
      .mockReturnValueOnce(fail({ code: 'UNKNOWN' }))
      .mockReturnValueOnce(ok(null));
    const { screen, invalidate } = await renderCard(
      {},
      {
        enableTwoFactor: () => ok({ totpURI: 'otpauth://totp/x?secret=ABCD', backupCodes: CODES }),
        addPasskey,
      },
    );
    const group = screen.getByRole('region', { name: 'Verifikasi dua langkah' });
    await expect
      .element(group.getByText('Kode 6 digit dari Google Authenticator, 1Password, atau Authy'))
      .toBeVisible();
    await expect.element(group.getByRole('button', { name: 'Buat kode baru' })).toBeDisabled();
    expect(group.getByRole('list').query()).toBeNull();

    await userEvent.click(group.getByRole('button', { name: 'Aktifkan' }));
    const enroll = page.getByRole('dialog', { name: 'Aktifkan aplikasi autentikator' });
    await userEvent.fill(enroll.getByLabelText('Kata sandi'), 'secret');
    await userEvent.click(enroll.getByRole('button', { name: 'Lanjut' }));
    await expect.element(enroll.getByRole('img', { name: 'Kode QR untuk aplikasi autentikator' })).toBeVisible();
    await userEvent.click(enroll.getByRole('button', { name: 'Batal' }));
    await expect.element(enroll).not.toBeInTheDocument();
    expect(invalidate).toHaveBeenCalledOnce();

    await userEvent.click(group.getByRole('button', { name: 'Tambah passkey' }));
    const add = page.getByRole('dialog', { name: 'Tambah passkey' });
    await userEvent.click(add.getByRole('button', { name: 'Batal' }));
    await expect.element(add).not.toBeInTheDocument();
    await userEvent.click(group.getByRole('button', { name: 'Tambah passkey' }));
    const next = add.getByRole('button', { name: 'Lanjut' });
    await expect.element(next).toBeDisabled();
    await userEvent.fill(add.getByLabelText('Nama passkey'), ' iPhone ');
    await userEvent.click(next);
    await expect.element(add.getByRole('alert')).toHaveTextContent('Ada yang salah. Coba lagi sebentar.');
    await userEvent.click(next);
    await expect.element(add).not.toBeInTheDocument();
    expect(addPasskey).toHaveBeenLastCalledWith('iPhone');
    expect(invalidate).toHaveBeenCalledTimes(2);
  });

  it('turns it off with the password, makes new backup codes, and removes passkeys', async () => {
    const disableTwoFactor = vi
      .fn<AuthActions['disableTwoFactor']>()
      .mockReturnValueOnce(fail({ code: 'INVALID_PASSWORD' }))
      .mockReturnValueOnce(ok(null));
    const deletePasskey = vi
      .fn<AuthActions['deletePasskey']>()
      .mockReturnValueOnce(fail({ code: 'NETWORK', status: 0 }))
      .mockReturnValueOnce(ok(null));
    const generateBackupCodes = vi.fn<AuthActions['generateBackupCodes']>(() => ok({ backupCodes: CODES }));
    const { screen, invalidate } = await renderCard(
      { twoFactorEnabled: true, passkeys: PASSKEYS },
      { disableTwoFactor, deletePasskey, generateBackupCodes },
    );
    const group = screen.getByRole('region', { name: 'Verifikasi dua langkah' });
    await expect.element(group.getByText('Aktif', { exact: true })).toBeVisible();

    await userEvent.click(group.getByRole('button', { name: 'Nonaktifkan' }));
    const disable = page.getByRole('dialog', { name: 'Nonaktifkan verifikasi dua langkah?' });
    await userEvent.click(disable.getByRole('button', { name: 'Batal' }));
    await expect.element(disable).not.toBeInTheDocument();
    await userEvent.click(group.getByRole('button', { name: 'Nonaktifkan' }));
    const off = disable.getByRole('button', { name: 'Nonaktifkan' });
    await expect.element(off).toBeDisabled();
    await userEvent.fill(disable.getByLabelText('Kata sandi'), 'wrong');
    await userEvent.click(off);
    await expect.element(disable.getByRole('alert')).toHaveTextContent('Kata sandi salah');
    await userEvent.click(off);
    await expect.element(disable).not.toBeInTheDocument();
    expect(disableTwoFactor).toHaveBeenLastCalledWith('wrong');

    await userEvent.click(group.getByRole('button', { name: 'Buat kode baru' }));
    const backup = page.getByRole('dialog', { name: 'Kode cadangan' });
    await userEvent.fill(backup.getByLabelText('Kata sandi'), 'secret');
    await userEvent.click(backup.getByRole('button', { name: 'Buat kode baru' }));
    await expect.element(backup.getByRole('list', { name: 'Kode cadangan' })).toHaveTextContent(CODES.join(''));
    expect(generateBackupCodes).toHaveBeenCalledWith('secret');
    await userEvent.click(backup.getByLabelText('Saya sudah menyimpan kode cadangan'));
    await userEvent.click(backup.getByRole('button', { name: 'Selesai' }));
    await expect.element(backup).not.toBeInTheDocument();

    const list = group.getByRole('list', { name: 'Passkey tersimpan' });
    await expect
      .element(list)
      .toHaveTextContent('MacBook Pro · ditambahkan 1 Okt 2026HapusPasskey tanpa nama · ditambahkan 2 Okt 2026Hapus');
    await userEvent.click(list.getByRole('button', { name: 'Hapus Passkey tanpa nama' }));
    const confirm = page.getByRole('alertdialog', { name: 'Hapus passkey?' });
    await expect
      .element(confirm)
      .toHaveAccessibleDescription('Passkey tanpa nama tidak bisa dipakai untuk masuk lagi.');
    await userEvent.click(confirm.getByRole('button', { name: 'Hapus' }));
    await expect.element(group.getByRole('alert')).toHaveTextContent('Koneksi terputus. Coba lagi.');
    expect(deletePasskey).toHaveBeenLastCalledWith('pk-2');
    await userEvent.click(list.getByRole('button', { name: 'Hapus MacBook Pro' }));
    await expect
      .element(page.getByRole('alertdialog', { name: 'Hapus passkey?' }))
      .toHaveAccessibleDescription('MacBook Pro tidak bisa dipakai untuk masuk lagi.');
    await userEvent.click(page.getByRole('button', { name: 'Hapus', exact: true }));
    await vi.waitFor(() => {
      expect(deletePasskey).toHaveBeenLastCalledWith('pk-1');
    });
    await expect.element(group.getByRole('alert')).not.toBeInTheDocument();
    expect(invalidate).toHaveBeenCalledTimes(4);
  });

  it('keeps it on for admins, and asks no password where the account has none', async () => {
    const generateBackupCodes = vi.fn<AuthActions['generateBackupCodes']>(() => ok({ backupCodes: CODES }));
    const { screen } = await renderCard(
      { twoFactorEnabled: true, isAdmin: true, hasPassword: false },
      { generateBackupCodes },
    );
    const group = screen.getByRole('region', { name: 'Verifikasi dua langkah' });
    await expect.element(group.getByText('Wajib untuk admin — tidak bisa dinonaktifkan')).toBeVisible();
    expect(group.getByRole('button', { name: 'Nonaktifkan' }).query()).toBeNull();

    await userEvent.click(group.getByRole('button', { name: 'Buat kode baru' }));
    const backup = page.getByRole('dialog', { name: 'Kode cadangan' });
    expect(backup.getByLabelText('Kata sandi').query()).toBeNull();
    await userEvent.click(backup.getByRole('button', { name: 'Buat kode baru' }));
    await expect.element(backup.getByRole('list', { name: 'Kode cadangan' })).toBeVisible();
    expect(generateBackupCodes).toHaveBeenCalledWith(null);
    await userEvent.keyboard('{Escape}');
    await expect.element(backup).not.toBeInTheDocument();
  });
});
