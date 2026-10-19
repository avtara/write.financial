// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute } from '@tanstack/react-router';
import { OverviewPage } from '../../components/overview-page.tsx';
import { listAccounts, listCategories, listTags } from '../../server/fn/ledger.ts';

/** `/`: the Overview; loads what the Quick Add bar picks from. */
export const Route = createFileRoute('/_app/')({
  loader: async () => {
    const [accounts, categories, tags] = await Promise.all([
      listAccounts({ data: {} }),
      listCategories({ data: {} }),
      listTags({ data: {} }),
    ]);
    return { accounts, categories, tags };
  },
  component: OverviewRoute,
});

function OverviewRoute() {
  const { accounts, categories, tags } = Route.useLoaderData();
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
            }
          : null
      }
    />
  );
}
