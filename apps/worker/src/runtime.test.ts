// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JOBS } from '@wf/jobs/queues';
import { captureLog, fakeBroker, fakeDb, fakeMailer, type FakeBroker, type LogCapture } from '../test/fakes.ts';
import { heartbeatKey } from './heartbeat.ts';
import { createLogger } from './logger.ts';
import { startWorker, type Runtime } from './runtime.ts';
import type { WorkerDb } from './worker-db.ts';

const NOW = Date.parse('2026-10-18T20:30:00Z');
const KEY = heartbeatKey('host-1');

let broker: FakeBroker;
let log: LogCapture;

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
  broker = fakeBroker();
  log = captureLog();
});

afterEach(() => {
  vi.useRealTimers();
});

const start = (db: WorkerDb = fakeDb()): Promise<Runtime> =>
  startWorker({
    broker,
    db,
    mailer: fakeMailer(),
    publicUrl: 'https://uang.example/',
    logger: createLogger('info', log),
    now: Date.now,
    heartbeat: { key: KEY, intervalMs: 1_000, maxAgeMs: 4_000 },
  });

describe('startWorker', () => {
  it('registers the schedules, starts one worker per queue, and writes the heartbeat', async () => {
    const runtime = await start();
    expect([...broker.queues.keys()]).toEqual(Object.keys(JOBS));
    expect([...(broker.queues.get('maintenance')?.schedulers.keys() ?? [])]).toEqual(['maintenance-daily']);
    expect([...(broker.queues.get('fx')?.schedulers.keys() ?? [])]).toEqual(['fx-daily', 'fx-retry']);
    expect([...(broker.queues.get('dispatch')?.schedulers.keys() ?? [])]).toEqual(['dispatch-minute']);
    expect(broker.workers.get('maintenance')?.concurrency).toBe(1);
    expect(broker.workers.get('fx')?.concurrency).toBe(1);
    expect(broker.store.entries.get(KEY)?.value).toBe(String(NOW));
    expect(log.messages()).toEqual([...Array<string>(4).fill('job scheduler registered'), 'worker started']);
    expect(log.lines[4]).toMatchObject({ queues: Object.keys(JOBS) });
    await runtime.stop();
  });

  it('gives processors an enqueue over the runtime queues (the dispatch adds follow-up jobs)', async () => {
    const USER = '0199f5d2-7c4e-7a3b-8c1d-2e3f4a5b6c7d';
    const db = fakeDb();
    const runtime = await start({
      ...db,
      dispatch: { ...db.dispatch, users: () => Promise.resolve([{ userId: USER, timeZone: 'Asia/Jakarta' }]) },
    });
    // 03.30 WIB on 19 Oct: the jobs from 00.05 and 03.00 are due, keyed by the local date.
    await broker.workers.get('dispatch')?.run({ id: 'd1', data: {}, attemptsMade: 0 });
    expect([...(broker.queues.get('occurrences')?.jobs.keys() ?? [])]).toEqual([`occ.${USER}.2026-10-19`]);
    expect(broker.queues.get('occurrences')?.jobs.get(`occ.${USER}.2026-10-19`)).toEqual({
      name: 'occurrences',
      data: { userId: USER },
    });
    await runtime.stop();
  });

  it('runs jobs with the WorkerDb and the clock, and logs start and result with the job context', async () => {
    const db = fakeDb({ verifications: 1, sessions: 0, invitations: 0 });
    const runtime = await start(db);
    const result = await broker.workers.get('maintenance')?.run({ id: 'mt.2026-10-19', data: {}, attemptsMade: 2 });
    expect(result).toEqual({ purged: { verifications: 1, sessions: 0, invitations: 0 }, notifications: 5 });
    expect(db.purgeCalls).toEqual([new Date(NOW)]);
    const context = { queue: 'maintenance', jobId: 'mt.2026-10-19', attempt: 3 };
    expect(log.lines.slice(-2)).toEqual([
      expect.objectContaining({ ...context, msg: 'job started' }),
      expect.objectContaining({ ...context, msg: 'job completed', result }),
    ]);
    await runtime.stop();
  });

  it('logs a failed attempt and rethrows so BullMQ schedules the retry', async () => {
    const db = fakeDb();
    const runtime = await start({
      ...db,
      maintenance: { ...db.maintenance, purgeExpiredAuth: () => Promise.reject(new Error('permission denied')) },
    });
    await expect(broker.workers.get('maintenance')?.run({ id: 'j1', data: {}, attemptsMade: 0 })).rejects.toThrow(
      'permission denied',
    );
    expect(log.lines.at(-1)).toMatchObject({
      level: 50,
      msg: 'job failed',
      attempt: 1,
      err: { message: 'permission denied' },
    });
    await runtime.stop();
  });

  it('logs connection errors of queues and workers with their source', async () => {
    const runtime = await start();
    broker.queues.get('maintenance')?.onError(new Error('ECONNRESET'));
    broker.workers.get('maintenance')?.onError(new Error('ETIMEDOUT'));
    expect(log.lines.slice(-2)).toEqual([
      expect.objectContaining({
        msg: 'queue connection error',
        source: 'maintenance',
        err: expect.objectContaining({ message: 'ECONNRESET' }) as unknown,
      }),
      expect.objectContaining({
        msg: 'queue connection error',
        source: 'maintenance worker',
        err: expect.objectContaining({ message: 'ETIMEDOUT' }) as unknown,
      }),
    ]);
    await runtime.stop();
  });

  it('keeps beating on the interval and warns when a write fails', async () => {
    const runtime = await start();
    broker.store.failNextSet(new Error('OOM command not allowed'));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(log.lines.at(-1)).toMatchObject({ level: 40, msg: 'heartbeat write failed' });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(broker.store.entries.get(KEY)?.value).toBe(String(NOW + 2_000));
    await runtime.stop();
  });
});

describe('stop', () => {
  it('waits for the running job, then removes the heartbeat, then closes the queues', async () => {
    const purge = Promise.withResolvers<{ verifications: number; sessions: number; invitations: number }>();
    const db = fakeDb();
    const runtime = await start({ ...db, maintenance: { ...db.maintenance, purgeExpiredAuth: () => purge.promise } });
    const job = broker.workers.get('maintenance')?.run({ id: 'j1', data: {}, attemptsMade: 0 });
    const stopping = runtime.stop();
    await vi.advanceTimersByTimeAsync(10);
    const others = Object.keys(JOBS).filter((queue) => queue !== 'maintenance');
    // The idle workers close at once; the maintenance worker waits for its job, and no queue closes before all.
    expect(broker.closed).toEqual(others.map((queue) => `worker:${queue}`));
    expect(broker.store.entries.has(KEY)).toBe(true);

    purge.resolve({ verifications: 0, sessions: 0, invitations: 0 });
    await stopping;
    await expect(job).resolves.toEqual({ purged: { verifications: 0, sessions: 0, invitations: 0 }, notifications: 5 });
    expect(broker.closed).toEqual([
      ...others.map((queue) => `worker:${queue}`),
      'worker:maintenance',
      ...Object.keys(JOBS).map((queue) => `queue:${queue}`),
    ]);
    expect(broker.store.entries.has(KEY)).toBe(false);
  });
});
