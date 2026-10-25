// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from 'node:crypto';
import type { AiLogsPage, AiSettingsView } from '@wf/domain/ai';
import { expect } from 'vitest';
import type { Result } from '../../../src/server/access.ts';
import { aId, as, type Case, type Name, secrets, superuser, UNAUTHENTICATED } from '../harness.ts';

const A_REVISION = randomUUID();
let seeded: Promise<void> | undefined;
function seedA(): Promise<void> {
  seeded ??= (async () => {
    await superuser`INSERT INTO ai_settings (user_id, revision) VALUES (${aId}, ${A_REVISION})`;
    await superuser`INSERT INTO ai_connections (user_id, provider, base_url, api_key_enc, last4, model_id, status)
      VALUES (${aId}, 'openrouter', 'https://openrouter.ai/api/v1', '\x01', 'a4a4', 'a-only/model', 'connected')`;
    await superuser`INSERT INTO ai_usage_months (user_id, month, requests, spent_usd)
      VALUES (${aId}, to_char(now(), 'YYYY-MM'), 1, 0.04)`;
    await superuser`INSERT INTO ai_logs (user_id, id, month, revision, provider, feature, model_id, status, cost_usd, reserved_usd, cost_source)
      VALUES (${aId}, ${randomUUID()}, to_char(now(), 'YYYY-MM'), ${A_REVISION}, 'openrouter', 'test', 'a-only/model', 'ok', 0.04, 0, 'reported')`;
  })();
  return seeded;
}
const aRows = async () => ({
  settings: await superuser`SELECT * FROM ai_settings WHERE user_id = ${aId}`,
  connections: await superuser`SELECT provider, last4, status, model_id FROM ai_connections WHERE user_id = ${aId}`,
  usage: await superuser`SELECT * FROM ai_usage_months WHERE user_id = ${aId}`,
  logs: await superuser`SELECT * FROM ai_logs WHERE user_id = ${aId}`,
});

export const cases = {
  getAiSettings: {
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      await seedA();
      const own = await as<Result<AiSettingsView>>('B', 'getAiSettings');
      expect(own.ok && own.value.connections.some((item) => item.last4 !== null)).toBe(false);
      const other = await as<Result<AiSettingsView>>('A', 'getAiSettings');
      expect(other.ok && other.value.connections.find((item) => item.provider === 'openrouter')).toMatchObject({
        last4: 'a4a4',
        modelId: 'a-only/model',
      });
    },
  },
  saveAiSettings: {
    input: () => {
      const apiKey = `fixture-isolation-ai-${randomUUID()}`;
      secrets.push(apiKey);
      return {
        expectedRevision: null,
        provider: 'openrouter',
        apiKey,
        modelId: 'b-only/model',
        allowReadFinancial: false,
        allowCreateDrafts: false,
        requireConfirmation: true,
        monthlyLimitUsd: '1',
        pricing: null,
      };
    },
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      await seedA();
      const before = await aRows();
      const result = await as<Result<AiSettingsView>>('B', 'saveAiSettings', input);
      expect(result.ok && result.value.connections.find((item) => item.provider === 'openrouter')).toMatchObject({
        modelId: 'b-only/model',
        status: 'untested',
      });
      expect(await aRows()).toEqual(before);
    },
  },
  removeAiKey: {
    input: () => ({ provider: 'openrouter', expectedRevision: A_REVISION }),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      await seedA();
      const before = await aRows();
      expect(await as('B', 'removeAiKey', input)).toEqual({ ok: false, code: 'AI_CONFIG_CHANGED' });
      const own = await as<Result<AiSettingsView>>('B', 'getAiSettings');
      if (!own.ok) throw new Error('Own settings unavailable');
      const removed = await as<Result<AiSettingsView>>('B', 'removeAiKey', {
        provider: 'openrouter',
        expectedRevision: own.value.revision,
      });
      expect(removed.ok && removed.value.connections.find((item) => item.provider === 'openrouter')).toMatchObject({
        last4: null,
        status: 'not_connected',
      });
      expect(await aRows()).toEqual(before);
    },
  },
  listAiModels: {
    input: () => ({ provider: 'custom' }),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      await seedA();
      const before = await aRows();
      // No B custom key: never borrow A's and never contact a real paid/public provider in this isolation suite.
      expect(await as('B', 'listAiModels', input)).toEqual({ ok: false, code: 'AI_NOT_CONFIGURED' });
      expect(await aRows()).toEqual(before);
    },
  },
  testAiConnection: {
    input: () => ({ provider: 'openrouter', expectedRevision: A_REVISION, requestId: randomUUID() }),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      await seedA();
      const before = await aRows();
      expect(await as('B', 'testAiConnection', input)).toEqual({ ok: false, code: 'AI_CONFIG_CHANGED' });
      expect(await aRows()).toEqual(before);
    },
  },
  listAiLogs: {
    input: () => ({}),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      await seedA();
      const own = await as<Result<AiLogsPage>>('B', 'listAiLogs', input);
      expect(own.ok && own.value.total).toBe(0);
      const other = await as<Result<AiLogsPage>>('A', 'listAiLogs', input);
      expect(other.ok && other.value.items.map((item) => item.modelId)).toEqual(['a-only/model']);
    },
  },
  exportAiLogs: {
    input: () => ({}),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      await seedA();
      const own = await as<Result<{ csv: string }>>('B', 'exportAiLogs', input);
      expect(own.ok && own.value.csv).not.toContain('a-only/model');
      const other = await as<Result<{ csv: string }>>('A', 'exportAiLogs', input);
      expect(other.ok && other.value.csv).toContain('a-only/model');
    },
  },
} satisfies Partial<Record<Name, Case>>;
