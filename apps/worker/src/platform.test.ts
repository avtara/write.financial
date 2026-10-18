// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The adapter's contract with BullMQ and ioredis: connection options, key prefix, default job options, and error
 * listeners. The real libraries against Valkey are exercised by worker.integration.test.ts.
 */
import { DEFAULT_JOB_OPTIONS } from '@wf/jobs/queues';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { connectBroker } from './platform.ts';

const mocks = vi.hoisted(() => {
  const redis = {
    on: vi.fn(),
    get: vi.fn<(key: string) => Promise<string | null>>(),
    set: vi.fn<(...args: unknown[]) => Promise<'OK'>>(),
    del: vi.fn<(key: string) => Promise<number>>(),
    quit: vi.fn<() => Promise<'OK'>>(),
    disconnect: vi.fn(),
  };
  const queue = { on: vi.fn() };
  const worker = { on: vi.fn() };
  return {
    redis,
    queue,
    worker,
    Redis: vi.fn(function Redis() {
      return redis;
    }),
    Queue: vi.fn(function Queue() {
      return queue;
    }),
    Worker: vi.fn(function Worker() {
      return worker;
    }),
  };
});

vi.mock('ioredis', () => ({ Redis: mocks.Redis }));
vi.mock('bullmq', () => ({ Queue: mocks.Queue, Worker: mocks.Worker }));

const URL = 'redis://:unused@127.0.0.1:6379/0';
const onError = vi.fn<(error: Error) => void>();

beforeEach(() => {
  vi.clearAllMocks();
});

describe('connectBroker', () => {
  it('connects for BullMQ (no per-request retry limit) and forwards connection errors', () => {
    connectBroker(URL, { onError, failFast: false });
    expect(mocks.Redis).toHaveBeenCalledWith(URL, { maxRetriesPerRequest: null });
    expect(mocks.redis.on).toHaveBeenCalledWith('error', onError);
  });

  it('fails fast for the healthcheck: one connection attempt, one try per command', () => {
    connectBroker(URL, { onError, failFast: true });
    const [, options] = mocks.Redis.mock.calls[0] as unknown as [string, { retryStrategy: () => unknown }];
    expect(options).toMatchObject({ maxRetriesPerRequest: 1, connectTimeout: 2_000 });
    expect(options.retryStrategy()).toBeNull();
  });

  it('stores the heartbeat with GET, SET … PX, and DEL', async () => {
    const { store } = connectBroker(URL, { onError, failFast: false });
    mocks.redis.get.mockResolvedValue('123');
    mocks.redis.set.mockResolvedValue('OK');
    mocks.redis.del.mockResolvedValue(1);
    expect(await store.get('k')).toBe('123');
    await expect(store.set('k', '456', 8_000)).resolves.toBeUndefined();
    expect(mocks.redis.set).toHaveBeenCalledWith('k', '456', 'PX', 8_000);
    await expect(store.del('k')).resolves.toBeUndefined();
    expect(mocks.redis.del).toHaveBeenCalledWith('k');
  });

  it('creates queues under the wf prefix with the default job options on the shared connection', () => {
    const broker = connectBroker(URL, { onError, failFast: false });
    const onQueueError = vi.fn();
    expect(broker.createQueue('maintenance', onQueueError)).toBe(mocks.queue);
    expect(mocks.Queue).toHaveBeenCalledWith('maintenance', {
      connection: mocks.redis,
      prefix: 'wf',
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    });
    expect(mocks.queue.on).toHaveBeenCalledWith('error', onQueueError);
  });

  it('creates workers with the concurrency that pass only id, data, and attempts to the processor', async () => {
    const broker = connectBroker(URL, { onError, failFast: false });
    const processor = vi.fn((job: object) => Promise.resolve({ seen: job }));
    const onWorkerError = vi.fn();
    expect(broker.createWorker('maintenance', processor, { concurrency: 2, onError: onWorkerError })).toBe(
      mocks.worker,
    );
    const [name, run, options] = mocks.Worker.mock.calls[0] as unknown as [
      string,
      (job: object) => Promise<unknown>,
      object,
    ];
    expect(name).toBe('maintenance');
    expect(options).toEqual({ connection: mocks.redis, prefix: 'wf', concurrency: 2 });
    expect(mocks.worker.on).toHaveBeenCalledWith('error', onWorkerError);
    expect(await run({ id: 'j1', data: {}, attemptsMade: 1, token: 'lock', opts: {} })).toEqual({
      seen: { id: 'j1', data: {}, attemptsMade: 1 },
    });
  });

  it('closes with QUIT, or drops the socket when QUIT fails', async () => {
    const broker = connectBroker(URL, { onError, failFast: false });
    mocks.redis.quit.mockResolvedValueOnce('OK');
    await broker.close();
    expect(mocks.redis.disconnect).not.toHaveBeenCalled();
    mocks.redis.quit.mockRejectedValueOnce(new Error('Connection is closed.'));
    await broker.close();
    expect(mocks.redis.disconnect).toHaveBeenCalledOnce();
  });
});
