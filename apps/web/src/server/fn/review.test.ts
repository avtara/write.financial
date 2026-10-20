// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeSession } from '../../../test/fixtures.ts';
import { call, requestContext, validatorOf } from '../../../test/server-fn.ts';
import {
  confirmOccurrence,
  confirmReview,
  confirmReviewBulk,
  getReviewCounts,
  ignoreReview,
  listReviewItems,
  markReviewUnpaid,
} from './review.ts';

const ID = '0192a6c0-0000-7000-8000-000000000001';
const OTHER = '0192a6c0-0000-7000-8000-000000000002';
const CONFIRMED = { transactionId: OTHER, overrideIds: [] };

const fake = vi.hoisted(() => ({
  ledgerError: (code: string) => Object.assign(new Error(code), { code }),
  review: {
    list: vi.fn(() => Promise.resolve({ items: [], total: 0 })),
    counts: vi.fn(() => Promise.resolve({ total: 4 })),
    confirm: vi.fn(() => Promise.resolve({ transactionId: '0192a6c0-0000-7000-8000-000000000002', overrideIds: [] })),
    confirmBulk: vi.fn(() => Promise.resolve({ confirmed: [], failed: [] })),
    ignore: vi.fn(() => Promise.resolve({ ignored: 2 })),
    markUnpaid: vi.fn(() => Promise.resolve()),
    confirmOccurrence: vi.fn(() =>
      Promise.resolve({ transactionId: '0192a6c0-0000-7000-8000-000000000002', overrideIds: [] }),
    ),
  },
}));

// vi.mock factories run before imports; they load the shared helper themselves.
vi.mock('@tanstack/react-start', async () => (await import('../../../test/server-fn.ts')).serverFnModule());
vi.mock('../runtime.ts', () => ({
  services: () => Promise.resolve({ review: fake.review, now: () => new Date('2026-10-15T09:42:00Z') }),
}));

const USER_ID = fakeSession().user.id;
const signedIn = () => requestContext(fakeSession());
const signedOut = () => requestContext(null);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('review server functions', () => {
  it('lists and counts the session user’s queue', async () => {
    expect(await call(listReviewItems, { context: signedIn(), data: { reason: 'due_occurrence' } })).toEqual({
      ok: true,
      value: { items: [], total: 0 },
    });
    expect(fake.review.list).toHaveBeenCalledWith(USER_ID, { reason: 'due_occurrence' });
    expect(await call(getReviewCounts, { context: signedIn(), data: undefined })).toEqual({
      ok: true,
      value: { total: 4 },
    });
    expect(fake.review.counts).toHaveBeenCalledWith(USER_ID);
  });

  it('confirms with or without the card’s edits', async () => {
    expect(await call(confirmReview, { context: signedIn(), data: { itemId: ID } })).toEqual({
      ok: true,
      value: CONFIRMED,
    });
    expect(fake.review.confirm).toHaveBeenLastCalledWith(USER_ID, ID, undefined);
    await call(confirmReview, {
      context: signedIn(),
      data: { itemId: ID, edits: { amountMinor: 186_000n, note: undefined, categoryId: null } },
    });
    expect(fake.review.confirm).toHaveBeenLastCalledWith(USER_ID, ID, { amountMinor: 186_000n, categoryId: null });

    expect(await call(confirmOccurrence, { context: signedIn(), data: { occurrenceId: ID } })).toEqual({
      ok: true,
      value: CONFIRMED,
    });
    expect(fake.review.confirmOccurrence).toHaveBeenLastCalledWith(USER_ID, ID, undefined);
    await call(confirmOccurrence, { context: signedIn(), data: { occurrenceId: ID, edits: { accountId: OTHER } } });
    expect(fake.review.confirmOccurrence).toHaveBeenLastCalledWith(USER_ID, ID, { accountId: OTHER });
  });

  it('confirms in bulk, ignores, and marks unpaid', async () => {
    const data = { itemIds: [ID, OTHER], edits: { categoryId: OTHER } };
    expect(await call(confirmReviewBulk, { context: signedIn(), data })).toEqual({
      ok: true,
      value: { confirmed: [], failed: [] },
    });
    expect(fake.review.confirmBulk).toHaveBeenCalledWith(USER_ID, [ID, OTHER], { categoryId: OTHER });
    expect(await call(ignoreReview, { context: signedIn(), data: { itemIds: [ID, OTHER] } })).toEqual({
      ok: true,
      value: { ignored: 2 },
    });
    expect(fake.review.ignore).toHaveBeenCalledWith(USER_ID, [ID, OTHER]);
    expect(await call(markReviewUnpaid, { context: signedIn(), data: { itemId: ID } })).toEqual({
      ok: true,
      value: null,
    });
    expect(fake.review.markUnpaid).toHaveBeenCalledWith(USER_ID, ID);
  });

  it('turns ledger errors into expected results', async () => {
    fake.review.confirm.mockRejectedValueOnce(fake.ledgerError('REVIEW_RESOLVED'));
    expect(await call(confirmReview, { context: signedIn(), data: { itemId: ID } })).toEqual({
      ok: false,
      code: 'REVIEW_RESOLVED',
    });
  });

  it('refuses signed-out requests', async () => {
    const UNAUTHENTICATED = { ok: false, code: 'UNAUTHENTICATED' };
    const context = signedOut();
    expect(await call(listReviewItems, { context, data: {} })).toEqual(UNAUTHENTICATED);
    expect(await call(getReviewCounts, { context, data: undefined })).toEqual(UNAUTHENTICATED);
    expect(await call(confirmReview, { context, data: { itemId: ID } })).toEqual(UNAUTHENTICATED);
    expect(await call(confirmReviewBulk, { context, data: { itemIds: [ID] } })).toEqual(UNAUTHENTICATED);
    expect(await call(ignoreReview, { context, data: { itemIds: [ID] } })).toEqual(UNAUTHENTICATED);
    expect(await call(markReviewUnpaid, { context, data: { itemId: ID } })).toEqual(UNAUTHENTICATED);
    expect(await call(confirmOccurrence, { context, data: { occurrenceId: ID } })).toEqual(UNAUTHENTICATED);
    expect(Object.values(fake.review).every((fn) => fn.mock.calls.length === 0)).toBe(true);
  });

  it('validates input with Zod schemas', () => {
    const list = validatorOf(listReviewItems);
    expect(list.safeParse({ status: 'resolved', source: 'schedule', limit: 50, offset: 0 }).success).toBe(true);
    expect(list.safeParse({ reason: 'spam' }).success).toBe(false);
    expect(list.safeParse({ limit: 0 }).success).toBe(false);
    const confirm = validatorOf(confirmReview);
    const occurredAt = new Date('2026-10-18T05:00:00Z');
    expect(
      confirm.safeParse({ itemId: ID, edits: { amountMinor: 1n, occurredAt, tags: ['langganan'], goalId: null } })
        .success,
    ).toBe(true);
    expect(confirm.safeParse({ itemId: ID, edits: { amountMinor: 0n } }).success).toBe(false);
    expect(confirm.safeParse({ itemId: ID, edits: { amountMinor: 186000 } }).success).toBe(false);
    expect(confirm.safeParse({ itemId: 'nope' }).success).toBe(false);
    const bulk = validatorOf(confirmReviewBulk);
    expect(bulk.safeParse({ itemIds: [] }).success).toBe(false);
    expect(bulk.safeParse({ itemIds: [ID], edits: { categoryId: null } }).success).toBe(true);
    expect(validatorOf(ignoreReview).safeParse({ itemIds: ['nope'] }).success).toBe(false);
    expect(validatorOf(markReviewUnpaid).safeParse({ itemId: ID }).success).toBe(true);
    expect(validatorOf(confirmOccurrence).safeParse({ occurrenceId: ID, edits: {} }).success).toBe(true);
  });
});
