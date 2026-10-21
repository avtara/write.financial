// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The notification panel and page (FR-S5): list with filters, unread counts for the bell, mark read, and the next
 * reminder for the empty state; Settings › Notifikasi (FR-ST3). The user always comes from the session.
 */
import { createServerFn } from '@tanstack/react-start';
import { NOTIFICATION_GROUPS, type NotificationSettings } from '@wf/db/notification-settings';
import type { NextReminder, NotificationCounts, NotificationView } from '@wf/db/notifications';
import { NOTIFICATION_CATEGORIES, NOTIFICATION_TYPES } from '@wf/db/schema';
import * as z from 'zod';
import { attempt, requireSession, type Result } from '../access.ts';
import { defined, localDate } from '../inputs.ts';
import { services } from '../runtime.ts';

const category = z.enum(NOTIFICATION_CATEGORIES);
const range = { from: localDate.optional(), to: localDate.optional() };

/** Newest first, one page; pass `nextCursor` as `before` for the next page (`null` on the last page). */
export const listNotifications = createServerFn({ method: 'GET' })
  .validator(
    z.object({
      ...range,
      filter: z.enum(['all', 'unread']).optional(),
      type: z.enum(NOTIFICATION_TYPES).optional(),
      category: category.optional(),
      search: z.string().max(100).optional(),
      limit: z.number().int().min(1).max(100).optional(),
      before: z.uuid().optional(),
    }),
  )
  .handler(async ({ context, data }): Promise<Result<{ items: NotificationView[]; nextCursor: string | null }>> => {
    const { notifications, now } = await services();
    return attempt(async () => {
      const { user } = await requireSession(context.session, {}, now());
      return notifications.list(user.id, defined(data));
    });
  });

/** Counts in the range (default the last 30 days); `unread` is the bell badge. */
export const getNotificationCounts = createServerFn({ method: 'GET' })
  .validator(z.object(range))
  .handler(async ({ context, data }): Promise<Result<NotificationCounts>> => {
    const { notifications, now } = await services();
    return attempt(async () => {
      const { user } = await requireSession(context.session, {}, now());
      return notifications.counts(user.id, defined(data));
    });
  });

/** "Tandai dibaca" for some notifications, or "Tandai semua dibaca" (optionally of one category). */
export const markNotificationsRead = createServerFn({ method: 'POST' })
  .validator(
    z.union([
      z.object({ ids: z.array(z.uuid()).min(1).max(100) }),
      z.object({ all: z.literal(true), category: category.optional() }),
    ]),
  )
  .handler(async ({ context, data }): Promise<Result<{ updated: number }>> => {
    const { notifications, now } = await services();
    return attempt(async () => {
      const { user } = await requireSession(context.session, {}, now());
      return notifications.markRead(user.id, defined(data));
    });
  });

/** The next reminder still to fire ("Pengingat berikutnya"), or `null`. */
export const getNextReminder = createServerFn({ method: 'GET' }).handler(
  async ({ context }): Promise<Result<NextReminder | null>> => {
    const { notifications, now } = await services();
    return attempt(async () => {
      const { user } = await requireSession(context.session, {}, now());
      return notifications.nextReminder(user.id);
    });
  },
);

const channels = z.object({ inApp: z.boolean(), email: z.boolean() });

/** Settings › Notifikasi: what shows in the app, what is emailed, and when bill reminders are sent. */
export const getNotificationSettings = createServerFn({ method: 'GET' }).handler(
  async ({ context }): Promise<Result<NotificationSettings>> => {
    const { notificationSettings, now } = await services();
    return attempt(async () => {
      const { user } = await requireSession(context.session, {}, now());
      return notificationSettings.get(user.id);
    });
  },
);

/** "Simpan perubahan": a new reminder time moves the reminders not sent yet. */
export const updateNotificationSettings = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      email: z.boolean(),
      reminderTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
      groups: z.object(
        Object.fromEntries(NOTIFICATION_GROUPS.map((group) => [group, channels])) as Record<
          (typeof NOTIFICATION_GROUPS)[number],
          typeof channels
        >,
      ),
    }),
  )
  .handler(async ({ context, data }): Promise<Result<{ settings: NotificationSettings; movedReminders: number }>> => {
    const { notificationSettings, now } = await services();
    return attempt(async () => {
      const { user } = await requireSession(context.session, {}, now());
      return notificationSettings.update(user.id, data);
    });
  });
