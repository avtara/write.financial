// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { fail, fakeAuthActions, ok } from '../../../test/fake-auth.ts';
import { renderApp } from '../../../test/render.tsx';
import type { AuthActions } from '../../lib/auth-client.ts';
import { AuthActionsProvider } from '../auth-actions.tsx';
import { AuthFoot, GoogleSignIn } from './parts.tsx';

function renderGoogle(signInGoogle: AuthActions['signInGoogle']) {
  return renderApp(
    <AuthActionsProvider actions={fakeAuthActions({ signInGoogle })}>
      <GoogleSignIn callbackURL="/settings" />
      <AuthFoot>Kaki</AuthFoot>
    </AuthActionsProvider>,
  );
}

describe('GoogleSignIn', () => {
  it('leaves for Google with the callback and stays busy meanwhile', async () => {
    const signInGoogle = vi.fn(() => ok(null));
    const { screen } = await renderGoogle(signInGoogle);
    await expect.element(screen.getByText('atau')).toBeVisible();
    await expect.element(screen.getByText('Kaki')).toBeVisible();
    const button = screen.getByRole('button', { name: 'Lanjut dengan Google' });
    await userEvent.click(button);
    expect(signInGoogle).toHaveBeenCalledWith('/settings');
    await expect.element(button).toBeDisabled();
    await expect.element(screen.getByRole('alert')).not.toBeInTheDocument();
  });

  it('says why Google sign-in could not start and lets the visitor retry', async () => {
    const signInGoogle = vi.fn(() => fail({ status: 0, code: 'NETWORK' }));
    const { screen } = await renderGoogle(signInGoogle);
    const button = screen.getByRole('button', { name: 'Lanjut dengan Google' });
    await userEvent.click(button);
    await expect.element(screen.getByRole('alert')).toHaveTextContent('Koneksi terputus. Coba lagi.');
    await expect.element(button).toBeEnabled();
  });
});
