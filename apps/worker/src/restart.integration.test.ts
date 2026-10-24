// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The M3 exit path and restart safety against PostgreSQL 18.6 (Testcontainers) with the roles bootstrapped and the
 * migrations applied: the app (`wf_app`) creates a Netflix subscription (18 Okt, H-1, Asia/Jakarta); the worker's
 * real processors (`dispatch`, `occurrences`, `reminders`, `notify`, `period-close`) run on `WorkerDb` as `wf_worker`
 * under a fake clock, a fake BullMQ (job ids deduplicated like BullMQ's kept completed jobs) and a fake mailer. The
 * reminder comes at 09.00 WIB on the 17th exactly once, the bill reaches the Review queue on the 18th, and the balance
 * changes only with `confirmReview`. After a restart (new pool, lost job ids, every completed job retried) there is
 * still exactly one reminder, one email, one review item, and no duplicate occurrence. September's close proposes
 * "pindah sisa Rp1.150.000 ke Dana Darurat", which changes nothing until it is confirmed (D14).
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { parseKeyring } from '@wf/crypto/keyring';
import { createAccounts } from '@wf/db/accounts';
import { createBudgets } from '@wf/db/budgets';
import { createCategories } from '@wf/db/categories';
import { createDb, type Database } from '@wf/db/db';
import { migrate } from '@wf/db/migrate';
import { bootstrapRoles, ROLES, type RoleName } from '@wf/db/roles';
import { createPeriods } from '@wf/db/periods';
import { createReview } from '@wf/db/review';
import { createSchedules } from '@wf/db/schedules';
import { seedLedger } from '@wf/db/seed';
import { createTransactions } from '@wf/db/transactions';
import { createUserKeys } from '@wf/db/user-keys';
import { parseLocalDate } from '@wf/domain/period';
import { DESIGN_SEED } from '@wf/domain/seed';
import type { JobQueue } from '@wf/jobs/queues';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fakeAdapters, fakeMailer, fakePurgePort, type FakeMailer } from '../test/fakes.ts';
import { PROCESSORS, type ProcessorDeps } from './processors.ts';
import { FAKE_S3 } from '../test/fakes.ts';
import { openWorkerDb, type WorkerDbConnection } from './worker-db.ts';

const password = (role: string) => `${role}-${randomBytes(6).toString('hex')}`;
const PASSWORDS = {
  app: password('app'),
  worker: password('worker'),
  migrate: password('migrate'),
  auth: password('auth'),
  readonlyOps: null,
};
const keyring = parseKeyring(`v1:${randomBytes(32).toString('base64')}\n`);

/** The queues of the reminder chain; the dispatch's other daily jobs are not part of this test. */
const CHAIN: readonly JobQueue[] = ['dispatch', 'occurrences', 'reminders', 'notify'];

let pg: StartedPostgreSqlContainer;
let superuser: postgres.Sql;
let app: Database;
let userId: string;
let netflixId: string;

function urlAs(role: RoleName, rolePassword: string): string {
  const url = new URL(pg.getConnectionUri());
  url.username = role;
  url.password = rolePassword;
  return url.href;
}

interface Job {
  readonly queue: JobQueue;
  readonly id: string;
  readonly data: object;
}

/** One worker process: its pool, mailer, and the jobs it ran. The broker (`jobs`) outlives it, as Redis does. */
interface WorkerProcess {
  readonly connection: WorkerDbConnection;
  readonly mailer: FakeMailer;
  /** Runs the dispatch at `at` and every chain job it leads to, until nothing new is enqueued. */
  tick(at: Date): Promise<void>;
  /** Runs `jobs` again under their ids (a BullMQ retry, or a stalled job picked up after the restart). */
  retry(jobs: readonly Job[], at: Date): Promise<void>;
}

/**
 * A fake BullMQ: `enqueue` adds a job only if its id is new to the broker, like BullMQ with completed jobs kept for
 * a week. `forget()` drops every id (a flushed Redis), so the next dispatch enqueues everything again.
 */
function fakeBroker() {
  const known = new Set<string>();
  const waiting: Job[] = [];
  const completed: Job[] = [];
  return {
    completed,
    waiting,
    forget: () => {
      known.clear();
    },
    add: (job: Job) => {
      if (known.has(job.id)) return;
      known.add(job.id);
      waiting.push(job);
    },
  };
}

const broker = fakeBroker();

function startWorker(): WorkerProcess {
  const connection = openWorkerDb(urlAs(ROLES.worker, PASSWORDS.worker), keyring, { s3: FAKE_S3 });
  const mailer = fakeMailer();
  let clock = new Date(0);
  const deps: ProcessorDeps = {
    db: connection.db,
    now: () => clock,
    mailer,
    publicUrl: 'https://uang.example/',
    render: async () => Promise.resolve(new Uint8Array()),
    objects: { attachments: fakePurgePort(), avatars: fakePurgePort() },
    market: { adapters: fakeAdapters(), cmcApiKey: null },
    enqueue: async (queue, payload, { jobId }) => {
      if (CHAIN.includes(queue)) broker.add({ queue, id: jobId, data: payload });
      return Promise.resolve();
    },
  };
  const run = async (job: Job) => PROCESSORS[job.queue].create(deps)({ id: job.id, data: job.data, attemptsMade: 0 });
  return {
    connection,
    mailer,
    tick: async (at) => {
      clock = at;
      await run({ queue: 'dispatch', id: `dsp.${at.toISOString()}`, data: {} });
      // A second dispatch a minute later picks up the outbox rows the reminders wrote.
      for (let round = 0; round < 3; round += 1) {
        while (broker.waiting.length > 0) {
          const job = broker.waiting.shift() as Job;
          await run(job);
          broker.completed.push(job);
        }
        await run({ queue: 'dispatch', id: `dsp.${at.toISOString()}.${round}`, data: {} });
      }
    },
    retry: async (jobs, at) => {
      clock = at;
      for (const job of jobs) await run(job);
    },
  };
}

const count = async (query: string) => {
  const [row] = await superuser.unsafe<{ n: number }[]>(query);
  return row?.n;
};

/** What must exist exactly once, and the ledger rows the worker must never touch. */
async function state() {
  return {
    reminders: await count(`SELECT count(*)::int AS n FROM notifications WHERE type = 'bill_reminder'`),
    reviewDue: await count(`SELECT count(*)::int AS n FROM notifications WHERE type = 'review_due'`),
    outbox: await count('SELECT count(*)::int AS n FROM notification_outbox'),
    unsent: await count('SELECT count(*)::int AS n FROM notification_outbox WHERE sent_at IS NULL'),
    reviewItems: await count('SELECT count(*)::int AS n FROM review_items'),
    occurrences: await count('SELECT count(*)::int AS n FROM scheduled_occurrences'),
    duplicateOccurrences: await count(
      `SELECT count(*)::int AS n FROM (SELECT 1 FROM scheduled_occurrences
         GROUP BY source_type, source_id, due_date HAVING count(*) > 1) d`,
    ),
    transactions: await count('SELECT count(*)::int AS n FROM transactions'),
    postings: await count('SELECT count(*)::int AS n FROM postings'),
  };
}

const wib = (date: string, time: string) => new Date(`${date}T${time}:00+07:00`);

beforeAll(async () => {
  pg = await new PostgreSqlContainer('postgres:18.6').start();
  superuser = postgres(pg.getConnectionUri(), { max: 2, onnotice: () => undefined });
  await bootstrapRoles(pg.getConnectionUri(), PASSWORDS);
  await migrate(urlAs(ROLES.migrate, PASSWORDS.migrate));
  const [user] = await superuser<{ id: string }[]>`
    INSERT INTO users (name, email) VALUES ('Ayu', 'ayu@example.test') RETURNING id`;
  userId = user?.id as string;
  const [account] = await superuser<{ id: string }[]>`
    INSERT INTO accounts (user_id, type, provider_name, display_name, currency, opening_balance_minor, opening_date, color)
    VALUES (${userId}, 'bank', 'BCA', 'BCA', 'IDR', 100000000, '2026-01-01', 'blue') RETURNING id`;
  const bca = account?.id as string;

  app = createDb(urlAs(ROLES.app, PASSWORDS.app), { max: 1 });
  const { getOrCreateDek: getDek } = createUserKeys(app, keyring);
  const categories = await createCategories(app, { getDek }).list(userId);
  const subscriptionsCategory = categories.find((row) => row.builtInKey === 'system:subscriptions')?.id as string;
  const created = new Date('2026-10-15T03:00:00Z');
  await createTransactions(app, { getDek, now: () => created }).create(userId, {
    type: 'expense',
    clientId: randomUUID(),
    occurredAt: wib('2026-10-14', '12:00'),
    accountId: bca,
    amountMinor: 186_000n,
    categoryId: subscriptionsCategory,
    merchant: 'Netflix',
  });
  const netflix = await createSchedules(app, { now: () => created }).createSubscription(userId, {
    name: 'Netflix',
    plan: 'Premium',
    priceMinor: 186_000n,
    currency: 'IDR',
    cycle: 'monthly',
    nextBillingDate: parseLocalDate('2026-10-18'),
    payFromAccountId: bca,
    categoryId: subscriptionsCategory,
    remindDaysBefore: 1,
    startedOn: parseLocalDate('2025-01-18'),
  });
  netflixId = netflix.id;
});

afterAll(async () => {
  await app.$client.end();
  await superuser.end();
  await pg.stop();
});

describe('restart safety (reminder → email → review)', () => {
  it('creates one reminder, one email, and one review item however often the worker restarts or retries', async () => {
    const ledger = await state();
    expect(ledger.transactions).toBe(1);
    expect(ledger.postings).toBeGreaterThan(0);
    const [remindAt] = await superuser<{ remind_at: Date }[]>`
      SELECT remind_at FROM scheduled_occurrences WHERE source_id = ${netflixId} AND due_date = '2026-10-18'`;
    expect(remindAt?.remind_at).toEqual(wib('2026-10-17', '09:00'));

    const first = startWorker();
    await first.tick(wib('2026-10-17', '08:59'));
    expect(await state()).toMatchObject({ reminders: 0, outbox: 0, reviewItems: 0 });
    expect(first.mailer.sent).toHaveLength(0);

    await first.tick(wib('2026-10-17', '09:00'));
    expect(await state()).toMatchObject({ reminders: 1, outbox: 1, unsent: 0, reviewItems: 0 });
    expect(first.mailer.sent).toHaveLength(1);
    expect(first.mailer.sent[0]).toMatchObject({
      to: 'ayu@example.test',
      template: {
        kind: 'bill_reminder',
        name: 'Netflix',
        dueDate: '2026-10-18',
        amount: { amountMinor: 186_000n, currency: 'IDR' },
        url: 'https://uang.example/subscriptions',
      },
    });

    await first.tick(wib('2026-10-18', '00:05'));
    const settled = await state();
    expect(settled).toMatchObject({
      reminders: 1,
      reviewDue: 1,
      outbox: 1,
      reviewItems: 1,
      duplicateOccurrences: 0,
      transactions: ledger.transactions,
      postings: ledger.postings,
    });
    const ran = [...broker.completed];
    expect(new Set(ran.map((job) => job.queue))).toEqual(new Set(['occurrences', 'reminders', 'notify']));

    // Restart: a new process with a new pool and mailer; every job it ran before is retried under the same id, then
    // the dispatch runs again at both times, once with the broker's ids kept and once after they were lost.
    await first.connection.close();
    const second = startWorker();
    await second.retry(ran, wib('2026-10-18', '00:06'));
    await second.tick(wib('2026-10-17', '09:00'));
    await second.tick(wib('2026-10-18', '00:05'));
    broker.forget();
    await second.tick(wib('2026-10-17', '09:00'));
    await second.tick(wib('2026-10-18', '00:05'));
    await second.retry(ran, wib('2026-10-18', '00:07'));

    expect(second.mailer.sent).toHaveLength(0);
    expect(first.mailer.sent).toHaveLength(1);
    expect(await state()).toEqual(settled);
    const [occurrence] = await superuser<{ status: string; reminded_at: Date }[]>`
      SELECT status::text, reminded_at FROM scheduled_occurrences WHERE source_id = ${netflixId} AND due_date = '2026-10-18'`;
    expect(occurrence).toEqual({ status: 'due_review', reminded_at: wib('2026-10-17', '09:00') });
    await second.connection.close();

    // "Sudah dibayar": only now does BCA pay Netflix (one more transaction, −Rp186.000).
    const accounts = createAccounts(app);
    const balance = async () => (await accounts.list(userId)).accounts[0]?.balanceMinor;
    const before = await balance();
    const review = createReview(app, { getDek: createUserKeys(app, keyring).getOrCreateDek });
    const { items } = await review.list(userId);
    expect(items).toHaveLength(1);
    const result = await review.confirm(userId, items[0]?.id as string);
    expect(result.transactionId).not.toBeNull();
    expect(await balance()).toBe((before as bigint) - 186_000n);
    expect(await count('SELECT count(*)::int AS n FROM transactions')).toBe((ledger.transactions as number) + 1);
    const [confirmed] = await superuser<{ status: string }[]>`
      SELECT status::text FROM scheduled_occurrences WHERE source_id = ${netflixId} AND due_date = '2026-10-18'`;
    expect(confirmed?.status).toBe('confirmed');
  });

  it('proposes moving September’s Rp1.150.000 leftover to Dana Darurat; nothing changes until confirmed', async () => {
    const [user] = await superuser<{ id: string }[]>`
      INSERT INTO users (name, email) VALUES ('Avtara', 'avtara@example.test') RETURNING id`;
    const avtara = user?.id as string;
    const getDek = createUserKeys(app, keyring).getOrCreateDek;
    const seededAt = wib('2026-09-30', '20:00');
    // September is still open: the worker closes it.
    await seedLedger(app, avtara, { getDek, now: () => seededAt, seed: { ...DESIGN_SEED, closedPeriods: [] } });
    // The app was used during September, so its period row exists (the worker only closes existing rows).
    await createPeriods(app, { now: () => seededAt }).list(avtara);
    const ledgerRows = async () => ({
      transactions: await count(`SELECT count(*)::int AS n FROM transactions WHERE user_id = '${avtara}'`),
      overrides: await count(`SELECT count(*)::int AS n FROM budget_period_overrides WHERE user_id = '${avtara}'`),
    });
    const before = await ledgerRows();
    const accounts = createAccounts(app);
    const available = async () => (await accounts.list(avtara)).availableMinor;
    const availableBefore = await available();

    const worker = openWorkerDb(urlAs(ROLES.worker, PASSWORDS.worker), keyring, { s3: FAKE_S3 });
    const closeAt = wib('2026-10-01', '00:05');
    const deps: ProcessorDeps = {
      db: worker.db,
      now: () => closeAt,
      mailer: fakeMailer(),
      publicUrl: 'https://uang.example/',
      market: { adapters: fakeAdapters(), cmcApiKey: null },
      render: async () => Promise.resolve(new Uint8Array()),
      objects: { attachments: fakePurgePort(), avatars: fakePurgePort() },
      enqueue: () => Promise.resolve(),
    };
    const close = PROCESSORS['period-close'].create(deps);
    await close({ id: 'close.a', data: { userId: avtara }, attemptsMade: 0 });
    // A retry and a restarted worker propose nothing new.
    await close({ id: 'close.a', data: { userId: avtara }, attemptsMade: 1 });
    await worker.close();

    const [september] = await superuser<{ status: string }[]>`
      SELECT status::text FROM periods WHERE user_id = ${avtara} AND label = '2026-09'`;
    expect(september?.status).toBe('closed');
    const review = createReview(app, { getDek });
    const proposals = (await review.list(avtara, { reason: 'period_close_proposal' })).items;
    expect(proposals).toHaveLength(1);
    const [leftover] = proposals;
    expect(leftover?.payload).toMatchObject({ kind: 'leftover', amountMinor: 1_150_000n });
    expect(leftover?.label).toContain('Dana Darurat');
    expect(await ledgerRows()).toEqual(before);
    expect(await available()).toBe(availableBefore);
    const october = await createBudgets(app, { now: () => wib('2026-10-01', '09:00') }).status(avtara);
    expect(october.period.label).toBe('2026-10');

    // "Terapkan": the move is recorded only now (a transfer tagged with the goal, source period_close).
    await review.confirm(avtara, leftover?.id as string);
    expect(await ledgerRows()).toEqual({ ...before, transactions: (before.transactions as number) + 1 });
    const [moved] = await superuser<{ source: string }[]>`
      SELECT source::text FROM transactions WHERE user_id = ${avtara} ORDER BY created_at DESC LIMIT 1`;
    expect(moved?.source).toBe('period_close');
  });
});
