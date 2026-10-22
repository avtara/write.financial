// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute, Link, useRouter } from '@tanstack/react-router';
import { addDays, parseLocalDate, type LocalDate } from '@wf/domain/period';
import { m } from '@wf/i18n/messages';
import { toLocalDate } from '@wf/ui/dates';
import { PageState } from '@wf/ui/page-state';
import * as z from 'zod';
import { CalendarPage, type CalendarData } from '../../components/calendar/calendar-page.tsx';
import { monthOf, weekOf, type CalendarView } from '../../components/calendar/calendar-model.ts';
import { Button } from '../../components/form.tsx';
import { PageHeader } from '../../components/page-header.tsx';
import { usePreferences } from '../../components/preferences.tsx';
import { ledgerErrorMessage } from '../../lib/ledger-errors.ts';
import { getBudgetStatus } from '../../server/fn/budget.ts';
import { getCalendarRange, getCalendarYear } from '../../server/fn/calendar.ts';
import { listAccounts, listCategories } from '../../server/fn/ledger.ts';

const SEARCH = z.object({
  view: z.enum(['week', 'year']).optional().catch(undefined),
  date: z
    .string()
    .transform((value, context) => {
      try {
        return parseLocalDate(value);
      } catch {
        context.addIssue({ code: 'custom', message: 'Not a date' });
        return z.NEVER;
      }
    })
    .optional()
    .catch(undefined),
});

type Load<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly code: string };

/** The weeks a month view shows (Monday of its first week through Sunday of its last). */
function monthRange(date: LocalDate) {
  const { first, last } = monthOf(date);
  return { from: weekOf(first).first, to: weekOf(last).last };
}

async function loadData(view: CalendarView, date: LocalDate, today: LocalDate): Promise<Load<CalendarData>> {
  if (view === 'year') {
    const year = await getCalendarYear({ data: { year: Number(date.slice(0, 4)) } });
    return year.ok ? { ok: true, value: { view, year: year.value } } : year;
  }
  if (view === 'week') {
    const { first, last } = weekOf(date);
    // The week before too: "vs Sen–Kam lalu".
    const range = await getCalendarRange({ data: { from: addDays(first, -7), to: last } });
    return range.ok ? { ok: true, value: { view, range: range.value } } : range;
  }
  const future = monthOf(date).first > today;
  const [range, pattern] = await Promise.all([
    getCalendarRange({ data: monthRange(date) }),
    future ? getCalendarRange({ data: monthRange(today) }) : null,
  ]);
  if (!range.ok) return range;
  return {
    ok: true,
    value: { view: 'month', range: range.value, pattern: pattern?.ok === true ? pattern.value : null },
  };
}

/**
 * `/calendar` (FR-C1–C3): the month of `?date` (default today) — or its week (`?view=week`) or year (`?view=year`) —
 * with the accounts and categories (names, needs / wants) and the budget's safe daily limit (week view).
 */
export const Route = createFileRoute('/_app/calendar')({
  validateSearch: SEARCH,
  // Its own keys only: opening Settings (the layout's `?settings=`) leaves the page loaded.
  loaderDeps: ({ search: { view, date } }) => ({ view, date }),
  loader: async ({ deps, context }) => {
    const today = toLocalDate(new Date(), context.viewer.timezone);
    const view: CalendarView = deps.view ?? 'month';
    const date = deps.date ?? today;
    const [data, accounts, categories, budget] = await Promise.all([
      loadData(view, date, today),
      listAccounts({ data: { status: 'all' } }),
      listCategories({ data: {} }),
      getBudgetStatus({ data: {} }).catch(() => null),
    ]);
    return { view, date, today, data, accounts, categories, budget };
  },
  head: () => ({ meta: [{ title: `${m.nav_calendar()} · ${m.app_name()}` }] }),
  pendingComponent: CalendarPending,
  component: CalendarRoute,
});

function CalendarRoute() {
  const { date, today, data, accounts, categories, budget } = Route.useLoaderData();
  const { viewer } = Route.useRouteContext();
  if (!data.ok) return <LoadFailed code={data.code} />;
  if (!accounts.ok) return <LoadFailed code={accounts.code} />;
  if (!categories.ok) return <LoadFailed code={categories.code} />;
  return (
    <CalendarPage
      data={data.value}
      date={date}
      today={today}
      accounts={accounts.value.accounts}
      categories={categories.value}
      baseCurrency={accounts.value.baseCurrency}
      safeDailyMinor={budget?.ok === true && budget.value.version !== null ? budget.value.totals.safeDailyMinor : null}
      timeZone={viewer.timezone}
    />
  );
}

function CalendarPending() {
  return (
    <>
      <PageHeader breadcrumb={[m.breadcrumb_finance(), m.nav_calendar()]} title={m.nav_calendar()} />
      <section className="rounded-[12px] border border-border bg-card">
        <PageState kind="loading" title={m.calendar_loading()} />
      </section>
    </>
  );
}

function LoadFailed({ code }: { code: string }) {
  const { preferences } = usePreferences();
  const router = useRouter();
  return (
    <>
      <PageHeader breadcrumb={[m.breadcrumb_finance(), m.nav_calendar()]} title={m.nav_calendar()} />
      <section className="rounded-[12px] border border-border bg-card">
        <PageState
          kind="error"
          title={m.calendar_load_failed()}
          description={`${ledgerErrorMessage(code, preferences.locale)} ${m.calendar_load_failed_hint()}`}
          action={
            <span className="flex gap-2">
              <Button variant="secondary" onClick={() => void router.invalidate()}>
                {m.subscriptions_retry()}
              </Button>
              <Link
                to="/transactions"
                className="inline-flex h-9 items-center rounded-[8px] border border-border px-3 text-[13px] text-fg hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
              >
                {m.calendar_open_transactions()}
              </Link>
            </span>
          }
        />
      </section>
    </>
  );
}
