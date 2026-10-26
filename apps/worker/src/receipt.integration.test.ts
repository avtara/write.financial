// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { ValkeyContainer, type StartedValkeyContainer } from '@testcontainers/valkey';
import type { Config } from '@wf/config';
import { createKeyFile, loadKeyring } from '@wf/crypto/keyring';
import { createAiRepository } from '@wf/db/ai';
import { createDb, withUser, type Database } from '@wf/db/db';
import { migrate } from '@wf/db/migrate';
import { createReceipts, type ReceiptsRepository } from '@wf/db/receipts';
import { createReview } from '@wf/db/review';
import { bootstrapRoles } from '@wf/db/roles';
import { seedLedger } from '@wf/db/seed';
import { createUserKeys } from '@wf/db/user-keys';
import { createAiClient } from '@wf/integrations/ai';
import { createObjectStore, type ObjectStore } from '@wf/integrations/objectstore';
import { prepareReceipt } from '@wf/integrations/receipt';
import { createEnqueue } from '@wf/jobs/enqueue';
import { jobIds, QUEUE_PREFIX } from '@wf/jobs/queues';
import { Queue, QueueEvents, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import postgres from 'postgres';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fakeDeps } from '../test/fakes.ts';
import { createOcrProcessor } from './processors/ocr.ts';
import { openWorkerDb, type WorkerDbConnection } from './worker-db.ts';
const PASSWORDS = {
  app: randomUUID(),
  worker: randomUUID(),
  auth: randomUUID(),
  migrate: randomUUID(),
  readonlyOps: null,
};
const now = new Date('2026-10-15T09:00:00Z');
let pg: StartedPostgreSqlContainer;
let valkey: StartedValkeyContainer;
let seaweed: StartedTestContainer;
let root: postgres.Sql;
let app: Database;
let workerSql: Database;
let workerDb: WorkerDbConnection;
let redis: Redis;
let queue: Queue;
let events: QueueEvents;
let worker: Worker;
let userId: string;
let accountId: string;
let categoryId: string;
let revision: string;
let directory: string;
let receipts: ReceiptsRepository;
let store: ObjectStore;
let calls = 0;
let unreadable = false;
async function handleProvider(request: IncomingMessage, response: ServerResponse) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk as Uint8Array));
  const body = JSON.parse(Buffer.concat(chunks).toString()) as {
    messages: { content: { type: string; image_url?: { url: string } }[] }[];
  };
  const image = body.messages[0]?.content.find((entry) => entry.type === 'image_url')?.image_url?.url;
  if (!image?.startsWith('data:image/webp;base64,')) {
    response.writeHead(400).end();
    return;
  }
  calls++;
  const content = JSON.stringify(
    unreadable
      ? { amountMinor: null, date: null }
      : {
          merchant: 'Apotek K-24',
          description: 'Obat',
          amountMinor: '96500',
          currency: 'IDR',
          date: '2026-10-15',
          time: '15:20',
          accountId,
          categoryId,
          uncertain: ['account'],
          items: [{ name: 'Plester luka', quantity: '1', amountMinor: null, uncertain: true }],
        },
  );
  response.setHeader('Content-Type', 'application/json');
  response.end(
    JSON.stringify({
      choices: [{ message: { content }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1000, completion_tokens: 200, cost: '0.009' },
    }),
  );
}
const provider = createServer((request, response) => {
  void handleProvider(request, response).catch(() => {
    response.writeHead(500).end();
  });
});
function url(role: keyof typeof PASSWORDS) {
  const value = new URL(pg.getConnectionUri());
  value.username = `wf_${role}`;
  value.password = PASSWORDS[role] ?? '';
  return value.href;
}
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'wf-receipt-integration-'));
  const source = fileURLToPath(new URL('../../../deploy/dev/seaweedfs/', import.meta.url));
  [pg, valkey, seaweed] = await Promise.all([
    new PostgreSqlContainer('postgres:18.6').start(),
    new ValkeyContainer('valkey/valkey:9.2').withPassword(randomUUID()).start(),
    new GenericContainer('chrislusf/seaweedfs:4.48')
      .withEntrypoint(['/bin/sh', '/init/start.sh'])
      .withCopyFilesToContainer([
        { source: `${source}start.sh`, target: '/init/start.sh' },
        { source: `${source}s3.json`, target: '/etc/seaweedfs/s3.json' },
      ])
      .withExposedPorts(8333)
      .withWaitStrategy(Wait.forSuccessfulCommand('test -f /tmp/wf-buckets-ready'))
      .withStartupTimeout(120000)
      .start(),
  ]);
  root = postgres(pg.getConnectionUri(), { max: 2, onnotice: () => undefined });
  await bootstrapRoles(pg.getConnectionUri(), PASSWORDS);
  await migrate(url('migrate'));
  app = createDb(url('app'));
  workerSql = createDb(url('worker'));
  const kekFile = join(directory, 'kek');
  await createKeyFile(kekFile);
  const keyring = await loadKeyring(kekFile);
  const getDek = createUserKeys(app, keyring).getOrCreateDek;
  const [row] = await root<
    { id: string }[]
  >`INSERT INTO users (name,email,two_factor_enabled) VALUES ('Receipt fixture','receipt-integration@example.test',true) RETURNING id`;
  userId = row?.id ?? '';
  await seedLedger(app, userId, { getDek, now: () => now });
  accountId =
    (await root<{ id: string }[]>`SELECT id FROM accounts WHERE user_id=${userId} AND display_name='BCA Tahapan'`)[0]
      ?.id ?? '';
  categoryId =
    (await root<{ id: string }[]>`SELECT id FROM categories WHERE user_id=${userId} AND name='system:health'`)[0]?.id ??
    '';
  const identities = JSON.parse(await readFile(`${source}s3.json`, 'utf8')) as {
    identities: { credentials: { accessKey: string; secretKey: string }[] }[];
  };
  const credentials = identities.identities[0]?.credentials[0];
  if (credentials === undefined) throw new Error('Missing S3 fixture credentials');
  const s3: Config['s3'] = {
    endpoint: `http://${seaweed.getHost()}:${String(seaweed.getMappedPort(8333))}`,
    region: 'us-east-1',
    accessKeyId: credentials.accessKey,
    secretAccessKey: credentials.secretKey,
    buckets: { attachments: 'wf-attachments', avatars: 'wf-avatars', reports: 'wf-reports', exports: 'wf-exports' },
  };
  store = createObjectStore({ s3, bucket: 'attachments', getDek });
  receipts = createReceipts(app, { getDek });
  provider.listen(0, '127.0.0.1');
  await once(provider, 'listening');
  const endpoint = `http://127.0.0.1:${String((provider.address() as AddressInfo).port)}/v1`;
  const ai = createAiRepository(app, { getDek, allowedBaseUrls: [endpoint], now: () => now });
  const settings = await ai.save(userId, {
    expectedRevision: null,
    provider: 'custom',
    baseUrl: endpoint,
    apiKey: `fixture-${randomUUID()}`,
    modelId: 'fixture/vision',
    allowReadFinancial: true,
    allowCreateDrafts: true,
    requireConfirmation: true,
    monthlyLimitUsd: '5',
    pricing: { inputUsdPerMillion: '1', outputUsdPerMillion: '2', requestUsd: '0', imageUsd: '0' },
  });
  revision = settings.revision ?? '';
  workerDb = openWorkerDb(url('worker'), keyring, { s3, aiAllowedBaseUrls: [endpoint] });
  redis = new Redis(valkey.getConnectionUrl(), { maxRetriesPerRequest: null });
  queue = new Queue('ocr', { connection: redis, prefix: QUEUE_PREFIX });
  events = new QueueEvents('ocr', { connection: redis, prefix: QUEUE_PREFIX });
  await events.waitUntilReady();
  const process = createOcrProcessor(
    fakeDeps({
      db: workerDb.db,
      receipt: { client: createAiClient({ allowedBaseUrls: [endpoint] }), objects: workerDb.receiptObjects },
    }),
  );
  worker = new Worker('ocr', async (job) => process({ id: job.id, data: job.data, attemptsMade: job.attemptsMade }), {
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
  await Promise.all([pg.stop(), valkey.stop(), seaweed.stop()]);
  await rm(directory, { recursive: true, force: true });
});
async function upload() {
  const id = randomUUID();
  const prepared = await prepareReceipt(
    await readFile(fileURLToPath(new URL('../../../images/attachments/receipt-shopee.jpg', import.meta.url))),
    'image/jpeg',
  );
  const object = { ...(await store.put(userId, prepared.bytes, prepared.mime)), mime: prepared.mime };
  await receipts.stage(userId, {
    id,
    revision,
    provider: 'custom',
    payload: {
      name: 'receipt-fixture.jpg',
      original: object,
      pages: [object],
      timeZone: 'Asia/Jakarta',
      evidence: null,
    },
  });
  const enqueue = createEnqueue(() => queue);
  await enqueue('ocr', { userId, receiptId: id }, { jobId: jobIds.ocr(userId, id) });
  const job = await queue.getJob(jobIds.ocr(userId, id));
  if (job === undefined) throw new Error('Receipt job missing');
  await job.waitUntilFinished(events, 30000);
  return { id, object, enqueue };
}
describe('receipt OCR on real Postgres, SeaweedFS and Valkey', () => {
  it('queues vision, confirms once with encrypted evidence, attaches duplicates without ledger growth, and supports manual failure recovery', async () => {
    const count = async () =>
      Number((await root<{ n: number }[]>`SELECT count(*)::int AS n FROM transactions WHERE user_id=${userId}`)[0]?.n);
    const before = await count();
    const first = await upload();
    const view = await receipts.get(userId, first.id);
    expect(view.status).toBe('ready');
    expect(await count()).toBe(before);
    const getDek = createUserKeys(app, await loadKeyring(join(directory, 'kek'))).getOrCreateDek;
    const review = createReview(app, { getDek, now: () => now });
    const saved = await review.confirm(userId, view.reviewItemId as string);
    await review.confirm(userId, view.reviewItemId as string);
    expect(await count()).toBe(before + 1);
    const [attachment] = await root<
      { name_enc: Buffer; ocr_enc: Buffer }[]
    >`SELECT name_enc,ocr_enc FROM attachments WHERE transaction_id=${saved.transactionId as string}`;
    expect(attachment?.name_enc.toString()).not.toContain('receipt-fixture');
    expect(attachment?.ocr_enc.toString()).not.toContain('Apotek');
    expect((await store.get(userId, first.object.key, first.object.sha256)).mime).toBe('image/webp');
    const second = await upload();
    const duplicate = await receipts.get(userId, second.id);
    expect(duplicate.duplicates.map((entry) => entry.id)).toContain(saved.transactionId);
    await review.confirm(userId, duplicate.reviewItemId as string, {
      receiptDuplicateId: saved.transactionId as string,
    });
    expect(await count()).toBe(before + 1);
    await first.enqueue('ocr', { userId, receiptId: first.id }, { jobId: jobIds.ocr(userId, first.id) });
    expect(calls).toBe(2);
    unreadable = true;
    const failed = await upload();
    expect((await receipts.get(userId, failed.id)).status).toBe('failed');
    expect(await count()).toBe(before + 1);
    const manual = await receipts.manual(userId, failed.id, {
      type: 'expense',
      accountId,
      amountMinor: 42000n,
      categoryId,
      occurredAt: now,
      description: 'Manual',
    });
    await review.confirm(userId, manual);
    expect(await count()).toBe(before + 2);
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
  });
});
