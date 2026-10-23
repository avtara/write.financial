// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute, useRouter } from '@tanstack/react-router';
import { m } from '@wf/i18n/messages';
import { PageState } from '@wf/ui/page-state';
import { Button } from '../../components/form.tsx';
import { PageHeader } from '../../components/page-header.tsx';
import { usePreferences } from '../../components/preferences.tsx';
import { ReportsPage } from '../../components/reports/reports-page.tsx';
import { ledgerErrorMessage } from '../../lib/ledger-errors.ts';
import { getReportsHome } from '../../server/fn/reports.ts';

/** `/reports`: "Laporan" (FR-LP1–LP5), the saved report snapshots of closed periods and custom ranges. */
export const Route = createFileRoute('/_app/reports')({
  loaderDeps: () => ({}),
  loader: async () => ({ home: await getReportsHome({ data: {} }) }),
  head: () => ({ meta: [{ title: `${m.reports_title()} · ${m.app_name()}` }] }),
  pendingComponent: ReportsPending,
  component: ReportsRoute,
});

function ReportsRoute() {
  const { home } = Route.useLoaderData();
  const { viewer } = Route.useRouteContext();
  if (!home.ok) return <LoadFailed code={home.code} />;
  return (
    <ReportsPage
      reports={home.value.reports}
      latestFinal={home.value.latestFinal}
      today={home.value.today}
      timeZone={viewer.timezone}
      locale={viewer.locale}
    />
  );
}

function ReportsPending() {
  return (
    <>
      <PageHeader breadcrumb={[m.breadcrumb_finance(), m.reports_title()]} title={m.reports_title()} />
      <section className="rounded-[12px] border border-border bg-card">
        <PageState kind="loading" title={m.reports_loading()} />
      </section>
    </>
  );
}

function LoadFailed({ code }: { code: string }) {
  const { preferences } = usePreferences();
  const router = useRouter();
  return (
    <>
      <PageHeader breadcrumb={[m.breadcrumb_finance(), m.reports_title()]} title={m.reports_title()} />
      <section className="rounded-[12px] border border-border bg-card">
        <PageState
          kind="error"
          title={m.error_unknown()}
          description={ledgerErrorMessage(code, preferences.locale)}
          action={
            <Button variant="secondary" onClick={() => void router.invalidate()}>
              {m.reports_error_retry()}
            </Button>
          }
        />
      </section>
    </>
  );
}
