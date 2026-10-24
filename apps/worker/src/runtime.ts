// SPDX-License-Identifier: AGPL-3.0-only
import type { Mailer } from '@wf/integrations/mailer';
import { createEnqueue, type QueuePort } from '@wf/jobs/enqueue';
import type { JobQueue } from '@wf/jobs/queues';
import type { Logger } from 'pino';
import { startHeartbeat, type HeartbeatSettings, type HeartbeatStore } from './heartbeat.ts';
import { PROCESSORS, type Processor, type ProcessorDeps } from './processors.ts';
import { registerSchedules, type SchedulerQueue } from './schedules.ts';
import type { WorkerDb } from './worker-db.ts';

export interface Closable {
  close(): Promise<void>;
}

/** One Redis connection with the BullMQ queues and workers on it (platform.ts). */
export interface Broker extends Closable {
  readonly store: HeartbeatStore;
  createQueue(name: JobQueue, onError: (error: Error) => void): SchedulerQueue & QueuePort & Closable;
  /** Starts consuming `name`; `close()` waits for the jobs in progress. */
  createWorker(
    name: JobQueue,
    processor: Processor,
    options: { readonly concurrency: number; readonly onError: (error: Error) => void },
  ): Closable;
}

export interface RuntimeDeps {
  readonly broker: Broker;
  readonly db: WorkerDb;
  readonly mailer: Mailer;
  /** `PUBLIC_URL`, for links in emails. */
  readonly publicUrl: string;
  /** Prints the self-contained report HTML into PDF bytes (`report-export`). */
  readonly render: ProcessorDeps['render'];
  /** Market quote adapters and the operator's CoinMarketCap key. */
  readonly market: ProcessorDeps['market'];
  /** The encrypted object stores, for `account-deletion` to purge a leaving user's blobs from. */
  readonly objects: ProcessorDeps['objects'];
  readonly logger: Logger;
  readonly now: () => number;
  readonly heartbeat: HeartbeatSettings & { readonly key: string };
}

export interface Runtime {
  /** Stops taking jobs, waits for the running ones, then stops the heartbeat and closes the queues. */
  stop(): Promise<void>;
}

const QUEUES = Object.keys(PROCESSORS) as JobQueue[];

/** Registers the schedules, starts one BullMQ worker per queue, and starts the heartbeat. */
export async function startWorker({
  broker,
  db,
  mailer,
  publicUrl,
  render,
  market,
  objects,
  logger,
  now,
  heartbeat,
}: RuntimeDeps): Promise<Runtime> {
  const onError = (source: string) => (error: Error) => {
    logger.error({ err: error, source }, 'queue connection error');
  };
  const queues = Object.fromEntries(QUEUES.map((name) => [name, broker.createQueue(name, onError(name))])) as Record<
    JobQueue,
    SchedulerQueue & QueuePort & Closable
  >;
  await registerSchedules((name) => queues[name], logger);
  const enqueue = createEnqueue((name) => queues[name]);

  const workers = QUEUES.map((name) => {
    const { concurrency, create } = PROCESSORS[name];
    const handle = create({ db, now: () => new Date(now()), enqueue, mailer, publicUrl, render, market, objects });
    const run: Processor = async (job) => {
      const log = logger.child({ queue: name, jobId: job.id, attempt: job.attemptsMade + 1 });
      log.info('job started');
      try {
        const result = await handle(job);
        log.info({ result }, 'job completed');
        return result;
      } catch (error) {
        log.error({ err: error }, 'job failed');
        throw error;
      }
    };
    return broker.createWorker(name, run, { concurrency, onError: onError(`${name} worker`) });
  });

  const beat = await startHeartbeat({
    ...heartbeat,
    store: broker.store,
    now,
    onError: (error) => {
      logger.warn({ err: error }, 'heartbeat write failed');
    },
  });
  logger.info({ queues: QUEUES }, 'worker started');

  return {
    stop: async () => {
      try {
        await Promise.all(workers.map((worker) => worker.close()));
      } finally {
        await beat.stop();
        await Promise.all(Object.values(queues).map((queue) => queue.close()));
      }
    },
  };
}
