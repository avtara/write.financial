// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { renderAuthRoutes } from '../../../test/auth-routes.tsx';
import { fakeAuthActions, ok } from '../../../test/fake-auth.ts';
import { hardNavigate } from '../../lib/navigation.ts';
import { revokeDevice } from '../../server/fn/account.ts';
import { Route } from './2fa.tsx';

vi.mock('../../server/fn/account.ts', () => ({
  revokeDevice: vi.fn(() => Promise.resolve({ ok: true, value: null })),
}));
vi.mock('../../lib/navigation.ts', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  hardNavigate: vi.fn(),
}));

afterEach(() => {
  vi.mocked(hardNavigate).mockClear();
});

describe('/2fa', () => {
  it('names the email from the sign-in page and ends the replaced session after the code', async () => {
    const verifyTotp = vi.fn(() => ok(null));
    const { screen, router } = await renderAuthRoutes([[Route, '/2fa']], {
      path: '/',
      actions: fakeAuthActions({ verifyTotp }),
    });
    await router.navigate({
      to: '/2fa',
      search: { redirect: '/settings', previous: 'old-session' },
      state: { email: 'avtara@example.test' },
    } as never);
    await expect
      .element(screen.getByText('Masukkan kode 6 digit dari aplikasi autentikator untuk avtara@example.test.'))
      .toBeVisible();
    await userEvent.fill(screen.getByRole('textbox', { name: 'Digit 1 dari 6' }), '123456');
    await vi.waitFor(() => {
      expect(hardNavigate).toHaveBeenCalledWith('/settings');
    });
    expect(revokeDevice).toHaveBeenCalledWith({ data: { id: 'old-session' } });
  });

  it('asks for the code without an email when the browser does not know it', async () => {
    const { screen } = await renderAuthRoutes([[Route, '/2fa']], { path: '/2fa' });
    await expect.element(screen.getByText('Masukkan kode 6 digit dari aplikasi autentikator.')).toBeVisible();
  });
});
