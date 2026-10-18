// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { fail, fakeAuthActions, ok } from '../../../test/fake-auth.ts';
import { flushReact, renderApp, type RenderAppOptions } from '../../../test/render.tsx';
import type { AuthActions } from '../../lib/auth-client.ts';
import { AuthActionsProvider } from '../auth-actions.tsx';
import { ForgotPage, RESEND_COOLDOWN_SECONDS } from './forgot-page.tsx';

afterEach(() => {
  vi.useRealTimers();
});

function renderForgot(requestPasswordReset: AuthActions['requestPasswordReset'], options?: RenderAppOptions) {
  return renderApp(
    <AuthActionsProvider actions={fakeAuthActions({ requestPasswordReset })}>
      <ForgotPage />
    </AuthActionsProvider>,
    options,
  );
}

async function advance(seconds: number) {
  await vi.advanceTimersByTimeAsync(seconds * 1000);
  await flushReact();
}

describe('ForgotPage', () => {
  it('sends the link, then offers to send it again after a minute', async () => {
    const requestPasswordReset = vi.fn(() => ok(null));
    const { screen } = await renderForgot(requestPasswordReset);
    await expect.element(screen.getByRole('heading', { name: 'Lupa kata sandi' })).toBeVisible();
    await expect.element(screen.getByRole('link', { name: 'Masuk' })).toHaveAttribute('href', '/sign-in');
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'], now: new Date(2026, 9, 18, 16, 52, 5) });
    await userEvent.fill(screen.getByRole('textbox', { name: 'Email' }), 'avtara@example.test');
    await userEvent.click(screen.getByRole('button', { name: 'Kirim tautan reset' }));

    await expect.element(screen.getByRole('heading', { name: 'Cek email kamu' })).toBeVisible();
    await expect
      .element(screen.getByText('Kami mengirim tautan reset ke avtara@example.test. Tautan berlaku 30 menit.'))
      .toBeVisible();
    await expect
      .element(screen.getByRole('status'))
      .toHaveTextContent('Email terkirim · 16.52Tidak ada? Cek folder spam.');
    await expect.element(screen.getByText('Kirim ulang dalam 1:00')).toBeVisible();
    await expect.element(screen.getByRole('link', { name: 'Masuk' })).toBeVisible();
    expect(requestPasswordReset).toHaveBeenCalledWith('avtara@example.test');

    await advance(18);
    await expect.element(screen.getByText('Kirim ulang dalam 0:42')).toBeVisible();
    await advance(RESEND_COOLDOWN_SECONDS - 18);
    const resend = screen.getByRole('button', { name: 'Kirim ulang' });
    await expect.element(resend).toBeVisible();

    await userEvent.click(resend);
    await expect.element(screen.getByText('Kirim ulang dalam 1:00')).toBeVisible();
    await expect
      .element(screen.getByRole('status'))
      .toHaveTextContent('Email terkirim · 16.53Tidak ada? Cek folder spam.');
    expect(requestPasswordReset).toHaveBeenCalledTimes(2);
  });

  it('keeps the sent note when sending again fails', async () => {
    const requestPasswordReset = vi
      .fn<AuthActions['requestPasswordReset']>()
      .mockImplementationOnce(() => ok(null))
      .mockImplementationOnce(() => fail({ status: 429, code: 'RATE_LIMITED' }));
    const { screen } = await renderForgot(requestPasswordReset, { preferences: { locale: 'en' } });
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    await userEvent.fill(screen.getByRole('textbox', { name: 'Email' }), 'avtara@example.test');
    await userEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
    await expect.element(screen.getByRole('heading', { name: 'Check your email' })).toBeVisible();
    await advance(RESEND_COOLDOWN_SECONDS);
    await userEvent.click(screen.getByRole('button', { name: 'Resend' }));
    await expect
      .element(screen.getByRole('alert'))
      .toHaveTextContent('Too many attempts from this network. Try again in a moment.');
    await expect.element(screen.getByRole('button', { name: 'Resend' })).toBeEnabled();
  });

  it('shows why the link could not be sent under the email', async () => {
    const requestPasswordReset = vi.fn(() => fail({ status: 0, code: 'NETWORK' }));
    const { screen } = await renderForgot(requestPasswordReset);
    const email = screen.getByRole('textbox', { name: 'Email' });
    await userEvent.fill(email, 'avtara@example.test');
    await userEvent.keyboard('{Enter}');
    await expect.element(email).toHaveAccessibleDescription('Koneksi terputus. Coba lagi.');
    await expect.element(email).toHaveAttribute('aria-invalid', 'true');
    await expect.element(screen.getByRole('button', { name: 'Kirim tautan reset' })).toBeEnabled();
  });
});
