// SPDX-License-Identifier: AGPL-3.0-only
/** In-memory stand-ins for the worker's ports (Redis, BullMQ, the database, the log). */
import type { AuthPurgeCounts } from '@wf/db/maintenance';
import type { JobQueue } from '@wf/jobs/queues';
import type { DestinationStream } from 'pino';
import type { HeartbeatStore } from '../src/heartbeat.ts';
import type { Processor, ProcessorJob } from '../src/processors.ts';
import type { Broker } from '../src/runtime.ts';
import type { WorkerDb } from '../src/worker-db.ts';

export interface FakeStore extends HeartbeatStore {
  readonly entries: Map<string, { value: string; ttlMs: number }>;
  /** Makes the next `set` reject with this error. */
  failNextSet(error: Error): void;
}

export function fakeStore(): FakeStore {
  const entries = new Map<string, { value: string; ttlMs: number }>();
  let failure: Error | undefined;
  return {
    entries,
    failNextSet: (error) => {
      failure = error;
    },
    get: async (key) => Promise.resolve(entries.get(key)?.value ?? null),
    set: async (key, value, ttlMs) => {
      const error = failure;
      failure = undefined;
      if (error !== undefined) throw error;
      entries.set(key, { value, ttlMs });
      return Promise.resolve();
    },
    del: async (key) => {
      entries.delete(key);
      return Promise.resolve();
    },
  };
}

export interface FakeQueue {
  readonly schedulers: Map<string, { repeat: object; template: object }>;
  readonly onError: (error: Error) => void;
  closed: boolean;
}

export interface FakeWorker {
  readonly concurrency: number;
  readonly onError: (error: Error) => void;
  /** Runs a job through the registered processor, as BullMQ would. */
  run(job: ProcessorJob): Promise<object>;
  closed: boolean;
}

export interface FakeBroker extends Broker {
  readonly store: FakeStore;
  readonly queues: Map<JobQueue, FakeQueue>;
  readonly workers: Map<JobQueue, FakeWorker>;
  /** Order in which things were closed, e.g. `['worker:maintenance', 'queue:maintenance', 'broker']`. */
  readonly closed: string[];
}

export interface NextRun {
  readonly timestamp: number;
  readonly delay: number;
  readonly opts: { readonly prevMillis?: number };
}

/** The next job the fake scheduler reports: slot 2026-10-19 03:30 WIB, enqueued 12 ms "late" by the producer clock. */
export const NEXT_RUN: NextRun = {
  timestamp: Date.parse('2026-10-18T10:00:00.012Z'),
  delay: 9.5 * 60 * 60 * 1000,
  opts: { prevMillis: Date.parse('2026-10-18T19:30:00Z') },
};

export function fakeBroker(nextRun: NextRun = NEXT_RUN): FakeBroker {
  const store = fakeStore();
  const queues = new Map<JobQueue, FakeQueue>();
  const workers = new Map<JobQueue, FakeWorker>();
  const closed: string[] = [];
  return {
    store,
    queues,
    workers,
    closed,
    createQueue: (name, onError) => {
      const queue: FakeQueue = { schedulers: new Map(), onError, closed: false };
      queues.set(name, queue);
      return {
        upsertJobScheduler: async (id, repeat, template) => {
          queue.schedulers.set(id, { repeat, template });
          return Promise.resolve(nextRun);
        },
        close: async () => {
          queue.closed = true;
          closed.push(`queue:${name}`);
          return Promise.resolve();
        },
      };
    },
    createWorker: (name, processor: Processor, { concurrency, onError }) => {
      const running = new Set<Promise<unknown>>();
      const worker: FakeWorker = {
        concurrency,
        onError,
        closed: false,
        run: async (job) => {
          const result = processor(job);
          running.add(result);
          try {
            return await result;
          } finally {
            running.delete(result);
          }
        },
      };
      workers.set(name, worker);
      return {
        close: async () => {
          await Promise.allSettled(running);
          worker.closed = true;
          closed.push(`worker:${name}`);
        },
      };
    },
    close: async () => {
      closed.push('broker');
      return Promise.resolve();
    },
  };
}

export interface FakeDb extends WorkerDb {
  readonly purgeCalls: Date[];
}

export function fakeDb(counts: AuthPurgeCounts = { verifications: 2, sessions: 3, invitations: 1 }): FakeDb {
  const purgeCalls: Date[] = [];
  return {
    purgeCalls,
    maintenance: {
      purgeExpiredAuth: async (now) => {
        purgeCalls.push(now);
        return Promise.resolve(counts);
      },
    },
  };
}

export interface LogCapture extends DestinationStream {
  readonly lines: Record<string, unknown>[];
  /** Messages (`msg`) in order. */
  messages(): string[];
}

/** A pino destination that keeps every line, parsed. */
export function captureLog(): LogCapture {
  const lines: Record<string, unknown>[] = [];
  return {
    lines,
    write: (line: string) => {
      lines.push(JSON.parse(line) as Record<string, unknown>);
    },
    messages: () => lines.map((line) => String(line['msg'])),
  };
}
