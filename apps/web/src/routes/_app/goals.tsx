// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute, useRouter } from '@tanstack/react-router';
import { m } from '@wf/i18n/messages';
import { PageState } from '@wf/ui/page-state';
import * as z from 'zod';
import { Button } from '../../components/form.tsx';
import { GoalsPage } from '../../components/goals/goals-page.tsx';
import { PageHeader } from '../../components/page-header.tsx';
import { usePreferences } from '../../components/preferences.tsx';
import { ledgerErrorMessage } from '../../lib/ledger-errors.ts';
import { yearMonthParam } from '../../lib/transactions-search.ts';
import { getGoals } from '../../server/fn/goals.ts';
import { listInvestmentAssets } from '../../server/fn/investments.ts';
import { listAccounts } from '../../server/fn/ledger.ts';

/**
 * `/goals`: "Tabungan" (FR-G1, G3, G4, FR-B6) with every goal, the month's contributions (`?month=YYYY-MM`, default
 * the current one), and the accounts. `?goal=<id>` opens a goal's detail, `?new` the form, `?remainder=<id>` "Pindahkan
 * sisa" (the Record sheet's toast after paying from a goal).
 */
export const Route = createFileRoute('/_app/goals')({
  validateSearch: z.object({
    month: yearMonthParam.optional().catch(undefined),
    goal: z.uuid().optional().catch(undefined),
    new: z.literal(true).optional().catch(undefined),
    remainder: z.uuid().optional().catch(undefined),
  }),
  loaderDeps: ({ search }) => ({ month: search.month }),
  loader: async ({ deps }) => {
    const [overview, accounts, assets] = await Promise.all([
      getGoals({ data: deps.month === undefined ? {} : { month: deps.month } }),
      listAccounts({ data: { status: 'all' } }),
      // Asset sources and price notices only: the page works without them.
      listInvestmentAssets({ data: {} }).catch(() => null),
    ]);
    return { overview, accounts, assets };
  },
  head: () => ({ meta: [{ title: `${m.nav_goals()} · ${m.app_name()}` }] }),
  pendingComponent: GoalsPending,
  component: GoalsRoute,
});

function GoalsRoute() {
  const { overview, accounts, assets } = Route.useLoaderData();
  const { viewer } = Route.useRouteContext();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  if (!overview.ok) return <LoadFailed code={overview.code} />;
  if (!accounts.ok) return <LoadFailed code={accounts.code} />;
  return (
    <GoalsPage
      overview={overview.value}
      accounts={accounts.value.accounts}
      assets={assets?.ok === true ? assets.value : []}
      timeZone={viewer.timezone}
      initialGoalId={search.goal}
      initialNew={search.new === true}
      initialRemainderId={search.remainder}
      onConsumeSearch={() => {
        void navigate({
          search: (previous) => ({ ...previous, goal: undefined, new: undefined, remainder: undefined }),
          replace: true,
        });
      }}
      onMonthChange={(month) => {
        void navigate({ search: (previous) => ({ ...previous, month }) });
      }}
    />
  );
}

function GoalsPending() {
  return (
    <>
      <PageHeader breadcrumb={[m.breadcrumb_finance(), m.nav_goals()]} title={m.nav_goals()} />
      <section className="rounded-[12px] border border-border bg-card">
        <PageState kind="loading" title={m.goals_loading()} />
      </section>
    </>
  );
}

function LoadFailed({ code }: { code: string }) {
  const { preferences } = usePreferences();
  const router = useRouter();
  return (
    <>
      <PageHeader breadcrumb={[m.breadcrumb_finance(), m.nav_goals()]} title={m.nav_goals()} />
      <section className="rounded-[12px] border border-border bg-card">
        <PageState
          kind="error"
          title={m.goals_load_failed()}
          description={ledgerErrorMessage(code, preferences.locale)}
          action={
            <Button variant="secondary" onClick={() => void router.invalidate()}>
              {m.goals_retry()}
            </Button>
          }
        />
      </section>
    </>
  );
}
