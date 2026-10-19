// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { captureLog, fakeBroker, fakeDb, type FakeBroker, type LogCapture } from '../test/fakes.ts';
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
    logger: createLogger('info', log),
    now: Date.now,
    heartbeat: { key: KEY, intervalMs: 1_000, maxAgeMs: 4_000 },
  });

describe('startWorker', () => {
  it('registers the schedules, starts one worker per queue, and writes the heartbeat', async () => {
    const runtime = await start();
    expect([...broker.queues.keys()]).toEqual(['maintenance', 'fx']);
    expect([...(broker.queues.get('maintenance')?.schedulers.keys() ?? [])]).toEqual(['maintenance-daily']);
    expect([...(broker.queues.get('fx')?.schedulers.keys() ?? [])]).toEqual(['fx-daily', 'fx-retry']);
    expect(broker.workers.get('maintenance')?.concurrency).toBe(1);
    expect(broker.workers.get('fx')?.concurrency).toBe(1);
    expect(broker.store.entries.get(KEY)?.value).toBe(String(NOW));
    expect(log.messages()).toEqual([
      'job scheduler registered',
      'job scheduler registered',
      'job scheduler registered',
      'worker started',
    ]);
    expect(log.lines[3]).toMatchObject({ queues: ['maintenance', 'fx'] });
    await runtime.stop();
  });

  it('runs jobs with the WorkerDb and the clock, and logs start and result with the job context', async () => {
    const db = fakeDb({ verifications: 1, sessions: 0, invitations: 0 });
    const runtime = await start(db);
    const result = await broker.workers.get('maintenance')?.run({ id: 'mt.2026-10-19', data: {}, attemptsMade: 2 });
    expect(result).toEqual({ purged: { verifications: 1, sessions: 0, invitations: 0 } });
    expect(db.purgeCalls).toEqual([new Date(NOW)]);
    const context = { queue: 'maintenance', jobId: 'mt.2026-10-19', attempt: 3 };
    expect(log.lines.slice(-2)).toEqual([
      expect.objectContaining({ ...context, msg: 'job started' }),
      expect.objectContaining({ ...context, msg: 'job completed', result }),
    ]);
    await runtime.stop();
  });

  it('logs a failed attempt and rethrows so BullMQ schedules the retry', async () => {
    const runtime = await start({
      ...fakeDb(),
      maintenance: { purgeExpiredAuth: () => Promise.reject(new Error('permission denied')) },
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
    const runtime = await start({ ...fakeDb(), maintenance: { purgeExpiredAuth: () => purge.promise } });
    const job = broker.workers.get('maintenance')?.run({ id: 'j1', data: {}, attemptsMade: 0 });
    const stopping = runtime.stop();
    await vi.advanceTimersByTimeAsync(10);
    // The idle fx worker closes at once; the maintenance worker waits for its job, and no queue closes before both.
    expect(broker.closed).toEqual(['worker:fx']);
    expect(broker.store.entries.has(KEY)).toBe(true);

    purge.resolve({ verifications: 0, sessions: 0, invitations: 0 });
    await stopping;
    await expect(job).resolves.toEqual({ purged: { verifications: 0, sessions: 0, invitations: 0 } });
    expect(broker.closed).toEqual(['worker:fx', 'worker:maintenance', 'queue:maintenance', 'queue:fx']);
    expect(broker.store.entries.has(KEY)).toBe(false);
  });
});
