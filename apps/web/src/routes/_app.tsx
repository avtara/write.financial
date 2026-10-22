// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';
import { m } from '@wf/i18n/messages';
import { Toaster } from '@wf/ui/toast';
import * as z from 'zod';
import { ReconcileProvider } from '../components/accounts/reconcile.tsx';
import { AppShell } from '../components/app-shell.tsx';
import { AppCommandActions } from '../components/command-palette/app-actions.tsx';
import { CommandPaletteProvider } from '../components/command-palette/command-palette.tsx';
import { RecordTransactionProvider } from '../components/ledger/record-transaction.tsx';
import type { NavCounts } from '../components/nav.ts';
import { loadSettingsSection, SettingsDialog, type SettingsData } from '../components/settings/settings-dialog.tsx';
import { canOpenSection, SETTINGS_SECTIONS } from '../components/settings/settings-sections.ts';
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
 * its app-wide actions can use them) are mounted here once for every page. `?settings=<section>` on any page opens the
 * Settings dialog over it (`openSettings()`; `/settings/<section>` redirects there). The loader provides the nav badge
 * counts (`null` when they fail; the nav then shows none) and the open Settings section's data (`null` when closed or
 * not open to this user).
 */
export const Route = createFileRoute('/_app')({
  validateSearch: z.object({ settings: z.enum(SETTINGS_SECTIONS).optional().catch(undefined) }),
  loaderDeps: ({ search }) => ({ settings: search.settings }),
  beforeLoad: ({ context, location }) => {
    const { viewer } = context.gate;
    if (viewer === null) throw redirect({ to: '/sign-in', search: { redirect: location.href } });
    if (viewer.role === 'admin' && !viewer.twoFactorEnabled) throw redirect({ to: '/two-factor-setup' });
    if (viewer.onboardingStep !== null) {
      throw redirect({ to: '/onboarding/$step', params: { step: viewer.onboardingStep } });
    }
    return { viewer };
  },
  loader: async ({ deps, context }): Promise<{ navCounts: NavCounts | null; settings: SettingsData | null }> => {
    // Offline (FR-D4) the badges are left out rather than failing the page.
    const offline = (error: unknown) => {
      if (error instanceof TypeError) return null;
      throw error;
    };
    const section = deps.settings !== undefined && canOpenSection(deps.settings, context.viewer) ? deps.settings : null;
    const [transactions, review, subscriptions, notifications, settings] = await Promise.all([
      countPeriodTransactions().catch(offline),
      getReviewCounts().catch(offline),
      countActiveSubscriptions().catch(offline),
      getNotificationCounts({ data: {} }).catch(offline),
      section === null ? null : loadSettingsSection(section),
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
      settings,
    };
  },
  component: AppLayout,
});

function AppLayout() {
  const { viewer } = Route.useRouteContext();
  const { settings } = Route.useLoaderData();
  return (
    <>
      <ReconcileProvider timeZone={viewer.timezone}>
        <RecordTransactionProvider timeZone={viewer.timezone}>
          <CommandPaletteProvider>
            <AppCommandActions />
            <AppShell>
              <Outlet />
            </AppShell>
            <SettingsDialog viewer={viewer} data={settings} />
          </CommandPaletteProvider>
        </RecordTransactionProvider>
      </ReconcileProvider>
      <Toaster label={m.toast_region_label()} />
    </>
  );
}
