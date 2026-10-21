// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute } from '@tanstack/react-router';
import { NOTIFICATION_TYPES } from '@wf/db/schema';
import type { LocalDate } from '@wf/domain/period';
import { m } from '@wf/i18n/messages';
import { toLocalDate } from '@wf/ui/dates';
import { PageState } from '@wf/ui/page-state';
import * as z from 'zod';
import { PageHeader } from '../../components/page-header.tsx';
import { usePreferences } from '../../components/preferences.tsx';
import { NotificationsPage } from '../../components/notifications/notifications-page.tsx';
import { rangeOf } from '../../lib/notifications-search.ts';
import { ledgerErrorMessage } from '../../lib/ledger-errors.ts';
import { getNotificationCounts, listNotifications } from '../../server/fn/notifications.ts';

const date = z.iso
  .date()
  .transform((value) => value as LocalDate)
  .optional()
  .catch(undefined);

/**
 * `/notifications`: every notification of the chosen range (the last 30 days by default), filtered by `?filter=unread`,
 * `?type=`, and `?q=`, with the counts for the filter chips.
 */
export const Route = createFileRoute('/_app/notifications')({
  validateSearch: z.object({
    filter: z.literal('unread').optional().catch(undefined),
    type: z.enum(NOTIFICATION_TYPES).optional().catch(undefined),
    q: z.string().max(100).optional().catch(undefined),
    from: date,
    to: date,
  }),
  loaderDeps: ({ search }) => search,
  loader: async ({ deps, context }) => {
    // The server's day, so hydration renders the same day headings.
    const today = toLocalDate(new Date(), context.viewer.timezone);
    const range = rangeOf(deps, today);
    const dates = { from: range.start, to: range.end };
    const [page, counts] = await Promise.all([
      listNotifications({
        data: {
          ...dates,
          ...(deps.filter === undefined ? {} : { filter: deps.filter }),
          ...(deps.type === undefined ? {} : { type: deps.type }),
          ...(deps.q === undefined ? {} : { search: deps.q }),
        },
      }),
      getNotificationCounts({ data: dates }),
    ]);
    return { page, counts, today };
  },
  head: () => ({ meta: [{ title: `${m.notifications_page_title()} · ${m.app_name()}` }] }),
  component: NotificationsRoute,
});

function NotificationsRoute() {
  const { page, counts, today } = Route.useLoaderData();
  const search = Route.useSearch();
  const { viewer } = Route.useRouteContext();
  if (!page.ok) return <LoadFailed code={page.code} />;
  if (!counts.ok) return <LoadFailed code={counts.code} />;
  return (
    <NotificationsPage
      search={search}
      page={page.value}
      counts={counts.value}
      today={today}
      timeZone={viewer.timezone}
    />
  );
}

function LoadFailed({ code }: { code: string }) {
  const { preferences } = usePreferences();
  return (
    <>
      <PageHeader
        breadcrumb={[m.notifications_title(), m.notifications_page_title()]}
        title={m.notifications_page_title()}
      />
      <section className="rounded-[12px] border border-border bg-card">
        <PageState
          kind="error"
          title={m.notifications_load_failed()}
          description={ledgerErrorMessage(code, preferences.locale)}
        />
      </section>
    </>
  );
}
