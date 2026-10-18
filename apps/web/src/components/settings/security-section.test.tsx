// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { fail, fakeAuthActions, ok, VIEWER } from '../../../test/fake-auth.ts';
import { renderApp } from '../../../test/render.tsx';
import type { SecurityOverview } from '../../server/account.ts';
import { AuthActionsProvider } from '../auth-actions.tsx';
import { SecuritySection } from './security-section.tsx';

const server = vi.hoisted(() => ({
  revokeDevice: vi.fn(() => Promise.resolve({ ok: true, value: null })),
  revokeOtherDevices: vi.fn(),
  getSecurityHistory: vi.fn(),
}));
vi.mock('../../server/fn/account.ts', () => server);

const OVERVIEW: SecurityOverview = {
  twoFactorEnabled: false,
  hasPassword: true,
  googleLinked: false,
  passkeys: [],
  devices: [
    {
      id: VIEWER.sessionId,
      label: 'Chrome · macOS',
      current: true,
      createdAt: new Date('2026-10-15T03:05:00Z'),
      expiresAt: new Date('2026-11-15T03:05:00Z'),
    },
  ],
  history: { events: [], nextBefore: null },
};

describe('SecuritySection', () => {
  it('urges 2FA while it is off, and signs in again when an action needs a fresh session', async () => {
    const changePassword = vi
      .fn()
      .mockReturnValueOnce(fail({ code: 'REAUTHENTICATION_REQUIRED', status: 403 }))
      .mockReturnValueOnce(ok(null));
    const { screen } = await renderApp(
      <AuthActionsProvider actions={fakeAuthActions({ changePassword, signInEmail: () => ok({ twoFactor: false }) })}>
        <SecuritySection viewer={VIEWER} overview={OVERVIEW} />
      </AuthActionsProvider>,
    );
    await expect
      .element(screen.getByRole('note'))
      .toHaveTextContent(
        'Aktifkan verifikasi dua langkahWajib sebelum menyimpan API key, menghubungkan Gmail, atau mengekspor semua data.',
      );
    await expect.element(screen.getByRole('region', { name: 'Verifikasi dua langkah' })).toBeVisible();
    await expect.element(screen.getByRole('region', { name: 'Perangkat aktif' })).toBeVisible();
    await expect.element(screen.getByRole('region', { name: 'Riwayat keamanan' })).toBeVisible();
    const access = screen.getByRole('region', { name: 'Akses' });
    await expect.element(access.getByText('Diatur', { exact: true })).toBeVisible();

    await userEvent.click(access.getByRole('button', { name: 'Ubah' }));
    const dialog = page.getByRole('dialog', { name: 'Ubah kata sandi' });
    await userEvent.fill(dialog.getByLabelText('Kata sandi saat ini'), 'old password');
    await userEvent.fill(dialog.getByLabelText('Kata sandi baru'), 'new password 123');
    await userEvent.fill(dialog.getByLabelText('Ulangi kata sandi baru'), 'new password 123');
    await userEvent.click(dialog.getByRole('button', { name: 'Simpan kata sandi' }));
    const reauth = page.getByRole('dialog', { name: 'Masuk lagi untuk melanjutkan' });
    await userEvent.fill(reauth.getByLabelText('Kata sandi'), 'old password');
    await userEvent.click(reauth.getByRole('button', { name: 'Lanjut' }));
    await expect.element(access.getByRole('status')).toHaveTextContent('Kata sandi diubah');
    expect(changePassword).toHaveBeenCalledTimes(2);
    expect(server.revokeDevice).toHaveBeenCalledWith({ data: { id: VIEWER.sessionId } });
  });

  it('has no banner once 2FA is on, and offers to set a password for Google-only accounts', async () => {
    const { screen } = await renderApp(
      <SecuritySection viewer={VIEWER} overview={{ ...OVERVIEW, twoFactorEnabled: true, hasPassword: false }} />,
    );
    await expect.element(screen.getByRole('region', { name: 'Akses' })).toBeVisible();
    expect(screen.getByRole('note').query()).toBeNull();
    await expect.element(screen.getByRole('button', { name: 'Atur kata sandi' })).toBeVisible();
    await expect.element(screen.getByText('Belum diatur — saat ini hanya bisa masuk dengan Google')).toBeVisible();
  });
});
