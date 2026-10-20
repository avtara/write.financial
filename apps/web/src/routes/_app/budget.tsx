// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute } from '@tanstack/react-router';
import { m } from '@wf/i18n/messages';
import { PageState } from '@wf/ui/page-state';
import * as z from 'zod';
import { BudgetPage } from '../../components/budget/budget-page.tsx';
import { PageHeader } from '../../components/page-header.tsx';
import { usePreferences } from '../../components/preferences.tsx';
import { ledgerErrorMessage } from '../../lib/ledger-errors.ts';
import { getBudgetStatus, listPeriods, listPeriodSpending } from '../../server/fn/budget.ts';
import { listAccounts, listCategories } from '../../server/fn/ledger.ts';

/**
 * `/budget`: "Anggaran" (FR-B1–B5) of the current period, or of `?period=<id>` (closed periods are read-only, FR-P3),
 * with the period list for the switcher, the categories (names, "Tambah kategori anggaran"), the accounts (detail
 * transactions), and the period's spending per category.
 */
export const Route = createFileRoute('/_app/budget')({
  validateSearch: z.object({ period: z.uuid().optional().catch(undefined) }),
  loaderDeps: ({ search }) => ({ period: search.period }),
  loader: async ({ deps }) => {
    const [status, periods, categories, accounts] = await Promise.all([
      getBudgetStatus({ data: deps.period === undefined ? {} : { periodId: deps.period } }),
      listPeriods(),
      listCategories({ data: {} }),
      listAccounts({ data: { status: 'all' } }),
    ]);
    const periodId = status.ok ? status.value.period.id : null;
    const spending = periodId === null ? null : await listPeriodSpending({ data: { periodId } });
    return { status, periods, categories, accounts, spending };
  },
  head: () => ({ meta: [{ title: `${m.nav_budget()} · ${m.app_name()}` }] }),
  component: BudgetRoute,
});

function BudgetRoute() {
  const { status, periods, categories, accounts, spending } = Route.useLoaderData();
  const navigate = Route.useNavigate();
  const { viewer } = Route.useRouteContext();
  if (!status.ok) return <LoadFailed code={status.code} />;
  if (!periods.ok) return <LoadFailed code={periods.code} />;
  if (!categories.ok) return <LoadFailed code={categories.code} />;
  if (!accounts.ok) return <LoadFailed code={accounts.code} />;
  return (
    <BudgetPage
      status={status.value}
      periods={periods.value}
      categories={categories.value}
      accounts={accounts.value.accounts}
      spending={spending?.ok === true ? spending.value : []}
      timeZone={viewer.timezone}
      onPeriodChange={(periodId) =>
        void navigate({ search: periodId === periods.value.current.id ? {} : { period: periodId } })
      }
    />
  );
}

function LoadFailed({ code }: { code: string }) {
  const { preferences } = usePreferences();
  return (
    <>
      <PageHeader breadcrumb={[m.breadcrumb_finance(), m.nav_budget()]} title={m.nav_budget()} />
      <section className="rounded-[12px] border border-border bg-card">
        <PageState
          kind="error"
          title={m.budget_load_failed()}
          description={ledgerErrorMessage(code, preferences.locale)}
        />
      </section>
    </>
  );
}
