// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute } from '@tanstack/react-router';
import { m } from '@wf/i18n/messages';
import { toLocalDate } from '@wf/ui/dates';
import { PageState } from '@wf/ui/page-state';
import * as z from 'zod';
import { PageHeader } from '../../components/page-header.tsx';
import { usePreferences } from '../../components/preferences.tsx';
import { ReviewPage } from '../../components/review/review-page.tsx';
import { ledgerErrorMessage } from '../../lib/ledger-errors.ts';
import { listAccounts, listCategories } from '../../server/fn/ledger.ts';
import { listReviewItems } from '../../server/fn/review.ts';

/**
 * `/review`: the Review queue "Perlu ditinjau" (FR-L7) with every pending item (up to 200), the accounts and
 * categories its cards name, and `?item=<id>` for the card ⌘K opened.
 */
export const Route = createFileRoute('/_app/review')({
  validateSearch: z.object({ item: z.uuid().optional().catch(undefined) }),
  loader: async () => {
    const [review, accounts, categories] = await Promise.all([
      listReviewItems({ data: { limit: 200 } }),
      listAccounts({ data: { status: 'all' } }),
      listCategories({ data: { includeArchived: true } }),
    ]);
    return { review, accounts, categories };
  },
  head: () => ({ meta: [{ title: `${m.review_title()} · ${m.app_name()}` }] }),
  component: ReviewRoute,
});

function ReviewRoute() {
  const { review, accounts, categories } = Route.useLoaderData();
  const { item } = Route.useSearch();
  const { viewer } = Route.useRouteContext();
  if (!review.ok) return <LoadFailed code={review.code} />;
  if (!accounts.ok) return <LoadFailed code={accounts.code} />;
  if (!categories.ok) return <LoadFailed code={categories.code} />;
  return (
    <ReviewPage
      items={review.value.items}
      lookup={{
        baseCurrency: accounts.value.baseCurrency,
        accounts: accounts.value.accounts,
        categories: categories.value,
      }}
      timeZone={viewer.timezone}
      today={toLocalDate(new Date(), viewer.timezone)}
      focusItem={item}
    />
  );
}

function LoadFailed({ code }: { code: string }) {
  const { preferences } = usePreferences();
  return (
    <>
      <PageHeader breadcrumb={[m.breadcrumb_finance(), m.review_title()]} title={m.review_title()} />
      <section className="rounded-[12px] border border-border bg-card">
        <PageState
          kind="error"
          title={m.review_load_failed()}
          description={ledgerErrorMessage(code, preferences.locale)}
        />
      </section>
    </>
  );
}
