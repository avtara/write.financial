// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { fail, fakeAuthActions, ok } from '../../../test/fake-auth.ts';
import { renderApp, type RenderAppOptions } from '../../../test/render.tsx';
import type { AuthActions } from '../../lib/auth-client.ts';
import { hardNavigate } from '../../lib/navigation.ts';
import { AuthActionsProvider } from '../auth-actions.tsx';
import { TwoFactorPage, type TwoFactorPageProps } from './two-factor-page.tsx';

vi.mock('../../lib/navigation.ts', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  hardNavigate: vi.fn(),
}));

afterEach(() => {
  vi.mocked(hardNavigate).mockClear();
});

async function renderChallenge(
  actions: Partial<AuthActions>,
  props: Partial<TwoFactorPageProps> = {},
  options?: RenderAppOptions,
) {
  const revokeSession = vi.fn(() => Promise.resolve(null));
  const result = await renderApp(
    <AuthActionsProvider actions={fakeAuthActions(actions)}>
      <TwoFactorPage
        redirect="/settings"
        previous={undefined}
        email="avtara@example.test"
        revokeSession={revokeSession}
        {...props}
      />
    </AuthActionsProvider>,
    options,
  );
  const typeCode = (code: string) =>
    userEvent.fill(result.screen.getByRole('textbox', { name: 'Digit 1 dari 6' }), code);
  return { ...result, revokeSession, typeCode };
}

describe('TwoFactorPage', () => {
  it('verifies the code as soon as six digits are in, then ends the replaced session', async () => {
    const verifyTotp = vi.fn(() => ok(null));
    const { screen, typeCode, revokeSession } = await renderChallenge({ verifyTotp }, { previous: 'old-session' });
    await expect.element(screen.getByRole('heading', { name: 'Verifikasi dua langkah' })).toBeVisible();
    await expect
      .element(screen.getByText('Masukkan kode 6 digit dari aplikasi autentikator untuk avtara@example.test.'))
      .toBeVisible();
    await expect.element(screen.getByText('5 kali salah → dikunci 15 menit · kode berlaku 30 detik')).toBeVisible();
    await expect.element(screen.getByRole('button', { name: 'Verifikasi' })).toBeDisabled();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Percayai perangkat ini 30 hari' }));
    await typeCode('123456');
    await vi.waitFor(() => {
      expect(hardNavigate).toHaveBeenCalledWith('/settings');
    });
    expect(verifyTotp).toHaveBeenCalledWith({ code: '123456', trustDevice: true });
    expect(revokeSession).toHaveBeenCalledWith('old-session');
  });

  it('shows the tries left after a wrong code and retries with Verifikasi', async () => {
    const verifyTotp = vi
      .fn<AuthActions['verifyTotp']>()
      .mockImplementationOnce(() => fail({ code: 'INVALID_CODE', remainingAttempts: 4 }))
      .mockImplementationOnce(() => ok(null));
    const { screen, typeCode, revokeSession } = await renderChallenge({ verifyTotp }, { redirect: undefined });
    await typeCode('111111');
    await expect
      .element(screen.getByRole('alert'))
      .toHaveTextContent('Kode salah · sisa 4 percobaan sebelum dikunci 15 menit');
    await expect
      .element(screen.getByRole('textbox', { name: 'Digit 1 dari 6' }))
      .toHaveAttribute('aria-invalid', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'Verifikasi' }));
    await vi.waitFor(() => {
      expect(hardNavigate).toHaveBeenCalledWith('/');
    });
    expect(verifyTotp).toHaveBeenLastCalledWith({ code: '111111', trustDevice: false });
    expect(revokeSession).not.toHaveBeenCalled();
  });

  it('says until when a locked account stays locked', async () => {
    const lockedUntil = new Date(2026, 9, 18, 16, 52);
    const { screen, typeCode } = await renderChallenge({
      verifyTotp: vi.fn(() => fail({ status: 423, code: 'ACCOUNT_LOCKED', lockedUntil })),
    });
    await typeCode('222222');
    await expect
      .element(screen.getByRole('alert'))
      .toHaveTextContent('Akun dikunci sampai 16.52 karena terlalu banyak percobaan salah.');
  });

  it('sends back to sign-in when the challenge expired', async () => {
    const { screen, typeCode } = await renderChallenge(
      { verifyTotp: vi.fn(() => fail({ status: 401, code: 'INVALID_TWO_FACTOR_COOKIE' })) },
      { email: undefined },
      { preferences: { locale: 'en' } },
    );
    await expect.element(screen.getByText('Enter the 6-digit code from your authenticator app.')).toBeVisible();
    await userEvent.fill(screen.getByRole('textbox', { name: 'Digit 1 of 6' }), '333333');
    await expect
      .element(screen.getByRole('alert'))
      .toHaveTextContent('The verification step expired. Sign in again. Sign in again');
    await expect
      .element(screen.getByRole('link', { name: 'Sign in again' }))
      .toHaveAttribute('href', '/sign-in?redirect=%2Fsettings');
    expect(typeCode).toBeTypeOf('function');
  });

  it('accepts a backup code instead, and switches back', async () => {
    const verifyBackupCode = vi
      .fn<AuthActions['verifyBackupCode']>()
      .mockImplementationOnce(() => fail({ code: 'INVALID_BACKUP_CODE' }))
      .mockImplementationOnce(() => ok(null));
    const { screen } = await renderChallenge({ verifyBackupCode });
    await userEvent.click(screen.getByRole('button', { name: 'Pakai kode cadangan' }));
    const input = screen.getByRole('textbox', { name: 'Kode cadangan' });
    await userEvent.fill(input, ' abcde-12345 ');
    await userEvent.click(screen.getByRole('button', { name: 'Verifikasi' }));
    await expect.element(screen.getByRole('alert')).toHaveTextContent('Kode cadangan salah atau sudah dipakai');
    await expect.element(input).toHaveAttribute('aria-invalid', 'true');

    await userEvent.click(screen.getByRole('button', { name: 'Pakai kode autentikator' }));
    await expect.element(screen.getByRole('group', { name: 'Kode verifikasi' })).toBeVisible();
    await expect.element(screen.getByRole('alert')).not.toBeInTheDocument();
    await expect.element(screen.getByRole('button', { name: 'Verifikasi' })).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: 'Pakai kode cadangan' }));
    await userEvent.fill(screen.getByRole('textbox', { name: 'Kode cadangan' }), 'fghij-67890');
    await userEvent.keyboard('{Enter}');
    await vi.waitFor(() => {
      expect(hardNavigate).toHaveBeenCalledWith('/settings');
    });
    expect(verifyBackupCode).toHaveBeenNthCalledWith(1, { code: 'abcde-12345', trustDevice: false });
    expect(verifyBackupCode).toHaveBeenNthCalledWith(2, { code: 'fghij-67890', trustDevice: false });
  });

  it('signs in with a passkey', async () => {
    const signInPasskey = vi
      .fn<AuthActions['signInPasskey']>()
      .mockImplementationOnce(() => fail({ code: 'AUTH_CANCELLED' }))
      .mockImplementationOnce(() => ok(null));
    const { screen } = await renderChallenge({ signInPasskey });
    const passkey = screen.getByRole('button', { name: 'Pakai passkey' });
    await userEvent.click(passkey);
    await expect.element(screen.getByRole('alert')).toHaveTextContent('Ada yang salah. Coba lagi sebentar.');
    await userEvent.click(passkey);
    await vi.waitFor(() => {
      expect(hardNavigate).toHaveBeenCalledWith('/settings');
    });
  });

  it('explains how to recover the account', async () => {
    const { screen } = await renderChallenge({});
    const recover = screen.getByRole('button', { name: 'Pulihkan akun' });
    const help = screen.getByText('Jika semua kode cadangan hilang', { exact: false });
    await expect.element(recover).toHaveAttribute('aria-expanded', 'false');
    await expect.element(help).not.toBeVisible();
    await userEvent.click(recover);
    await expect.element(recover).toHaveAttribute('aria-expanded', 'true');
    await expect.element(help).toBeVisible();
    await userEvent.click(recover);
    await expect.element(help).not.toBeVisible();
  });
});
