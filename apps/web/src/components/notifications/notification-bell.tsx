// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The bell in the sidebar and the tablet rail (FR-S5, design `JdcJD`, `h5aPn2`): the unread count, and a popover with
 * the unread notifications in two tabs ("Anggaran & tagihan" / "Sistem"), grouped by day, each with its action button
 * (opening a page, `/review` for anything to confirm — never recording). "Tandai dibaca" marks the open tab read; with
 * nothing unread it shows "Semua sudah dibaca" and the next reminder. "Lihat semua notifikasi" opens the page.
 */
import { Link, useRouter } from '@tanstack/react-router';
import type { NextReminder, NotificationCategory, NotificationView } from '@wf/db/notifications';
import type { Locale } from '@wf/domain/money';
import { countDays, type LocalDate } from '@wf/domain/period';
import { m } from '@wf/i18n/messages';
import { formatDate, formatTime, toLocalDate } from '@wf/ui/dates';
import { Money } from '@wf/ui/money';
import { PageState } from '@wf/ui/page-state';
import { Popover, PopoverContent, PopoverTrigger } from '@wf/ui/popover';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@wf/ui/tabs';
import { Bell, CheckCheck } from 'lucide-react';
import { useState } from 'react';
import { getNextReminder, listNotifications, markNotificationsRead } from '../../server/fn/notifications.ts';
import { usePreferences } from '../preferences.tsx';
import { RichMessage } from '../rich-message.tsx';
import { dayHeading, groupByDay, NotificationItem } from './notification-item.tsx';

const CATEGORIES: readonly NotificationCategory[] = ['budget_bills', 'system'];
const TAB_LABELS: Readonly<Record<NotificationCategory, () => string>> = {
  budget_bills: m.notifications_tab_budget_bills,
  system: m.notifications_tab_system,
};

export interface NotificationBellProps {
  /** `sidebar`: a small icon button by the wordmark; `rail`: a rail-sized button with the popover to its right. */
  readonly variant: 'sidebar' | 'rail';
  /** Unread notifications (the `_app` loader); `null` when unknown (offline). */
  readonly unread: number | null;
  readonly timeZone: string;
}

export function NotificationBell({ variant, unread, timeZone }: NotificationBellProps) {
  const router = useRouter();
  const { locale } = usePreferences().preferences;
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<NotificationCategory>('budget_bills');
  const [status, setStatus] = useState<'loading' | 'failed' | 'ready'>('loading');
  const [items, setItems] = useState<NotificationView[]>([]);
  const [next, setNext] = useState<NextReminder | null>(null);

  const load = () => {
    setStatus('loading');
    void Promise.all([listNotifications({ data: { filter: 'unread', limit: 100 } }), getNextReminder()]).then(
      ([list, reminder]) => {
        setItems(list.ok ? list.value.items : []);
        setNext(reminder.ok ? reminder.value : null);
        setStatus(list.ok ? 'ready' : 'failed');
      },
      () => {
        setStatus('failed');
      },
    );
  };

  const markRead = async (target: { ids: string[] } | { all: true; category: NotificationCategory }) => {
    const result = await markNotificationsRead({ data: target }).catch(() => null);
    if (result?.ok === true) {
      setItems((current) =>
        current.filter((item) => ('ids' in target ? !target.ids.includes(item.id) : item.category !== target.category)),
      );
      await router.invalidate();
    }
  };

  const today = toLocalDate(new Date(), timeZone);
  const label =
    unread === null || unread === 0 ? m.notifications_title() : m.notifications_bell_unread({ count: unread });
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) load();
      }}
    >
      <PopoverTrigger
        aria-label={label}
        className={`flex shrink-0 items-center justify-center text-muted-fg hover:bg-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-ring ${variant === 'rail' ? 'size-10 rounded-[8px]' : 'size-8 rounded-[7px]'}`}
      >
        {/* The count sits on the icon's top-right corner, in the space beside the bell's dome, so the bell stays whole. */}
        <span className="relative flex">
          <Bell aria-hidden="true" className={variant === 'rail' ? 'size-[17px]' : 'size-4'} />
          {unread === null || unread === 0 ? null : (
            <span
              aria-hidden="true"
              className="absolute bottom-[68%] left-[70%] min-w-3.5 rounded-full bg-red px-1 text-center font-mono text-[9.5px] leading-[14px] text-on-accent"
            >
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </span>
      </PopoverTrigger>
      <PopoverContent
        side={variant === 'rail' ? 'right' : 'bottom'}
        aria-label={m.notifications_title()}
        className="flex max-h-[min(560px,calc(100dvh-32px))] w-[380px] flex-col"
      >
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <h2 className="text-[14px] font-semibold text-fg">{m.notifications_title()}</h2>
          {items.length === 0 ? null : (
            <span className="rounded-full bg-blue-tint-2 px-1.5 text-[11px] text-blue-fg">
              {m.notifications_new({ count: items.length })}
            </span>
          )}
          <span className="flex-1" />
          <button
            type="button"
            disabled={!items.some((item) => item.category === tab)}
            onClick={() => void markRead({ all: true, category: tab })}
            className="inline-flex h-7 items-center gap-1 rounded-[6px] px-2 text-[12px] text-muted-fg hover:bg-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50"
          >
            <CheckCheck aria-hidden="true" className="size-3.5" />
            {m.notifications_mark_read()}
          </button>
        </div>
        <Tabs
          value={tab}
          onValueChange={(next) => {
            setTab(next as NotificationCategory);
          }}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="px-4 pt-3">
            <TabsList label={m.notifications_tabs_label()} fill>
              {CATEGORIES.map((category) => {
                const count = items.filter((item) => item.category === category).length;
                return (
                  <TabsTrigger key={category} value={category}>
                    {TAB_LABELS[category]()}
                    {count === 0 ? null : <span className="font-mono text-[11px] text-subtle">{count}</span>}
                  </TabsTrigger>
                );
              })}
            </TabsList>
          </div>
          {CATEGORIES.map((category) => (
            <TabsContent key={category} value={category} className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
              {status === 'loading' ? <PageState kind="loading" title={m.notifications_loading()} /> : null}
              {status === 'failed' ? <PageState kind="error" title={m.notifications_load_failed()} /> : null}
              {status === 'ready' ? (
                <TabBody
                  items={items.filter((item) => item.category === category)}
                  next={next}
                  today={today}
                  locale={locale}
                  timeZone={timeZone}
                  onAction={(notification, href) => {
                    setOpen(false);
                    void markRead({ ids: [notification.id] });
                    void router.navigate({ href });
                  }}
                />
              ) : null}
            </TabsContent>
          ))}
        </Tabs>
        <div className="border-t border-border px-4 py-2.5">
          <Link
            to="/notifications"
            onClick={() => {
              setOpen(false);
            }}
            className="text-[12.5px] text-blue-fg hover:underline focus-visible:outline-2 focus-visible:outline-ring"
          >
            {m.notifications_see_all()}
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function TabBody({
  items,
  next,
  today,
  locale,
  timeZone,
  onAction,
}: {
  items: NotificationView[];
  next: NextReminder | null;
  today: LocalDate;
  locale: Locale;
  timeZone: string;
  onAction: (notification: NotificationView, href: string) => void;
}) {
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-1.5 px-4 py-8 text-center">
        <CheckCheck aria-hidden="true" className="size-5 text-green-fg" />
        <p className="text-[13px] font-medium text-fg">{m.notifications_all_read()}</p>
        {next === null ? null : (
          <p className="text-[12.5px] text-muted-fg">
            <NextReminderText next={next} locale={locale} timeZone={timeZone} />
          </p>
        )}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {groupByDay(items, timeZone).map((group) => (
        <section key={group.day} aria-label={dayHeading(group.day, today, locale)} className="flex flex-col gap-0.5">
          <h3 className="px-3 pt-1 text-[11px] font-medium text-subtle uppercase">
            {dayHeading(group.day, today, locale)}
          </h3>
          {group.items.map((item) => (
            <NotificationItem
              key={item.id}
              notification={item}
              locale={locale}
              timeZone={timeZone}
              onAction={onAction}
            />
          ))}
        </section>
      ))}
    </div>
  );
}

/** "Pengingat berikutnya: Netflix ditagih 18 Okt (Rp186.000), dikirim H-1 jam 09.00." */
export function NextReminderText({ next, locale, timeZone }: { next: NextReminder; locale: Locale; timeZone: string }) {
  const days = countDays(toLocalDate(next.remindAt, timeZone), next.dueDate) - 1;
  return (
    <RichMessage
      message={m.notifications_next_reminder}
      slots={{
        name: next.name,
        date: formatDate(next.dueDate, locale, 'day'),
        amount: <Money minor={next.expectedMinor} currency={next.currency} context="amount" locale={locale} />,
        offset: days === 0 ? m.notifications_offset_same_day() : m.notifications_offset_days({ days }),
        time: formatTime(next.remindAt, timeZone, locale),
      }}
    />
  );
}
