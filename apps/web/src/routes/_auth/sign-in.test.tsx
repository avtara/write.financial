// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { renderAuthRoutes } from '../../../test/auth-routes.tsx';
import { VIEWER, fakeAuthActions, fakeGate, ok } from '../../../test/fake-auth.ts';
import { hardNavigate } from '../../lib/navigation.ts';
import { revokeDevice } from '../../server/fn/account.ts';
import { Route } from './sign-in.tsx';

vi.mock('../../server/fn/account.ts', () => ({
  revokeDevice: vi.fn(() => Promise.resolve({ ok: true, value: null })),
}));
vi.mock('../../lib/navigation.ts', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  hardNavigate: vi.fn(),
}));

afterEach(() => {
  vi.mocked(hardNavigate).mockClear();
  vi.mocked(revokeDevice).mockClear();
});

describe('/sign-in', () => {
  it('offers Google and hides sign-up as the instance is set up', async () => {
    const { screen } = await renderAuthRoutes([[Route, '/sign-in']], {
      path: '/sign-in',
      gate: fakeGate({ googleEnabled: true, registrationMode: 'closed' }),
    });
    await expect.element(screen.getByRole('heading', { name: 'Masuk ke write.financial' })).toBeVisible();
    await expect.element(screen.getByRole('button', { name: 'Lanjut dengan Google' })).toBeVisible();
    await expect.element(screen.getByRole('link', { name: 'Daftar' })).not.toBeInTheDocument();
  });

  it('shows the normal sign-in when ?reauth=1 comes without a viewer', async () => {
    const { screen } = await renderAuthRoutes([[Route, '/sign-in']], { path: '/sign-in?reauth=1' });
    await expect.element(screen.getByRole('heading', { name: 'Masuk ke write.financial' })).toBeVisible();
    await expect.element(screen.getByRole('link', { name: 'Daftar' })).toHaveAttribute('href', '/sign-up');
  });

  it('re-authenticates the viewer and ends their previous session on the server', async () => {
    const signInEmail = vi.fn(() => ok({ twoFactor: false }));
    const { screen } = await renderAuthRoutes([[Route, '/sign-in']], {
      path: '/sign-in?redirect=%2Fsettings&reauth=1',
      gate: fakeGate({ viewer: VIEWER }),
      actions: fakeAuthActions({ signInEmail }),
    });
    await expect.element(screen.getByRole('textbox', { name: 'Email' })).toHaveValue(VIEWER.email);
    await userEvent.fill(screen.getByLabelText('Kata sandi', { exact: true }), 'kata-sandi-panjang');
    await userEvent.click(screen.getByRole('button', { name: 'Masuk' }));
    await vi.waitFor(() => {
      expect(hardNavigate).toHaveBeenCalledWith('/settings');
    });
    expect(revokeDevice).toHaveBeenCalledWith({ data: { id: VIEWER.sessionId } });
  });
});
