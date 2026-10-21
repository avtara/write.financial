// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';
import { m } from '@wf/i18n/messages';
import { Toaster } from '@wf/ui/toast';
import { ReconcileProvider } from '../components/accounts/reconcile.tsx';
import { AppShell } from '../components/app-shell.tsx';
import { AppCommandActions } from '../components/command-palette/app-actions.tsx';
import { CommandPaletteProvider } from '../components/command-palette/command-palette.tsx';
import { RecordTransactionProvider } from '../components/ledger/record-transaction.tsx';
import type { NavCounts } from '../components/nav.ts';
import { countActiveSubscriptions } from '../server/fn/schedules.ts';
import { getNotificationCounts } from '../server/fn/notifications.ts';
import { getReviewCounts } from '../server/fn/review.ts';
import { countPeriodTransactions } from '../server/fn/transactions.ts';

/**
 * Pathless layout for every signed-in page. Signed-out visitors go to sign-in (and come back afterwards); admins
 * without two-step verification must enroll first, because 2FA is mandatory for admins (PRD §9.1, FR-A9); then a
 * user who has not finished the onboarding resumes it at the step they are on (FR-A4, `/onboarding/$step`). Toasts
 * (`toast()` from `@wf/ui/toast`) appear in the one `<Toaster>` mounted here, and the Record Transaction sheet (`N`,
 * FR-T1), "Sesuaikan saldo" (`useReconcile()`, FR-R4), and the ⌘K palette (`<CommandPaletteProvider>`, inside both so
 * its app-wide actions can use them) are mounted here once for every page. The loader provides the nav badge counts
 * (`null` when they fail; the nav then shows none).
 */
export const Route = createFileRoute('/_app')({
  beforeLoad: ({ context, location }) => {
    const { viewer } = context.gate;
    if (viewer === null) throw redirect({ to: '/sign-in', search: { redirect: location.href } });
    if (viewer.role === 'admin' && !viewer.twoFactorEnabled) throw redirect({ to: '/two-factor-setup' });
    if (viewer.onboardingStep !== null) {
      throw redirect({ to: '/onboarding/$step', params: { step: viewer.onboardingStep } });
    }
    return { viewer };
  },
  loader: async (): Promise<{ navCounts: NavCounts | null }> => {
    // Offline (FR-D4) the badges are left out rather than failing the page.
    const offline = (error: unknown) => {
      if (error instanceof TypeError) return null;
      throw error;
    };
    const [transactions, review, subscriptions, notifications] = await Promise.all([
      countPeriodTransactions().catch(offline),
      getReviewCounts().catch(offline),
      countActiveSubscriptions().catch(offline),
      getNotificationCounts({ data: {} }).catch(offline),
    ]);
    return {
      navCounts:
        transactions?.ok === true && review?.ok === true && subscriptions?.ok === true && notifications?.ok === true
          ? {
              transactions: transactions.value,
              review: review.value.total,
              subscriptions: subscriptions.value,
              notifications: notifications.value.unread,
            }
          : null,
    };
  },
  component: AppLayout,
});

function AppLayout() {
  const { viewer } = Route.useRouteContext();
  return (
    <>
      <ReconcileProvider timeZone={viewer.timezone}>
        <RecordTransactionProvider timeZone={viewer.timezone}>
          <CommandPaletteProvider>
            <AppCommandActions />
            <AppShell>
              <Outlet />
            </AppShell>
          </CommandPaletteProvider>
        </RecordTransactionProvider>
      </ReconcileProvider>
      <Toaster label={m.toast_region_label()} />
    </>
  );
}
