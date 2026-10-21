// SPDX-License-Identifier: AGPL-3.0-only
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { insertUser, PGLITE_HOOK_TIMEOUT, startMigrated, type TestDatabase } from '../test/pglite.ts';
import { withUser } from './db.ts';
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  emailsType,
  hiddenTypes,
  notificationSettingsIn,
  readNotificationSettings,
  type NotificationSettings,
} from './notification-settings.ts';

let test: TestDatabase;
let userId: string;

beforeAll(async () => {
  test = await startMigrated();
}, PGLITE_HOOK_TIMEOUT);

afterAll(async () => {
  await test.close();
});

beforeEach(async () => {
  await test.query('DELETE FROM users');
  userId = await insertUser(test, 'ayu@example.test');
});

describe('readNotificationSettings', () => {
  it('takes the defaults for whatever is missing or malformed', () => {
    expect(readNotificationSettings({})).toEqual(DEFAULT_NOTIFICATION_SETTINGS);
    expect(
      readNotificationSettings({
        email: false,
        reminderTime: '19:30',
        groups: { budget: { inApp: false, email: true }, balance: 'yes', period: ['x'], bills: { email: 'no' } },
      }),
    ).toEqual({
      email: false,
      reminderTime: '19:30',
      groups: {
        ...DEFAULT_NOTIFICATION_SETTINGS.groups,
        budget: { inApp: false, email: true },
      },
    });
    expect(readNotificationSettings({ reminderTime: '25:00', groups: [] }).reminderTime).toBe('09:00');
    expect(readNotificationSettings({ reminderTime: 9, groups: null })).toEqual(DEFAULT_NOTIFICATION_SETTINGS);
  });

  it('reads them in a transaction, also as the worker', async () => {
    await test.query(`INSERT INTO user_preferences (user_id, notif) VALUES ($1, '{"email": false}')`, [userId]);
    expect(
      await test.as('wf_worker', () => withUser(test.db, userId, (tx) => notificationSettingsIn(tx, userId))),
    ).toEqual({ ...DEFAULT_NOTIFICATION_SETTINGS, email: false });
    const other = await insertUser(test, 'budi@example.test');
    expect(
      await test.as('wf_worker', () => withUser(test.db, other, (tx) => notificationSettingsIn(tx, other))),
    ).toEqual(DEFAULT_NOTIFICATION_SETTINGS);
  });

  it('says which types are hidden in the app and which are emailed', () => {
    expect(hiddenTypes(DEFAULT_NOTIFICATION_SETTINGS)).toEqual([]);
    const settings: NotificationSettings = {
      ...DEFAULT_NOTIFICATION_SETTINGS,
      groups: { ...DEFAULT_NOTIFICATION_SETTINGS.groups, balance: { inApp: false, email: true } },
    };
    expect(hiddenTypes(settings)).toEqual(['low_balance', 'account_unchecked']);
    expect(emailsType(settings, 'low_balance')).toBe(true);
    expect(emailsType(settings, 'bill_reminder')).toBe(true);
    expect(emailsType(settings, 'budget_threshold')).toBe(false);
    expect(emailsType({ ...settings, email: false }, 'bill_reminder')).toBe(false);
  });
});
