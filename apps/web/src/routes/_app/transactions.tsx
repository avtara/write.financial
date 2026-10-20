// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute, useRouter } from '@tanstack/react-router';
import { m } from '@wf/i18n/messages';
import { PageState } from '@wf/ui/page-state';
import { PageHeader } from '../../components/page-header.tsx';
import { usePreferences } from '../../components/preferences.tsx';
import { TransactionsPage } from '../../components/transactions/transactions-page.tsx';
import { ledgerErrorMessage } from '../../lib/ledger-errors.ts';
import { queryOf, TRANSACTIONS_SEARCH, type TransactionsSearch } from '../../lib/transactions-search.ts';
import { listAccounts, listCategories, listTags } from '../../server/fn/ledger.ts';
import { getTransactionsView } from '../../server/fn/transactions.ts';

/**
 * `/transactions` (FR-L1–L6): the transactions of a period (`?period=YYYY-MM`, default the current one) or a range
 * (`?range=from..to`) with the filters, view, and sort in the URL (see `lib/transactions-search.ts`); `?tx=<id>` opens
 * a transaction's detail. Only the query part reloads the data; switching the view or opening a detail does not.
 */
export const Route = createFileRoute('/_app/transactions')({
  validateSearch: TRANSACTIONS_SEARCH,
  loaderDeps: ({ search }) => queryOf(search),
  loader: async ({ deps }) => {
    const [view, accounts, categories, tags] = await Promise.all([
      getTransactionsView({ data: deps }),
      listAccounts({ data: {} }),
      listCategories({ data: {} }),
      listTags({ data: {} }),
    ]);
    return { view, accounts, categories, tags };
  },
  head: () => ({ meta: [{ title: `${m.transactions_page_title()} · ${m.app_name()}` }] }),
  component: TransactionsRoute,
});

function TransactionsRoute() {
  const { view, accounts, categories, tags } = Route.useLoaderData();
  const { viewer } = Route.useRouteContext();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  if (!view.ok) return <LoadFailed code={view.code} />;
  if (!accounts.ok) return <LoadFailed code={accounts.code} />;
  if (!categories.ok) return <LoadFailed code={categories.code} />;
  if (!tags.ok) return <LoadFailed code={tags.code} />;
  const { baseCurrency, accounts: accountViews, availableMinor: available } = accounts.value;
  return (
    <TransactionsPage
      view={view.value}
      search={search}
      ledger={{
        baseCurrency,
        accounts: accountViews,
        categories: categories.value,
        tags: tags.value,
      }}
      available={available}
      timeZone={viewer.timezone}
      onSearchChange={(patch: Partial<TransactionsSearch>) =>
        void navigate({ search: (previous) => ({ ...previous, ...patch }) })
      }
    />
  );
}

/** "Transaksi gagal dimuat" (design `dNUPl`) with "Coba lagi". */
function LoadFailed({ code }: { code: string }) {
  const { preferences } = usePreferences();
  const router = useRouter();
  return (
    <>
      <PageHeader
        breadcrumb={[m.transactions_page_breadcrumb(), m.transactions_page_title()]}
        title={m.transactions_page_title()}
      />
      <section className="rounded-[12px] border border-border bg-card">
        <PageState
          kind="error"
          title={m.transactions_page_load_failed()}
          description={ledgerErrorMessage(code, preferences.locale)}
          action={
            <button
              type="button"
              className="inline-flex h-8 items-center rounded-[6px] border border-border-input px-3 text-[13px] text-fg hover:bg-tint-06 focus-visible:outline-2 focus-visible:outline-ring"
              onClick={() => void router.invalidate()}
            >
              {m.transactions_page_retry()}
            </button>
          }
        />
      </section>
    </>
  );
}
