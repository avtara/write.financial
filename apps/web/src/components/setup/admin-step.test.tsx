// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { renderApp } from '../../../test/render.tsx';
import type { AuthActions, AuthResult } from '../../lib/auth-client.ts';
import type { Result } from '../../server/access.ts';
import { AuthActionsProvider } from '../auth-actions.tsx';
import { AdminStep, type AdminInput } from './admin-step.tsx';

const PASSWORD = ['correct', 'horse', 'battery'].join('-');

async function setup({
  created = { ok: true, value: null },
  signedIn = { ok: true, value: { twoFactor: false } },
  locale = 'id',
}: {
  created?: Result<null>;
  signedIn?: AuthResult<{ twoFactor: boolean }>;
  locale?: 'id' | 'en';
} = {}) {
  const onCreate = vi.fn<(input: AdminInput) => Promise<Result<null>>>(() => Promise.resolve(created));
  const onDone = vi.fn<(password: string | undefined) => Promise<void>>(() => Promise.resolve());
  const signInEmail = vi.fn(() => Promise.resolve(signedIn));
  const actions = { signInEmail } as unknown as AuthActions;
  const { screen } = await renderApp(
    <AuthActionsProvider actions={actions}>
      <AdminStep onCreate={onCreate} onDone={onDone} />
    </AuthActionsProvider>,
    { preferences: { locale } },
  );
  const fill = async (password = PASSWORD) => {
    await userEvent.fill(screen.getByLabelText('Nama'), '  Ayu  ');
    await userEvent.fill(screen.getByLabelText('Email'), 'ayu@example.com ');
    await userEvent.fill(screen.getByLabelText('Kata sandi', { exact: true }), password);
    await userEvent.click(screen.getByRole('button', { name: 'Buat admin' }));
  };
  return { screen, fill, onCreate, onDone, signInEmail };
}

describe('AdminStep', () => {
  it('creates the admin in the interface language, signs in, and hands the password on', async () => {
    const { fill, onCreate, onDone, signInEmail } = await setup();
    await fill();
    await vi.waitFor(() => {
      expect(onDone).toHaveBeenCalledWith(PASSWORD);
    });
    expect(onCreate).toHaveBeenCalledWith({ name: 'Ayu', email: 'ayu@example.com', password: PASSWORD, locale: 'id' });
    expect(signInEmail).toHaveBeenCalledWith({ email: 'ayu@example.com', password: PASSWORD, rememberMe: false });
  });

  it('continues without the password when signing in failed', async () => {
    const { fill, onDone } = await setup({ signedIn: { ok: false, error: { status: 0, code: 'NETWORK' } } });
    await fill();
    await vi.waitFor(() => {
      expect(onDone).toHaveBeenCalledWith(undefined);
    });
  });

  it('refuses a short password before asking the server', async () => {
    const { screen, fill, onCreate } = await setup();
    await fill('short');
    await expect.element(screen.getByText('Kata sandi minimal 10 karakter.')).toBeVisible();
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('shows an email refusal at the email field', async () => {
    const { screen, fill, onDone } = await setup({ created: { ok: false, code: 'EMAIL_TAKEN' } });
    await fill();
    await expect.element(screen.getByLabelText('Email')).toHaveAccessibleDescription('Email ini sudah terdaftar.');
    await expect.element(screen.getByRole('button', { name: 'Buat admin' })).toBeEnabled();
    expect(onDone).not.toHaveBeenCalled();
  });

  it('shows a password refusal at the password field', async () => {
    const { screen, fill } = await setup({ created: { ok: false, code: 'PASSWORD_COMPROMISED' } });
    await fill();
    await expect
      .element(screen.getByRole('alert'))
      .toHaveTextContent('Kata sandi ini pernah bocor di internet. Pilih kata sandi lain.');
  });

  it('shows other refusals above the button', async () => {
    const { screen } = await setup({ created: { ok: false, code: 'FORBIDDEN' }, locale: 'en' });
    await userEvent.fill(screen.getByLabelText('Name'), 'Ayu');
    await userEvent.fill(screen.getByLabelText('Email'), 'ayu@example.com');
    await userEvent.fill(screen.getByLabelText('Password', { exact: true }), PASSWORD);
    await userEvent.click(screen.getByRole('button', { name: 'Create admin' }));
    await expect.element(screen.getByRole('alert')).toHaveTextContent("You don't have access to this.");
  });
});
