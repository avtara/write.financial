// SPDX-License-Identifier: AGPL-3.0-only
/** Notifications as `listNotifications` returns them, after the design persona (FR-S5). */
import type { NextReminder, NotificationCounts, NotificationView } from '@wf/db/notifications';
import type { LocalDate } from '@wf/domain/period';

export function notification(id: string, patch: Partial<NotificationView> = {}): NotificationView {
  return {
    id,
    type: 'bill_reminder',
    category: 'budget_bills',
    titleKey: 'notification_bill_reminder_title',
    bodyKey: 'notification_bill_reminder_body',
    params: {
      name: 'Netflix',
      dueDate: '2026-10-18',
      amount: { amountMinor: '186000', currency: 'IDR' },
      account: 'BCA Tahapan',
      days: 1,
    },
    action: { href: '/subscriptions' },
    ref: `rem.${id}`,
    readAt: null,
    // 17 Okt 2026 09.00 WIB.
    createdAt: new Date('2026-10-17T02:00:00Z'),
    ...patch,
  };
}

/** Netflix's H-1 reminder (17 Okt 09.00). */
export const NETFLIX_REMINDER = notification('n-netflix');

/** iCloud+ overdue: confirm it in the Review queue. */
export const ICLOUD_OVERDUE = notification('n-icloud', {
  type: 'bill_overdue',
  titleKey: 'notification_bill_overdue_title',
  bodyKey: 'notification_bill_overdue_body',
  params: {
    name: 'iCloud+',
    dueDate: '2026-10-09',
    amount: { amountMinor: '45000', currency: 'IDR' },
    account: 'BCA Tahapan',
  },
  action: { href: '/review' },
  createdAt: new Date('2026-10-16T17:05:00Z'),
});

/** September closed (a system notification, read). */
export const PERIOD_CLOSED = notification('n-period', {
  type: 'period_closed',
  category: 'system',
  titleKey: 'notification_period_closed_title',
  bodyKey: 'notification_period_closed_body',
  params: {
    start: '2026-09-01',
    end: '2026-09-30',
    proposals: 1,
    leftover: { amountMinor: '1150000', currency: 'IDR' },
  },
  action: null,
  readAt: new Date('2026-10-02T01:00:00Z'),
  createdAt: new Date('2026-10-12T00:05:00Z'),
});

export const NEXT_REMINDER: NextReminder = {
  occurrenceId: 'occ-netflix',
  sourceType: 'subscription',
  sourceId: 'sub-netflix',
  name: 'Netflix',
  dueDate: '2026-11-18' as LocalDate,
  remindAt: new Date('2026-11-17T02:00:00Z'),
  expectedMinor: 186_000n,
  currency: 'IDR',
};

export function counts(patch: Partial<NotificationCounts> = {}): NotificationCounts {
  const byType = Object.fromEntries(
    [
      'bill_reminder',
      'trial_ending',
      'pause_ending',
      'review_due',
      'bill_overdue',
      'budget_threshold',
      'low_balance',
      'account_unchecked',
      'insufficient_balance',
      'period_closed',
      'subscriptions_detected',
      'system',
    ].map((type) => [type, 0]),
  ) as NotificationCounts['byType'];
  return {
    total: 3,
    unread: 2,
    unreadByCategory: { budget_bills: 2, system: 0 },
    byType: { ...byType, bill_reminder: 1, bill_overdue: 1, period_closed: 1 },
    ...patch,
  };
}
