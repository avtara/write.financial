// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Isolation cases for the server functions in `src/server/fn/schedules.ts`, run by
 * `src/server/fn/isolation.integration.test.ts`.
 */
import type {
  ChangeAccountResult,
  DetectedOverview,
  RecurrenceView,
  ScheduledItem,
  SubscriptionsOverview,
  SubscriptionView,
} from '@wf/db/schedules';
import { addDays } from '@wf/domain/period';
import { expect } from 'vitest';
import type { Result } from '../../../src/server/access.ts';
import {
  A_LEDGER,
  aM3Rows,
  arisan,
  arisanOfB,
  as,
  bId,
  type Case,
  count,
  firstOfA,
  idsOf,
  type Name,
  NOT_FOUND,
  ok,
  services,
  SOME_ID,
  spotify,
  subscriptionOf,
  UNAUTHENTICATED,
} from '../harness.ts';

export const cases = {
  listRecurrences: {
    input: () => ({}),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      const ofB = await as<Result<RecurrenceView[]>>('B', 'listRecurrences', input);
      expect(ofB.ok && ofB.value.map((recurrence) => recurrence.id)).toEqual(await idsOf('recurrences', bId));
      expect(ofB.ok && ofB.value.map((recurrence) => recurrence.template.description)).toEqual(['Kos B']);
      const ofA = await as<Result<RecurrenceView[]>>('A', 'listRecurrences', input);
      expect(ofA.ok && ofA.value.map((recurrence) => recurrence.template.description)).toEqual([A_LEDGER.recurrence]);
    },
  },
  createRecurrence: {
    input: () => arisan(SOME_ID),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const a = await aM3Rows();
      expect(await as('B', 'createRecurrence', arisan(await firstOfA('accounts')))).toEqual({
        ok: false,
        code: 'INVALID_RECURRENCE',
      });
      const [accountOfB = ''] = await idsOf('accounts', bId);
      const created = await as<Result<RecurrenceView>>('B', 'createRecurrence', arisan(accountOfB));
      expect(created).toMatchObject(ok({ template: { description: 'Arisan B' }, freq: 'weekly', status: 'active' }));
      expect(await idsOf('recurrences', bId)).toContain(created.ok && created.value.id);
      // The first occurrence must be B's own transaction.
      expect(
        await as('B', 'createRecurrence', { ...arisan(accountOfB), transactionId: await firstOfA('transactions') }),
      ).toEqual(NOT_FOUND);
      expect(await aM3Rows()).toEqual(a);
    },
  },
  getTransactionRecurrence: {
    input: () => ({ transactionId: SOME_ID }),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const [accountOfB = ''] = await idsOf('accounts', bId);
      const [transactionOfB = ''] = await idsOf('transactions', bId);
      const created = await as<Result<RecurrenceView>>('B', 'createRecurrence', {
        ...arisan(accountOfB),
        transactionId: transactionOfB,
      });
      expect(await as('B', 'getTransactionRecurrence', { transactionId: transactionOfB })).toMatchObject(
        ok({ id: created.ok && created.value.id }),
      );
      expect(await as('A', 'getTransactionRecurrence', { transactionId: transactionOfB })).toEqual(ok(null));
    },
  },
  updateRecurrence: {
    input: () => ({ id: SOME_ID, ...arisan(SOME_ID) }),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const a = await aM3Rows();
      const [accountOfB = ''] = await idsOf('accounts', bId);
      const changed = arisan(accountOfB, 75_000n);
      expect(await as('B', 'updateRecurrence', { id: await firstOfA('recurrences'), ...changed })).toEqual(NOT_FOUND);
      expect(await as('B', 'updateRecurrence', { id: await arisanOfB(), ...changed })).toMatchObject(
        ok({ template: { amountMinor: 75_000n } }),
      );
      expect(await aM3Rows()).toEqual(a);
    },
  },
  stopRecurrence: {
    input: () => ({ id: SOME_ID }),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const a = await aM3Rows();
      expect(await as('B', 'stopRecurrence', { id: await firstOfA('recurrences') })).toEqual(NOT_FOUND);
      const stopped = await as<Result<{ deletedOccurrences: number }>>('B', 'stopRecurrence', {
        id: await arisanOfB(),
      });
      expect(stopped.ok && stopped.value.deletedOccurrences).toBeGreaterThan(0);
      expect(await aM3Rows()).toEqual(a);
    },
  },
  undoStopRecurrence: {
    input: () => ({ id: SOME_ID }),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const a = await aM3Rows();
      expect(await as('B', 'undoStopRecurrence', { id: await firstOfA('recurrences') })).toEqual(NOT_FOUND);
      expect(await as('B', 'undoStopRecurrence', { id: await arisanOfB() })).toMatchObject(ok({ status: 'active' }));
      expect(await aM3Rows()).toEqual(a);
    },
  },
  listSubscriptions: {
    input: () => ({}),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      const ofB = await as<Result<SubscriptionsOverview>>('B', 'listSubscriptions', input);
      expect(ofB.ok && ofB.value.subscriptions.map((subscription) => subscription.name).sort()).toEqual([
        'Langganan B',
        'Langganan B2',
      ]);
      const ofA = await as<Result<SubscriptionsOverview>>('A', 'listSubscriptions', input);
      expect(ofA.ok && ofA.value.subscriptions.map((subscription) => subscription.name)).toEqual([
        A_LEDGER.subscription,
      ]);
    },
  },
  countActiveSubscriptions: {
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const ofB = await as<Result<SubscriptionsOverview>>('B', 'listSubscriptions', {});
      expect(await as('B', 'countActiveSubscriptions', undefined)).toEqual(ok(ofB.ok ? ofB.value.counts.active : -1));
    },
  },
  setSubscriptionLogo: {
    input: () => {
      const form = new FormData();
      form.set('id', SOME_ID);
      form.set('file', new File([new Uint8Array([137, 80, 78, 71])], 'logo.png', { type: 'image/png' }));
      return form;
    },
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      // Refused before the image is read or anything reaches storage.
      const form = new FormData();
      form.set('id', await firstOfA('subscriptions'));
      form.set('file', new File([new Uint8Array([137, 80, 78, 71])], 'logo.png', { type: 'image/png' }));
      const a = await aM3Rows();
      expect(await as('B', 'setSubscriptionLogo', form)).toEqual(NOT_FOUND);
      expect(await aM3Rows()).toEqual(a);
    },
  },
  removeSubscriptionLogo: {
    input: () => ({ id: SOME_ID }),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const a = await aM3Rows();
      expect(await as('B', 'removeSubscriptionLogo', { id: await firstOfA('subscriptions') })).toEqual(NOT_FOUND);
      expect(await aM3Rows()).toEqual(a);
    },
  },
  getSubscription: {
    input: () => ({ id: SOME_ID }),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      expect(await as('B', 'getSubscription', { id: await firstOfA('subscriptions') })).toEqual(NOT_FOUND);
      expect(await as('B', 'getSubscription', { id: await subscriptionOf(bId, 'Langganan B') })).toMatchObject(
        ok({ name: 'Langganan B', priceMinor: 186_000n }),
      );
    },
  },
  createSubscription: {
    input: () => spotify(SOME_ID, '2026-11-05'),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const a = await aM3Rows();
      const later = addDays((await services.schedules.listSubscriptions(bId)).today, 20);
      expect(await as('B', 'createSubscription', spotify(await firstOfA('accounts'), later))).toEqual({
        ok: false,
        code: 'INVALID_SUBSCRIPTION',
      });
      const [accountOfB = ''] = await idsOf('accounts', bId);
      const created = await as<Result<SubscriptionView>>('B', 'createSubscription', spotify(accountOfB, later));
      expect(created).toMatchObject(ok({ name: 'Spotify B', nextBillingDate: later }));
      expect(await subscriptionOf(bId, 'Spotify B')).toBe(created.ok && created.value.id);
      expect(await aM3Rows()).toEqual(a);
    },
  },
  updateSubscription: {
    input: () => ({ id: SOME_ID, patch: { plan: 'Family' } }),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const a = await aM3Rows();
      const patch = { plan: 'Family' };
      expect(await as('B', 'updateSubscription', { id: await firstOfA('subscriptions'), patch })).toEqual(NOT_FOUND);
      expect(await as('B', 'updateSubscription', { id: await subscriptionOf(bId, 'Spotify B'), patch })).toMatchObject(
        ok({ plan: 'Family' }),
      );
      expect(await aM3Rows()).toEqual(a);
    },
  },
  changeSubscriptionAccount: {
    input: () => ({ id: SOME_ID, accountId: SOME_ID }),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const a = await aM3Rows();
      const [accountOfB = ''] = await idsOf('accounts', bId);
      const spotifyOfB = await subscriptionOf(bId, 'Spotify B');
      expect(
        await as('B', 'changeSubscriptionAccount', { id: await firstOfA('subscriptions'), accountId: accountOfB }),
      ).toEqual(NOT_FOUND);
      expect(
        await as('B', 'changeSubscriptionAccount', { id: spotifyOfB, accountId: await firstOfA('accounts') }),
      ).toEqual({ ok: false, code: 'INVALID_SUBSCRIPTION' });
      const changed = await as<Result<ChangeAccountResult>>('B', 'changeSubscriptionAccount', {
        id: spotifyOfB,
        accountId: accountOfB,
      });
      expect(changed.ok).toBe(true);
      expect(await aM3Rows()).toEqual(a);
    },
  },
  pauseSubscription: {
    input: () => ({ id: SOME_ID, length: { months: 1 }, remindDaysBefore: 3 }),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const a = await aM3Rows();
      const pause = { length: { months: 1 }, remindDaysBefore: 3 };
      expect(await as('B', 'pauseSubscription', { ...pause, id: await firstOfA('subscriptions') })).toEqual(NOT_FOUND);
      const paused = await as<Result<SubscriptionView>>('B', 'pauseSubscription', {
        ...pause,
        id: await subscriptionOf(bId, 'Spotify B'),
      });
      expect(paused.ok && paused.value.pausedUntil).toEqual(expect.any(String));
      expect(await aM3Rows()).toEqual(a);
    },
  },
  reactivateSubscription: {
    input: () => ({ id: SOME_ID }),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const a = await aM3Rows();
      expect(await as('B', 'reactivateSubscription', { id: await firstOfA('subscriptions') })).toEqual(NOT_FOUND);
      expect(await as('B', 'reactivateSubscription', { id: await subscriptionOf(bId, 'Spotify B') })).toMatchObject(
        ok({ pausedUntil: null, effectiveStatus: 'active' }),
      );
      expect(await aM3Rows()).toEqual(a);
    },
  },
  cancelSubscription: {
    input: () => ({ id: SOME_ID, mode: 'after_next_bill' }),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const a = await aM3Rows();
      const mode = 'after_next_bill';
      expect(await as('B', 'cancelSubscription', { id: await firstOfA('subscriptions'), mode })).toEqual(NOT_FOUND);
      expect(await as('B', 'cancelSubscription', { id: await subscriptionOf(bId, 'Spotify B'), mode })).toMatchObject(
        ok({ cancelMode: mode }),
      );
      expect(await aM3Rows()).toEqual(a);
    },
  },
  rateSubscriptionUsage: {
    input: () => ({ id: SOME_ID, rating: 'rarely' }),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const a = await aM3Rows();
      const rating = 'rarely';
      expect(await as('B', 'rateSubscriptionUsage', { id: await firstOfA('subscriptions'), rating })).toEqual(
        NOT_FOUND,
      );
      expect(
        await as('B', 'rateSubscriptionUsage', { id: await subscriptionOf(bId, 'Langganan B'), rating }),
      ).toMatchObject(ok({ usageRating: rating }));
      expect(await aM3Rows()).toEqual(a);
    },
  },
  getSubscriptionBilling: {
    input: () => ({ id: SOME_ID }),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      expect(await as('B', 'getSubscriptionBilling', { id: await firstOfA('subscriptions') })).toEqual(NOT_FOUND);
      const id = await subscriptionOf(bId, 'Langganan B');
      const ofB = await as<Result<{ count: number; charges: { transactionId: string }[] }>>(
        'B',
        'getSubscriptionBilling',
        { id },
      );
      expect(ofB.ok && ofB.value.count).toBe(
        await count('scheduled_occurrences', `source_id = '${id}' AND status = 'confirmed'`),
      );
      const transactionsOfB = await idsOf('transactions', bId);
      expect(ofB.ok && ofB.value.charges.every((charge) => transactionsOfB.includes(charge.transactionId))).toBe(true);
    },
  },
  listDetectedSubscriptions: {
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const ofB = await as<Result<DetectedOverview>>('B', 'listDetectedSubscriptions');
      expect(ofB.ok && ofB.value.candidates.map((candidate) => candidate.merchant).sort()).toEqual([
        'Gym B',
        'Vidio B',
      ]);
      const ofA = await as<Result<DetectedOverview>>('A', 'listDetectedSubscriptions');
      expect(ofA.ok && ofA.value.candidates.map((candidate) => candidate.merchant)).toEqual([A_LEDGER.detected]);
    },
  },
  addDetectedSubscriptions: {
    input: () => ({ ids: [SOME_ID] }),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const a = await aM3Rows();
      const vidio = await idsOf('detected_recurring', bId, `merchant = 'Vidio B'`);
      expect(await as('B', 'addDetectedSubscriptions', { ids: [await firstOfA('detected_recurring')] })).toEqual(
        NOT_FOUND,
      );
      const added = await as<Result<{ subscriptionIds: string[] }>>('B', 'addDetectedSubscriptions', { ids: vidio });
      expect(added.ok && added.value.subscriptionIds).toHaveLength(1);
      expect(await idsOf('subscriptions', bId)).toEqual(
        expect.arrayContaining(added.ok ? added.value.subscriptionIds : ['']),
      );
      expect(await aM3Rows()).toEqual(a);
    },
  },
  dismissDetectedSubscriptions: {
    input: () => ({ ids: [SOME_ID] }),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const a = await aM3Rows();
      expect(await as('B', 'dismissDetectedSubscriptions', { ids: [await firstOfA('detected_recurring')] })).toEqual(
        ok({ dismissed: 0 }),
      );
      const gym = await idsOf('detected_recurring', bId, `merchant = 'Gym B'`);
      expect(await as('B', 'dismissDetectedSubscriptions', { ids: gym })).toEqual(ok({ dismissed: 1 }));
      expect(await aM3Rows()).toEqual(a);
    },
  },
  deleteSubscription: {
    input: () => ({ id: SOME_ID }),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const a = await aM3Rows();
      expect(await as('B', 'deleteSubscription', { id: await firstOfA('subscriptions') })).toEqual(NOT_FOUND);
      const deleted = await as<Result<{ deletedOccurrences: number }>>('B', 'deleteSubscription', {
        id: await subscriptionOf(bId, 'Spotify B'),
      });
      expect(deleted.ok && deleted.value.deletedOccurrences).toBeGreaterThanOrEqual(0);
      expect(await subscriptionOf(bId, 'Spotify B')).toBe('');
      expect(await aM3Rows()).toEqual(a);
    },
  },
  listScheduled: {
    input: () => ({ from: '2026-10-01', to: '2026-10-31' }),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const { today } = await services.schedules.listSubscriptions(bId);
      const range = { from: today, to: addDays(today, 60) };
      const ofB = await as<Result<ScheduledItem[]>>('B', 'listScheduled', range);
      const sourcesOfB = [...(await idsOf('subscriptions', bId)), ...(await idsOf('recurrences', bId))];
      expect(ofB.ok && ofB.value.length).toBeGreaterThan(0);
      expect(ofB.ok && ofB.value.filter((item) => !sourcesOfB.includes(item.sourceId))).toEqual([]);
      expect(await as('B', 'listScheduled', { from: today, to: addDays(today, 400) })).toEqual({
        ok: false,
        code: 'INVALID_PERIOD',
      });
    },
  },
} satisfies Partial<Record<Name, Case>>;
