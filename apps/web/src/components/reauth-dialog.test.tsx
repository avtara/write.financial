// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { fail, fakeAuthActions, ok, VIEWER } from '../../test/fake-auth.ts';
import { renderApp } from '../../test/render.tsx';
import type { AuthActions } from '../lib/auth-client.ts';
import { AuthActionsProvider } from './auth-actions.tsx';
import { ReauthDialog } from './reauth-dialog.tsx';

const server = vi.hoisted(() => ({ revokeDevice: vi.fn() }));
vi.mock('../server/fn/account.ts', () => server);
const navigation = vi.hoisted(() => ({ hardNavigate: vi.fn() }));
vi.mock('../lib/navigation.ts', () => navigation);

async function renderDialog(actions: Partial<AuthActions>) {
  server.revokeDevice.mockResolvedValue({ ok: true, value: null });
  const onDone = vi.fn();
  const onOpenChange = vi.fn();
  const result = await renderApp(
    <AuthActionsProvider actions={fakeAuthActions(actions)}>
      <ReauthDialog
        open
        onOpenChange={onOpenChange}
        email={VIEWER.email}
        sessionId={VIEWER.sessionId}
        onDone={onDone}
      />
    </AuthActionsProvider>,
    { path: '/other?tab=1' },
  );
  const dialog = page.getByRole('dialog', { name: 'Masuk lagi untuk melanjutkan' });
  await expect.element(dialog).toBeVisible();
  return { ...result, dialog, onDone, onOpenChange };
}

async function typeCode(code: string) {
  await userEvent.click(page.getByRole('textbox', { name: 'Digit 1 dari 6' }));
  await userEvent.keyboard(code);
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('ReauthDialog', () => {
  it('signs in again with the password, ends the previous session, and continues', async () => {
    const signInEmail = vi
      .fn<AuthActions['signInEmail']>()
      .mockReturnValueOnce(fail({ code: 'INVALID_EMAIL_OR_PASSWORD', remainingAttempts: 2 }))
      .mockReturnValueOnce(ok({ twoFactor: false }));
    const { dialog, onDone } = await renderDialog({ signInEmail });
    await expect
      .element(dialog.getByText(`Demi keamanan, masukkan lagi kata sandi untuk ${VIEWER.email}.`))
      .toBeVisible();
    const next = dialog.getByRole('button', { name: 'Lanjut' });
    await expect.element(next).toBeDisabled();
    await userEvent.fill(dialog.getByLabelText('Kata sandi'), 'wrong');
    await userEvent.click(next);
    await expect
      .element(dialog.getByRole('alert'))
      .toHaveTextContent('Email atau kata sandi salah · sisa 2 percobaan sebelum dikunci 15 menit');
    await userEvent.fill(dialog.getByLabelText('Kata sandi'), 'right');
    await userEvent.click(next);
    await vi.waitFor(() => {
      expect(onDone).toHaveBeenCalledOnce();
    });
    expect(signInEmail).toHaveBeenLastCalledWith({ email: VIEWER.email, password: 'right', rememberMe: true });
    expect(server.revokeDevice).toHaveBeenCalledWith({ data: { id: VIEWER.sessionId } });
  });

  it('asks for the authenticator code, or a backup code, when the account has 2FA', async () => {
    const verifyTotp = vi.fn<AuthActions['verifyTotp']>(() => fail({ code: 'INVALID_CODE' }));
    const verifyBackupCode = vi
      .fn<AuthActions['verifyBackupCode']>()
      .mockReturnValueOnce(fail({ code: 'INVALID_BACKUP_CODE' }))
      .mockReturnValueOnce(ok(null));
    const { dialog, onDone } = await renderDialog({
      signInEmail: () => ok({ twoFactor: true }),
      verifyTotp,
      verifyBackupCode,
    });
    await userEvent.fill(dialog.getByLabelText('Kata sandi'), 'right');
    await userEvent.click(dialog.getByRole('button', { name: 'Lanjut' }));
    await expect.element(dialog.getByText('Masukkan kode 6 digit dari aplikasi autentikator.')).toBeVisible();
    const verify = dialog.getByRole('button', { name: 'Verifikasi' });
    await expect.element(verify).toBeDisabled();
    await typeCode('123456');
    await userEvent.click(verify);
    await expect.element(dialog.getByRole('alert')).toHaveTextContent('Kode salah');
    expect(verifyTotp).toHaveBeenCalledWith({ code: '123456', trustDevice: false });

    await userEvent.click(dialog.getByRole('button', { name: 'Pakai kode cadangan' }));
    await expect.element(dialog.getByRole('alert')).not.toBeInTheDocument();
    await userEvent.fill(dialog.getByLabelText('Kode cadangan'), ' abcde-fghij ');
    await userEvent.click(verify);
    await expect.element(dialog.getByRole('alert')).toHaveTextContent('Kode cadangan salah atau sudah dipakai');
    await userEvent.click(dialog.getByRole('button', { name: 'Pakai aplikasi autentikator' }));
    await userEvent.click(dialog.getByRole('button', { name: 'Pakai kode cadangan' }));
    await userEvent.fill(dialog.getByLabelText('Kode cadangan'), 'abcde-fghij');
    await userEvent.click(verify);
    await vi.waitFor(() => {
      expect(onDone).toHaveBeenCalledOnce();
    });
    expect(verifyBackupCode).toHaveBeenLastCalledWith({ code: 'abcde-fghij', trustDevice: false });
    expect(server.revokeDevice).toHaveBeenCalledOnce();
  });

  it('continues on the sign-in page for other sign-in methods, and cancels', async () => {
    const { dialog, onOpenChange } = await renderDialog({});
    await userEvent.click(dialog.getByRole('button', { name: 'Masuk dengan cara lain' }));
    expect(navigation.hardNavigate).toHaveBeenCalledWith('/sign-in?reauth=1&redirect=%2Fother%3Ftab%3D1');
    await userEvent.click(dialog.getByRole('button', { name: 'Batal' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
