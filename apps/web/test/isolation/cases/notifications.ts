// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Isolation cases for the server functions in `src/server/fn/notifications.ts`, run by
 * `src/server/fn/isolation.integration.test.ts`.
 */
import { DEFAULT_NOTIFICATION_SETTINGS } from '@wf/db/notification-settings';
import type { NextReminder, NotificationCounts, NotificationView } from '@wf/db/notifications';
import { expect } from 'vitest';
import type { Result } from '../../../src/server/access.ts';
import {
  A_LEDGER,
  aId,
  aM3Rows,
  as,
  bId,
  type Case,
  idsOf,
  type Name,
  notificationRows,
  ok,
  UNAUTHENTICATED,
} from '../harness.ts';

export const cases = {
  listNotifications: {
    input: () => ({}),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      type Page = Result<{ items: NotificationView[]; nextCursor: string | null }>;
      const ofB = await as<Page>('B', 'listNotifications', input);
      expect(ofB.ok && ofB.value.items.map((item) => item.id).sort()).toEqual(
        (await notificationRows(bId)).map((row) => row.id),
      );
      expect(ofB.ok && ofB.value.items.map((item) => item.params)).toContainEqual({ account: 'Rekening B' });
      expect(await as('B', 'listNotifications', { search: 'Rahasia' })).toEqual(ok({ items: [], nextCursor: null }));
      const [ofA] = await notificationRows(aId);
      expect(await as('B', 'listNotifications', { before: ofA?.id })).toEqual(ok({ items: [], nextCursor: null }));
      const forA = await as<Page>('A', 'listNotifications', { search: 'Rahasia' });
      expect(forA.ok && forA.value.items.map((item) => item.params)).toContainEqual({ account: A_LEDGER.account });
    },
  },
  getNotificationCounts: {
    input: () => ({}),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      const rows = (await notificationRows(bId)).length;
      expect(rows).toBeGreaterThan(1);
      const ofB = await as<Result<NotificationCounts>>('B', 'getNotificationCounts', input);
      expect(ofB.ok && ofB.value).toMatchObject({ total: rows, unread: rows });
    },
  },
  markNotificationsRead: {
    input: () => ({ all: true }),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      const a = await aM3Rows();
      const ofA = (await notificationRows(aId)).map((row) => row.id);
      expect(await as('B', 'markNotificationsRead', { ids: ofA })).toEqual(ok({ updated: 0 }));
      const ofB = await notificationRows(bId);
      expect(await as('B', 'markNotificationsRead', input)).toEqual(ok({ updated: ofB.length }));
      expect((await notificationRows(bId)).every((row) => row.read_at instanceof Date)).toBe(true);
      expect(await aM3Rows()).toEqual(a);
      expect(a.notifications.every((row) => row.read_at === null)).toBe(true);
    },
  },
  getNextReminder: {
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const ofB = await as<Result<NextReminder | null>>('B', 'getNextReminder');
      const sourcesOfB = [...(await idsOf('subscriptions', bId)), ...(await idsOf('recurrences', bId))];
      expect(ofB.ok && sourcesOfB).toContain(ofB.ok && ofB.value?.sourceId);
      const ofA = await as<Result<NextReminder | null>>('A', 'getNextReminder');
      const sourcesOfA = [...(await idsOf('subscriptions', aId)), ...(await idsOf('recurrences', aId))];
      expect(ofA.ok && sourcesOfA).toContain(ofA.ok && ofA.value?.sourceId);
    },
  },
  getNotificationSettings: {
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      // A's settings stay A's: B saving its own changes nothing for A.
      expect(await as('B', 'getNotificationSettings')).toEqual(ok(DEFAULT_NOTIFICATION_SETTINGS));
    },
  },
  updateNotificationSettings: {
    input: () => ({ ...DEFAULT_NOTIFICATION_SETTINGS, email: false }),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      const a = await as('A', 'getNotificationSettings');
      expect(await as('B', 'updateNotificationSettings', input)).toMatchObject(ok({ settings: { email: false } }));
      expect(await as('B', 'getNotificationSettings')).toMatchObject(ok({ email: false }));
      expect(await as('A', 'getNotificationSettings')).toEqual(a);
    },
  },
} satisfies Partial<Record<Name, Case>>;
