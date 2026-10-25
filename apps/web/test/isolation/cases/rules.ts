// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Isolation cases for the server functions in `src/server/fn/rules.ts`, run by
 * `src/server/fn/isolation.integration.test.ts`: B sees and changes only B's rules, suggestions, preview, and
 * backfill, and never A's transactions.
 */
import type { AutoRuleDefinition, AutoRuleView } from '@wf/domain/rules';
import { expect } from 'vitest';
import type { Result } from '../../../src/server/access.ts';
import {
  aId,
  aTransactionId,
  as,
  bId,
  budgetedId,
  type Case,
  categoryId,
  type Name,
  NOT_FOUND,
  ok,
  services,
  SOME_ID,
  UNAUTHENTICATED,
} from '../harness.ts';

const definition = (categoryIdValue: string, name: string): AutoRuleDefinition => ({
  name,
  enabled: true,
  conditions: [{ field: 'description', op: 'containsAny', values: ['kopi'] }],
  actions: [{ type: 'setCategory', categoryId: categoryIdValue }],
});

const categoryOfB = () => categoryId(bId, 'Anggaran tag-b');
const categoryOfA = () => Promise.resolve(budgetedId(aId));

async function ownRule(name: string): Promise<AutoRuleView> {
  return services.autoRules.create(bId, { input: definition(await categoryOfB(), name) });
}

export const cases = {
  listAutoRules: {
    input: () => ({}),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      const created = await ownRule('B list');
      await services.autoRules.create(aId, { input: definition(await categoryOfA(), 'A list') });
      const result = await as<Result<AutoRuleView[]>>('B', 'listAutoRules', input);
      expect(result.ok).toBe(true);
      expect(result.ok && result.value.map((rule) => rule.id)).toContain(created.id);
      expect(result.ok && result.value.some((rule) => rule.name === 'A list')).toBe(false);
      const enabled = await as<Result<AutoRuleView[]>>('B', 'listAutoRules', { enabledOnly: true });
      expect(enabled.ok && enabled.value.every((rule) => rule.enabled)).toBe(true);
    },
  },
  createAutoRule: {
    input: () => ({ input: definition(SOME_ID, 'B create') }),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const category = await categoryOfB();
      const created = await as<Result<AutoRuleView>>('B', 'createAutoRule', {
        input: definition(category, 'B created'),
      });
      expect(created).toEqual(ok(expect.objectContaining({ name: 'B created', enabled: true })));
      expect(created.ok && created.value.id).not.toBe('');
      expect(await as('B', 'createAutoRule', { input: definition(await categoryOfA(), 'B cannot use A') })).toEqual({
        ok: false,
        code: 'INVALID_RULE',
      });
    },
  },
  updateAutoRule: {
    input: () => ({ id: SOME_ID, input: definition(SOME_ID, 'x') }),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const category = await categoryOfB();
      const own = await ownRule('B update');
      const ofA = await services.autoRules.create(aId, { input: definition(await categoryOfA(), 'A update') });
      expect(await as('B', 'updateAutoRule', { id: ofA.id, input: definition(category, 'stolen') })).toEqual(NOT_FOUND);
      expect(await as('B', 'updateAutoRule', { id: own.id, input: definition(category, 'B updated') })).toEqual(
        ok(expect.objectContaining({ id: own.id, name: 'B updated' })),
      );
      const stillA = await services.autoRules.list(aId);
      expect(stillA.find((rule) => rule.id === ofA.id)?.name).toBe('A update');
    },
  },
  deleteAutoRule: {
    input: () => ({ id: SOME_ID }),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const category = await categoryOfB();
      const own = await services.autoRules.create(bId, { input: definition(category, 'B delete') });
      const ofA = await services.autoRules.create(aId, { input: definition(await categoryOfA(), 'A delete') });
      expect(await as('B', 'deleteAutoRule', { id: ofA.id })).toEqual(NOT_FOUND);
      expect((await services.autoRules.list(aId)).some((rule) => rule.id === ofA.id)).toBe(true);
      expect(await as('B', 'deleteAutoRule', { id: own.id })).toEqual(ok(null));
    },
  },
  setAutoRuleEnabled: {
    input: () => ({ id: SOME_ID, enabled: false }),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const own = await ownRule('B toggle');
      const ofA = await services.autoRules.create(aId, {
        input: definition(await categoryOfA(), 'A toggle'),
      });
      expect(await as('B', 'setAutoRuleEnabled', { id: ofA.id, enabled: false })).toEqual(NOT_FOUND);
      expect(await as('B', 'setAutoRuleEnabled', { id: own.id, enabled: false })).toEqual(
        ok(expect.objectContaining({ id: own.id, enabled: false })),
      );
      expect((await services.autoRules.list(aId)).find((rule) => rule.id === ofA.id)?.enabled).toBe(true);
    },
  },
  reorderAutoRules: {
    input: () => ({ ids: [SOME_ID] }),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      await ownRule('B order 1');
      await ownRule('B order 2');
      const own = await services.autoRules.list(bId);
      const reversed = [...own].reverse().map((rule) => rule.id);
      expect(await as('B', 'reorderAutoRules', { ids: reversed })).toEqual(ok(null));
      expect((await services.autoRules.list(bId)).map((rule) => rule.id)).toEqual(reversed);
      const ofA = await services.autoRules.create(aId, { input: definition(await categoryOfA(), 'A order') });
      expect(await as('B', 'reorderAutoRules', { ids: [...reversed, ofA.id] })).toEqual({
        ok: false,
        code: 'INVALID_RULE',
      });
    },
  },
  listRuleSuggestions: {
    input: () => ({}),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      const result = await as<Result<unknown[]>>('B', 'listRuleSuggestions', input);
      expect(result.ok).toBe(true);
    },
  },
  dismissRuleSuggestion: {
    input: () => ({ key: 'unknown-key' }),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      expect(await as('B', 'dismissRuleSuggestion', { key: 'unknown-key' })).toEqual(NOT_FOUND);
    },
  },
  previewAutoRule: {
    input: () => ({
      input: definition(SOME_ID, 'B preview'),
      trial: {
        description: 'Kopi pagi',
        date: '2026-10-15',
        time: '09:00',
        accountId: SOME_ID,
        direction: 'expense',
        subscription: false,
      },
    }),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const category = await categoryOfB();
      const result = await as<Result<{ trial: { categoryId: string } }>>('B', 'previewAutoRule', {
        input: definition(category, 'B preview'),
        trial: {
          description: 'Kopi pagi',
          date: '2026-10-15',
          time: '09:00',
          accountId: null,
          direction: 'expense',
          subscription: false,
        },
      });
      expect(result.ok ? result.value.trial.categoryId : null).toBe(category);
    },
  },
  requestRuleBackfill: {
    input: () => ({ ruleIds: [SOME_ID] }),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      const requested = await as<Result<{ jobId: string }>>('B', 'requestRuleBackfill', input);
      expect(requested.ok).toBe(true);
      if (!requested.ok) throw new Error('the worker job was not queued');
      // B owns the job; A reading the same id gets a generic failure, never B's proposal data.
      expect(await as('A', 'getRuleBackfillResult', { jobId: requested.value.jobId })).toEqual(ok({ status: 'failed' }));
      expect(await as('B', 'getRuleBackfillResult', { jobId: requested.value.jobId })).toEqual(
        ok({ status: 'pending' }),
      );
    },
  },
  getRuleBackfillResult: {
    input: () => ({ jobId: 'unknown-job' }),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      expect(await as('B', 'getRuleBackfillResult', input)).toEqual(ok({ status: 'failed' }));
    },
  },
  applyRuleBackfill: {
    input: () => ({
      ruleIds: [SOME_ID],
      version: 'version',
      items: [{ transactionId: SOME_ID, version: 'version' }],
    }),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      const before = await services.transactions.get(aId, aTransactionId);
      expect(await as('B', 'applyRuleBackfill', input)).toEqual(
        ok({ applied: [], skipped: [{ transactionId: SOME_ID, reason: 'stale' }], rulesChanged: true }),
      );
      const after = await services.transactions.get(aId, aTransactionId);
      expect(after.categoryId).toBe(before.categoryId);
      expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
    },
  },
} satisfies Partial<Record<Name, Case>>;
