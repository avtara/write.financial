// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { renderAuthRoutes } from '../../../test/auth-routes.tsx';
import { Route } from './reset-password.tsx';

describe('/reset-password', () => {
  it('asks for a new password when the link carries a token', async () => {
    const { screen } = await renderAuthRoutes([[Route, '/reset-password']], { path: '/reset-password?token=abc123' });
    await expect.element(screen.getByRole('heading', { name: 'Atur kata sandi baru' })).toBeVisible();
  });

  it('explains a dead link', async () => {
    const { screen } = await renderAuthRoutes([[Route, '/reset-password']], {
      path: '/reset-password?error=INVALID_TOKEN',
    });
    await expect.element(screen.getByRole('heading', { name: 'Tautan tidak berlaku' })).toBeVisible();
  });
});
