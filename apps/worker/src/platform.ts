// SPDX-License-Identifier: AGPL-3.0-only
import { DEFAULT_JOB_OPTIONS, QUEUE_PREFIX } from '@wf/jobs/queues';
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import type { Broker } from './runtime.ts';

export interface ConnectOptions {
  readonly onError: (error: Error) => void;
  /**
   * For the healthcheck: one connection attempt and one try per command, so an unreachable Redis fails at once.
   * The worker instead waits for Redis (BullMQ requires `maxRetriesPerRequest: null`).
   */
  readonly failFast: boolean;
}

/** BullMQ queues and workers and the heartbeat store on one ioredis connection to Valkey/Redis (`noeviction`). */
export function connectBroker(url: string, { onError, failFast }: ConnectOptions): Broker {
  const redis = new Redis(
    url,
    failFast
      ? { maxRetriesPerRequest: 1, connectTimeout: 2_000, retryStrategy: () => null }
      : { maxRetriesPerRequest: null },
  );
  redis.on('error', onError);
  const shared = { connection: redis, prefix: QUEUE_PREFIX };
  return {
    store: {
      get: (key) => redis.get(key),
      set: async (key, value, ttlMs) => {
        await redis.set(key, value, 'PX', ttlMs);
      },
      del: async (key) => {
        await redis.del(key);
      },
    },
    createQueue: (name, onQueueError) => {
      const queue = new Queue(name, { ...shared, defaultJobOptions: DEFAULT_JOB_OPTIONS });
      queue.on('error', onQueueError);
      return queue;
    },
    createWorker: (name, processor, { concurrency, onError: onWorkerError }) => {
      const worker = new Worker(
        name,
        (job) => processor({ id: job.id, data: job.data, attemptsMade: job.attemptsMade }),
        { ...shared, concurrency },
      );
      worker.on('error', onWorkerError);
      return worker;
    },
    close: async () => {
      try {
        await redis.quit();
      } catch {
        // Never connected (or already gone): nothing to flush, just drop the socket.
        redis.disconnect();
      }
    },
  };
}
