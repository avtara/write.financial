// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { ValkeyContainer, type StartedValkeyContainer } from '@testcontainers/valkey';
import { createKeyFile, loadKeyring } from '@wf/crypto/keyring';
import { createAiRepository } from '@wf/db/ai';
import { createDb, withUser, type Database } from '@wf/db/db';
import { createGmail, type GmailRepository } from '@wf/db/gmail';
import { migrate } from '@wf/db/migrate';
import { createReview } from '@wf/db/review';
import { bootstrapRoles } from '@wf/db/roles';
import { seedLedger } from '@wf/db/seed';
import { createTransactions } from '@wf/db/transactions';
import { createUserKeys } from '@wf/db/user-keys';
import { createAiClient } from '@wf/integrations/ai';
import { createGmailClient } from '@wf/integrations/gmail';
import { createEnqueue } from '@wf/jobs/enqueue';
import { jobIds, QUEUE_PREFIX } from '@wf/jobs/queues';
import { Queue, QueueEvents, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FAKE_S3, fakeDeps } from '../test/fakes.ts';
import { createGmailProcessor } from './processors/gmail.ts';
import { openWorkerDb, type WorkerDbConnection } from './worker-db.ts';
const passwords = {
  app: randomUUID(),
  worker: randomUUID(),
  auth: randomUUID(),
  migrate: randomUUID(),
  readonlyOps: null,
};
const now = new Date('2026-10-18T02:00:00Z');
let pg: StartedPostgreSqlContainer;
let valkey: StartedValkeyContainer;
let root: postgres.Sql;
let app: Database;
let workerSql: Database;
let workerDb: WorkerDbConnection;
let redis: Redis;
let queue: Queue;
let events: QueueEvents;
let worker: Worker;
let directory: string;
let userId: string;
let accountId: string;
let otherAccountId: string;
let categoryId: string;
let gmail: GmailRepository;
let calls = 0;
let mailId = 'pln-one';
let revoked = false;
async function providerRequest(request: IncomingMessage, response: ServerResponse) {
  let body = '';
  for await (const chunk of request) body += String(chunk);
  const input = JSON.parse(body) as { messages: { content: string }[] };
  if (!input.messages[0]?.content.includes('UNTRUSTED DATA')) {
    response.writeHead(400).end();
    return;
  }
  calls++;
  response.setHeader('Content-Type', 'application/json');
  response.end(
    JSON.stringify({
      choices: [
        {
          finish_reason: 'stop',
          message: {
            content: JSON.stringify({
              amountMinor: '350000',
              occurredAt: now.toISOString(),
              merchant: 'PLN',
              currency: 'IDR',
              accountId,
              categoryId,
              confidence: { amount: 97, date: 97, merchant: 97, currency: 97, account: 97, category: 97 },
            }),
          },
        },
      ],
      usage: { prompt_tokens: 1000, completion_tokens: 200, cost: '0.004' },
    }),
  );
}
const provider = createServer((request, response) => {
  void providerRequest(request, response).catch(() => {
    response.writeHead(500).end();
  });
});
const url = (role: keyof typeof passwords) => {
  const value = new URL(pg.getConnectionUri());
  value.username = `wf_${role}`;
  value.password = passwords[role] ?? '';
  return value.href;
};
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'wf-gmail-integration-'));
  pg = await new PostgreSqlContainer('postgres:18.6').start();
  valkey = await new ValkeyContainer('valkey/valkey:9.2').withPassword(randomUUID()).start();
  root = postgres(pg.getConnectionUri(), { max: 2, onnotice: () => undefined });
  await bootstrapRoles(pg.getConnectionUri(), passwords);
  await migrate(url('migrate'));
  app = createDb(url('app'));
  workerSql = createDb(url('worker'));
  const kekFile = join(directory, 'kek');
  await createKeyFile(kekFile);
  const keyring = await loadKeyring(kekFile);
  const getDek = createUserKeys(app, keyring).getOrCreateDek;
  const [user] = await root<
    { id: string }[]
  >`INSERT INTO users(name,email,two_factor_enabled) VALUES ('Gmail fixture','gmail-integration@example.test',true) RETURNING id`;
  userId = user?.id ?? '';
  await seedLedger(app, userId, { getDek, now: () => now });
  accountId =
    (await root<{ id: string }[]>`SELECT id FROM accounts WHERE user_id=${userId} AND display_name='BCA Tahapan'`)[0]
      ?.id ?? '';
  otherAccountId =
    (await root<{ id: string }[]>`SELECT id FROM accounts WHERE user_id=${userId} AND display_name='GoPay'`)[0]?.id ??
    '';
  categoryId =
    (await root<{ id: string }[]>`SELECT id FROM categories WHERE user_id=${userId} AND name='system:health'`)[0]?.id ??
    '';
  provider.listen(0, '127.0.0.1');
  await once(provider, 'listening');
  const endpoint = `http://127.0.0.1:${String((provider.address() as AddressInfo).port)}/v1`;
  const ai = createAiRepository(app, { getDek, allowedBaseUrls: [endpoint], now: () => now });
  await ai.save(userId, {
    expectedRevision: null,
    provider: 'custom',
    baseUrl: endpoint,
    apiKey: `fixture-${randomUUID()}`,
    modelId: 'fixture/gmail',
    allowReadFinancial: true,
    allowCreateDrafts: true,
    requireConfirmation: true,
    monthlyLimitUsd: '5',
    pricing: { inputUsdPerMillion: '1', outputUsdPerMillion: '2', requestUsd: '0', imageUsd: '0' },
  });
  gmail = createGmail(app, { getDek, now: () => now });
  await gmail.saveConnection(userId, {
    email: 'fixture@gmail.com',
    tokens: {
      accessToken: 'private-fixture-access',
      refreshToken: 'private-fixture-refresh',
      expiresAt: new Date('2099-01-01'),
    },
    filters: { senders: ['bank.test'], keywords: ['payment'], ignoreKeywords: ['promo'] },
  });
  workerDb = openWorkerDb(url('worker'), keyring, { s3: FAKE_S3, aiAllowedBaseUrls: [endpoint] });
  redis = new Redis(valkey.getConnectionUrl(), { maxRetriesPerRequest: null });
  queue = new Queue('gmail', { connection: redis, prefix: QUEUE_PREFIX });
  events = new QueueEvents('gmail', { connection: redis, prefix: QUEUE_PREFIX });
  await events.waitUntilReady();
  const google = createGmailClient({
    oauth: { clientId: 'fixture-client', clientSecret: 'fixture-secret' },
    fetch: (input) => {
      const target = input instanceof Request ? input.url : input.toString();
      if (revoked) return Promise.resolve(Response.json({}, { status: 401 }));
      if (target.endsWith('/watch'))
        return Promise.resolve(Response.json({ historyId: '500', expiration: String(Date.now() + 7 * 86400000) }));
      if (target.endsWith('/profile'))
        return Promise.resolve(Response.json({ emailAddress: 'fixture@gmail.com', historyId: '501' }));
      if (target.includes('/history?'))
        return Promise.resolve(
          Response.json({ historyId: '501', history: [{ messagesAdded: [{ message: { id: mailId } }] }] }),
        );
      if (target.includes('/messages?')) return Promise.resolve(Response.json({ messages: [{ id: mailId }] }));
      return Promise.resolve(
        Response.json({
          internalDate: String(now.getTime()),
          snippet: 'Minimal PLN payment 350000 IDR',
          payload: {
            headers: [
              { name: 'From', value: 'Bank <pay@bank.test>' },
              { name: 'Subject', value: 'PLN payment' },
            ],
          },
        }),
      );
    },
  });
  const process = createGmailProcessor(
    fakeDeps(
      {
        db: workerDb.db,
        gmail: {
          enabled: true,
          topic: 'projects/fixture/topics/mail',
          fetch: google,
          client: createAiClient({ allowedBaseUrls: [endpoint] }),
        },
      },
      now,
    ),
  );
  worker = new Worker('gmail', (job) => process({ id: job.id, data: job.data, attemptsMade: job.attemptsMade }), {
    connection: redis,
    prefix: QUEUE_PREFIX,
  });
});
afterAll(async () => {
  await worker.close();
  await events.close();
  await queue.close();
  redis.disconnect();
  await workerDb.close();
  await workerSql.$client.end();
  await app.$client.end();
  await root.end();
  provider.close();
  await valkey.stop();
  await pg.stop();
  await rm(directory, { recursive: true, force: true });
});
async function ingest(trigger: string) {
  await createEnqueue(() => queue)('gmail', { userId }, { jobId: jobIds.gmail(userId, trigger) });
  const job = await queue.getJob(jobIds.gmail(userId, trigger));
  if (job === undefined) throw new Error('Gmail job missing');
  return job.waitUntilFinished(events, 30000) as Promise<unknown>;
}

describe('Gmail on real Postgres/Valkey and the wf_worker SQL role', () => {
  it('replays pushes once, keeps money unchanged until confirm, preserves encryption/source/log linkage and manual dedupe', async () => {
    const before = Number(
      (await root<{ n: number }[]>`SELECT count(*)::int AS n FROM transactions WHERE user_id=${userId}`)[0]?.n,
    );
    expect(await ingest('push1')).toMatchObject({ proposed: 1 });
    expect(await ingest('push2')).toMatchObject({ proposed: 0 });
    expect(calls).toBe(1);
    expect(
      Number((await root<{ n: number }[]>`SELECT count(*)::int AS n FROM transactions WHERE user_id=${userId}`)[0]?.n),
    ).toBe(before);
    const getDek = createUserKeys(app, await loadKeyring(join(directory, 'kek'))).getOrCreateDek;
    const review = createReview(app, { getDek, now: () => now });
    const [item] = (await review.list(userId, { source: 'gmail' })).items;
    expect(item?.aiConfidence).toBe(97);
    expect(item?.payload.kind).toBe('gmail');
    const saved = await review.confirm(userId, item?.id ?? '');
    await review.confirm(userId, item?.id ?? '');
    expect(
      (await root<{ source: string }[]>`SELECT source FROM transactions WHERE id=${saved.transactionId as string}`)[0]
        ?.source,
    ).toBe('gmail');
    expect((await gmail.listLogs(userId))[0]?.outcome).toBe('confirmed');
    const [sealed] = await root<
      { tokens_enc: Buffer; quote_enc: Buffer; extraction_enc: Buffer }[]
    >`SELECT tokens_enc,quote_enc,extraction_enc FROM gmail_connections CROSS JOIN email_ingest_logs WHERE gmail_connections.user_id=${userId}`;
    expect(sealed?.tokens_enc.toString()).not.toContain('private-fixture');
    expect(sealed?.quote_enc.toString()).not.toContain('PLN');
    expect(sealed?.extraction_enc.toString()).not.toContain('350000');
    mailId = 'manual-duplicate';
    await createTransactions(app, { getDek, now: () => now }).create(userId, {
      type: 'expense',
      clientId: randomUUID(),
      accountId: otherAccountId,
      amountMinor: 350000n,
      categoryId,
      occurredAt: now,
      merchant: 'Manually entered unrelated merchant',
      source: 'manual',
    });
    expect(await ingest('push3')).toMatchObject({ proposed: 0, duplicates: 1 });
    expect((await gmail.listLogs(userId)).find((row) => row.messageId === mailId)?.outcome).toBe('duplicate');
    expect(
      (
        await root<
          { n: number }[]
        >`SELECT count(*)::int AS n FROM review_items WHERE user_id=${userId} AND source='gmail'`
      )[0]?.n,
    ).toBe(1);
    for (const table of ['transactions', 'postings', 'budget_lines']) {
      await expect(
        withUser(workerSql, userId, async (tx) => {
          await tx.execute(`UPDATE ${table} SET user_id=user_id WHERE user_id='${userId}'`);
        }),
      ).rejects.toMatchObject({ cause: { code: '42501' } });
      await expect(
        withUser(workerSql, userId, async (tx) => {
          await tx.execute(`INSERT INTO ${table} DEFAULT VALUES`);
        }),
      ).rejects.toMatchObject({ cause: { code: '42501' } });
    }
    revoked = true;
    expect(await ingest('push4')).toMatchObject({ status: 'revoked' });
    expect(await gmail.tokens(userId)).toBeNull();
  });
});
