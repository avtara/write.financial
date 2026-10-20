// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute } from '@tanstack/react-router';
import { OverviewPage } from '../../components/overview-page.tsx';
import { getBudgetStatus } from '../../server/fn/budget.ts';
import { listAccounts, listCategories, listTags } from '../../server/fn/ledger.ts';

/** `/`: the Overview; loads what the Quick Add bar picks from, with the budget for its category notes. */
export const Route = createFileRoute('/_app/')({
  loader: async () => {
    const [accounts, categories, tags, budget] = await Promise.all([
      listAccounts({ data: {} }),
      listCategories({ data: {} }),
      listTags({ data: {} }),
      getBudgetStatus({ data: {} }),
    ]);
    return { accounts, categories, tags, budget };
  },
  component: OverviewRoute,
});

function OverviewRoute() {
  const { accounts, categories, tags, budget } = Route.useLoaderData();
  const { viewer } = Route.useRouteContext();
  return (
    <OverviewPage
      timeZone={viewer.timezone}
      ledger={
        accounts.ok && categories.ok && tags.ok
          ? {
              baseCurrency: accounts.value.baseCurrency,
              accounts: accounts.value.accounts,
              categories: categories.value,
              tags: tags.value,
              ...(budget.ok ? { budget: { lines: budget.value.lines, currency: budget.value.baseCurrency } } : {}),
            }
          : null
      }
    />
  );
}
