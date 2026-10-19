// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';
import { m } from '@wf/i18n/messages';
import { Toaster } from '@wf/ui/toast';
import { AppShell } from '../components/app-shell.tsx';
import { RecordTransactionProvider } from '../components/ledger/record-transaction.tsx';

/**
 * Pathless layout for every signed-in page. Signed-out visitors go to sign-in (and come back afterwards); admins
 * without two-step verification must enroll first, because 2FA is mandatory for admins (PRD §9.1, FR-A9). Toasts
 * (`toast()` from `@wf/ui/toast`) appear in the one `<Toaster>` mounted here, and the Record Transaction sheet (`N`,
 * FR-T1) is mounted here once for every page.
 */
export const Route = createFileRoute('/_app')({
  beforeLoad: ({ context, location }) => {
    const { viewer } = context.gate;
    if (viewer === null) throw redirect({ to: '/sign-in', search: { redirect: location.href } });
    if (viewer.role === 'admin' && !viewer.twoFactorEnabled) throw redirect({ to: '/two-factor-setup' });
    return { viewer };
  },
  component: AppLayout,
});

function AppLayout() {
  const { viewer } = Route.useRouteContext();
  return (
    <>
      <RecordTransactionProvider timeZone={viewer.timezone}>
        <AppShell>
          <Outlet />
        </AppShell>
      </RecordTransactionProvider>
      <Toaster label={m.toast_region_label()} />
    </>
  );
}
