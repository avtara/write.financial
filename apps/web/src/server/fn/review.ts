// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The Review queue ("Perlu ditinjau", FR-L7): list and badge counts, confirm (one, bulk, with edits), ignore, "Belum
 * dibayar", and "Tandai dibayar" on a scheduled bill before its due date. Only confirming applies a proposal (D14).
 * The user always comes from the session.
 */
import { createServerFn } from '@tanstack/react-start';
import type { ConfirmResult, ReviewCounts, ReviewItemView } from '@wf/db/review';
import { REVIEW_REASONS, REVIEW_SOURCES } from '@wf/db/schema';
import * as z from 'zod';
import { attempt, requireSession, type Result } from '../access.ts';
import { defined } from '../inputs.ts';
import { services } from '../runtime.ts';

const id = z.uuid();
const itemIds = z.array(id).min(1).max(200);
const text = z.string().max(200).nullable().optional();
/** Changes made in the review card; omitted fields keep the proposal. */
const edits = z
  .object({
    amountMinor: z.bigint().positive().optional(),
    receivedMinor: z.bigint().positive().optional(),
    accountId: id.optional(),
    fromAccountId: id.optional(),
    toAccountId: id.optional(),
    categoryId: id.nullable().optional(),
    occurredAt: z.date().optional(),
    description: text,
    merchant: text,
    note: z.string().max(2000).nullable().optional(),
    tags: z.array(z.string().min(1).max(64)).max(5).optional(),
    goalId: id.nullable().optional(),
  })
  .optional();

/** The queue: pending items by default (`resolved` = confirmed or ignored), with decrypted proposals. */
export const listReviewItems = createServerFn({ method: 'GET' })
  .validator(
    z.object({
      status: z.enum(['pending', 'resolved']).optional(),
      reason: z.enum(REVIEW_REASONS).optional(),
      source: z.enum(REVIEW_SOURCES).optional(),
      limit: z.number().int().min(1).max(200).optional(),
      offset: z.number().int().min(0).optional(),
    }),
  )
  .handler(async ({ context, data }): Promise<Result<{ items: ReviewItemView[]; total: number }>> => {
    const { review, now } = await services();
    return attempt(async () => {
      const { user } = await requireSession(context.session, {}, now());
      return review.list(user.id, defined(data));
    });
  });

/** Pending items in total (the sidebar badge) and per reason. */
export const getReviewCounts = createServerFn({ method: 'GET' }).handler(
  async ({ context }): Promise<Result<ReviewCounts>> => {
    const { review, now } = await services();
    return attempt(async () => {
      const { user } = await requireSession(context.session, {}, now());
      return review.counts(user.id);
    });
  },
);

/** "Konfirmasi": applies one item's proposal, with the card's edits. */
export const confirmReview = createServerFn({ method: 'POST' })
  .validator(z.object({ itemId: id, edits }))
  .handler(async ({ context, data }): Promise<Result<ConfirmResult>> => {
    const { review, now } = await services();
    return attempt(async () => {
      const { user } = await requireSession(context.session, {}, now());
      return review.confirm(user.id, data.itemId, data.edits === undefined ? undefined : defined(data.edits));
    });
  });

/** "Tandai semua dibayar" / one category for many: each item on its own; refusals are reported per item. */
export const confirmReviewBulk = createServerFn({ method: 'POST' })
  .validator(z.object({ itemIds, edits: z.object({ categoryId: id.nullable() }).optional() }))
  .handler(
    async ({ context, data }): Promise<Result<{ confirmed: string[]; failed: { id: string; code: string }[] }>> => {
      const { review, now } = await services();
      return attempt(async () => {
        const { user } = await requireSession(context.session, {}, now());
        return review.confirmBulk(user.id, data.itemIds, data.edits);
      });
    },
  );

/** "Abaikan": resolves the items without applying them; their bills are skipped. */
export const ignoreReview = createServerFn({ method: 'POST' })
  .validator(z.object({ itemIds }))
  .handler(async ({ context, data }): Promise<Result<{ ignored: number }>> => {
    const { review, now } = await services();
    return attempt(async () => {
      const { user } = await requireSession(context.session, {}, now());
      return review.ignore(user.id, data.itemIds);
    });
  });

/** "Belum dibayar / Belum ditagih": the item stays pending, its bill becomes unconfirmed. */
export const markReviewUnpaid = createServerFn({ method: 'POST' })
  .validator(z.object({ itemId: id }))
  .handler(async ({ context, data }): Promise<Result<null>> => {
    const { review, now } = await services();
    return attempt(async () => {
      const { user } = await requireSession(context.session, {}, now());
      await review.markUnpaid(user.id, data.itemId);
      return null;
    });
  });

/** "Tandai dibayar" on a scheduled bill (a subscription or recurrence), also before its due date. */
export const confirmOccurrence = createServerFn({ method: 'POST' })
  .validator(z.object({ occurrenceId: id, edits }))
  .handler(async ({ context, data }): Promise<Result<ConfirmResult>> => {
    const { review, now } = await services();
    return attempt(async () => {
      const { user } = await requireSession(context.session, {}, now());
      return review.confirmOccurrence(
        user.id,
        data.occurrenceId,
        data.edits === undefined ? undefined : defined(data.edits),
      );
    });
  });
