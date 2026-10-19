// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute } from '@tanstack/react-router';
import { m } from '@wf/i18n/messages';
import { ACCOUNT_TYPES } from '@wf/domain/ledger';
import { PageState } from '@wf/ui/page-state';
import * as z from 'zod';
import { AccountsPage } from '../../components/accounts/accounts-page.tsx';
import { PageHeader } from '../../components/page-header.tsx';
import { usePreferences } from '../../components/preferences.tsx';
import { ledgerErrorMessage } from '../../lib/ledger-errors.ts';
import { listAccounts, listCategories } from '../../server/fn/ledger.ts';

/**
 * `/accounts`: "Rekening & dompet" (FR-R1–R6) with every account (both tabs) and the categories for reconciling.
 * `?account=<id>` selects an account, `?new=<type>` opens "Tambah rekening" (links from ⌘K and other pages).
 */
export const Route = createFileRoute('/_app/accounts')({
  validateSearch: z.object({
    account: z.uuid().optional().catch(undefined),
    new: z.enum(ACCOUNT_TYPES).optional().catch(undefined),
  }),
  loader: async () => {
    const [accounts, categories] = await Promise.all([
      listAccounts({ data: { status: 'all' } }),
      listCategories({ data: {} }),
    ]);
    return { accounts, categories };
  },
  head: () => ({ meta: [{ title: `${m.accounts_title()} · ${m.app_name()}` }] }),
  component: AccountsRoute,
});

function AccountsRoute() {
  const { accounts, categories } = Route.useLoaderData();
  const { viewer } = Route.useRouteContext();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  if (!accounts.ok) return <LoadFailed code={accounts.code} />;
  if (!categories.ok) return <LoadFailed code={categories.code} />;
  return (
    <AccountsPage
      overview={accounts.value}
      categories={categories.value}
      timeZone={viewer.timezone}
      {...(search.account === undefined ? {} : { initialAccountId: search.account })}
      {...(search.new === undefined ? {} : { initialNewType: search.new })}
      onConsumeSearch={() => void navigate({ search: {}, replace: true })}
    />
  );
}

function LoadFailed({ code }: { code: string }) {
  const { preferences } = usePreferences();
  return (
    <>
      <PageHeader breadcrumb={[m.nav_group_account(), m.accounts_title()]} title={m.accounts_title()} />
      <section className="rounded-[12px] border border-border bg-card">
        <PageState
          kind="error"
          title={m.accounts_load_failed()}
          description={ledgerErrorMessage(code, preferences.locale)}
        />
      </section>
    </>
  );
}
