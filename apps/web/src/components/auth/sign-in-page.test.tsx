// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { VIEWER, fail, fakeAuthActions, ok } from '../../../test/fake-auth.ts';
import { renderApp } from '../../../test/render.tsx';
import type { AuthActions } from '../../lib/auth-client.ts';
import { hardNavigate } from '../../lib/navigation.ts';
import { AuthActionsProvider } from '../auth-actions.tsx';
import { SignInPage, type SignInPageProps } from './sign-in-page.tsx';

vi.mock('../../lib/navigation.ts', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  hardNavigate: vi.fn(),
}));

afterEach(() => {
  vi.mocked(hardNavigate).mockClear();
});

async function renderSignIn(actions: Partial<AuthActions>, props: Partial<SignInPageProps> = {}) {
  const revokeSession = vi.fn(() => Promise.resolve(null));
  const result = await renderApp(
    <AuthActionsProvider actions={fakeAuthActions(actions)}>
      <SignInPage
        redirect="/settings"
        reauthViewer={null}
        googleEnabled={false}
        signUpOffered
        revokeSession={revokeSession}
        {...props}
      />
    </AuthActionsProvider>,
  );
  const { screen } = result;
  const fillAndSubmit = async (email: string | null, password: string) => {
    if (email !== null) await userEvent.fill(screen.getByRole('textbox', { name: 'Email' }), email);
    await userEvent.fill(screen.getByLabelText('Kata sandi', { exact: true }), password);
    await userEvent.click(screen.getByRole('button', { name: 'Masuk' }));
  };
  return { ...result, revokeSession, fillAndSubmit };
}

describe('SignInPage', () => {
  it('signs in and loads the page the visitor was headed to', async () => {
    const signInEmail = vi.fn(() => ok({ twoFactor: false }));
    const { screen, fillAndSubmit, revokeSession } = await renderSignIn({ signInEmail });
    await expect.element(screen.getByRole('heading', { name: 'Masuk ke write.financial' })).toBeVisible();
    await expect.element(screen.getByText('Selamat datang kembali.')).toBeVisible();
    await expect.element(screen.getByRole('link', { name: 'Lupa kata sandi?' })).toHaveAttribute('href', '/forgot');
    await expect.element(screen.getByRole('link', { name: 'Daftar' })).toHaveAttribute('href', '/sign-up');
    await expect.element(screen.getByRole('button', { name: 'Lanjut dengan Google' })).not.toBeInTheDocument();
    await expect.element(screen.getByRole('checkbox', { name: 'Ingat perangkat ini selama 30 hari' })).toBeChecked();
    await fillAndSubmit('avtara@example.test', 'kata-sandi-panjang');
    await vi.waitFor(() => {
      expect(hardNavigate).toHaveBeenCalledWith('/settings');
    });
    expect(signInEmail).toHaveBeenCalledWith({
      email: 'avtara@example.test',
      password: 'kata-sandi-panjang',
      rememberMe: true,
    });
    expect(revokeSession).not.toHaveBeenCalled();
  });

  it('shows the tries left under the password and forgets the device when asked', async () => {
    const signInEmail = vi.fn(() => fail({ status: 401, code: 'INVALID_PASSWORD', remainingAttempts: 3 }));
    const { screen, fillAndSubmit } = await renderSignIn({ signInEmail });
    await userEvent.click(screen.getByRole('checkbox', { name: 'Ingat perangkat ini selama 30 hari' }));
    await fillAndSubmit('avtara@example.test', 'salah');
    const password = screen.getByLabelText('Kata sandi', { exact: true });
    await expect
      .element(password)
      .toHaveAccessibleDescription('Kata sandi salah · sisa 3 percobaan sebelum dikunci 15 menit');
    await expect.element(password).toHaveAttribute('aria-invalid', 'true');
    await expect.element(screen.getByRole('button', { name: 'Masuk' })).toBeEnabled();
    expect(signInEmail).toHaveBeenCalledWith({ email: 'avtara@example.test', password: 'salah', rememberMe: false });
    expect(hardNavigate).not.toHaveBeenCalled();
  });

  it('says until when a locked account stays locked, in English too', async () => {
    const lockedUntil = new Date(2026, 9, 18, 16, 52);
    const signInEmail = vi.fn(() => fail({ status: 423, code: 'ACCOUNT_LOCKED', lockedUntil }));
    const { screen } = await renderApp(
      <AuthActionsProvider actions={fakeAuthActions({ signInEmail })}>
        <SignInPage
          redirect={undefined}
          reauthViewer={null}
          googleEnabled
          signUpOffered={false}
          revokeSession={vi.fn()}
        />
      </AuthActionsProvider>,
      { preferences: { locale: 'en' } },
    );
    await expect.element(screen.getByRole('heading', { name: 'Sign in to write.financial' })).toBeVisible();
    await expect.element(screen.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
    await expect.element(screen.getByRole('link', { name: 'Sign up' })).not.toBeInTheDocument();
    await userEvent.fill(screen.getByRole('textbox', { name: 'Email' }), 'avtara@example.test');
    await userEvent.fill(screen.getByLabelText('Password', { exact: true }), 'salah');
    await userEvent.keyboard('{Enter}');
    await expect
      .element(screen.getByLabelText('Password', { exact: true }))
      .toHaveAccessibleDescription('The account is locked until 16:52 after too many wrong attempts.');
  });

  it('continues at /2fa with the destination and the email in the history entry', async () => {
    const signInEmail = vi.fn(() => ok({ twoFactor: true }));
    const { router, fillAndSubmit } = await renderSignIn({ signInEmail });
    await fillAndSubmit('avtara@example.test', 'kata-sandi-panjang');
    await vi.waitFor(() => {
      expect(router.state.location.pathname).toBe('/2fa');
    });
    expect(router.state.location.search).toEqual({ redirect: '/settings' });
    expect(router.state.location.state).toMatchObject({ email: 'avtara@example.test' });
    expect(hardNavigate).not.toHaveBeenCalled();
  });

  describe('re-authentication', () => {
    it('asks the viewer for their password and ends the previous session afterwards', async () => {
      const signInEmail = vi.fn(() => ok({ twoFactor: false }));
      const { screen, fillAndSubmit, revokeSession } = await renderSignIn(
        { signInEmail },
        { reauthViewer: VIEWER, googleEnabled: true, redirect: '/admin/queues' },
      );
      await expect.element(screen.getByRole('heading', { name: 'Masuk lagi untuk melanjutkan' })).toBeVisible();
      const email = screen.getByRole('textbox', { name: 'Email' });
      await expect.element(email).toHaveValue(VIEWER.email);
      await expect.element(email).toHaveAttribute('readonly');
      await expect.element(screen.getByRole('button', { name: 'Lanjut dengan Google' })).not.toBeInTheDocument();
      await expect.element(screen.getByRole('link', { name: 'Daftar' })).not.toBeInTheDocument();
      await fillAndSubmit(null, 'kata-sandi-panjang');
      await vi.waitFor(() => {
        expect(hardNavigate).toHaveBeenCalledWith('/admin/queues');
      });
      expect(revokeSession).toHaveBeenCalledWith(VIEWER.sessionId);
      expect(signInEmail).toHaveBeenCalledWith({
        email: VIEWER.email,
        password: 'kata-sandi-panjang',
        rememberMe: true,
      });
    });

    it('passes the previous session on to /2fa', async () => {
      const signInEmail = vi.fn(() => ok({ twoFactor: true }));
      const { router, fillAndSubmit, revokeSession } = await renderSignIn(
        { signInEmail },
        { reauthViewer: VIEWER, redirect: undefined },
      );
      await fillAndSubmit(null, 'kata-sandi-panjang');
      await vi.waitFor(() => {
        expect(router.state.location.pathname).toBe('/2fa');
      });
      expect(router.state.location.search).toEqual({ previous: VIEWER.sessionId });
      expect(revokeSession).not.toHaveBeenCalled();
    });
  });
});
