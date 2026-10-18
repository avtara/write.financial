// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { renderAuthRoutes } from '../../../test/auth-routes.tsx';
import { fakeGate } from '../../../test/fake-auth.ts';
import { Route } from './sign-up.tsx';

describe('/sign-up', () => {
  it('shows the form for an invitation on an invite-only instance', async () => {
    const { screen } = await renderAuthRoutes([[Route, '/sign-up']], {
      path: '/sign-up?invitation=inv-token',
      gate: fakeGate({ registrationMode: 'invite', googleEnabled: true }),
    });
    await expect.element(screen.getByRole('heading', { name: 'Buat akun' })).toBeVisible();
    await expect.element(screen.getByRole('button', { name: 'Lanjut dengan Google' })).toBeVisible();
  });

  it('says sign-up needs an invitation when none came', async () => {
    const { screen } = await renderAuthRoutes([[Route, '/sign-up']], {
      path: '/sign-up',
      gate: fakeGate({ registrationMode: 'invite' }),
    });
    await expect.element(screen.getByText('Pendaftaran hanya dengan undangan')).toBeVisible();
  });
});
