// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { renderAuthRoutes } from '../../test/auth-routes.tsx';
import { VIEWER, fakeGate } from '../../test/fake-auth.ts';
import { Route as ForgotRoute } from './_auth/forgot.tsx';
import { Route as SignInRoute } from './_auth/sign-in.tsx';

vi.mock('../server/fn/account.ts', () => ({ revokeDevice: vi.fn() }));

const PAGES = [
  [ForgotRoute, '/forgot'],
  [SignInRoute, '/sign-in'],
] as const;

beforeEach(async () => {
  await page.viewport(1440, 900);
});

describe('/_auth layout', () => {
  it('frames signed-out pages with the brand panel and the language switcher', async () => {
    const { screen } = await renderAuthRoutes(PAGES, { path: '/forgot' });
    await expect.element(screen.getByRole('complementary')).toBeVisible();
    await expect.element(screen.getByRole('combobox', { name: 'Bahasa' })).toBeVisible();
    await expect.element(screen.getByRole('main').getByRole('heading', { name: 'Lupa kata sandi' })).toBeVisible();
  });

  it('sends a signed-in visitor where they were headed', async () => {
    const { router } = await renderAuthRoutes(PAGES, {
      path: '/forgot?redirect=%2Fsettings',
      gate: fakeGate({ viewer: VIEWER }),
    });
    expect(router.state.location.pathname).toBe('/settings');
  });

  it('never follows a redirect to another site', async () => {
    const { router } = await renderAuthRoutes(PAGES, {
      path: '/sign-in?redirect=%2F%2Fevil.example',
      gate: fakeGate({ viewer: VIEWER }),
    });
    expect(router.state.location.pathname).toBe('/');
  });

  it('lets a signed-in viewer re-authenticate on /sign-in?reauth=1', async () => {
    const { screen, router } = await renderAuthRoutes(PAGES, {
      path: '/sign-in?reauth=1',
      gate: fakeGate({ viewer: VIEWER }),
    });
    expect(router.state.location.pathname).toBe('/sign-in');
    await expect.element(screen.getByRole('heading', { name: 'Masuk lagi untuk melanjutkan' })).toBeVisible();
  });

  it('does not treat ?reauth=1 on other pages as re-authentication', async () => {
    const { router } = await renderAuthRoutes(PAGES, { path: '/forgot?reauth=1', gate: fakeGate({ viewer: VIEWER }) });
    expect(router.state.location.pathname).toBe('/');
  });
});
