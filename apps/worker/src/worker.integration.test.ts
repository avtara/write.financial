// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The worker as a real process (`node src/main.ts`) against PostgreSQL 18.6 and Valkey 9.2 (Testcontainers), with
 * the roles bootstrapped and the migrations applied: scheduler registration with two processes, the maintenance job,
 * retry with backoff, graceful shutdown with a job in progress, and the Docker healthcheck.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { ValkeyContainer, type StartedValkeyContainer } from '@testcontainers/valkey';
import { migrate } from '@wf/db/migrate';
import { bootstrapRoles, ROLES, type RoleName } from '@wf/db/roles';
import { parseLocalDate } from '@wf/domain/period';
import { createEnqueue } from '@wf/jobs/enqueue';
import { DEFAULT_JOB_OPTIONS, jobIds, QUEUE_PREFIX } from '@wf/jobs/queues';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import postgres from 'postgres';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const MAIN = fileURLToPath(new URL('main.ts', import.meta.url));

/** Built at runtime so no fixture looks like a committed secret. */
const password = (role: string) => `${role}-${randomBytes(6).toString('hex')}`;
const PASSWORDS = {
  app: password('app'),
  worker: password('worker'),
  migrate: password('migrate'),
  auth: password('auth'),
  readonlyOps: null,
};

let pg: StartedPostgreSqlContainer;
let valkey: StartedValkeyContainer;
let superuser: postgres.Sql;
let redis: Redis;
let queue: Queue;
let env: Record<string, string>;
let admin: string;

function urlAs(role: RoleName, rolePassword: string): string {
  const url = new URL(pg.getConnectionUri());
  url.username = role;
  url.password = rolePassword;
  return url.href;
}

beforeAll(async () => {
  [pg, valkey] = await Promise.all([
    new PostgreSqlContainer('postgres:18.6').start(),
    new ValkeyContainer('valkey/valkey:9.2').withPassword(password('valkey')).start(),
  ]);
  superuser = postgres(pg.getConnectionUri(), { max: 2, onnotice: () => undefined });
  await bootstrapRoles(pg.getConnectionUri(), PASSWORDS);
  await migrate(urlAs(ROLES.migrate, PASSWORDS.migrate));
  const [row] = await superuser<{ id: string }[]>`
    INSERT INTO users (name, email, role) VALUES ('Admin', 'admin@example.test', 'admin') RETURNING id`;
  admin = row?.id ?? '';

  redis = new Redis(valkey.getConnectionUrl(), { maxRetriesPerRequest: null });
  // As in deploy/dev: BullMQ needs keys never to be evicted.
  await redis.config('SET', 'maxmemory-policy', 'noeviction');
  queue = new Queue('maintenance', { connection: redis, prefix: QUEUE_PREFIX });

  env = {
    PATH: process.env['PATH'] ?? '',
    NODE_ENV: 'test',
    PUBLIC_URL: 'http://localhost:3000',
    DATABASE_URL: urlAs(ROLES.app, PASSWORDS.app),
    DATABASE_URL_WORKER: urlAs(ROLES.worker, PASSWORDS.worker),
    DATABASE_URL_AUTH: urlAs(ROLES.auth, PASSWORDS.auth),
    REDIS_URL: valkey.getConnectionUrl(),
    S3_ENDPOINT: 'http://127.0.0.1:8333',
    S3_ACCESS_KEY_ID: 'unused',
    S3_SECRET_ACCESS_KEY: password('s3'),
    KEK_FILE: '/nonexistent/kek',
    AUTH_SECRET: password('auth-secret').padEnd(40, 'x'),
    LOG_LEVEL: 'info',
  };
});

afterAll(async () => {
  await queue.close();
  redis.disconnect();
  await superuser.end();
  await Promise.all([pg.stop(), valkey.stop()]);
});

interface WorkerProcess {
  readonly child: ChildProcess;
  /** Parsed pino lines so far. */
  readonly logs: Record<string, unknown>[];
  readonly exited: Promise<number | null>;
  waitForLog(msg: string, match?: Record<string, unknown>): Promise<Record<string, unknown>>;
}

const running = new Set<WorkerProcess>();

// A failed test must not leave a worker behind: it would keep beating and consuming jobs in the next tests.
afterEach(async () => {
  for (const worker of running) worker.child.kill('SIGKILL');
  await Promise.all([...running].map((worker) => worker.exited));
});

function startWorkerProcess(args: string[] = []): WorkerProcess {
  const child = spawn(process.execPath, [MAIN, ...args], { env, stdio: ['ignore', 'pipe', 'inherit'] });
  const logs: Record<string, unknown>[] = [];
  let buffer = '';
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) if (line !== '') logs.push(JSON.parse(line) as Record<string, unknown>);
  });
  const exited = once(child, 'exit').then(([code]) => code as number | null);
  const worker: WorkerProcess = {
    child,
    logs,
    exited,
    waitForLog: async (msg, match = {}) => {
      let found: Record<string, unknown> | undefined;
      await vi.waitFor(
        () => {
          found = logs.find((line) => line['msg'] === msg && Object.entries(match).every(([k, v]) => line[k] === v));
          expect(found, `log "${msg}"`).toBeDefined();
        },
        { timeout: 20_000, interval: 50 },
      );
      return found ?? {};
    },
  };
  running.add(worker);
  void exited.then(() => running.delete(worker));
  return worker;
}

async function healthcheck(): Promise<number | null> {
  return startWorkerProcess(['--healthcheck']).exited;
}

async function stopGracefully(worker: WorkerProcess): Promise<void> {
  worker.child.kill('SIGTERM');
  expect(await worker.exited).toBe(0);
  expect(worker.logs.map((line) => line['msg'])).toContain('worker stopped');
}

async function finishedJob(id: string): Promise<{ returnvalue: unknown; attemptsMade: number }> {
  let result: { returnvalue: unknown; attemptsMade: number } | undefined;
  await vi.waitFor(
    async () => {
      const job = await queue.getJob(id);
      expect(job?.finishedOn, `job ${id} finished`).toBeDefined();
      result = { returnvalue: job?.returnvalue, attemptsMade: job?.attemptsMade ?? 0 };
    },
    { timeout: 20_000, interval: 100 },
  );
  return result ?? { returnvalue: undefined, attemptsMade: 0 };
}

const enqueue = createEnqueue(() => queue);

describe('worker process', () => {
  it('registers the maintenance scheduler once even when two workers start together', async () => {
    const workers = [startWorkerProcess(), startWorkerProcess()];
    for (const worker of workers) {
      const registered = await worker.waitForLog('job scheduler registered');
      expect(registered).toMatchObject({ scheduler: 'maintenance-daily', pattern: '30 3 * * *', tz: 'Asia/Jakarta' });
      // 03:30 in Jakarta (UTC+7) is 20:30 UTC.
      expect(String(registered['nextRunAt'])).toMatch(/T20:30:00\.000Z$/);
      await worker.waitForLog('worker started');
    }

    const schedulers = await queue.getJobSchedulers();
    expect(schedulers).toEqual([
      expect.objectContaining({ key: 'maintenance-daily', pattern: '30 3 * * *', tz: 'Asia/Jakarta' }),
    ]);
    const delayed = await queue.getDelayed();
    expect(delayed).toHaveLength(1);
    expect(delayed[0]?.opts).toMatchObject({ attempts: 5, backoff: { type: 'exponential', delay: 30_000 } });

    await Promise.all(workers.map(stopGracefully));
    // A stopped worker deletes its heartbeat, so the healthcheck fails at once.
    expect(await healthcheck()).toBe(1);
  });

  it('runs the maintenance job: deletes only expired rows, deduplicates by job id, and is idempotent', async () => {
    await superuser`INSERT INTO verifications (identifier, value, expires_at) VALUES
      ('v-expired', 'x', now() - interval '1 minute'), ('v-live', 'x', now() + interval '1 hour')`;
    await superuser`INSERT INTO sessions (token, user_id, expires_at) VALUES
      (${password('s-expired')}, ${admin}, now() - interval '1 minute'),
      ('s-live', ${admin}, now() + interval '1 day')`;
    const invitation = (email: string, expiresAt: string, usedAt: string | null) =>
      superuser`INSERT INTO invitations (email, token_hash, invited_by, expires_at, used_at)
        VALUES (${email}, ${randomBytes(32).toString('hex')}, ${admin}, now() + ${expiresAt}::interval,
                now() + ${usedAt}::interval)`;
    await invitation('expired-31d@example.test', '-31 days', null);
    await invitation('expired-1d@example.test', '-1 day', null);
    await invitation('used-31d@example.test', '-20 days', '-31 days');
    await invitation('open@example.test', '7 days', null);

    const worker = startWorkerProcess();
    await worker.waitForLog('worker started');
    const first = jobIds.maintenance(parseLocalDate('2026-10-18'));
    await enqueue('maintenance', {}, { jobId: first });
    expect((await finishedJob(first)).returnvalue).toEqual({
      purged: { verifications: 1, sessions: 1, invitations: 2 },
    });
    expect(await superuser`SELECT identifier FROM verifications`).toEqual([{ identifier: 'v-live' }]);
    expect(await superuser`SELECT token FROM sessions`).toEqual([{ token: 's-live' }]);
    expect(await superuser`SELECT email FROM invitations ORDER BY email`).toEqual([
      { email: 'expired-1d@example.test' },
      { email: 'open@example.test' },
    ]);

    // Same id: the completed job is kept, so nothing runs again.
    await enqueue('maintenance', {}, { jobId: first });
    const second = jobIds.maintenance(parseLocalDate('2026-10-19'));
    await enqueue('maintenance', {}, { jobId: second });
    expect((await finishedJob(second)).returnvalue).toEqual({
      purged: { verifications: 0, sessions: 0, invitations: 0 },
    });
    expect(worker.logs.filter((line) => line['msg'] === 'job started' && line['jobId'] === first)).toHaveLength(1);

    await stopGracefully(worker);
  });

  it('retries a failing job with exponential backoff until it succeeds', async () => {
    const worker = startWorkerProcess();
    await worker.waitForLog('worker started');
    await superuser`REVOKE EXECUTE ON FUNCTION wf_maintenance_purge_auth(timestamptz) FROM wf_worker`;
    try {
      // The default 30 s backoff, shortened so the test does not wait minutes.
      await queue.add(
        'maintenance',
        {},
        { ...DEFAULT_JOB_OPTIONS, backoff: { type: 'exponential', delay: 400 }, jobId: 'mt.retry' },
      );
      await worker.waitForLog('job failed', { jobId: 'mt.retry', attempt: 2 });
    } finally {
      await superuser`GRANT EXECUTE ON FUNCTION wf_maintenance_purge_auth(timestamptz) TO wf_worker`;
    }
    const { returnvalue, attemptsMade } = await finishedJob('mt.retry');
    expect(returnvalue).toEqual({ purged: { verifications: 0, sessions: 0, invitations: 0 } });
    expect(attemptsMade).toBeGreaterThanOrEqual(3);

    const failures = worker.logs.filter((line) => line['msg'] === 'job failed' && line['jobId'] === 'mt.retry');
    expect(failures[0]).toMatchObject({
      attempt: 1,
      err: { message: expect.stringMatching(/permission denied/) as unknown },
    });
    const [first = 0, second = 0, third = 0] = worker.logs
      .filter((line) => line['msg'] === 'job started' && line['jobId'] === 'mt.retry')
      .map((line) => Number(line['time']));
    // Exponential: 400 ms before the 2nd attempt, 800 ms before the 3rd.
    expect(second - first).toBeGreaterThanOrEqual(400);
    expect(third - second).toBeGreaterThanOrEqual(800);

    await stopGracefully(worker);
  });

  it('finishes the job in progress before exiting on SIGTERM', async () => {
    await superuser`INSERT INTO verifications (identifier, value, expires_at) VALUES ('v-old', 'x', now() - interval '1 day')`;
    const worker = startWorkerProcess();
    await worker.waitForLog('worker started');

    const release = Promise.withResolvers<undefined>();
    const locked = Promise.withResolvers<undefined>();
    // Holding the table lock blocks the purge inside the job until the lock is released.
    const holder = superuser.begin(async (tx) => {
      await tx`LOCK TABLE verifications IN ACCESS EXCLUSIVE MODE`;
      locked.resolve(undefined);
      await release.promise;
    });
    await locked.promise;
    const id = jobIds.maintenance(parseLocalDate('2026-10-20'));
    await enqueue('maintenance', {}, { jobId: id });
    await worker.waitForLog('job started', { jobId: id });

    worker.child.kill('SIGTERM');
    await worker.waitForLog('shutting down');
    // A real child process: the only observable is that it is still alive a while after the signal (an absence of
    // an event), so this waits on the wall clock.
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    expect(worker.child.exitCode).toBeNull();
    expect(await (await queue.getJob(id))?.getState()).toBe('active');

    release.resolve(undefined);
    await holder;
    expect(await worker.exited).toBe(0);
    expect((await finishedJob(id)).returnvalue).toEqual({ purged: { verifications: 1, sessions: 0, invitations: 0 } });
    const messages = worker.logs.map((line) => line['msg']);
    expect(messages.indexOf('job completed')).toBeLessThan(messages.indexOf('worker stopped'));
  });

  it('is healthy while the worker beats and unhealthy once the heartbeat stops', async () => {
    const worker = startWorkerProcess();
    await worker.waitForLog('worker started');
    expect(await healthcheck()).toBe(0);

    // SIGKILL: no shutdown, so the last heartbeat stays in Redis and goes stale.
    worker.child.kill('SIGKILL');
    await worker.exited;
    const killedAt = Date.now();
    expect(await healthcheck()).toBe(0);
    await vi.waitFor(
      async () => {
        expect(await healthcheck()).toBe(1);
      },
      { timeout: 40_000, interval: 1_000 },
    );
    // Max age 20 s, beats every 5 s: unhealthy 15–20 s after the last beat before the kill.
    expect(Date.now() - killedAt).toBeGreaterThanOrEqual(14_000);
  }, 60_000);
});
