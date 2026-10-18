// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute, Outlet } from '@tanstack/react-router';
import { AppShell } from '../components/app-shell.tsx';

/** Pathless layout for every app page. Authentication guards attach here with the auth slice. */
export const Route = createFileRoute('/_app')({
  component: () => (
    <AppShell>
      <Outlet />
    </AppShell>
  ),
});
