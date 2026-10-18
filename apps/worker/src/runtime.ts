// SPDX-License-Identifier: AGPL-3.0-only
import type { JobQueue } from '@wf/jobs/queues';
import type { Logger } from 'pino';
import { startHeartbeat, type HeartbeatSettings, type HeartbeatStore } from './heartbeat.ts';
import { PROCESSORS, type Processor } from './processors.ts';
import { registerSchedules, type SchedulerQueue } from './schedules.ts';
import type { WorkerDb } from './worker-db.ts';

export interface Closable {
  close(): Promise<void>;
}

/** One Redis connection with the BullMQ queues and workers on it (platform.ts). */
export interface Broker extends Closable {
  readonly store: HeartbeatStore;
  createQueue(name: JobQueue, onError: (error: Error) => void): SchedulerQueue & Closable;
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
export async function startWorker({ broker, db, logger, now, heartbeat }: RuntimeDeps): Promise<Runtime> {
  const onError = (source: string) => (error: Error) => {
    logger.error({ err: error, source }, 'queue connection error');
  };
  const queues = Object.fromEntries(QUEUES.map((name) => [name, broker.createQueue(name, onError(name))])) as Record<
    JobQueue,
    SchedulerQueue & Closable
  >;
  await registerSchedules((name) => queues[name], logger);

  const workers = QUEUES.map((name) => {
    const { concurrency, create } = PROCESSORS[name];
    const handle = create({ db, now: () => new Date(now()) });
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
