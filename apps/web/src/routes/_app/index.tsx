// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute, useHydrated, useRouter, useRouterState } from '@tanstack/react-router';
import { addDays } from '@wf/domain/period';
import { m } from '@wf/i18n/messages';
import { useEffect, useState } from 'react';
import { DashboardOffline, DashboardSkeleton } from '../../components/dashboard/dashboard-states.tsx';
import { lastOverview, rememberOverview } from '../../components/dashboard/last-overview.ts';
import { PageHeader } from '../../components/page-header.tsx';
import { usePreferences } from '../../components/preferences.tsx';
import { OverviewPage, type OverviewData } from '../../components/overview-page.tsx';
import { DEFAULT_DASHBOARD_LAYOUT, type DashboardCard } from '../../lib/dashboard-layout.ts';
import { DASHBOARD_SEARCH, dashboardRequestOf, type DashboardSearch } from '../../lib/dashboard-search.ts';
import { getProfile } from '../../server/fn/account.ts';
import { getBudgetStatus, getDashboard, listPeriods } from '../../server/fn/budget.ts';
import { getDashboardLayout } from '../../server/fn/dashboard-layout.ts';
import { listGoals } from '../../server/fn/goals.ts';
import { listAccounts, listCategories, listTags } from '../../server/fn/ledger.ts';
import { listAutoRules } from '../../server/fn/rules.ts';
import { listScheduled, listSubscriptions } from '../../server/fn/schedules.ts';

type OverviewLoad = ({ readonly status: 'ready' } & OverviewData) | { readonly status: 'offline' };

/** Everything `/` shows for `search`; a failed request (no connection) is `offline`, never an error page. */
async function loadOverview(search: DashboardSearch): Promise<OverviewLoad> {
  try {
    // Only `?period=` needs the period rows (its label → id): any other request runs alongside the rest.
    const known = search.period === undefined ? dashboardRequestOf(search, []) : null;
    const [periods, accounts, categories, tags, rules, profile, budget, subscriptions, layout, early] =
      await Promise.all([
        listPeriods(),
        listAccounts({ data: {} }),
        listCategories({ data: {} }),
        listTags({ data: {} }),
        listAutoRules({ data: { enabledOnly: true } }),
        getProfile(),
        getBudgetStatus({ data: {} }),
        listSubscriptions({ data: {} }),
        getDashboardLayout(),
        known === null ? null : getDashboard({ data: known }),
      ]);
    const request = known ?? dashboardRequestOf(search, periods.ok ? periods.value.periods : []);
    const dashboard = early ?? (await getDashboard({ data: request }));
    const shownPeriod = request.scope === 'month' ? request.periodId : undefined;
    // The addable cards (FR-D3) cost a request each: read only what the saved layout shows.
    const cards = (layout.ok ? layout.value : DEFAULT_DASHBOARD_LAYOUT).cards;
    const shows = (id: DashboardCard) => cards.some((card) => card.id === id && card.visible);
    const today = dashboard.ok ? dashboard.value.today : null;
    const [shownBudget, scheduled, goals, bills] = await Promise.all([
      shownPeriod === undefined || (periods.ok && shownPeriod === periods.value.current.id)
        ? null
        : getBudgetStatus({ data: { periodId: shownPeriod } }),
      dashboard.ok
        ? listScheduled({ data: { from: dashboard.value.ranges.full.from, to: dashboard.value.ranges.full.to } })
        : null,
      shows('goals') ? listGoals({ data: { status: 'active' } }) : null,
      shows('bills') && today !== null ? listScheduled({ data: { from: today, to: addDays(today, 6) } }) : null,
    ]);
    return {
      status: 'ready',
      accounts,
      categories,
      tags,
      rules,
      periods,
      profile,
      dashboard,
      budget,
      shownBudget,
      subscriptions,
      scheduled,
      layout,
      goals,
      bills,
      loadedAt: new Date(),
    };
  } catch (error) {
    // A server function call that never reached the server.
    if (error instanceof TypeError) return { status: 'offline' };
    throw error;
  }
}

/** `/` (FR-D1/D2/D4): the Overview of `?scope=`, `?period=`, `?year=`, or `?range=` (`lib/dashboard-search.ts`). */
export const Route = createFileRoute('/_app/')({
  validateSearch: DASHBOARD_SEARCH,
  // Its own keys only: opening Settings (the layout's `?settings=`) leaves the page loaded.
  loaderDeps: ({ search: { scope, period, year, range } }) => ({ scope, period, year, range }),
  loader: ({ deps }) => loadOverview(deps),
  pendingComponent: OverviewPending,
  component: OverviewRoute,
});

function OverviewPending() {
  const { viewer } = Route.useRouteContext();
  const last = lastOverview();
  if (last !== null) return <OverviewPage data={last} timeZone={viewer.timezone} refreshing />;
  return (
    <>
      <PageHeader
        breadcrumb={[m.breadcrumb_finance(), m.nav_overview()]}
        title={m.nav_overview()}
        description={m.overview_loading()}
      />
      <DashboardSkeleton />
    </>
  );
}

function OverviewRoute() {
  const load = Route.useLoaderData();
  const { viewer } = Route.useRouteContext();
  const router = useRouter();
  const { preferences } = usePreferences();
  // A reload can start (a transaction recorded right after the page opened) before this route has hydrated; the server
  // never renders "Memperbarui ringkasan…", so until then neither does the client (a hydration mismatch otherwise).
  const hydrated = useHydrated();
  const loading = useRouterState({ select: (state) => state.isLoading && state.location.pathname === '/' });
  const refreshing = hydrated && loading;
  const [showLast, setShowLast] = useState(false);
  useEffect(() => {
    if (load.status === 'ready') rememberOverview(load);
  }, [load]);

  if (load.status === 'ready') {
    return <OverviewPage data={load} timeZone={viewer.timezone} refreshing={refreshing} />;
  }
  const last = lastOverview();
  if (showLast && last !== null) return <OverviewPage data={last} timeZone={viewer.timezone} offline />;
  return (
    <>
      <PageHeader breadcrumb={[m.breadcrumb_finance(), m.nav_overview()]} title={m.nav_overview()} />
      <DashboardOffline
        lastLoadedAt={last?.loadedAt ?? null}
        onRetry={() => {
          void router.invalidate();
        }}
        onShowLast={() => {
          setShowLast(true);
        }}
        locale={preferences.locale}
        timeZone={viewer.timezone}
      />
    </>
  );
}
