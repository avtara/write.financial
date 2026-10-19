// SPDX-License-Identifier: AGPL-3.0-only
import { isRedirect } from '@tanstack/react-router';
import type { ComponentType } from 'react';
import { describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { renderApp } from '../../test/render.tsx';
import type { Viewer } from '../server/gate.ts';
import { Route } from './_app.tsx';

const VIEWER: Viewer = {
  id: 'u1',
  sessionId: 's1',
  name: 'Sari',
  email: 'sari@example.test',
  image: null,
  locale: 'id',
  timezone: 'Asia/Jakarta',
  role: 'user',
  twoFactorEnabled: false,
};

function beforeLoad(viewer: Viewer | null, href = '/settings/security?x=1') {
  const hook = Route.options.beforeLoad;
  if (typeof hook !== 'function') throw new Error('_app beforeLoad missing');
  try {
    return hook({ context: { gate: { viewer } }, location: { href } } as never);
  } catch (error) {
    return error;
  }
}

describe('/_app layout', () => {
  it('sends signed-out visitors to sign in, coming back afterwards', () => {
    const redirect = beforeLoad(null);
    expect(isRedirect(redirect)).toBe(true);
    expect(redirect).toMatchObject({ options: { to: '/sign-in', search: { redirect: '/settings/security?x=1' } } });
  });

  it('makes admins without two-step verification enroll first', () => {
    const redirect = beforeLoad({ ...VIEWER, role: 'admin' });
    expect(isRedirect(redirect)).toBe(true);
    expect(redirect).toMatchObject({ options: { to: '/two-factor-setup' } });
  });

  it('lets users (2FA optional) and enrolled admins in, with the viewer in the context', () => {
    expect(beforeLoad(VIEWER)).toEqual({ viewer: VIEWER });
    const admin = { ...VIEWER, role: 'admin', twoFactorEnabled: true } as const;
    expect(beforeLoad(admin)).toEqual({ viewer: admin });
  });

  it('wraps its pages in the app shell, with one toast region', async () => {
    await page.viewport(1440, 900);
    const Layout = Route.options.component as ComponentType;
    const { screen } = await renderApp(<Layout />);
    await expect.element(screen.getByRole('main')).toBeInTheDocument();
    await expect.element(screen.getByRole('navigation', { name: 'Navigasi utama' })).toBeVisible();
    await expect.element(screen.getByRole('region', { name: 'Notifikasi' })).toBeInTheDocument();
  });
});
