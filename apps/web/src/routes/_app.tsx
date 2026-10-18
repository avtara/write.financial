// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';
import { AppShell } from '../components/app-shell.tsx';

/**
 * Pathless layout for every signed-in page. Signed-out visitors go to sign-in (and come back afterwards); admins
 * without two-step verification must enroll first, because 2FA is mandatory for admins (PRD §9.1, FR-A9).
 */
export const Route = createFileRoute('/_app')({
  beforeLoad: ({ context, location }) => {
    const { viewer } = context.gate;
    if (viewer === null) throw redirect({ to: '/sign-in', search: { redirect: location.href } });
    if (viewer.role === 'admin' && !viewer.twoFactorEnabled) throw redirect({ to: '/two-factor-setup' });
    return { viewer };
  },
  component: () => (
    <AppShell>
      <Outlet />
    </AppShell>
  ),
});
