// SPDX-License-Identifier: AGPL-3.0-only
/** RPC lifecycle coverage uses real tenant-scoped rules; only the asynchronous queue transport is substituted. */
import { randomUUID } from 'node:crypto';
import { generateDek } from '@wf/crypto/envelope';
import { createTransactions } from '@wf/db/transactions';
import type { AutoRuleDefinition } from '@wf/domain/rules';
import { createAutoRules, type AutoRulesRepository } from '@wf/db/auto-rules';
import { PGLITE_HOOK_TIMEOUT, startMigrated, type TestDatabase } from '@wf/db/testing';
import { fakeSession, NOW } from '../../../test/fixtures.ts';
import { ruleBackfillJobStatus } from '../rules-backfill-queue.ts';
import type { Result } from '../access.ts';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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
const runtime = vi.hoisted(() => ({ rules: null as AutoRulesRepository | null, enqueue: vi.fn() }));
vi.mock('../runtime.ts', () => ({
  services: () =>
    Promise.resolve({
      autoRules: runtime.rules,
      rulesBackfillQueue: {
        enqueue: runtime.enqueue,
        status: (_jobId: string, userId: string) =>
          ruleBackfillJobStatus(
            {
              data: { userId: '00000000-0000-4000-8000-000000000002', requestId: ID },
              returnvalue: { private: 'other tenant proposals' },
              state: () => Promise.resolve('completed'),
            },
            userId,
          ),
      },
      now: () => NOW,
    }),
}));
let test: TestDatabase;
const owner = fakeSession().user.id;
const invoke = <T>(fn: unknown, data: unknown = {}) =>
  test.as('wf_app', () => call<Result<T>>(fn, { context: requestContext(fakeSession()), data }));
beforeAll(async () => {
  test = await startMigrated();
}, PGLITE_HOOK_TIMEOUT);
afterAll(async () => {
  await test.close();
});
beforeEach(async () => {
  vi.resetAllMocks();
  await test.query('DELETE FROM users');
  await test.query("INSERT INTO users(id,name,email) VALUES ($1,'Rules','rules-rpc@example.test')", [owner]);
  await test.query(
    `INSERT INTO categories(id,user_id,name,kind,"group",icon,color)
    VALUES ($1,$2,'Coffee','expense','wants','coffee','blue')`,
    [CATEGORY, owner],
  );
  runtime.rules = createAutoRules(test.db, { now: () => NOW });
  runtime.enqueue.mockResolvedValue('queued-proposals');
});

describe('rules server functions', () => {
  it('refuses every signed-out request before touching a repository', async () => {
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

  it('persists rule creation, ordering, enabled filtering, edits and deletion as one tenant lifecycle', async () => {
    const first = await invoke<{ id: string }>(createAutoRule, { input: definition });
    const second = await invoke<{ id: string }>(createAutoRule, {
      input: { ...definition, name: 'Second' },
      suggestionKey: 'coffee-pattern',
    });
    if (!first.ok || !second.ok) throw new Error('Rule creation failed');
    await invoke(reorderAutoRules, { ids: [second.value.id, first.value.id] });
    expect(await invoke(listAutoRules)).toMatchObject({ ok: true, value: [{ name: 'Second' }, { name: 'Kopi' }] });
    await invoke(setAutoRuleEnabled, { id: second.value.id, enabled: false });
    expect(await invoke(listAutoRules, { enabledOnly: true })).toMatchObject({
      ok: true,
      value: [{ id: first.value.id }],
    });
    await invoke(updateAutoRule, { id: first.value.id, input: { ...definition, name: 'Updated' } });
    expect(await invoke(previewAutoRule, { input: definition, trial })).toMatchObject({
      ok: true,
      value: { trial: { categoryId: CATEGORY } },
    });
    await invoke(deleteAutoRule, { id: second.value.id });
    expect(await invoke(listAutoRules)).toMatchObject({ ok: true, value: [{ name: 'Updated' }] });
    expect(await invoke(updateAutoRule, { id: second.value.id, input: definition })).toMatchObject({
      ok: false,
      code: 'NOT_FOUND',
    });
    expect(await invoke(dismissRuleSuggestion, { key: 'missing-pattern' })).toEqual({ ok: false, code: 'NOT_FOUND' });
    expect(await invoke(listRuleSuggestions)).toEqual({ ok: true, value: [] });
  });

  it('never exposes a foreign backfill result or applies an unowned/stale proposal and propagates queue outages', async () => {
    expect(await invoke(getRuleBackfillResult, { jobId: 'foreign-job' })).toEqual({
      ok: true,
      value: { status: 'failed' },
    });
    expect(
      await invoke(applyRuleBackfill, {
        ruleIds: [ID],
        version: 'stale',
        items: [{ transactionId: ID, version: 'stale' }],
      }),
    ).toMatchObject({
      ok: true,
      value: { applied: [], skipped: [{ transactionId: ID, reason: 'stale' }], rulesChanged: true },
    });
    expect(await invoke(requestRuleBackfill)).toEqual({ ok: true, value: { jobId: 'queued-proposals' } });
    runtime.enqueue.mockRejectedValueOnce(new Error('Valkey unavailable'));
    await expect(invoke(requestRuleBackfill, { ruleIds: [ID] })).rejects.toThrow('Valkey unavailable');
    expect(await test.query('SELECT id FROM transactions WHERE user_id=$1', [owner])).toEqual([]);
  });

  it('durably dismisses a real four-transaction correction pattern without changing the ledger', async () => {
    await test.query(
      `INSERT INTO categories(id,user_id,name,kind,"group",icon,color)
      VALUES ($1,$2,'Original','expense','needs','coffee','blue')`,
      [ID, owner],
    );
    const [account] = await test.query<{ id: string }>(
      `INSERT INTO accounts
      (user_id,type,provider_name,display_name,currency,opening_date,color)
      VALUES ($1,'bank','Bank','Bank','IDR','2026-10-01','blue') RETURNING id`,
      [owner],
    );
    if (account === undefined) throw new Error('Missing account');
    const dek = generateDek();
    const transactions = createTransactions(test.db, { getDek: () => Promise.resolve(dek), now: () => NOW });
    for (let index = 0; index < 4; index++) {
      const draft = {
        clientId: randomUUID(),
        type: 'expense' as const,
        accountId: account.id,
        categoryId: ID,
        amountMinor: 1000n,
        occurredAt: NOW,
        description: `Recurring coffee ${index}`,
      };
      await test.as('wf_app', async () => {
        const saved = await transactions.create(owner, draft);
        await transactions.update(owner, saved.id, { ...draft, categoryId: CATEGORY });
      });
    }
    const suggestions = await invoke<{ key: string }[]>(listRuleSuggestions);
    if (!suggestions.ok || suggestions.value[0] === undefined) throw new Error('Missing correction suggestion');
    expect(await invoke(dismissRuleSuggestion, { key: suggestions.value[0].key })).toEqual({ ok: true, value: null });
    expect(await invoke(listRuleSuggestions)).toEqual({ ok: true, value: [] });
    expect(await test.query('SELECT count(*)::int AS n FROM transactions WHERE user_id=$1', [owner])).toEqual([
      { n: 4 },
    ]);
  });
});
