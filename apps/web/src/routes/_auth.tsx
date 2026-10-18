// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';
import { AuthLayout } from '../components/auth-layout.tsx';
import { reauthFlag } from '../components/auth/search.ts';
import { safeRedirect } from '../lib/navigation.ts';

/**
 * Pathless layout of the signed-out pages. A signed-in visitor goes where they were headed instead, except on
 * `/sign-in?reauth=1`, where they confirm their password again (FR-A9).
 */
export const Route = createFileRoute('/_auth')({
  beforeLoad: ({ context, location }) => {
    const search: Record<string, unknown> = location.search;
    const reauth = location.pathname === '/sign-in' && reauthFlag(search.reauth) !== undefined;
    if (context.gate.viewer !== null && !reauth) throw redirect({ href: safeRedirect(search.redirect) });
  },
  component: () => (
    <AuthLayout>
      <Outlet />
    </AuthLayout>
  ),
});
