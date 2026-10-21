// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `/notifications` "Semua notifikasi" (FR-S5, design `dzA5V`): filters All / Unread / per type with their counts,
 * search, a date range (the last 30 days by default, within the 90 days notifications are kept), the list grouped by
 * day with each notification's action and "Tandai dibaca", "Tandai semua dibaca", and "Muat lebih lama". The filters
 * live in the URL.
 */
import { useNavigate, useRouter } from '@tanstack/react-router';
import type { NotificationCounts, NotificationType, NotificationView } from '@wf/db/notifications';
import { addDays, countDays, type LocalDate } from '@wf/domain/period';
import { m } from '@wf/i18n/messages';
import { formatDateRange } from '@wf/ui/dates';
import { PageState } from '@wf/ui/page-state';
import { RangePicker } from '@wf/ui/range-picker';
import { toast } from '@wf/ui/toast';
import { CheckCheck, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { RANGE_DAYS, rangeOf, RETENTION_DAYS, type NotificationsSearch } from '../../lib/notifications-search.ts';
import { listNotifications, markNotificationsRead } from '../../server/fn/notifications.ts';
import { Button, INPUT_FRAME } from '../form.tsx';
import { PageHeader } from '../page-header.tsx';
import { usePreferences } from '../preferences.tsx';
import { dayHeading, groupByDay, NotificationItem } from './notification-item.tsx';

/** Search waits for typing to pause. */
const SEARCH_DELAY_MS = 300;

export interface NotificationsPageProps {
  readonly search: NotificationsSearch;
  readonly page: { readonly items: NotificationView[]; readonly nextCursor: string | null };
  readonly counts: NotificationCounts;
  readonly today: LocalDate;
  readonly timeZone: string;
}

const TYPE_LABELS: Readonly<Record<NotificationType, () => string>> = {
  bill_reminder: m.notifications_type_bill_reminder,
  trial_ending: m.notifications_type_trial_ending,
  pause_ending: m.notifications_type_pause_ending,
  review_due: m.notifications_type_review_due,
  bill_overdue: m.notifications_type_bill_overdue,
  budget_threshold: m.notifications_type_budget_threshold,
  low_balance: m.notifications_type_low_balance,
  account_unchecked: m.notifications_type_account_unchecked,
  insufficient_balance: m.notifications_type_insufficient_balance,
  period_closed: m.notifications_type_period_closed,
  subscriptions_detected: m.notifications_type_subscriptions_detected,
  system: m.notifications_type_system,
};

const CHIP =
  'inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-border px-2.5 text-[12.5px] text-muted-fg hover:bg-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-ring aria-pressed:border-border-strong aria-pressed:bg-muted aria-pressed:text-fg';

export function NotificationsPage({ search, page, counts, today, timeZone }: NotificationsPageProps) {
  const router = useRouter();
  const navigate = useNavigate({ from: '/notifications' });
  const { locale } = usePreferences().preferences;
  const [items, setItems] = useState(page.items);
  const [cursor, setCursor] = useState(page.nextCursor);
  const [loadingMore, setLoadingMore] = useState(false);
  const [query, setQuery] = useState(search.q ?? '');
  const range = rangeOf(search, today);

  // A new page from the loader (other filters, or after marking read) replaces what was loaded.
  const [shown, setShown] = useState(page);
  if (shown !== page) {
    setShown(page);
    setItems(page.items);
    setCursor(page.nextCursor);
  }

  useEffect(() => {
    if (query === (search.q ?? '')) return;
    const timer = setTimeout(() => {
      void navigate({ search: (current) => ({ ...current, q: query.trim() === '' ? undefined : query.trim() }) });
    }, SEARCH_DELAY_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [query, search.q, navigate]);

  const go = (patch: Partial<NotificationsSearch>) => {
    void navigate({ search: (current) => ({ ...current, ...patch }) });
  };

  const markRead = async (target: { ids: string[] } | { all: true }) => {
    const result = await markNotificationsRead({ data: target }).catch(() => null);
    if (result?.ok !== true) {
      toast({ tone: 'error', title: m.notifications_mark_failed() });
      return;
    }
    await router.invalidate();
  };

  const loadMore = async (before: string) => {
    setLoadingMore(true);
    const result = await listNotifications({
      data: {
        ...(search.filter === undefined ? {} : { filter: search.filter }),
        ...(search.type === undefined ? {} : { type: search.type }),
        ...(search.q === undefined ? {} : { search: search.q }),
        from: range.start,
        to: range.end,
        before,
      },
    }).catch(() => null);
    setLoadingMore(false);
    if (result?.ok !== true) {
      toast({ tone: 'error', title: m.notifications_load_failed() });
      return;
    }
    setItems((current) => [...current, ...result.value.items]);
    setCursor(result.value.nextCursor);
  };

  const types = (Object.keys(TYPE_LABELS) as NotificationType[]).filter((type) => counts.byType[type] > 0);
  return (
    <>
      <PageHeader
        breadcrumb={[m.notifications_title(), m.notifications_page_title()]}
        title={m.notifications_page_title()}
        description={m.notifications_page_description({
          range: formatDateRange(range, locale, today),
          days: RETENTION_DAYS,
        })}
        actions={
          <Button
            size="sm"
            variant="secondary"
            disabled={counts.unread === 0}
            onClick={() => void markRead({ all: true })}
          >
            <CheckCheck aria-hidden="true" className="size-3.5" />
            {m.notifications_mark_all_read()}
          </Button>
        }
      />
      <section className="flex flex-col gap-3 rounded-[12px] border border-border bg-card p-4">
        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label={m.notifications_filters_label()} className="flex flex-wrap gap-1.5">
            <button
              type="button"
              aria-pressed={search.filter === undefined && search.type === undefined}
              onClick={() => {
                go({ filter: undefined, type: undefined });
              }}
              className={CHIP}
            >
              {m.notifications_filter_all()}
              <span className="font-mono text-[11px] text-subtle">{counts.total}</span>
            </button>
            <button
              type="button"
              aria-pressed={search.filter === 'unread'}
              onClick={() => {
                go({ filter: search.filter === 'unread' ? undefined : 'unread' });
              }}
              className={CHIP}
            >
              {m.notifications_filter_unread()}
              <span className="font-mono text-[11px] text-subtle">{counts.unread}</span>
            </button>
            {types.map((type) => (
              <button
                key={type}
                type="button"
                aria-pressed={search.type === type}
                onClick={() => {
                  go({ type: search.type === type ? undefined : type });
                }}
                className={CHIP}
              >
                {TYPE_LABELS[type]()}
                <span className="font-mono text-[11px] text-subtle">{counts.byType[type]}</span>
              </button>
            ))}
          </div>
          <span className="flex-1" />
          <label className={`${INPUT_FRAME.sm} w-[220px] gap-2`}>
            <Search aria-hidden="true" className="size-3.5 shrink-0 text-subtle" />
            <input
              type="search"
              aria-label={m.notifications_search_label()}
              placeholder={m.notifications_search_placeholder()}
              value={query}
              onChange={(event) => {
                setQuery(event.currentTarget.value);
              }}
              className="min-w-0 flex-1 bg-transparent text-[12.5px] text-fg outline-none placeholder:text-subtle"
            />
          </label>
          <RangePicker
            value={range}
            onValueChange={(next) => {
              go({ from: next.start, to: next.end });
            }}
            presets={[
              { label: m.notifications_range_7(), range: { start: addDays(today, -6), end: today } },
              { label: m.notifications_range_30(), range: { start: addDays(today, 1 - RANGE_DAYS), end: today } },
              {
                label: m.notifications_range_90(),
                range: { start: addDays(today, 1 - RETENTION_DAYS), end: today },
              },
            ]}
            summary={(chosen) => m.notifications_range_summary({ days: countDays(chosen.start, chosen.end) })}
            today={today}
            locale={locale}
            labels={{
              previousMonth: m.calendar_previous_month(),
              nextMonth: m.calendar_next_month(),
              start: m.transactions_filter_date_start(),
              end: m.transactions_filter_date_end(),
              apply: m.transactions_filter_date_apply(),
              cancel: m.record_cancel(),
            }}
            aria-label={m.notifications_range_label()}
          />
        </div>

        {items.length === 0 ? (
          <PageState kind="empty" title={m.notifications_empty()} description={m.notifications_empty_description()} />
        ) : (
          <div className="flex flex-col gap-3">
            {groupByDay(items, timeZone).map((group) => (
              <section
                key={group.day}
                aria-label={dayHeading(group.day, today, locale)}
                className="flex flex-col gap-0.5"
              >
                <h2 className="px-3 text-[11px] font-medium text-subtle uppercase">
                  {dayHeading(group.day, today, locale)}
                </h2>
                {group.items.map((item) => (
                  <NotificationItem
                    key={item.id}
                    notification={item}
                    locale={locale}
                    timeZone={timeZone}
                    onAction={(notification, href) => {
                      void markRead({ ids: [notification.id] });
                      void router.navigate({ href });
                    }}
                    onMarkRead={(notification) => void markRead({ ids: [notification.id] })}
                  />
                ))}
              </section>
            ))}
          </div>
        )}
        {cursor === null ? null : (
          <Button
            variant="secondary"
            size="sm"
            pending={loadingMore}
            onClick={() => void loadMore(cursor)}
            className="self-center"
          >
            {m.notifications_load_more()}
          </Button>
        )}
        <p className="text-center text-[12px] text-subtle">{m.notifications_retention({ days: RETENTION_DAYS })}</p>
      </section>
    </>
  );
}
