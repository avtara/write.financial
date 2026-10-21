// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute, useRouter } from '@tanstack/react-router';
import { m } from '@wf/i18n/messages';
import { PageState } from '@wf/ui/page-state';
import * as z from 'zod';
import { Button } from '../../components/form.tsx';
import { PageHeader } from '../../components/page-header.tsx';
import { usePreferences } from '../../components/preferences.tsx';
import { SubscriptionsPage } from '../../components/subscriptions/subscriptions-page.tsx';
import { ledgerErrorMessage } from '../../lib/ledger-errors.ts';
import { getBudgetStatus } from '../../server/fn/budget.ts';
import { listAccounts, listCategories } from '../../server/fn/ledger.ts';
import { listDetectedSubscriptions, listSubscriptions } from '../../server/fn/schedules.ts';

/**
 * `/subscriptions`: "Langganan" (FR-SUB1–SUB6) with every subscription, the detected candidates, the accounts and
 * categories, and the current period's spending and expected income for the KPI shares. `?subscription=<id>` opens
 * one's detail (⌘K), `?new` the form (the Overview's card, ⌘K "Tambah langganan").
 */
export const Route = createFileRoute('/_app/subscriptions')({
  validateSearch: z.object({
    subscription: z.uuid().optional().catch(undefined),
    new: z.literal(true).optional().catch(undefined),
  }),
  loader: async () => {
    const [overview, detected, accounts, categories, budget] = await Promise.all([
      listSubscriptions({ data: {} }),
      listDetectedSubscriptions(),
      listAccounts({ data: { status: 'all' } }),
      listCategories({ data: {} }),
      // Only the KPI shares need it.
      getBudgetStatus({ data: {} }).catch(() => null),
    ]);
    return { overview, detected, accounts, categories, budget };
  },
  head: () => ({ meta: [{ title: `${m.nav_subscriptions()} · ${m.app_name()}` }] }),
  pendingComponent: SubscriptionsPending,
  component: SubscriptionsRoute,
});

function SubscriptionsRoute() {
  const { overview, detected, accounts, categories, budget } = Route.useLoaderData();
  const { viewer } = Route.useRouteContext();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  if (!overview.ok) return <LoadFailed code={overview.code} />;
  if (!accounts.ok) return <LoadFailed code={accounts.code} />;
  if (!categories.ok) return <LoadFailed code={categories.code} />;
  const status = budget?.ok === true ? budget.value : null;
  const spent = status === null ? 0n : status.totals.spentMinor + status.totals.unbudgetedSpentMinor;
  const income = status?.version?.expectedIncomeMinor ?? null;
  return (
    <SubscriptionsPage
      overview={overview.value}
      detected={detected.ok ? detected.value : null}
      accounts={accounts.value.accounts}
      categories={categories.value}
      spentMinor={spent > 0n ? spent : null}
      incomeMinor={income !== null && income > 0n ? income : null}
      timeZone={viewer.timezone}
      {...(search.subscription === undefined ? {} : { initialSubscriptionId: search.subscription })}
      initialNew={search.new === true}
      onConsumeSearch={() => void navigate({ search: {}, replace: true })}
    />
  );
}

function SubscriptionsPending() {
  return (
    <>
      <PageHeader breadcrumb={[m.breadcrumb_finance(), m.nav_subscriptions()]} title={m.nav_subscriptions()} />
      <section className="rounded-[12px] border border-border bg-card">
        <PageState kind="loading" title={m.subscriptions_loading()} />
      </section>
    </>
  );
}

function LoadFailed({ code }: { code: string }) {
  const { preferences } = usePreferences();
  const router = useRouter();
  return (
    <>
      <PageHeader breadcrumb={[m.breadcrumb_finance(), m.nav_subscriptions()]} title={m.nav_subscriptions()} />
      <section className="rounded-[12px] border border-border bg-card">
        <PageState
          kind="error"
          title={m.subscriptions_load_failed()}
          description={`${ledgerErrorMessage(code, preferences.locale)} ${m.subscriptions_load_failed_reminders()}`}
          action={
            <Button variant="secondary" onClick={() => void router.invalidate()}>
              {m.subscriptions_retry()}
            </Button>
          }
        />
      </section>
    </>
  );
}
