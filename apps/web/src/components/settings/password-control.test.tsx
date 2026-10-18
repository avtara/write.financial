// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { fail, fakeAuthActions, ok, VIEWER } from '../../../test/fake-auth.ts';
import { renderApp } from '../../../test/render.tsx';
import type { AuthActions } from '../../lib/auth-client.ts';
import { AuthActionsProvider } from '../auth-actions.tsx';
import { PasswordControl } from './password-control.tsx';

// Imported through the re-authentication dialog; not called here.
vi.mock('../../server/fn/account.ts', () => ({ revokeDevice: vi.fn() }));

async function renderControl(
  hasPassword: boolean,
  actions: Partial<AuthActions>,
  reauthenticate = vi.fn(() => Promise.resolve(true)),
) {
  const result = await renderApp(
    <AuthActionsProvider actions={fakeAuthActions(actions)}>
      <PasswordControl hasPassword={hasPassword} email={VIEWER.email} reauthenticate={reauthenticate} />
    </AuthActionsProvider>,
  );
  const invalidate = vi.spyOn(result.router, 'invalidate');
  return { ...result, invalidate, reauthenticate };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('PasswordControl', () => {
  it('changes the password: checks the repeat, retries after signing in again, and reloads', async () => {
    const changePassword = vi
      .fn<AuthActions['changePassword']>()
      .mockReturnValueOnce(fail({ code: 'INVALID_PASSWORD' }))
      .mockReturnValueOnce(fail({ code: 'REAUTHENTICATION_REQUIRED', status: 403 }))
      .mockReturnValueOnce(ok(null));
    const { screen, invalidate, reauthenticate } = await renderControl(true, { changePassword });
    await userEvent.click(screen.getByRole('button', { name: 'Ubah' }));
    const dialog = page.getByRole('dialog', { name: 'Ubah kata sandi' });
    const save = dialog.getByRole('button', { name: 'Simpan kata sandi' });
    await expect.element(save).toBeDisabled();
    await userEvent.fill(dialog.getByLabelText('Kata sandi saat ini'), 'old password');
    await userEvent.fill(dialog.getByLabelText('Kata sandi baru'), 'new password 123');
    await userEvent.fill(dialog.getByLabelText('Ulangi kata sandi baru'), 'different');
    await userEvent.click(save);
    await expect.element(dialog.getByRole('alert')).toHaveTextContent('Kata sandi tidak sama');
    expect(changePassword).not.toHaveBeenCalled();

    await userEvent.fill(dialog.getByLabelText('Ulangi kata sandi baru'), 'new password 123');
    await userEvent.click(dialog.getByLabelText('Keluar dari perangkat lain'));
    await userEvent.click(save);
    await expect.element(dialog.getByRole('alert')).toHaveTextContent('Kata sandi salah');
    await userEvent.click(save);
    await expect.element(dialog).not.toBeInTheDocument();
    expect(reauthenticate).toHaveBeenCalledOnce();
    expect(changePassword).toHaveBeenLastCalledWith({
      currentPassword: 'old password',
      newPassword: 'new password 123',
      revokeOtherSessions: true,
    });
    await expect.element(screen.getByRole('status')).toHaveTextContent('Kata sandi diubah');
    expect(invalidate).toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Ubah' }));
    await expect.element(screen.getByRole('status')).not.toBeInTheDocument();
    await userEvent.click(dialog.getByRole('button', { name: 'Batal' }));
    await expect.element(dialog).not.toBeInTheDocument();
  });

  it('emails a link to set a password for Google-only accounts', async () => {
    const requestPasswordReset = vi
      .fn<AuthActions['requestPasswordReset']>()
      .mockReturnValueOnce(fail({ code: 'RATE_LIMITED', status: 429 }))
      .mockReturnValueOnce(ok(null));
    const { screen } = await renderControl(false, { requestPasswordReset });
    const set = screen.getByRole('button', { name: 'Atur kata sandi' });
    await userEvent.click(set);
    await expect
      .element(screen.getByRole('alert'))
      .toHaveTextContent('Terlalu banyak percobaan dari jaringan ini. Coba lagi sebentar.');
    await userEvent.click(set);
    await expect
      .element(screen.getByRole('status'))
      .toHaveTextContent(`Tautan untuk mengatur kata sandi dikirim ke ${VIEWER.email}.`);
    expect(requestPasswordReset).toHaveBeenCalledWith(VIEWER.email);
    expect(screen.getByRole('alert').query()).toBeNull();
  });
});
