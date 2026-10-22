// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute, useRouter } from '@tanstack/react-router';
import { m } from '@wf/i18n/messages';
import { PageState } from '@wf/ui/page-state';
import { Button } from '../../components/form.tsx';
import { InvestmentsPage } from '../../components/investments/investments-page.tsx';
import { PageHeader } from '../../components/page-header.tsx';
import { usePreferences } from '../../components/preferences.tsx';
import { ledgerErrorMessage } from '../../lib/ledger-errors.ts';
import { getInvestments } from '../../server/fn/investments.ts';
import { listAccounts } from '../../server/fn/ledger.ts';

/** `/investments`: "Investasi" (FR-I1–I5, FR-G2/G5/G6) with the portfolio and the accounts trades move money with. */
export const Route = createFileRoute('/_app/investments')({
  loaderDeps: () => ({}),
  loader: async () => {
    const [overview, accounts] = await Promise.all([
      getInvestments({ data: {} }),
      listAccounts({ data: { status: 'all' } }),
    ]);
    return { overview, accounts };
  },
  head: () => ({ meta: [{ title: `${m.invest_title()} · ${m.app_name()}` }] }),
  pendingComponent: InvestmentsPending,
  component: InvestmentsRoute,
});

function InvestmentsRoute() {
  const { overview, accounts } = Route.useLoaderData();
  const { viewer } = Route.useRouteContext();
  if (!overview.ok) return <LoadFailed code={overview.code} />;
  if (!accounts.ok) return <LoadFailed code={accounts.code} />;
  return <InvestmentsPage overview={overview.value} accounts={accounts.value.accounts} timeZone={viewer.timezone} />;
}

function InvestmentsPending() {
  return (
    <>
      <PageHeader breadcrumb={[m.breadcrumb_finance(), m.invest_title()]} title={m.invest_title()} />
      <section className="rounded-[12px] border border-border bg-card">
        <PageState kind="loading" title={m.invest_loading()} />
      </section>
    </>
  );
}

function LoadFailed({ code }: { code: string }) {
  const { preferences } = usePreferences();
  const router = useRouter();
  return (
    <>
      <PageHeader breadcrumb={[m.breadcrumb_finance(), m.invest_title()]} title={m.invest_title()} />
      <section className="rounded-[12px] border border-border bg-card">
        <PageState
          kind="error"
          title={m.invest_load_failed()}
          description={ledgerErrorMessage(code, preferences.locale)}
          action={
            <Button variant="secondary" onClick={() => void router.invalidate()}>
              {m.invest_retry()}
            </Button>
          }
        />
      </section>
    </>
  );
}
