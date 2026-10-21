// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Isolation cases for the server functions in `src/server/fn/review.ts`, run by
 * `src/server/fn/isolation.integration.test.ts`.
 */
import type { ConfirmResult, ReviewCounts, ReviewItemView } from '@wf/db/review';
import { expect } from 'vitest';
import type { Result } from '../../../src/server/access.ts';
import {
  A_LEDGER,
  aId,
  aM3Rows,
  as,
  bId,
  browsers,
  type Case,
  firstOfA,
  FUNCTIONS,
  idsOf,
  type Name,
  NOT_FOUND,
  ok,
  SOME_ID,
  UNAUTHENTICATED,
} from '../harness.ts';

export const cases = {
  listReviewItems: {
    input: () => ({}),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      type Page = Result<{ items: ReviewItemView[]; total: number }>;
      const ofB = await as<Page>('B', 'listReviewItems', input);
      expect(ofB.ok && ofB.value.items.map((item) => item.id).sort()).toEqual(await idsOf('review_items', bId));
      expect(ofB.ok && ofB.value.items.map((item) => item.label).sort()).toEqual([
        'Kos B',
        'Langganan B',
        'Langganan B2',
      ]);
      expect(await as('B', 'listReviewItems', { status: 'resolved' })).toEqual(ok({ items: [], total: 0 }));
      const ofA = await as<Page>('A', 'listReviewItems', input);
      expect(ofA.ok && ofA.value.items.map((item) => item.label).sort()).toEqual([
        A_LEDGER.recurrence,
        A_LEDGER.subscription,
      ]);
    },
  },
  getReviewCounts: {
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      expect(await as<Result<ReviewCounts>>('B', 'getReviewCounts')).toMatchObject(
        ok({ total: 3, byReason: { due_occurrence: 3 } }),
      );
      expect(await as<Result<ReviewCounts>>('A', 'getReviewCounts')).toMatchObject(ok({ total: 2 }));
    },
  },
  markReviewUnpaid: {
    input: () => ({ itemId: SOME_ID }),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const a = await aM3Rows();
      expect(await as('B', 'markReviewUnpaid', { itemId: await firstOfA('review_items') })).toEqual(NOT_FOUND);
      const [itemId] = await idsOf('review_items', bId, `status = 'pending'`);
      expect(await as('B', 'markReviewUnpaid', { itemId })).toEqual(ok(null));
      expect(await idsOf('review_items', bId, `status = 'pending'`)).toContain(itemId);
      expect(await aM3Rows()).toEqual(a);
    },
  },
  confirmReview: {
    input: () => ({ itemId: SOME_ID }),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const a = await aM3Rows();
      const occurredAt = new Date();
      expect(await as('B', 'confirmReview', { itemId: await firstOfA('review_items'), edits: { occurredAt } })).toEqual(
        NOT_FOUND,
      );
      const [itemId] = await idsOf('review_items', bId, `status = 'pending'`);
      const confirmed = await as<Result<ConfirmResult>>('B', 'confirmReview', { itemId, edits: { occurredAt } });
      expect(confirmed).toMatchObject(ok({ overrideIds: [] }));
      expect(await idsOf('transactions', bId)).toContain(confirmed.ok && confirmed.value.transactionId);
      expect(await as('B', 'confirmReview', { itemId })).toEqual({ ok: false, code: 'REVIEW_RESOLVED' });
      expect(await aM3Rows()).toEqual(a);
    },
  },
  confirmReviewBulk: {
    input: () => ({ itemIds: [SOME_ID] }),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const a = await aM3Rows();
      const ofA = await firstOfA('review_items');
      const [itemId] = await idsOf('review_items', bId, `status = 'pending'`);
      // Not recorded for the leak scan: the answer names A's id only because B sent it.
      expect(await browsers.B.call(FUNCTIONS.confirmReviewBulk, { itemIds: [ofA, itemId] })).toEqual(
        ok({ confirmed: [itemId], failed: [{ id: ofA, code: 'NOT_FOUND' }] }),
      );
      expect(await aM3Rows()).toEqual(a);
    },
  },
  ignoreReview: {
    input: () => ({ itemIds: [SOME_ID] }),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const a = await aM3Rows();
      expect(await as('B', 'ignoreReview', { itemIds: await idsOf('review_items', aId) })).toEqual(ok({ ignored: 0 }));
      const pending = await idsOf('review_items', bId, `status = 'pending'`);
      expect(pending).toHaveLength(1);
      expect(await as('B', 'ignoreReview', { itemIds: pending })).toEqual(ok({ ignored: 1 }));
      expect(await idsOf('review_items', bId, `status = 'ignored'`)).toEqual(pending);
      expect(await aM3Rows()).toEqual(a);
    },
  },
  confirmOccurrence: {
    input: () => ({ occurrenceId: SOME_ID }),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const a = await aM3Rows();
      const edits = { occurredAt: new Date() };
      const [ofA] = await idsOf('scheduled_occurrences', aId, `status = 'scheduled'`);
      expect(await as('B', 'confirmOccurrence', { occurrenceId: ofA, edits })).toEqual(NOT_FOUND);
      const [occurrenceId] = await idsOf('scheduled_occurrences', bId, `status = 'scheduled'`);
      const confirmed = await as<Result<ConfirmResult>>('B', 'confirmOccurrence', { occurrenceId, edits });
      expect(await idsOf('transactions', bId)).toContain(confirmed.ok && confirmed.value.transactionId);
      expect(await idsOf('scheduled_occurrences', bId, `status = 'confirmed'`)).toContain(occurrenceId);
      expect(await aM3Rows()).toEqual(a);
    },
  },
} satisfies Partial<Record<Name, Case>>;
