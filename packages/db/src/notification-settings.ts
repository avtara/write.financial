// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Settings › Notifikasi (FR-ST3): per kind of notification whether it shows in the app and whether it is emailed, the
 * email opt-in, and the time bill reminders are sent. Stored in `user_preferences.notif` (JSON; missing keys take the
 * defaults, so users who never opened the section keep M3's behaviour: everything in the app, bill reminders by email,
 * at 09.00). Read by the worker (which notifications it emails, when reminders fire) and by the notifications
 * repository (which kinds the bell and the page show).
 */
import { REMINDER_TIME } from '@wf/domain/recurrence';
import { eq } from 'drizzle-orm';
import type { Transaction } from './db.ts';
import { userPreferences, type JsonObject, type NOTIFICATION_TYPES } from './schema.ts';

type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/** The kinds the settings list, each a group of notification types. */
export const NOTIFICATION_GROUPS = ['bills', 'due', 'budget', 'balance', 'period', 'detected', 'system'] as const;
export type NotificationGroup = (typeof NOTIFICATION_GROUPS)[number];

/** Which settings row a notification type follows. */
export const NOTIFICATION_GROUP_OF: Readonly<Record<NotificationType, NotificationGroup>> = {
  bill_reminder: 'bills',
  trial_ending: 'bills',
  pause_ending: 'bills',
  review_due: 'due',
  bill_overdue: 'due',
  insufficient_balance: 'due',
  budget_threshold: 'budget',
  low_balance: 'balance',
  account_unchecked: 'balance',
  period_closed: 'period',
  subscriptions_detected: 'detected',
  system: 'system',
  receivable_due: 'bills',
};

/** Types only ever shown in the app, whatever the settings: a receivable reminder goes "hanya ke kamu" (FR-U7). */
const IN_APP_ONLY: readonly NotificationType[] = ['receivable_due'];

export interface ChannelSettings {
  /** Shown in the bell and on the notifications page. */
  readonly inApp: boolean;
  /** Emailed too (only while {@link NotificationSettings.email} is on). */
  readonly email: boolean;
}

export interface NotificationSettings {
  /** The email opt-in: nothing is emailed while off. */
  readonly email: boolean;
  /** `HH:MM` in the user's time zone: when bill reminders are sent (on the day `due − offset`). */
  readonly reminderTime: string;
  readonly groups: Readonly<Record<NotificationGroup, ChannelSettings>>;
}

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = Object.freeze({
  email: true,
  reminderTime: REMINDER_TIME,
  groups: Object.freeze({
    bills: { inApp: true, email: true },
    due: { inApp: true, email: false },
    budget: { inApp: true, email: false },
    balance: { inApp: true, email: false },
    period: { inApp: true, email: false },
    detected: { inApp: true, email: false },
    system: { inApp: true, email: false },
  }),
});

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** The settings in `user_preferences.notif`, defaults for whatever is missing or malformed. */
export function readNotificationSettings(notif: JsonObject): NotificationSettings {
  const stored = notif['groups'];
  const groups = typeof stored === 'object' && stored !== null && !Array.isArray(stored) ? stored : {};
  const flag = (value: unknown, fallback: boolean) => (typeof value === 'boolean' ? value : fallback);
  const time = notif['reminderTime'];
  return {
    email: flag(notif['email'], DEFAULT_NOTIFICATION_SETTINGS.email),
    reminderTime: typeof time === 'string' && TIME.test(time) ? time : DEFAULT_NOTIFICATION_SETTINGS.reminderTime,
    groups: Object.fromEntries(
      NOTIFICATION_GROUPS.map((group) => {
        const fallback = DEFAULT_NOTIFICATION_SETTINGS.groups[group];
        const row = (groups as JsonObject)[group];
        const value = typeof row === 'object' && row !== null && !Array.isArray(row) ? (row as JsonObject) : {};
        return [group, { inApp: flag(value['inApp'], fallback.inApp), email: flag(value['email'], fallback.email) }];
      }),
    ) as Record<NotificationGroup, ChannelSettings>,
  };
}

/** The user's settings inside the caller's transaction (works as `wf_worker`, which may read preferences). */
export async function notificationSettingsIn(tx: Transaction, userId: string): Promise<NotificationSettings> {
  const [row] = await tx
    .select({ notif: userPreferences.notif })
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId));
  return readNotificationSettings(row?.notif ?? {});
}

/** The notification types whose group is hidden in the app. */
export function hiddenTypes(settings: NotificationSettings): NotificationType[] {
  return (Object.keys(NOTIFICATION_GROUP_OF) as NotificationType[]).filter(
    (type) => !settings.groups[NOTIFICATION_GROUP_OF[type]].inApp,
  );
}

/** Whether a notification of `type` is emailed (the opt-in and its group's email switch; never in-app-only types). */
export function emailsType(settings: NotificationSettings, type: NotificationType): boolean {
  return settings.email && settings.groups[NOTIFICATION_GROUP_OF[type]].email && !IN_APP_ONLY.includes(type);
}
