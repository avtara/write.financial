// SPDX-License-Identifier: AGPL-3.0-only
/**
 * One notification as the bell's popover and the notifications page show it (FR-S5, design `JdcJD`, `dzA5V`): an
 * icon by type, the title and body from their message keys (amounts through `<Money>`, so privacy mode hides them;
 * dates and built-in names in the reader's language), the time, and the action button — which only opens a page
 * (`/review` for anything to confirm), never records anything. Also the day groups ("HARI INI · 15 OKT").
 */
import type { NotificationType, NotificationView } from '@wf/db/notifications';
import type { Locale } from '@wf/domain/money';
import { addDays, type LocalDate } from '@wf/domain/period';
import { m } from '@wf/i18n/messages';
import { formatDate, formatTime, toLocalDate } from '@wf/ui/dates';
import { Money } from '@wf/ui/money';
import {
  AlarmClock,
  Bell,
  CalendarClock,
  CalendarX,
  Gauge,
  Info,
  Lock,
  Repeat,
  ScanSearch,
  TriangleAlert,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { categoryName } from '../../lib/ledger-labels.ts';
import { RichMessage } from '../rich-message.tsx';

const ICONS: Readonly<Record<NotificationType, LucideIcon>> = {
  bill_reminder: Bell,
  trial_ending: AlarmClock,
  pause_ending: Repeat,
  review_due: CalendarClock,
  bill_overdue: CalendarX,
  budget_threshold: Gauge,
  low_balance: Wallet,
  account_unchecked: ScanSearch,
  insufficient_balance: TriangleAlert,
  period_closed: Lock,
  subscriptions_detected: Repeat,
  system: Info,
};

/** What the action button says, by the page it opens. */
const ACTIONS: Readonly<Record<string, () => string>> = {
  '/review': m.notifications_action_review,
  '/budget': m.notifications_action_budget,
  '/accounts': m.notifications_action_accounts,
  '/subscriptions': m.notifications_action_subscriptions,
  '/calendar': m.notifications_action_calendar,
};

/** The label of a notification's action (a page outside the list above: "Buka"). */
export function actionLabel(href: string): string {
  return (ACTIONS[href] ?? m.notifications_action_open)();
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A param as the message shows it. */
function slot(value: unknown, locale: Locale): ReactNode {
  if (typeof value === 'object' && value !== null && 'amountMinor' in value && 'currency' in value) {
    return (
      <Money
        minor={BigInt(String(value.amountMinor))}
        currency={String(value.currency)}
        context="amount"
        locale={locale}
      />
    );
  }
  if (typeof value === 'string' && DATE.test(value)) return formatDate(value as LocalDate, locale, 'day');
  if (typeof value === 'string' && value.startsWith('system:')) return categoryName({ name: value, builtInKey: value });
  return String(value);
}

type Message = (inputs: Record<string, string>) => string;

/** A notification message by key, its params rendered as {@link slot}s; an unknown key (a newer worker) as itself. */
export function NotificationMessage({
  messageKey,
  params,
  locale,
}: {
  messageKey: string;
  params: Readonly<Record<string, unknown>>;
  locale: Locale;
}) {
  const message = (m as unknown as Record<string, Message | undefined>)[messageKey];
  if (message === undefined) return <>{messageKey}</>;
  const slots = Object.fromEntries(Object.entries(params).map(([key, value]) => [key, slot(value, locale)]));
  return <RichMessage message={message} slots={slots} />;
}

export interface NotificationItemProps {
  readonly notification: NotificationView;
  readonly locale: Locale;
  readonly timeZone: string;
  /** Opens the action's page (`href`); the host marks the notification read. */
  readonly onAction: (notification: NotificationView, href: string) => void;
  /** "Tandai dibaca" for one (the page); omitted in the popover, which marks them all. */
  readonly onMarkRead?: (notification: NotificationView) => void;
}

export function NotificationItem({ notification, locale, timeZone, onAction, onMarkRead }: NotificationItemProps) {
  const Icon = ICONS[notification.type];
  const unread = notification.readAt === null;
  const titleId = useId();
  const href = notification.action?.href ?? null;
  return (
    <article
      aria-labelledby={titleId}
      data-unread={unread}
      className="flex gap-3 rounded-[10px] px-3 py-2.5 hover:bg-muted data-[unread=true]:bg-surface-2"
    >
      <span
        aria-hidden="true"
        className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-[7px] bg-tint-06 text-muted-fg"
      >
        <Icon className="size-3.5" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-start gap-2">
          <h3 id={titleId} className="min-w-0 flex-1 text-[13px] font-medium text-fg">
            <NotificationMessage messageKey={notification.titleKey} params={notification.params} locale={locale} />
          </h3>
          <time dateTime={notification.createdAt.toISOString()} className="shrink-0 font-mono text-[11px] text-subtle">
            {formatTime(notification.createdAt, timeZone, locale)}
          </time>
          {unread ? (
            <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-blue">
              <span className="sr-only">{m.notifications_unread()}</span>
            </span>
          ) : null}
        </div>
        <p className="text-[12.5px] text-text-secondary">
          <NotificationMessage messageKey={notification.bodyKey} params={notification.params} locale={locale} />
        </p>
        {href === null && (onMarkRead === undefined || !unread) ? null : (
          <div className="flex flex-wrap gap-2 pt-0.5">
            {href === null ? null : (
              <button
                type="button"
                onClick={() => {
                  onAction(notification, href);
                }}
                className="inline-flex h-7 items-center rounded-[7px] border border-border px-2.5 text-[12px] text-fg hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
              >
                {actionLabel(href)}
              </button>
            )}
            {onMarkRead === undefined || !unread ? null : (
              <button
                type="button"
                onClick={() => {
                  onMarkRead(notification);
                }}
                className="inline-flex h-7 items-center rounded-[7px] px-2 text-[12px] text-muted-fg hover:bg-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-ring"
              >
                {m.notifications_mark_one_read()}
              </button>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

/** Notifications grouped by their day in `timeZone`, newest day first (the input is newest first). */
export function groupByDay(
  items: readonly NotificationView[],
  timeZone: string,
): { readonly day: LocalDate; readonly items: NotificationView[] }[] {
  const groups: { day: LocalDate; items: NotificationView[] }[] = [];
  for (const item of items) {
    const day = toLocalDate(item.createdAt, timeZone);
    const last = groups.at(-1);
    if (last?.day === day) last.items.push(item);
    else groups.push({ day, items: [item] });
  }
  return groups;
}

/** "Hari ini · 15 Okt", "Kemarin · 14 Okt", "Senin · 12 Okt". */
export function dayHeading(day: LocalDate, today: LocalDate, locale: Locale): string {
  const date = formatDate(day, locale, 'day');
  if (day === today) return m.notifications_day_today({ date });
  if (day === addDays(today, -1)) return m.notifications_day_yesterday({ date });
  return formatDate(day, locale, 'weekday');
}
