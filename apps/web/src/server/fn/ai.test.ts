// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from 'node:crypto';
import { generateDek } from '@wf/crypto/envelope';
import { createAiRepository } from '@wf/db/ai';
import { insertUser, PGLITE_HOOK_TIMEOUT, startMigrated, type TestDatabase } from '@wf/db/testing';
import type { AiSettingsInput, AiSettingsView } from '@wf/domain/ai';
import { createAiClient } from '@wf/integrations/ai';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeSession, NOW } from '../../../test/fixtures.ts';
import { call, requestContext, validatorOf } from '../../../test/server-fn.ts';
import type { Result } from '../access.ts';
import type { Services } from '../runtime.ts';
import {
  exportAiLogs,
  getAiSettings,
  listAiLogs,
  listAiModels,
  removeAiKey,
  saveAiSettings,
  testAiConnection,
} from './ai.ts';

const fake = vi.hoisted(() => ({ current: null as Pick<Services, 'ai' | 'aiClient' | 'now'> | null }));
// The hoisted mock intentionally loads the RPC test boundary inside its factory, before static imports initialize.
vi.mock('@tanstack/react-start', async () => (await import('../../../test/server-fn.ts')).serverFnModule());
vi.mock('../runtime.ts', () => ({
  services: () => {
    if (fake.current === null) return Promise.reject(new Error('AI test services not ready'));
    return Promise.resolve(fake.current);
  },
}));

let test: TestDatabase;
let userId: string;
let mode: 'ok' | 'unauthorized' | 'forbidden' | 'unavailable' | 'missing_cost';
let requests: number;
let duringRequest: (() => Promise<void>) | null;
const dek = generateDek();
const key = `fixture-ai-${randomUUID()}`;
const pricing = { inputUsdPerMillion: '1', outputUsdPerMillion: '2', requestUsd: '0', imageUsd: '0' };
const input = (extra: Partial<AiSettingsInput> = {}): AiSettingsInput => ({
  expectedRevision: null,
  provider: 'openrouter',
  apiKey: key,
  modelId: 'fixture/model',
  allowReadFinancial: false,
  allowCreateDrafts: false,
  requireConfirmation: true,
  monthlyLimitUsd: '1',
  pricing,
  ...extra,
});
function context(twoFactorEnabled = true, ageMinutes = 1) {
  const session = fakeSession({ twoFactorEnabled, ageMinutes });
  return requestContext({ ...session, user: { ...session.user, id: userId }, session: { ...session.session, userId } });
}
const invoke = <T>(fn: unknown, data?: unknown) =>
  test.as('wf_app', () => call<Result<T>>(fn, { context: context(), ...(data === undefined ? {} : { data }) }));
async function save(extra: Partial<AiSettingsInput> = {}): Promise<AiSettingsView> {
  const result = await invoke<AiSettingsView>(saveAiSettings, input(extra));
  if (!result.ok) throw new Error(result.code);
  return result.value;
}

beforeAll(async () => {
  test = await startMigrated();
}, PGLITE_HOOK_TIMEOUT);
afterAll(async () => {
  await test.close();
});
beforeEach(async () => {
  await test.query('DELETE FROM users');
  userId = await insertUser(test, 'ai-rpc@example.test');
  await test.query('UPDATE users SET two_factor_enabled = true');
  mode = 'ok';
  requests = 0;
  duringRequest = null;
  const fetcher = vi.fn<typeof fetch>(async (url) => {
    requests++;
    const address = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
    if (address.endsWith('/models'))
      return Response.json({
        data: [{ id: 'fixture/model', pricing: { prompt: '0.000001', completion: '0.000002' } }],
      });
    if (duringRequest !== null) await duringRequest();
    if (mode === 'unauthorized') return new Response(`Revoked ${key}`, { status: 401 });
    if (mode === 'forbidden') return new Response('private forbidden', { status: 403 });
    if (mode === 'unavailable') return new Response('private provider error', { status: 503 });
    return Response.json({
      choices: [{ message: { content: 'OK' } }],
      usage: { prompt_tokens: 12, completion_tokens: 1, ...(mode === 'missing_cost' ? {} : { cost: '0.0002' }) },
    });
  });
  fake.current = {
    now: () => NOW,
    ai: createAiRepository(test.db, {
      getDek: () => Promise.resolve(dek),
      allowedBaseUrls: ['https://custom.test/v1'],
      now: () => NOW,
    }),
    aiClient: createAiClient({ allowedBaseUrls: ['https://custom.test/v1'], fetch: fetcher }),
  };
});

describe('AI credential action authorization', () => {
  const actions: readonly [unknown, unknown?][] = [
    [getAiSettings],
    [saveAiSettings, input()],
    [removeAiKey, { provider: 'openrouter', expectedRevision: randomUUID() }],
    [listAiModels, { provider: 'openrouter' }],
    [testAiConnection, { provider: 'openrouter', expectedRevision: randomUUID(), requestId: randomUUID() }],
    [listAiLogs, {}],
    [exportAiLogs, {}],
  ];
  it.each(actions)('refuses a signed-out caller before secret use or external requests (%#)', async (fn, data) => {
    expect(await call(fn, { context: requestContext(null), data })).toEqual({ ok: false, code: 'UNAUTHENTICATED' });
    expect(requests).toBe(0);
  });

  it.each([saveAiSettings, removeAiKey, testAiConnection])(
    'requires both 2FA and a fresh session for sensitive actions (%#)',
    async (fn) => {
      const data =
        fn === saveAiSettings
          ? input()
          : { provider: 'openrouter', expectedRevision: randomUUID(), requestId: randomUUID() };
      expect(await call(fn, { context: context(false), data })).toEqual({ ok: false, code: 'TWO_FACTOR_REQUIRED' });
      expect(await call(fn, { context: context(true, 16), data })).toEqual({
        ok: false,
        code: 'REAUTHENTICATION_REQUIRED',
      });
      expect(requests).toBe(0);
    },
  );

  it('rejects disabling confirmation and malformed monetary input at the RPC contract', () => {
    expect(validatorOf(saveAiSettings).safeParse({ ...input(), requireConfirmation: false }).success).toBe(false);
    expect(validatorOf(saveAiSettings).safeParse({ ...input(), monthlyLimitUsd: '-1' }).success).toBe(false);
  });
});

describe('connection tests and activity', () => {
  it('does not treat a public catalog as authentication; a 401 preserves the saved key and records failure metadata', async () => {
    const saved = await save({ pricing: null });
    await invoke(listAiModels, { provider: 'openrouter' });
    const initial = await invoke<AiSettingsView>(getAiSettings);
    expect(initial.ok && initial.value.connections.find((item) => item.provider === 'openrouter')?.status).toBe(
      'untested',
    );
    mode = 'unauthorized';
    const result = await invoke(testAiConnection, {
      provider: 'openrouter',
      expectedRevision: saved.revision,
      requestId: randomUUID(),
    });
    expect(result).toMatchObject({
      ok: true,
      value: { connection: { status: 'invalid_key', last4: key.slice(-4), httpStatus: 401 } },
    });
    expect(JSON.stringify(result)).not.toContain(key);
    const logs = await invoke(listAiLogs, { status: 'error' });
    expect(logs).toMatchObject({
      ok: true,
      value: { total: 1, failed: 1, items: [{ errorCode: 'http_401', costSource: 'estimated' }] },
    });
  });

  it('blocks at a zero cap before paid egress and persists denied metadata without resetting the key', async () => {
    const saved = await save({ monthlyLimitUsd: '0' });
    expect(
      await invoke(testAiConnection, {
        provider: 'openrouter',
        expectedRevision: saved.revision,
        requestId: randomUUID(),
      }),
    ).toEqual({ ok: false, code: 'AI_COST_LIMIT' });
    expect(requests).toBe(0);
    expect(await invoke(listAiLogs, { status: 'blocked' })).toMatchObject({ ok: true, value: { total: 1, failed: 1 } });
  });

  it('settles reported subcent costs once, exports only metadata and neutralizes spreadsheet formulas', async () => {
    const saved = await save({ modelId: '@private/model' });
    const requestId = randomUUID();
    expect(
      await invoke(testAiConnection, { provider: 'openrouter', expectedRevision: saved.revision, requestId }),
    ).toMatchObject({
      ok: true,
      value: { connection: { status: 'connected' }, usage: { spentUsd: '0.0002', reservedUsd: '0' } },
    });
    expect(
      await invoke(testAiConnection, { provider: 'openrouter', expectedRevision: saved.revision, requestId }),
    ).toEqual({ ok: false, code: 'AI_REQUEST_EXISTS' });
    expect(requests).toBe(1);
    const exported = await invoke<{ csv: string }>(exportAiLogs, {});
    expect(exported.ok && exported.value.csv).toContain(",'@private/model,");
    expect(exported.ok && exported.value.csv).not.toContain(key);
    expect(exported.ok && exported.value.csv).not.toContain('Reply with OK');
  });

  it('does not claim a late old-key test succeeded after configuration changed in another tab', async () => {
    const saved = await save();
    duringRequest = async () => {
      await fake.current?.ai.save(userId, input({ expectedRevision: saved.revision, apiKey: 'fixture-new-key-9876' }));
    };
    expect(
      await invoke(testAiConnection, {
        provider: 'openrouter',
        expectedRevision: saved.revision,
        requestId: randomUUID(),
      }),
    ).toEqual({ ok: false, code: 'AI_CONFIG_CHANGED' });
    const current = await invoke<AiSettingsView>(getAiSettings);
    expect(current).toMatchObject({ ok: true, value: { usage: { spentUsd: '0.0002' } } });
    expect(current.ok && current.value.connections.find((item) => item.provider === 'openrouter')).toMatchObject({
      last4: '9876',
      status: 'untested',
    });
  });

  it('blocks missing catalog prices rather than treating missing prices as a free model', async () => {
    const saved = await save({ pricing: null, modelId: 'not-listed' });
    expect(
      await invoke(testAiConnection, {
        provider: 'openrouter',
        expectedRevision: saved.revision,
        requestId: randomUUID(),
      }),
    ).toEqual({ ok: false, code: 'AI_PRICING_REQUIRED' });
    expect(requests).toBe(1); // Public catalog only; no completion.
  });

  it('retains a key when saving non-secret settings, then removes it with revision protection', async () => {
    const saved = await save();
    const { apiKey, ...retained } = input({ expectedRevision: saved.revision, monthlyLimitUsd: '2' });
    expect(apiKey).toBe(key);
    const updated = await invoke<AiSettingsView>(saveAiSettings, retained);
    expect(updated).toMatchObject({
      ok: true,
      value: {
        monthlyLimitUsd: '2',
        connections: expect.arrayContaining([expect.objectContaining({ last4: key.slice(-4) })]) as unknown,
      },
    });
    if (!updated.ok) throw new Error(updated.code);
    expect(await invoke(removeAiKey, { provider: 'openrouter', expectedRevision: saved.revision })).toEqual({
      ok: false,
      code: 'AI_CONFIG_CHANGED',
    });
    expect(
      await invoke(removeAiKey, { provider: 'openrouter', expectedRevision: updated.value.revision }),
    ).toMatchObject({
      ok: true,
      value: {
        connections: expect.arrayContaining([
          expect.objectContaining({ provider: 'openrouter', last4: null, status: 'not_connected' }),
        ]) as unknown,
      },
    });
  });

  it('binds custom catalog authentication to the saved endpoint, current 2FA and fresh session', async () => {
    const saved = await save({ provider: 'custom', baseUrl: 'https://custom.test/v1' });
    expect(await call(listAiModels, { context: context(false), data: { provider: 'custom' } })).toEqual({
      ok: false,
      code: 'TWO_FACTOR_REQUIRED',
    });
    expect(await call(listAiModels, { context: context(true, 16), data: { provider: 'custom' } })).toEqual({
      ok: false,
      code: 'REAUTHENTICATION_REQUIRED',
    });
    expect(await invoke(listAiModels, { provider: 'custom', baseUrl: 'https://other.test/v1' })).toEqual({
      ok: false,
      code: 'AI_CONFIG_CHANGED',
    });
    expect(requests).toBe(0);
    expect(await invoke(listAiModels, { provider: 'custom', baseUrl: 'https://custom.test/v1/' })).toMatchObject({
      ok: true,
      value: { catalogPublic: false },
    });
    const catalogPriced = await save({
      expectedRevision: saved.revision,
      provider: 'custom',
      baseUrl: 'https://custom.test/v1',
      pricing: null,
    });
    expect(
      await invoke(testAiConnection, {
        provider: 'custom',
        expectedRevision: catalogPriced.revision,
        requestId: randomUUID(),
      }),
    ).toEqual({ ok: false, code: 'AI_PRICING_REQUIRED' });
  });

  it.each(['forbidden', 'unavailable'] as const)(
    'classifies %s probes without claiming the key is valid',
    async (next) => {
      const saved = await save();
      mode = next;
      expect(
        await invoke(testAiConnection, {
          provider: 'openrouter',
          expectedRevision: saved.revision,
          requestId: randomUUID(),
        }),
      ).toMatchObject({ ok: true, value: { connection: { status: next === 'forbidden' ? 'invalid_key' : 'error' } } });
      expect(await invoke(listAiLogs, { feature: 'receipt' })).toMatchObject({ ok: true, value: { total: 0 } });
      expect(await invoke(exportAiLogs, { feature: 'test' })).toMatchObject({
        ok: true,
        value: { csv: expect.stringContaining('http_') as unknown },
      });
    },
  );
});
