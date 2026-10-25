// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from 'node:crypto';
import { DecryptionError } from '@wf/crypto/cipher';
import type { AiSettingsInput } from '@wf/domain/ai';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { fixtureGetDek } from '../test/ledger-fixture.ts';
import { insertUser, PGLITE_HOOK_TIMEOUT, startMigrated, type TestDatabase } from '../test/pglite.ts';
import { createAiRepository, type AiReservationInput, type AiSettlementInput } from './ai.ts';
import { createExport } from './export.ts';

let test: TestDatabase;
let alice: string;
let bob: string;
let clock = new Date('2026-10-15T09:00:00Z');
const key = `fixture-ai-${randomUUID()}`;
const pricing = { inputUsdPerMillion: '1', outputUsdPerMillion: '2', requestUsd: '0', imageUsd: '0' };
const repo = () =>
  createAiRepository(test.db, {
    getDek: fixtureGetDek,
    now: () => clock,
    allowedBaseUrls: ['http://127.0.0.1:11434/v1', 'http://127.0.0.1:11435/v1'],
  });
const asApp = <T>(work: () => Promise<T>) => test.as('wf_app', work);
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
const reserve = (revision: string, extra: Partial<AiReservationInput> = {}): AiReservationInput => ({
  id: randomUUID(),
  expectedRevision: revision,
  provider: 'openrouter',
  modelId: 'fixture/model',
  feature: 'test',
  costUsd: '0.7',
  dataSent: { images: 0, categories: 0, accounts: 0, transactions: 0 },
  needsDraftPermission: false,
  ...extra,
});
const settlement = (extra: Partial<AiSettlementInput> = {}): AiSettlementInput => ({
  status: 'ok',
  httpStatus: 200,
  inputTokens: 10,
  outputTokens: 2,
  costUsd: '0.1',
  costSource: 'reported',
  durationMs: 12,
  errorCode: null,
  toolCalls: [],
  connectionStatus: 'connected',
  pricing,
  ...extra,
});
const save = (extra: Partial<AiSettingsInput> = {}) => asApp(() => repo().save(alice, input(extra)));

beforeAll(async () => {
  test = await startMigrated();
}, PGLITE_HOOK_TIMEOUT);
afterAll(async () => {
  await test.close();
});
beforeEach(async () => {
  await test.query('DELETE FROM users');
  alice = await insertUser(test, 'alice-ai@example.test');
  bob = await insertUser(test, 'bob-ai@example.test');
  await test.query('UPDATE users SET two_factor_enabled = true');
  clock = new Date('2026-10-15T09:00:00Z');
});

describe('BYOK confidentiality and ownership', () => {
  it('deleting an account erases its keys, settings, pending logs, and usage without erasing another user', async () => {
    const { revision: aliceRevision } = await save();
    const { revision: bobRevision } = await asApp(() => repo().save(bob, input()));
    if (aliceRevision === null || bobRevision === null) throw new Error('AI fixture has no revision');
    await asApp(() => repo().reserve(alice, reserve(aliceRevision)));
    await asApp(() => repo().reserve(bob, reserve(bobRevision)));
    const tables = ['ai_connections', 'ai_settings', 'ai_logs', 'ai_usage_months'];
    const counts = (table: string) =>
      test.query<{ deleted: number; retained: number }>(
        `SELECT count(*) FILTER (WHERE user_id = $1)::int AS deleted,
                count(*) FILTER (WHERE user_id = $2)::int AS retained FROM ${table}`,
        [alice, bob],
      );
    for (const table of tables) expect(await counts(table)).toEqual([{ deleted: 1, retained: 1 }]);
    await test.query('DELETE FROM users WHERE id = $1', [alice]);
    for (const table of tables) expect(await counts(table)).toEqual([{ deleted: 0, retained: 1 }]);
  });

  it('encrypts at rest, decrypts only for the owner, exports metadata without custom bytea ciphertext, and audits changes', async () => {
    const saved = await save();
    expect(saved.connections.find((item) => item.provider === 'openrouter')).toMatchObject({
      last4: key.slice(-4),
      status: 'untested',
    });
    expect(JSON.stringify(saved)).not.toContain(key);
    const [row] = await test.query<{ enc: Uint8Array }>('SELECT api_key_enc AS enc FROM ai_connections');
    expect(Buffer.from(row?.enc ?? []).toString()).not.toContain(key);
    expect((await asApp(() => repo().credential(alice, 'openrouter'))).apiKey).toBe(key);
    await expect(asApp(() => repo().credential(bob, 'openrouter'))).rejects.toMatchObject({
      code: 'AI_NOT_CONFIGURED',
    });
    const exported = await asApp(() => createExport(test.db).collect(alice));
    expect(exported.aiConnections[0]).toMatchObject({ provider: 'openrouter', last4: key.slice(-4) });
    expect(exported.aiConnections[0]).not.toHaveProperty('apiKeyEnc');
    expect(JSON.stringify(exported)).not.toContain(key);
    expect(await test.query('SELECT type, meta FROM security_events')).toEqual([
      { type: 'api_key_added', meta: { integration: 'ai', provider: 'openrouter' } },
    ]);
    await asApp(() => repo().removeKey(alice, 'openrouter', saved.revision as string));
    expect(await test.query('SELECT type FROM security_events ORDER BY id')).toEqual([
      { type: 'api_key_added' },
      { type: 'api_key_removed' },
    ]);
    await expect(asApp(() => repo().credential(alice, 'openrouter'))).rejects.toMatchObject({
      code: 'AI_NOT_CONFIGURED',
    });
  });

  it('requires current 2FA, never reuses a saved key at a changed custom endpoint and rejects stale saves', async () => {
    await test.query('UPDATE users SET two_factor_enabled = false WHERE id = $1', [alice]);
    await expect(save()).rejects.toMatchObject({ code: 'TWO_FACTOR_REQUIRED' });
    await test.query('UPDATE users SET two_factor_enabled = true WHERE id = $1', [alice]);
    const saved = await save({ provider: 'custom', baseUrl: 'http://127.0.0.1:11434/v1' });
    const changed = input({
      provider: 'custom',
      baseUrl: 'http://127.0.0.1:11435/v1',
      expectedRevision: saved.revision,
    });
    delete changed.apiKey;
    await expect(asApp(() => repo().save(alice, changed))).rejects.toMatchObject({ code: 'AI_INVALID_CONFIG' });
    await expect(save()).rejects.toMatchObject({ code: 'AI_CONFIG_CHANGED' });
  });

  it('does not release a saved key after destination metadata changes', async () => {
    await save({ provider: 'custom', baseUrl: 'http://127.0.0.1:11434/v1' });
    await test.query('UPDATE ai_connections SET base_url = $1 WHERE user_id = $2', [
      'http://127.0.0.1:11435/v1',
      alice,
    ]);
    await expect(asApp(() => repo().credential(alice, 'custom'))).rejects.toThrow(DecryptionError);
  });
});

describe('budget and permission transitions', () => {
  it('counts reservations, releases only the settled difference, rejects duplicates and never replenishes spend on key removal', async () => {
    const saved = await save();
    const first = reserve(saved.revision as string);
    await asApp(() => repo().reserve(alice, first));
    await expect(asApp(() => repo().reserve(alice, first))).rejects.toMatchObject({ code: 'AI_REQUEST_EXISTS' });
    await expect(
      asApp(() => repo().reserve(alice, reserve(saved.revision as string, { costUsd: '0.4' }))),
    ).rejects.toMatchObject({ code: 'AI_COST_LIMIT' });
    expect((await asApp(() => repo().settings(alice))).usage).toMatchObject({
      requests: 1,
      spentUsd: '0',
      reservedUsd: '0.7',
    });
    await asApp(() => repo().settle(alice, first.id, settlement()));
    await asApp(() => repo().settle(alice, first.id, settlement({ costUsd: '0.9' })));
    const removed = await asApp(() => repo().removeKey(alice, 'openrouter', saved.revision as string));
    expect(removed.usage).toMatchObject({ spentUsd: '0.1', reservedUsd: '0', requests: 1 });
    const replaced = await save({ expectedRevision: removed.revision });
    await expect(
      asApp(() => repo().reserve(alice, reserve(replaced.revision as string, { costUsd: '0.95' }))),
    ).rejects.toMatchObject({ code: 'AI_COST_LIMIT' });
    const logs = await asApp(() => repo().logs(alice, { status: 'blocked' }));
    expect(logs.items.map((item) => item.errorCode)).toEqual(['AI_COST_LIMIT', 'AI_COST_LIMIT']);
  });

  it('permits a nonfinancial connection test but refuses financial disclosure and draft permissions independently', async () => {
    const saved = await save();
    await expect(
      asApp(() => repo().reserve(alice, reserve(saved.revision as string, { feature: 'chat', costUsd: '0.01' }))),
    ).rejects.toMatchObject({ code: 'AI_PERMISSION_REQUIRED' });
    const allowedRead = await save({ expectedRevision: saved.revision, allowReadFinancial: true });
    await expect(
      asApp(() =>
        repo().reserve(
          alice,
          reserve(allowedRead.revision as string, { feature: 'chat', needsDraftPermission: true, costUsd: '0.01' }),
        ),
      ),
    ).rejects.toMatchObject({ code: 'AI_PERMISSION_REQUIRED' });
    const request = reserve(allowedRead.revision as string, { costUsd: '0.01' });
    await asApp(() => repo().reserve(alice, request));
    expect((await asApp(() => repo().settings(alice))).usage.requests).toBe(1);
  });

  it('charges unknown timeout costs conservatively and does not let an old test mark a replacement key connected', async () => {
    const saved = await save();
    const request = reserve(saved.revision as string);
    await asApp(() => repo().reserve(alice, request));
    await save({ expectedRevision: saved.revision, apiKey: 'test-9876' });
    await asApp(() =>
      repo().settle(alice, request.id, settlement({ status: 'timeout', costUsd: null, errorCode: 'timeout' })),
    );
    const state = await asApp(() => repo().settings(alice));
    expect(state.usage).toMatchObject({ spentUsd: '0.7', estimatedUsd: '0.7', reservedUsd: '0' });
    expect(state.connections.find((item) => item.provider === 'openrouter')).toMatchObject({
      last4: '9876',
      status: 'untested',
      testedAt: null,
    });
    expect((await asApp(() => repo().logs(alice, { status: 'timeout' }))).items[0]).toMatchObject({
      costUsd: '0.7',
      costSource: 'estimated',
      errorCode: 'timeout',
    });
  });

  it('settles against the request-start month even across the user-local month boundary', async () => {
    clock = new Date('2026-10-31T16:59:59Z');
    const saved = await save();
    const request = reserve(saved.revision as string);
    await asApp(() => repo().reserve(alice, request));
    clock = new Date('2026-10-31T17:00:01Z');
    await test.query('UPDATE users SET two_factor_enabled = false WHERE id = $1', [alice]);
    await asApp(() => repo().settle(alice, request.id, settlement()));
    expect((await asApp(() => repo().settings(alice))).usage).toMatchObject({
      month: '2026-11',
      spentUsd: '0',
      reservedUsd: '0',
    });
    const [october] = await test.query<{ spend: string; pending: string }>(
      'SELECT spent_usd::text AS spend, reserved_usd::text AS pending FROM ai_usage_months WHERE month = $1',
      ['2026-10'],
    );
    expect(october).toEqual({ spend: '0.100000000000000000', pending: '0.000000000000000000' });
  });
});
