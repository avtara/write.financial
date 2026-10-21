// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Schedules: recurring transactions (FR-T6, FR-L8), subscriptions and their actions (FR-SUB1–SUB6), detected
 * subscription candidates (FR-SUB4), and the calendar's scheduled events (FR-C2). Nothing here records a transaction:
 * bills reach the ledger only through the Review queue. The user always comes from the session.
 */
import { createServerFn } from '@tanstack/react-start';
import type {
  BillingHistory,
  ChangeAccountResult,
  DetectedOverview,
  RecurrenceView,
  ScheduledItem,
  SubscriptionsOverview,
  SubscriptionView,
} from '@wf/db/schedules';
import { RECURRENCE_FREQS } from '@wf/domain/recurrence';
import { CANCEL_MODES, SUBSCRIPTION_CYCLES, SUBSCRIPTION_STATUSES, USAGE_RATINGS } from '@wf/domain/subscriptions';
import { ImageRejectedError, prepareImageUpload } from '@wf/integrations/image';
import * as z from 'zod';
import { attempt, requireSession, UploadRejectedError, type Result } from '../access.ts';
import { defined, localDate } from '../inputs.ts';
import { services } from '../runtime.ts';

const id = z.uuid();
const ids = z.object({ ids: z.array(id).min(1).max(50) });
const byId = z.object({ id });
const positiveMinor = z.bigint().positive();
const text = z.string().trim().max(200).nullable().optional();
const tags = z.array(z.string().min(1).max(64)).max(5).optional();
const remindDays = z.number().int().min(0).max(30).nullable();

/** The transaction every occurrence proposes (amounts in the account currencies; never a note). */
const template = z.discriminatedUnion('type', [
  z.object({
    type: z.enum(['expense', 'income']),
    accountId: id,
    amountMinor: positiveMinor,
    categoryId: id.nullable(),
    description: text,
    merchant: text,
    tags,
  }),
  z.object({
    type: z.literal('transfer'),
    fromAccountId: id,
    toAccountId: id,
    sentMinor: positiveMinor,
    receivedMinor: positiveMinor,
    fee: z.object({ minor: positiveMinor, categoryId: id }).nullable().optional(),
    description: text,
    tags,
    allocations: z
      .array(z.object({ goalId: id, amountMinor: positiveMinor }))
      .max(20)
      .optional(),
  }),
]);

const recurrence = z.object({
  template,
  freq: z.enum(RECURRENCE_FREQS),
  interval: z.number().int().min(1).max(99).optional(),
  startOn: localDate,
  weekday: z.literal([1, 2, 3, 4, 5, 6, 7]).nullable().optional(),
  monthDay: z.number().int().min(1).max(31).nullable().optional(),
  end: z.discriminatedUnion('type', [
    z.object({ type: z.literal('never') }),
    z.object({ type: z.literal('after'), count: z.number().int().min(1).max(1000) }),
  ]),
  remindOffsetDays: remindDays,
});

/** `RecurrenceInput` as the repository takes it: no `undefined` properties, also inside the template. */
function recurrenceInput({ template: proposal, ...rule }: z.output<typeof recurrence>) {
  return { ...defined(rule), template: defined(proposal) };
}

const subscription = z.object({
  name: z.string().trim().min(1).max(40),
  plan: z.string().trim().max(40).nullable().optional(),
  icon: z.string().max(40).nullable().optional(),
  description: z.string().trim().max(200).nullable().optional(),
  priceMinor: positiveMinor,
  currency: z.string().regex(/^[A-Z]{3}$/),
  cycle: z.enum(SUBSCRIPTION_CYCLES),
  nextBillingDate: localDate,
  payFromAccountId: id,
  categoryId: id.nullable(),
  remindDaysBefore: remindDays.optional(),
  startedOn: localDate,
  trial: z
    .union([
      z.object({ days: z.number().int().min(1).max(366) }),
      z.object({ months: z.number().int().min(1).max(12) }),
      z.object({ until: localDate }),
    ])
    .nullable()
    .optional(),
});

/** FR-T6: the user's recurring transactions (active and stopped unless `status` narrows them). */
export const listRecurrences = createServerFn({ method: 'GET' })
  .validator(z.object({ status: z.enum(['active', 'stopped']).optional() }))
  .handler(async ({ context, data }): Promise<Result<RecurrenceView[]>> => {
    const { schedules, now } = await services();
    return attempt(async () => {
      const { user } = await requireSession(context.session, {}, now());
      return schedules.listRecurrences(user.id, defined(data));
    });
  });

/** FR-T6 "Ulangi": a new recurring transaction with its rule and reminder. */
export const createRecurrence = createServerFn({ method: 'POST' })
  .validator(recurrence)
  .handler(async ({ context, data }): Promise<Result<RecurrenceView>> => {
    const { schedules, now } = await services();
    return attempt(async () => {
      const { user } = await requireSession(context.session, {}, now());
      return schedules.createRecurrence(user.id, recurrenceInput(data));
    });
  });

/** Replaces a recurrence's rule and template; its future scheduled occurrences are rebuilt. */
export const updateRecurrence = createServerFn({ method: 'POST' })
  .validator(recurrence.extend({ id }))
  .handler(async ({ context, data }): Promise<Result<RecurrenceView>> => {
    const { schedules, now } = await services();
    return attempt(async () => {
      const { user } = await requireSession(context.session, {}, now());
      const { id: recurrenceId, ...input } = data;
      return schedules.updateRecurrence(user.id, recurrenceId, recurrenceInput(input));
    });
  });

/** FR-L8 "Hentikan pengulangan": future scheduled occurrences go; past transactions stay. */
export const stopRecurrence = createServerFn({ method: 'POST' })
  .validator(byId)
  .handler(async ({ context, data }): Promise<Result<{ deletedOccurrences: number }>> => {
    const { schedules, now } = await services();
    return attempt(async () => {
      const { user } = await requireSession(context.session, {}, now());
      return schedules.stopRecurrence(user.id, data.id);
    });
  });

/** "Urungkan" of {@link stopRecurrence}. */
export const undoStopRecurrence = createServerFn({ method: 'POST' })
  .validator(byId)
  .handler(async ({ context, data }): Promise<Result<RecurrenceView>> => {
    const { schedules, now } = await services();
    return attempt(async () => {
      const { user } = await requireSession(context.session, {}, now());
      return schedules.undoStopRecurrence(user.id, data.id);
    });
  });

/** FR-SUB2: the subscriptions page (list, totals, this month's schedule, savings, by category). */
export const listSubscriptions = createServerFn({ method: 'GET' })
  .validator(z.object({ status: z.enum(SUBSCRIPTION_STATUSES).optional() }))
  .handler(async ({ context, data }): Promise<Result<SubscriptionsOverview>> => {
    const { schedules, now } = await services();
    return attempt(async () => {
      const { user } = await requireSession(context.session, {}, now());
      return schedules.listSubscriptions(user.id, defined(data));
    });
  });

/** The sidebar badge "Langganan 7": the effectively active subscriptions. */
export const countActiveSubscriptions = createServerFn({ method: 'GET' }).handler(
  async ({ context }): Promise<Result<number>> => {
    const { schedules, now } = await services();
    return attempt(async () => {
      const { user } = await requireSession(context.session, {}, now());
      return schedules.countActive(user.id);
    });
  },
);

/** FR-SUB3: one subscription's detail. */
export const getSubscription = createServerFn({ method: 'GET' })
  .validator(byId)
  .handler(async ({ context, data }): Promise<Result<SubscriptionView>> => {
    const { schedules, now } = await services();
    return attempt(async () => {
      const { user } = await requireSession(context.session, {}, now());
      return schedules.getSubscription(user.id, data.id);
    });
  });

/** FR-SUB1 "Tambah langganan" (with an optional free trial). */
export const createSubscription = createServerFn({ method: 'POST' })
  .validator(subscription)
  .handler(async ({ context, data }): Promise<Result<SubscriptionView>> => {
    const { schedules, now } = await services();
    return attempt(async () => {
      const { user } = await requireSession(context.session, {}, now());
      return schedules.createSubscription(user.id, defined(data));
    });
  });

/** FR-SUB3 "Edit": the changed fields only. */
export const updateSubscription = createServerFn({ method: 'POST' })
  .validator(z.object({ id, patch: subscription.partial() }))
  .handler(async ({ context, data }): Promise<Result<SubscriptionView>> => {
    const { schedules, now } = await services();
    return attempt(async () => {
      const { user } = await requireSession(context.session, {}, now());
      return schedules.updateSubscription(user.id, data.id, defined(data.patch));
    });
  });

/** "Hapus langganan": the subscription, its open bills, and its uploaded logo; confirmed history stays. */
export const deleteSubscription = createServerFn({ method: 'POST' })
  .validator(byId)
  .handler(async ({ context, data }): Promise<Result<{ deletedOccurrences: number }>> => {
    const { schedules, logoStore, now } = await services();
    return attempt(async () => {
      const { user } = await requireSession(context.session, {}, now());
      const { logoKey } = await schedules.getSubscription(user.id, data.id);
      const deleted = await schedules.deleteSubscription(user.id, data.id);
      if (logoKey !== null) await logoStore.delete(user.id, logoKey);
      return deleted;
    });
  });

/**
 * FR-SUB1 "Unggah PNG": replaces the subscription's logo with the uploaded image (`file` in the form data, re-encoded
 * and stripped by the image pipeline) stored encrypted in the avatars bucket, like account logos.
 */
export const setSubscriptionLogo = createServerFn({ method: 'POST' })
  .validator(z.instanceof(FormData))
  .handler(async ({ context, data }): Promise<Result<SubscriptionView>> => {
    const { schedules, logoStore, now } = await services();
    return attempt(async () => {
      const { user } = await requireSession(context.session, {}, now());
      const subscriptionId = id.parse(data.get('id'));
      const file = z.instanceof(File).parse(data.get('file'));
      const before = await schedules.getSubscription(user.id, subscriptionId);
      let thumbnail;
      try {
        ({ thumbnail } = await prepareImageUpload(new Uint8Array(await file.arrayBuffer())));
      } catch (error) {
        if (error instanceof ImageRejectedError) throw new UploadRejectedError(error.reason);
        throw error;
      }
      const { key } = await logoStore.put(user.id, thumbnail.bytes, thumbnail.mime);
      const after = await schedules.updateSubscription(user.id, subscriptionId, { logoKey: key });
      if (before.logoKey !== null) await logoStore.delete(user.id, before.logoKey);
      return after;
    });
  });

/** FR-SUB1 "Pakai ikon": drops the uploaded logo. */
export const removeSubscriptionLogo = createServerFn({ method: 'POST' })
  .validator(byId)
  .handler(async ({ context, data }): Promise<Result<SubscriptionView>> => {
    const { schedules, logoStore, now } = await services();
    return attempt(async () => {
      const { user } = await requireSession(context.session, {}, now());
      const { logoKey } = await schedules.getSubscription(user.id, data.id);
      const after = await schedules.updateSubscription(user.id, data.id, { logoKey: null });
      if (logoKey !== null) await logoStore.delete(user.id, logoKey);
      return after;
    });
  });

/** FR-SUB3 "Ganti rekening": effective from the next bill not yet in review, with a balance warning. */
export const changeSubscriptionAccount = createServerFn({ method: 'POST' })
  .validator(z.object({ id, accountId: id }))
  .handler(async ({ context, data }): Promise<Result<ChangeAccountResult>> => {
    const { schedules, now } = await services();
    return attempt(async () => {
      const { user } = await requireSession(context.session, {}, now());
      return schedules.changeAccount(user.id, data.id, data.accountId);
    });
  });

/** FR-SUB3 "Jeda langganan" from the next bill, for 1–2 months or until a date. */
export const pauseSubscription = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      id,
      length: z.union([z.object({ months: z.literal([1, 2]) }), z.object({ until: localDate })]),
      remindDaysBefore: remindDays,
    }),
  )
  .handler(async ({ context, data }): Promise<Result<SubscriptionView>> => {
    const { schedules, now } = await services();
    return attempt(async () => {
      const { user } = await requireSession(context.session, {}, now());
      return schedules.pause(user.id, data.id, data.length, { remindDaysBefore: data.remindDaysBefore });
    });
  });

/** FR-SUB3 "Batalkan": after the next bill or now. */
export const cancelSubscription = createServerFn({ method: 'POST' })
  .validator(z.object({ id, mode: z.enum(CANCEL_MODES) }))
  .handler(async ({ context, data }): Promise<Result<SubscriptionView>> => {
    const { schedules, now } = await services();
    return attempt(async () => {
      const { user } = await requireSession(context.session, {}, now());
      return schedules.cancel(user.id, data.id, data.mode);
    });
  });

/** "Aktifkan lagi": clears a pause or cancel. */
export const reactivateSubscription = createServerFn({ method: 'POST' })
  .validator(byId)
  .handler(async ({ context, data }): Promise<Result<SubscriptionView>> => {
    const { schedules, now } = await services();
    return attempt(async () => {
      const { user } = await requireSession(context.session, {}, now());
      return schedules.reactivate(user.id, data.id);
    });
  });

/** FR-SUB5 "Seberapa sering kamu pakai?". */
export const rateSubscriptionUsage = createServerFn({ method: 'POST' })
  .validator(z.object({ id, rating: z.enum(USAGE_RATINGS) }))
  .handler(async ({ context, data }): Promise<Result<SubscriptionView>> => {
    const { schedules, now } = await services();
    return attempt(async () => {
      const { user } = await requireSession(context.session, {}, now());
      return schedules.rateUsage(user.id, data.id, data.rating);
    });
  });

/** FR-SUB3 "Riwayat tagihan": confirmed bills, newest first, and a price increase. */
export const getSubscriptionBilling = createServerFn({ method: 'GET' })
  .validator(byId)
  .handler(async ({ context, data }): Promise<Result<BillingHistory>> => {
    const { schedules, now } = await services();
    return attempt(async () => {
      const { user } = await requireSession(context.session, {}, now());
      return schedules.billingHistory(user.id, data.id);
    });
  });

/** FR-SUB4: detected subscription candidates and what adding them would cost per month. */
export const listDetectedSubscriptions = createServerFn({ method: 'GET' }).handler(
  async ({ context }): Promise<Result<DetectedOverview>> => {
    const { schedules, now } = await services();
    return attempt(async () => {
      const { user } = await requireSession(context.session, {}, now());
      return schedules.listDetected(user.id);
    });
  },
);

/** FR-SUB4 "Tambahkan" / "Tambah semua". */
export const addDetectedSubscriptions = createServerFn({ method: 'POST' })
  .validator(ids)
  .handler(async ({ context, data }): Promise<Result<{ subscriptionIds: string[] }>> => {
    const { schedules, now } = await services();
    return attempt(async () => {
      const { user } = await requireSession(context.session, {}, now());
      return schedules.addDetected(user.id, data.ids);
    });
  });

/** FR-SUB4 "Bukan langganan". */
export const dismissDetectedSubscriptions = createServerFn({ method: 'POST' })
  .validator(ids)
  .handler(async ({ context, data }): Promise<Result<{ dismissed: number }>> => {
    const { schedules, now } = await services();
    return attempt(async () => {
      const { user } = await requireSession(context.session, {}, now());
      return schedules.dismissDetected(user.id, data.ids);
    });
  });

/** FR-C2: the calendar's scheduled events in `from`–`to` (at most 366 days). */
export const listScheduled = createServerFn({ method: 'GET' })
  .validator(z.object({ from: localDate, to: localDate }))
  .handler(async ({ context, data }): Promise<Result<ScheduledItem[]>> => {
    const { schedules, now } = await services();
    return attempt(async () => {
      const { user } = await requireSession(context.session, {}, now());
      return schedules.listScheduled(user.id, data);
    });
  });
