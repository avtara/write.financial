// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Settings › Aturan otomatis (FR-AI1): ordered user-owned rules, their correction-based suggestions, the editor's
 * trial and current-period preview, and the "Terapkan ke transaksi lama" backfill. Rules never write a transaction
 * by themselves: the backfill preview only builds proposals, and applying them needs an explicit confirmation with
 * the row version the user saw. The user always comes from the session.
 */
import { createServerFn } from '@tanstack/react-start';
import type { AutoRulePreview, RuleSuggestion, RuleTrial } from '@wf/db/auto-rules';
import type { AutoRuleView } from '@wf/domain/rules';
import type { RuleBackfillResult } from '@wf/db/rule-backfill';
import type { RuleBackfillJobStatus } from '../rules-backfill-queue.ts';
import { RULE_ACTIONS_MAX, RULE_CONDITIONS_MAX, RULE_DIRECTIONS, RULE_NAME_MAX, WEEKDAYS } from '@wf/domain/rules';
import * as z from 'zod';
import { attempt, requireSession, type Result } from '../access.ts';
import { services } from '../runtime.ts';

const id = z.uuid();
const localDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .transform((value) => value as RuleTrial['date']);
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const text = (max: number) => z.string().trim().min(1).max(max);

const CONDITION = z.discriminatedUnion('field', [
  z.object({
    field: z.literal('description'),
    op: z.literal('containsAny'),
    values: z.array(text(40)).min(1).max(10).readonly(),
  }),
  z.object({
    field: z.literal('weekday'),
    op: z.literal('oneOf'),
    values: z
      .array(
        z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(6), z.literal(7)]),
      )
      .min(1)
      .max(WEEKDAYS.length)
      .readonly(),
  }),
  z.object({
    field: z.literal('time'),
    op: z.literal('before'),
    minute: z.number().int().min(0).max(1439),
  }),
  z.object({
    field: z.literal('account'),
    op: z.literal('oneOf'),
    values: z.array(id).min(1).max(10).readonly(),
  }),
  z.object({
    field: z.literal('direction'),
    op: z.literal('oneOf'),
    values: z.array(z.enum(RULE_DIRECTIONS)).min(1).max(2).readonly(),
  }),
  z.object({ field: z.literal('subscription'), op: z.literal('isRegistered') }),
]);

const ACTION = z.discriminatedUnion('type', [
  z.object({ type: z.literal('setCategory'), categoryId: id }),
  z.object({ type: z.literal('addTag'), tag: text(64) }),
]);

const DEFINITION = z.object({
  name: text(RULE_NAME_MAX),
  enabled: z.boolean(),
  conditions: z.array(CONDITION).min(1).max(RULE_CONDITIONS_MAX).readonly(),
  actions: z.array(ACTION).min(1).max(RULE_ACTIONS_MAX).readonly(),
});

const TRIAL = z.object({
  description: z.string().max(500).nullable(),
  date: localDate,
  time: time.nullable(),
  accountId: id.nullable(),
  direction: z.enum(RULE_DIRECTIONS),
  subscription: z.boolean(),
});

/** The rules the signed-in user owns, in their persisted order; `enabledOnly` for the record forms. */
export const listAutoRules = createServerFn({ method: 'GET' })
  .validator(z.object({ enabledOnly: z.boolean().optional() }))
  .handler(async ({ context, data }): Promise<Result<AutoRuleView[]>> => {
    const { autoRules, now } = await services();
    return attempt(async () => {
      const { user } = await requireSession(context.session, {}, now());
      return autoRules.list(user.id, data.enabledOnly === true ? { enabledOnly: true } : {});
    });
  });

/** "Aturan baru" / "Simpan": creating from a suggestion dismisses it in the same transaction. */
export const createAutoRule = createServerFn({ method: 'POST' })
  .validator(z.object({ input: DEFINITION, suggestionKey: z.string().max(200).optional() }))
  .handler(async ({ context, data }): Promise<Result<AutoRuleView>> => {
    const { autoRules, now } = await services();
    return attempt(async () => {
      const { user } = await requireSession(context.session, {}, now());
      return autoRules.create(user.id, {
        input: data.input,
        ...(data.suggestionKey === undefined ? {} : { suggestionKey: data.suggestionKey }),
      });
    });
  });

export const updateAutoRule = createServerFn({ method: 'POST' })
  .validator(z.object({ id, input: DEFINITION }))
  .handler(async ({ context, data }): Promise<Result<AutoRuleView>> => {
    const { autoRules, now } = await services();
    return attempt(async () => {
      const { user } = await requireSession(context.session, {}, now());
      return autoRules.update(user.id, data.id, data.input);
    });
  });

export const deleteAutoRule = createServerFn({ method: 'POST' })
  .validator(z.object({ id }))
  .handler(async ({ context, data }): Promise<Result<null>> => {
    const { autoRules, now } = await services();
    return attempt(async () => {
      const { user } = await requireSession(context.session, {}, now());
      await autoRules.remove(user.id, data.id);
      return null;
    });
  });

export const setAutoRuleEnabled = createServerFn({ method: 'POST' })
  .validator(z.object({ id, enabled: z.boolean() }))
  .handler(async ({ context, data }): Promise<Result<AutoRuleView>> => {
    const { autoRules, now } = await services();
    return attempt(async () => {
      const { user } = await requireSession(context.session, {}, now());
      return autoRules.setEnabled(user.id, data.id, data.enabled);
    });
  });

/** The complete new order ("naik" / "turun" controls). */
export const reorderAutoRules = createServerFn({ method: 'POST' })
  .validator(z.object({ ids: z.array(id).min(1).max(100) }))
  .handler(async ({ context, data }): Promise<Result<null>> => {
    const { autoRules, now } = await services();
    return attempt(async () => {
      const { user } = await requireSession(context.session, {}, now());
      await autoRules.reorder(user.id, data.ids);
      return null;
    });
  });

/** "Saran dari pola koreksimu": correction patterns at four distinct transactions, minus dismissals. */
export const listRuleSuggestions = createServerFn({ method: 'GET' }).handler(
  async ({ context }): Promise<Result<RuleSuggestion[]>> => {
    const { autoRules, now } = await services();
    return attempt(async () => {
      const { user } = await requireSession(context.session, {}, now());
      return autoRules.suggestions(user.id);
    });
  },
);

/** "Abaikan": durable per user, so the pattern is not offered again. */
export const dismissRuleSuggestion = createServerFn({ method: 'POST' })
  .validator(z.object({ key: z.string().min(1).max(200) }))
  .handler(async ({ context, data }): Promise<Result<null>> => {
    const { autoRules, now } = await services();
    return attempt(async () => {
      const { user } = await requireSession(context.session, {}, now());
      await autoRules.dismissSuggestion(user.id, data.key);
      return null;
    });
  });

/** "Uji dengan transaksi" and the current period's matches, with per-condition reasons. */
export const previewAutoRule = createServerFn({ method: 'POST' })
  .validator(z.object({ input: DEFINITION, trial: TRIAL }))
  .handler(async ({ context, data }): Promise<Result<AutoRulePreview>> => {
    const { autoRules, now } = await services();
    return attempt(async () => {
      const { user } = await requireSession(context.session, {}, now());
      return autoRules.preview(user.id, data.input, data.trial);
    });
  });

/** "Terapkan ke transaksi lama": asks the worker for proposals only (plan §6 `rules-backfill`). */
export const requestRuleBackfill = createServerFn({ method: 'POST' })
  .validator(z.object({ ruleIds: z.array(id).min(1).max(100).optional() }))
  .handler(async ({ context, data }): Promise<Result<{ jobId: string }>> => {
    const { rulesBackfillQueue, now } = await services();
    return attempt(async () => {
      const { user } = await requireSession(context.session, {}, now());
      const jobId = await rulesBackfillQueue.enqueue(
        {
          userId: user.id,
          requestId: crypto.randomUUID(),
          ...(data.ruleIds === undefined ? {} : { ruleIds: [...data.ruleIds] }),
        },
        crypto.randomUUID(),
      );
      return { jobId };
    });
  });

/** The queued proposal list, owned by the signed-in user; another user's job is `failed`, never read. */
export const getRuleBackfillResult = createServerFn({ method: 'GET' })
  .validator(z.object({ jobId: z.string().min(1).max(200) }))
  .handler(async ({ context, data }): Promise<Result<RuleBackfillJobStatus>> => {
    const { rulesBackfillQueue, now } = await services();
    return attempt(async () => {
      const { user } = await requireSession(context.session, {}, now());
      return rulesBackfillQueue.status(data.jobId, user.id);
    });
  });

/** The explicit confirmation: only selected rows, pinned to the previewed rules and row versions. */
export const applyRuleBackfill = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      ruleIds: z.array(id).min(1).max(100),
      version: z.string().min(1).max(128),
      items: z
        .array(z.object({ transactionId: id, version: z.string().min(1).max(128) }))
        .min(1)
        .max(500),
    }),
  )
  .handler(async ({ context, data }): Promise<Result<RuleBackfillResult>> => {
    const { autoRules, now } = await services();
    return attempt(async () => {
      const { user } = await requireSession(context.session, {}, now());
      return autoRules.applyBackfill(user.id, data);
    });
  });
