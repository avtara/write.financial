// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from 'node:crypto';
import type { AiSettingsView } from '@wf/domain/ai';
import { expect } from 'vitest';
import type { Result } from '../../../src/server/access.ts';
import { aId, as, type Case, type Name, superuser, UNAUTHENTICATED } from '../harness.ts';

const A_REVISION = randomUUID();
let seeded: Promise<void> | undefined;
function seedA(): Promise<void> {
  seeded ??= (async () => {
    // The ai cases may already have configured A; this case only needs A to own a configuration and a key.
    await superuser`INSERT INTO ai_settings (user_id, revision) VALUES (${aId}, ${A_REVISION})
      ON CONFLICT (user_id) DO NOTHING`;
    await superuser`INSERT INTO ai_connections (user_id, provider, base_url, api_key_enc, last4, model_id, status)
      VALUES (${aId}, 'openrouter', 'https://openrouter.ai/api/v1', '\x01', 'a4a4', 'a-only/model', 'connected')
      ON CONFLICT (user_id, provider) DO NOTHING`;
  })();
  return seeded;
}
const aRows = async () => ({
  settings: await superuser`SELECT * FROM ai_settings WHERE user_id = ${aId}`,
  connections: await superuser`SELECT provider, last4, status, model_id FROM ai_connections WHERE user_id = ${aId}`,
  logs: await superuser`SELECT * FROM ai_logs WHERE user_id = ${aId}`,
  usage: await superuser`SELECT * FROM ai_usage_months WHERE user_id = ${aId}`,
});

export const cases = {
  askAssistant: {
    input: () => ({
      requestId: randomUUID(),
      expectedRevision: A_REVISION,
      question: 'Berapa sisa anggaran Makan bulan ini?',
      history: [],
    }),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      await seedA();
      const before = await aRows();
      // B has no configuration of their own: the assistant refuses instead of borrowing A's key or allowance.
      expect(await as<Result<unknown>>('B', 'askAssistant', input)).toMatchObject({ ok: false });
      const own = await as<Result<AiSettingsView>>('B', 'getAiSettings');
      // B sees only placeholder connections: no key, no model, no status from A.
      expect(
        own.ok && own.value.connections.every((item) => item.last4 === null && item.status === 'not_connected'),
      ).toBe(true);
      expect(await aRows()).toEqual(before);
    },
  },
} satisfies Partial<Record<Name, Case>>;
