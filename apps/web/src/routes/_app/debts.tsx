// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute, useRouter } from '@tanstack/react-router';
import { m } from '@wf/i18n/messages';
import { PageState } from '@wf/ui/page-state';
import * as z from 'zod';
import { DebtsPage } from '../../components/debts/debts-page.tsx';
import { Button } from '../../components/form.tsx';
import { PageHeader } from '../../components/page-header.tsx';
import { usePreferences } from '../../components/preferences.tsx';
import { ledgerErrorMessage } from '../../lib/ledger-errors.ts';
import { getDebtsOverview } from '../../server/fn/debts.ts';

/**
 * `/debts`: "Utang & cicilan" (FR-R7, FR-U1–U5) with the debts, credit cards, payment priority, and receivables total;
 * `?new` opens "Tambah utang / cicilan".
 */
export const Route = createFileRoute('/_app/debts')({
  validateSearch: z.object({ new: z.literal(true).optional().catch(undefined) }),
  loader: () => getDebtsOverview(),
  head: () => ({ meta: [{ title: `${m.debts_title()} · ${m.app_name()}` }] }),
  pendingComponent: DebtsPending,
  component: DebtsRoute,
});

function DebtsRoute() {
  const overview = Route.useLoaderData();
  const search = Route.useSearch();
  if (!overview.ok) return <LoadFailed code={overview.code} />;
  return <DebtsPage overview={overview.value} initialNew={search.new === true} />;
}

function DebtsPending() {
  return (
    <>
      <PageHeader breadcrumb={[m.breadcrumb_finance(), m.debts_title()]} title={m.debts_title()} />
      <section className="rounded-[12px] border border-border bg-card">
        <PageState kind="loading" title={m.debts_loading()} />
      </section>
    </>
  );
}

function LoadFailed({ code }: { code: string }) {
  const { preferences } = usePreferences();
  const router = useRouter();
  return (
    <>
      <PageHeader breadcrumb={[m.breadcrumb_finance(), m.debts_title()]} title={m.debts_title()} />
      <section className="rounded-[12px] border border-border bg-card">
        <PageState
          kind="error"
          title={m.debts_load_failed()}
          description={ledgerErrorMessage(code, preferences.locale)}
          action={
            <Button variant="secondary" onClick={() => void router.invalidate()}>
              {m.debts_retry()}
            </Button>
          }
        />
      </section>
    </>
  );
}
