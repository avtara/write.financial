// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { fail, fakeAuthActions, ok } from '../../../test/fake-auth.ts';
import { renderApp } from '../../../test/render.tsx';
import type { AuthActions } from '../../lib/auth-client.ts';
import { AuthActionsProvider } from '../auth-actions.tsx';
import { ResetPasswordPage, type ResetPasswordPageProps } from './reset-password-page.tsx';

function renderReset(resetPassword: AuthActions['resetPassword'], props: ResetPasswordPageProps) {
  return renderApp(
    <AuthActionsProvider actions={fakeAuthActions({ resetPassword })}>
      <ResetPasswordPage {...props} />
    </AuthActionsProvider>,
  );
}

async function submit(password: string, confirm: string) {
  await userEvent.fill(page.getByLabelText('Kata sandi baru', { exact: true }), password);
  await userEvent.fill(page.getByLabelText('Ulangi kata sandi baru'), confirm);
  await userEvent.click(page.getByRole('button', { name: 'Simpan kata sandi' }));
}

describe('ResetPasswordPage', () => {
  it.each([
    { token: undefined, error: undefined },
    { token: 'tok', error: 'INVALID_TOKEN' },
  ])('offers a new link when the link is no good (%o)', async (props) => {
    const { screen } = await renderReset(vi.fn(), props);
    await expect.element(screen.getByRole('heading', { name: 'Tautan tidak berlaku' })).toBeVisible();
    await expect.element(screen.getByRole('link', { name: 'Minta tautan baru' })).toHaveAttribute('href', '/forgot');
  });

  it('sets the new password and leads to sign-in', async () => {
    const resetPassword = vi.fn(() => ok(null));
    const { screen } = await renderReset(resetPassword, { token: 'tok', error: undefined });
    await expect.element(screen.getByRole('heading', { name: 'Atur kata sandi baru' })).toBeVisible();
    await submit('abcdefgh1J', 'abcdefgh1X');
    const confirm = screen.getByLabelText('Ulangi kata sandi baru');
    await expect.element(confirm).toHaveAccessibleDescription('Kata sandi tidak sama.');
    await expect.element(confirm).toHaveAttribute('aria-invalid', 'true');
    expect(resetPassword).not.toHaveBeenCalled();

    await submit('abcdefgh1J', 'abcdefgh1J');
    await expect.element(screen.getByRole('heading', { name: 'Kata sandi diperbarui' })).toBeVisible();
    await expect.element(screen.getByRole('link', { name: 'Masuk' })).toHaveAttribute('href', '/sign-in');
    expect(resetPassword).toHaveBeenCalledWith({ token: 'tok', newPassword: 'abcdefgh1J' });
  });

  it('explains a refused password and keeps the form', async () => {
    const resetPassword = vi.fn(() => fail({ code: 'PASSWORD_COMPROMISED' }));
    const { screen } = await renderReset(resetPassword, { token: 'tok', error: undefined });
    await submit('password123', 'password123');
    await expect
      .element(screen.getByRole('alert'))
      .toHaveTextContent('Kata sandi ini pernah bocor di internet. Pilih kata sandi lain.');
    await expect.element(screen.getByRole('button', { name: 'Simpan kata sandi' })).toBeEnabled();
  });

  it.each(['INVALID_TOKEN', 'TOKEN_EXPIRED'])('turns into the dead-link page on %s', async (code) => {
    const resetPassword = vi.fn(() => fail({ code }));
    const { screen } = await renderReset(resetPassword, { token: 'tok', error: undefined });
    await submit('abcdefgh1J', 'abcdefgh1J');
    await expect.element(screen.getByRole('heading', { name: 'Tautan tidak berlaku' })).toBeVisible();
  });
});
