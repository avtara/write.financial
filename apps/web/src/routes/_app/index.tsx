// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute, useRouter, useRouterState } from '@tanstack/react-router';
import { m } from '@wf/i18n/messages';
import { useEffect, useState } from 'react';
import { DashboardOffline, DashboardSkeleton } from '../../components/dashboard/dashboard-states.tsx';
import { lastOverview, rememberOverview } from '../../components/dashboard/last-overview.ts';
import { PageHeader } from '../../components/page-header.tsx';
import { usePreferences } from '../../components/preferences.tsx';
import { OverviewPage, type OverviewData } from '../../components/overview-page.tsx';
import { DASHBOARD_SEARCH, dashboardRequestOf, type DashboardSearch } from '../../lib/dashboard-search.ts';
import { getProfile } from '../../server/fn/account.ts';
import { getBudgetStatus, getDashboard, listPeriods } from '../../server/fn/budget.ts';
import { listAccounts, listCategories, listTags } from '../../server/fn/ledger.ts';
import { listScheduled, listSubscriptions } from '../../server/fn/schedules.ts';

type OverviewLoad = ({ readonly status: 'ready' } & OverviewData) | { readonly status: 'offline' };

/** Everything `/` shows for `search`; a failed request (no connection) is `offline`, never an error page. */
async function loadOverview(search: DashboardSearch): Promise<OverviewLoad> {
  try {
    const [periods, accounts, categories, tags, profile, budget, subscriptions] = await Promise.all([
      listPeriods(),
      listAccounts({ data: {} }),
      listCategories({ data: {} }),
      listTags({ data: {} }),
      getProfile(),
      getBudgetStatus({ data: {} }),
      listSubscriptions({ data: {} }),
    ]);
    const request = dashboardRequestOf(search, periods.ok ? periods.value.periods : []);
    const dashboard = await getDashboard({ data: request });
    const shownPeriod = request.scope === 'month' ? request.periodId : undefined;
    const [shownBudget, scheduled] = await Promise.all([
      shownPeriod === undefined || (periods.ok && shownPeriod === periods.value.current.id)
        ? null
        : getBudgetStatus({ data: { periodId: shownPeriod } }),
      dashboard.ok
        ? listScheduled({ data: { from: dashboard.value.ranges.full.from, to: dashboard.value.ranges.full.to } })
        : null,
    ]);
    return {
      status: 'ready',
      accounts,
      categories,
      tags,
      periods,
      profile,
      dashboard,
      budget,
      shownBudget,
      subscriptions,
      scheduled,
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
  loaderDeps: ({ search }) => search,
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
  const refreshing = useRouterState({ select: (state) => state.isLoading && state.location.pathname === '/' });
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
