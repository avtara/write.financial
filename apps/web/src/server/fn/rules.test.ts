// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Expected refusals and input boundaries of the rules server functions: signed-out requests never reach the
 * repositories, and the validators refuse malformed rule/backfill input. Repository behavior itself is covered by the
 * DB tests and the real queue/database smoke tests, not by mock-forwarding assertions.
 */
import type { AutoRuleDefinition } from '@wf/domain/rules';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { call, requestContext, validatorOf } from '../../../test/server-fn.ts';
import {
  applyRuleBackfill,
  createAutoRule,
  deleteAutoRule,
  dismissRuleSuggestion,
  getRuleBackfillResult,
  listAutoRules,
  listRuleSuggestions,
  previewAutoRule,
  requestRuleBackfill,
  reorderAutoRules,
  setAutoRuleEnabled,
  updateAutoRule,
} from './rules.ts';

const ID = '0b4f4bd4-5d0e-4b8e-9d55-6b8f0f1a2b3c';
const CATEGORY = '1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d';
const definition: AutoRuleDefinition = {
  name: 'Kopi',
  enabled: true,
  conditions: [{ field: 'description', op: 'containsAny', values: ['kopi'] }],
  actions: [{ type: 'setCategory', categoryId: CATEGORY }],
};
const trial = {
  description: 'Kopi',
  date: '2026-10-18',
  time: '09:00',
  accountId: null,
  direction: 'expense' as const,
  subscription: false,
};

vi.mock('@tanstack/react-start', async () => (await import('../../../test/server-fn.ts')).serverFnModule());
vi.mock('../runtime.ts', () => ({
  services: () => Promise.reject(new Error('the signed-out path must not load services')),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('rules server functions', () => {
  it('refuses every signed-out request before touching services', async () => {
    const anonymous = requestContext(null);
    const calls: [unknown, unknown][] = [
      [listAutoRules, {}],
      [createAutoRule, { input: definition }],
      [updateAutoRule, { id: ID, input: definition }],
      [deleteAutoRule, { id: ID }],
      [setAutoRuleEnabled, { id: ID, enabled: true }],
      [reorderAutoRules, { ids: [ID] }],
      [listRuleSuggestions, {}],
      [dismissRuleSuggestion, { key: 'k' }],
      [previewAutoRule, { input: definition, trial }],
      [requestRuleBackfill, {}],
      [getRuleBackfillResult, { jobId: 'job' }],
      [applyRuleBackfill, { ruleIds: [ID], version: 'v', items: [{ transactionId: ID, version: 'v' }] }],
    ];
    for (const [fn, data] of calls) {
      expect(await call(fn, { context: anonymous, data })).toEqual({ ok: false, code: 'UNAUTHENTICATED' });
    }
  });

  it('validates definitions, ids, trials, and the queued backfill contract', () => {
    const create = validatorOf(createAutoRule);
    expect(create.safeParse({ input: definition }).success).toBe(true);
    expect(create.safeParse({ input: { ...definition, name: ' ' } }).success).toBe(false);
    expect(create.safeParse({ input: { ...definition, conditions: [] } }).success).toBe(false);
    expect(
      create.safeParse({ input: { ...definition, conditions: [{ field: 'time', op: 'before', minute: 1440 }] } })
        .success,
    ).toBe(false);
    expect(
      create.safeParse({ input: { ...definition, conditions: [{ field: 'weekday', op: 'oneOf', values: [8] }] } })
        .success,
    ).toBe(false);
    expect(create.safeParse({ input: definition, suggestionKey: 'x'.repeat(201) }).success).toBe(false);
    expect(validatorOf(updateAutoRule).safeParse({ id: 'nope', input: definition }).success).toBe(false);
    expect(validatorOf(reorderAutoRules).safeParse({ ids: [] }).success).toBe(false);
    const preview = validatorOf(previewAutoRule);
    expect(preview.safeParse({ input: definition, trial }).success).toBe(true);
    expect(preview.safeParse({ input: definition, trial: { ...trial, time: '9:00' } }).success).toBe(false);
    expect(preview.safeParse({ input: definition, trial: { ...trial, direction: 'transfer' } }).success).toBe(false);
    expect(validatorOf(requestRuleBackfill).safeParse({}).success).toBe(true);
    expect(validatorOf(requestRuleBackfill).safeParse({ ruleIds: [] }).success).toBe(false);
    expect(validatorOf(getRuleBackfillResult).safeParse({ jobId: '' }).success).toBe(false);
    const apply = validatorOf(applyRuleBackfill);
    expect(apply.safeParse({ ruleIds: [ID], version: 'v', items: [{ transactionId: ID, version: 'v' }] }).success).toBe(
      true,
    );
    expect(apply.safeParse({ ruleIds: [], version: 'v', items: [] }).success).toBe(false);
    expect(
      apply.safeParse({ ruleIds: [ID], version: 'v', items: [{ transactionId: 'nope', version: 'v' }] }).success,
    ).toBe(false);
    expect(validatorOf(dismissRuleSuggestion).safeParse({ key: '' }).success).toBe(false);
    expect(validatorOf(listAutoRules).safeParse({ enabledOnly: 'yes' }).success).toBe(false);
  });
});
