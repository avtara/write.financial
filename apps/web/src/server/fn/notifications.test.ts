// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeSession } from '../../../test/fixtures.ts';
import { call, requestContext, validatorOf } from '../../../test/server-fn.ts';
import { DEFAULT_NOTIFICATION_SETTINGS } from '@wf/db/notification-settings';
import {
  getNextReminder,
  getNotificationCounts,
  getNotificationSettings,
  listNotifications,
  markNotificationsRead,
  updateNotificationSettings,
} from './notifications.ts';

const ID = '0192a6c0-0000-7000-8000-000000000001';

const fake = vi.hoisted(() => ({
  ledgerError: (code: string) => Object.assign(new Error(code), { code }),
  notifications: {
    list: vi.fn(() => Promise.resolve({ items: [], nextCursor: null })),
    counts: vi.fn(() => Promise.resolve({ total: 3, unread: 1 })),
    markRead: vi.fn(() => Promise.resolve({ updated: 1 })),
    nextReminder: vi.fn(() => Promise.resolve(null)),
  },
  notificationSettings: {
    get: vi.fn(() => Promise.resolve('settings')),
    update: vi.fn(() => Promise.resolve({ settings: 'settings', movedReminders: 2 })),
  },
}));

// vi.mock factories run before imports; they load the shared helper themselves.
vi.mock('@tanstack/react-start', async () => (await import('../../../test/server-fn.ts')).serverFnModule());
vi.mock('../runtime.ts', () => ({
  services: () =>
    Promise.resolve({
      notifications: fake.notifications,
      notificationSettings: fake.notificationSettings,
      now: () => new Date('2026-10-15T09:42:00Z'),
    }),
}));

const USER_ID = fakeSession().user.id;
const signedIn = () => requestContext(fakeSession());
const signedOut = () => requestContext(null);
const parse = (fn: unknown, data: unknown): unknown => validatorOf(fn).parse(data);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('notification server functions', () => {
  it('lists a filtered page of the session user’s notifications', async () => {
    const filter = parse(listNotifications, { filter: 'unread', category: 'budget_bills', from: '2026-10-01' });
    expect(await call(listNotifications, { context: signedIn(), data: filter })).toEqual({
      ok: true,
      value: { items: [], nextCursor: null },
    });
    expect(fake.notifications.list).toHaveBeenCalledWith(USER_ID, {
      filter: 'unread',
      category: 'budget_bills',
      from: '2026-10-01',
    });
  });

  it('counts, marks read, and reads the next reminder', async () => {
    expect(await call(getNotificationCounts, { context: signedIn(), data: {} })).toEqual({
      ok: true,
      value: { total: 3, unread: 1 },
    });
    expect(fake.notifications.counts).toHaveBeenCalledWith(USER_ID, {});
    expect(await call(markNotificationsRead, { context: signedIn(), data: { ids: [ID] } })).toEqual({
      ok: true,
      value: { updated: 1 },
    });
    expect(fake.notifications.markRead).toHaveBeenCalledWith(USER_ID, { ids: [ID] });
    expect(await call(getNextReminder, { context: signedIn(), data: undefined })).toEqual({ ok: true, value: null });
    expect(fake.notifications.nextReminder).toHaveBeenCalledWith(USER_ID);
  });

  it('reads and saves Settings › Notifikasi', async () => {
    expect(await call(getNotificationSettings, { context: signedIn(), data: undefined })).toEqual({
      ok: true,
      value: 'settings',
    });
    expect(fake.notificationSettings.get).toHaveBeenCalledWith(USER_ID);
    const settings = parse(updateNotificationSettings, { ...DEFAULT_NOTIFICATION_SETTINGS, reminderTime: '07:30' });
    expect(await call(updateNotificationSettings, { context: signedIn(), data: settings })).toEqual({
      ok: true,
      value: { settings: 'settings', movedReminders: 2 },
    });
    expect(fake.notificationSettings.update).toHaveBeenCalledWith(USER_ID, {
      ...DEFAULT_NOTIFICATION_SETTINGS,
      reminderTime: '07:30',
    });
    expect(await call(getNotificationSettings, { context: signedOut(), data: undefined })).toMatchObject({ ok: false });
    expect(await call(updateNotificationSettings, { context: signedOut(), data: settings })).toMatchObject({
      ok: false,
      code: 'UNAUTHENTICATED',
    });
    const update = validatorOf(updateNotificationSettings);
    expect(update.safeParse({ ...DEFAULT_NOTIFICATION_SETTINGS, reminderTime: '24:00' }).success).toBe(false);
    expect(update.safeParse({ ...DEFAULT_NOTIFICATION_SETTINGS, groups: { bills: {} } }).success).toBe(false);
  });

  it('turns ledger errors into expected results', async () => {
    fake.notifications.list.mockRejectedValueOnce(fake.ledgerError('NOT_FOUND'));
    expect(await call(listNotifications, { context: signedIn(), data: {} })).toEqual({ ok: false, code: 'NOT_FOUND' });
  });

  it('refuses signed-out requests', async () => {
    const UNAUTHENTICATED = { ok: false, code: 'UNAUTHENTICATED' };
    expect(await call(listNotifications, { context: signedOut(), data: {} })).toEqual(UNAUTHENTICATED);
    expect(await call(getNotificationCounts, { context: signedOut(), data: {} })).toEqual(UNAUTHENTICATED);
    expect(await call(markNotificationsRead, { context: signedOut(), data: { all: true } })).toEqual(UNAUTHENTICATED);
    expect(await call(getNextReminder, { context: signedOut(), data: undefined })).toEqual(UNAUTHENTICATED);
    expect(Object.values(fake.notifications).every((fn) => fn.mock.calls.length === 0)).toBe(true);
  });

  it('validates input with Zod schemas', () => {
    const list = validatorOf(listNotifications);
    expect(list.safeParse({ type: 'bill_reminder', limit: 30, before: ID, search: 'Netflix' }).success).toBe(true);
    expect(list.safeParse({ type: 'spam' }).success).toBe(false);
    expect(list.safeParse({ limit: 101 }).success).toBe(false);
    expect(list.safeParse({ to: '2026-13-01' }).success).toBe(false);
    const counts = validatorOf(getNotificationCounts);
    expect(counts.parse({ from: '2026-09-16', to: '2026-10-15' })).toEqual({ from: '2026-09-16', to: '2026-10-15' });
    const mark = validatorOf(markNotificationsRead);
    expect(mark.parse({ all: true, category: 'system' })).toEqual({ all: true, category: 'system' });
    expect(mark.parse({ all: true })).toEqual({ all: true });
    expect(mark.safeParse({ ids: [] }).success).toBe(false);
    expect(mark.safeParse({ all: false }).success).toBe(false);
  });
});
