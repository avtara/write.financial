// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { fail, fakeAuthActions, ok } from '../../../test/fake-auth.ts';
import { renderApp, type RenderAppOptions } from '../../../test/render.tsx';
import type { AuthActions } from '../../lib/auth-client.ts';
import { hardNavigate } from '../../lib/navigation.ts';
import { AuthActionsProvider } from '../auth-actions.tsx';
import { SignUpPage, type SignUpPageProps } from './sign-up-page.tsx';

vi.mock('../../lib/navigation.ts', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  hardNavigate: vi.fn(),
}));

afterEach(() => {
  vi.mocked(hardNavigate).mockClear();
});

function renderSignUp(actions: Partial<AuthActions>, props: Partial<SignUpPageProps>, options?: RenderAppOptions) {
  return renderApp(
    <AuthActionsProvider actions={fakeAuthActions(actions)}>
      <SignUpPage invitation={undefined} registrationMode="open" googleEnabled={false} {...props} />
    </AuthActionsProvider>,
    options,
  );
}

describe('SignUpPage', () => {
  it('creates the account in the current language and opens the app', async () => {
    const signUpEmail = vi.fn(() => ok(null));
    const { screen } = await renderSignUp({ signUpEmail }, { googleEnabled: true });
    await expect.element(screen.getByRole('heading', { name: 'Buat akun' })).toBeVisible();
    await expect
      .element(screen.getByText('Gratis. Semua data kamu catat sendiri — tidak perlu login bank.'))
      .toBeVisible();
    await expect.element(screen.getByRole('button', { name: 'Lanjut dengan Google' })).toBeVisible();
    await userEvent.fill(screen.getByRole('textbox', { name: 'Nama' }), 'Avtara K.');
    await userEvent.fill(screen.getByRole('textbox', { name: 'Email' }), 'avtara@example.test');
    const password = screen.getByLabelText('Kata sandi', { exact: true });
    await userEvent.fill(password, 'abcdefgh1J');
    await expect.element(password).toHaveAccessibleDescription('Min. 10 karakter · kuat');
    await userEvent.click(screen.getByRole('button', { name: 'Buat akun' }));
    await vi.waitFor(() => {
      expect(hardNavigate).toHaveBeenCalledWith('/');
    });
    expect(signUpEmail).toHaveBeenCalledWith({
      name: 'Avtara K.',
      email: 'avtara@example.test',
      password: 'abcdefgh1J',
      locale: 'id',
      invitationToken: null,
    });
    await expect.element(screen.getByRole('link', { name: 'Masuk' })).toHaveAttribute('href', '/sign-in');
  });

  it('sends the invitation and explains a refusal', async () => {
    const signUpEmail = vi.fn(() => fail({ code: 'USER_ALREADY_EXISTS' }));
    const { screen } = await renderSignUp(
      { signUpEmail },
      { invitation: 'inv-token', registrationMode: 'invite' },
      { preferences: { locale: 'en' } },
    );
    await expect.element(screen.getByRole('button', { name: 'Continue with Google' })).not.toBeInTheDocument();
    await userEvent.fill(screen.getByRole('textbox', { name: 'Name' }), 'Avtara K.');
    await userEvent.fill(screen.getByRole('textbox', { name: 'Email' }), 'avtara@example.test');
    await userEvent.fill(screen.getByLabelText('Password', { exact: true }), 'abcdefgh1J');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
    await expect.element(screen.getByRole('alert')).toHaveTextContent('This email is already registered.');
    await expect.element(screen.getByRole('button', { name: 'Create account' })).toBeEnabled();
    expect(signUpEmail).toHaveBeenCalledWith(expect.objectContaining({ locale: 'en', invitationToken: 'inv-token' }));
    expect(hardNavigate).not.toHaveBeenCalled();
  });

  it.each(['invite', 'closed'] as const)('without an invitation says sign-up is %s only', async (registrationMode) => {
    const { screen } = await renderSignUp({}, { registrationMode });
    await expect.element(screen.getByText('Pendaftaran hanya dengan undangan')).toBeVisible();
    await expect.element(screen.getByText('Minta admin instans ini mengirim undangan', { exact: false })).toBeVisible();
    await expect.element(screen.getByRole('textbox', { name: 'Email' })).not.toBeInTheDocument();
    await expect.element(screen.getByRole('link', { name: 'Masuk' })).toHaveAttribute('href', '/sign-in');
  });
});
