// SPDX-License-Identifier: AGPL-3.0-only
import { isRedirect } from '@tanstack/react-router';
import type { ComponentType } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { renderApp } from '../../test/render.tsx';
import { AuthActionsProvider } from '../components/auth-actions.tsx';
import type { TotpEnrollmentProps } from '../components/totp-enrollment.tsx';
import type { AuthActions } from '../lib/auth-client.ts';
import type { Gate, Viewer } from '../server/gate.ts';
import { Route } from './two-factor-setup.tsx';

const navigation = vi.hoisted(() => ({ hardNavigate: vi.fn() }));
vi.mock('../lib/navigation.ts', () => navigation);

// Enrollment has its own tests; here it only shows what it was given.
vi.mock('../components/totp-enrollment.tsx', () => ({
  TotpEnrollment: ({ needsPassword, initialPassword, onDone }: TotpEnrollmentProps) => (
    <button type="button" onClick={onDone}>
      {`totp needsPassword=${String(needsPassword)} password=${initialPassword ?? 'none'}`}
    </button>
  ),
}));

const ADMIN: Viewer = {
  id: 'u1',
  sessionId: 's1',
  name: 'Ayu',
  email: 'ayu@example.com',
  image: null,
  locale: 'id',
  timezone: 'Asia/Jakarta',
  role: 'admin',
  twoFactorEnabled: false,
  onboardingStep: null,
};

function beforeLoad(viewer: Viewer | null): unknown {
  const gate: Gate = {
    setup: 'complete',
    viewer,
    instanceName: 'write.financial',
    registrationMode: 'closed',
    googleEnabled: false,
  };
  try {
    return (Route.options.beforeLoad as (options: { context: { gate: Gate } }) => unknown)({ context: { gate } });
  } catch (error) {
    return error;
  }
}

describe('/two-factor-setup', () => {
  it('sends signed-out visitors to sign in and enrolled ones home', () => {
    const signedOut = beforeLoad(null);
    expect(isRedirect(signedOut) && signedOut.options.to).toBe('/sign-in');
    const enrolled = beforeLoad({ ...ADMIN, twoFactorEnabled: true });
    expect(isRedirect(enrolled) && enrolled.options.to).toBe('/');
    expect(beforeLoad(ADMIN)).toBeUndefined();
  });

  it('explains that 2FA is mandatory, enrolls with the password, and opens the app afterwards', async () => {
    const Page = Route.options.component as ComponentType;
    const actions = {} as AuthActions;
    const { screen } = await renderApp(
      <AuthActionsProvider actions={actions}>
        <Page />
      </AuthActionsProvider>,
    );
    await expect.element(screen.getByRole('heading', { name: 'Aktifkan verifikasi dua langkah' })).toBeVisible();
    await expect.element(screen.getByText(/Akun admin wajib memakai verifikasi dua langkah/)).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'totp needsPassword=true password=none' }));
    expect(navigation.hardNavigate).toHaveBeenCalledWith('/');
  });

  it('signs out', async () => {
    const Page = Route.options.component as ComponentType;
    const signOut = vi.fn(() => Promise.resolve({ ok: true as const, value: null }));
    const { screen } = await renderApp(
      <AuthActionsProvider actions={{ signOut } as unknown as AuthActions}>
        <Page />
      </AuthActionsProvider>,
      { preferences: { locale: 'en' } },
    );
    await userEvent.click(screen.getByRole('button', { name: 'Sign out and use another account' }));
    expect(signOut).toHaveBeenCalledOnce();
    await vi.waitFor(() => {
      expect(navigation.hardNavigate).toHaveBeenCalledWith('/sign-in');
    });
  });
});
