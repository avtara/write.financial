// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from 'node:crypto';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { generateDek } from '@wf/crypto/envelope';
import { AiError } from '@wf/domain/ai';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createAiRepository, type AiRepository, type AiReservationInput } from './ai.ts';
import { createDb, withUser, type Database } from './db.ts';
import { migrate } from './migrate.ts';
import { bootstrapRoles, ROLES } from './roles.ts';

let container: StartedPostgreSqlContainer;
let admin: postgres.Sql;
let app: Database;
let repo: AiRepository;
let userId: string;
let revision: string;
const password = () => `fixture-${randomUUID()}`;
const passwords = { app: password(), auth: password(), worker: password(), migrate: password(), readonlyOps: null };
const dek = generateDek();
const pricing = { inputUsdPerMillion: '1', outputUsdPerMillion: '2', requestUsd: '0', imageUsd: '0' };
const roleUrl = (role: string, secret: string) => {
  const url = new URL(container.getConnectionUri());
  url.username = role;
  url.password = secret;
  return url.href;
};
const reservation = (costUsd: string): AiReservationInput => ({
  id: randomUUID(),
  expectedRevision: revision,
  provider: 'openrouter',
  modelId: 'fixture/model',
  feature: 'test',
  costUsd,
  dataSent: { images: 0, categories: 0, accounts: 0, transactions: 0 },
  needsDraftPermission: false,
});

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:18.6').start();
  admin = postgres(container.getConnectionUri(), { max: 1, onnotice: () => undefined });
  await bootstrapRoles(container.getConnectionUri(), passwords);
  await migrate(roleUrl(ROLES.migrate, passwords.migrate));
  app = createDb(roleUrl(ROLES.app, passwords.app));
  repo = createAiRepository(app, { getDek: () => Promise.resolve(dek), allowedBaseUrls: [] });
});
afterAll(async () => {
  await app.$client.end();
  await admin.end();
  await container.stop();
});
beforeEach(async () => {
  await admin`DELETE FROM users`;
  const [user] = await admin<{ id: string }[]>`INSERT INTO users (name, email, two_factor_enabled)
    VALUES ('AI concurrent fixture', 'ai-concurrent@example.test', true) RETURNING id`;
  if (user === undefined) throw new Error('No fixture user');
  userId = user.id;
  const settings = await repo.save(userId, {
    expectedRevision: null,
    provider: 'openrouter',
    apiKey: `fixture-${randomUUID()}`,
    modelId: 'fixture/model',
    allowReadFinancial: false,
    allowCreateDrafts: false,
    requireConfirmation: true,
    monthlyLimitUsd: '1',
    pricing,
  });
  revision = settings.revision as string;
});

describe('real concurrent AI accounting', () => {
  it('allows only one of four concurrent 60-cent reservations against a one-dollar cap', async () => {
    const results = await Promise.allSettled(Array.from({ length: 4 }, () => repo.reserve(userId, reservation('0.6'))));
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const failures = results.filter((result) => result.status === 'rejected');
    expect(
      failures.map((result) => (result.reason instanceof AiError ? result.reason.code : 'unexpected-error')),
    ).toEqual(['AI_COST_LIMIT', 'AI_COST_LIMIT', 'AI_COST_LIMIT']);
    expect((await repo.settings(userId)).usage).toMatchObject({ requests: 1, spentUsd: '0', reservedUsd: '0.6' });
    const logs = await repo.logs(userId, {});
    expect(logs).toMatchObject({ total: 4, failed: 3 });
    expect(logs.items.filter((item) => item.status === 'pending')).toHaveLength(1);
  });

  it('settles concurrent repeated callbacks once and preserves spent cost after key removal', async () => {
    const request = reservation('0.6');
    await repo.reserve(userId, request);
    const result = {
      status: 'ok' as const,
      httpStatus: 200,
      inputTokens: 12,
      outputTokens: 1,
      costUsd: '0.1',
      costSource: 'reported' as const,
      durationMs: 15,
      errorCode: null,
      toolCalls: [],
      connectionStatus: 'connected' as const,
      pricing,
    };
    await Promise.all([repo.settle(userId, request.id, result), repo.settle(userId, request.id, result)]);
    expect((await repo.settings(userId)).usage).toMatchObject({ spentUsd: '0.1', reservedUsd: '0', requests: 1 });
    const removed = await repo.removeKey(userId, 'openrouter', revision);
    expect(removed.usage.spentUsd).toBe('0.1');
    expect(await admin`SELECT api_key_enc, last4 FROM ai_connections WHERE user_id = ${userId}`).toEqual([
      { api_key_enc: null, last4: null },
    ]);
  });

  it('enforces 2FA on raw key updates too, not only through the application validator', async () => {
    await admin`UPDATE users SET two_factor_enabled = false WHERE id = ${userId}`;
    await expect(
      withUser(app, userId, (tx) => tx.execute(sql`UPDATE ai_connections SET last4 = 'evil'`)),
    ).rejects.toMatchObject({ cause: { code: '42501' } });
    expect(await admin`SELECT last4 = 'evil' AS changed FROM ai_connections WHERE user_id = ${userId}`).toEqual([
      { changed: false },
    ]);
  });
});
