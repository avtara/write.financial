// SPDX-License-Identifier: AGPL-3.0-only
import { DEFAULT_JOB_OPTIONS, type JobPayload, type JobQueue } from '@wf/jobs/queues';
import type { Logger } from 'pino';

/** The part of a BullMQ `Queue` the schedules use. */
export interface SchedulerQueue {
  /**
   * Creates or updates the job scheduler `id` (BullMQ job schedulers): idempotent, so every worker process can call it
   * on start and there is still one scheduler and one next job. Resolves to that next (delayed) job, whose
   * `opts.prevMillis` is the scheduled slot; `timestamp + delay` is the same slot measured against the producer's clock.
   */
  upsertJobScheduler(
    id: string,
    repeat: { readonly pattern: string; readonly tz: string },
    template: { readonly name: string; readonly data: object; readonly opts: typeof DEFAULT_JOB_OPTIONS },
  ): Promise<{ readonly timestamp: number; readonly delay: number; readonly opts: { readonly prevMillis?: number } }>;
}

type Schedule = {
  readonly [Q in JobQueue]: {
    readonly id: string;
    readonly queue: Q;
    /** Cron pattern in {@link tz}. */
    readonly pattern: string;
    readonly tz: string;
    readonly data: JobPayload<Q>;
  };
}[JobQueue];

/** Plan §6 triggers with a fixed time. Scheduled jobs get BullMQ ids `repeat:{id}:{time}`: one job per slot. */
export const SCHEDULES: readonly Schedule[] = [
  { id: 'maintenance-daily', queue: 'maintenance', pattern: '30 3 * * *', tz: 'Asia/Jakarta', data: {} },
  // After BI publishes its transaction rates, and a morning retry for a day the afternoon run missed (plan §6 `fx`).
  { id: 'fx-daily', queue: 'fx', pattern: '0 17 * * *', tz: 'Asia/Jakarta', data: {} },
  { id: 'fx-retry', queue: 'fx', pattern: '0 8 * * *', tz: 'Asia/Jakarta', data: {} },
  // Per-user times (00.05, 03.00, 07.00, 09.00, 23.55 local), own-key prices, and reminders: the dispatch enqueues them (processors/dispatch.ts).
  { id: 'dispatch-minute', queue: 'dispatch', pattern: '* * * * *', tz: 'Asia/Jakarta', data: {} },
  // Built-in crypto prices every 5 minutes (CoinMarketCap: 8 928 of its 15 000 monthly credits), gold spot after
  // fawazahmed0's daily update and again in the afternoon (plan §6 `market-server`).
  {
    id: 'market-crypto',
    queue: 'market-server',
    pattern: '*/5 * * * *',
    tz: 'Asia/Jakarta',
    data: { source: 'crypto' },
  },
  { id: 'market-gold', queue: 'market-server', pattern: '0 9,17 * * *', tz: 'Asia/Jakarta', data: { source: 'gold' } },
];

/** Upserts every schedule in {@link SCHEDULES} on its queue and logs when it runs next. */
export async function registerSchedules(queueFor: (queue: JobQueue) => SchedulerQueue, logger: Logger): Promise<void> {
  for (const { id, queue, pattern, tz, data } of SCHEDULES) {
    const next = await queueFor(queue).upsertJobScheduler(
      id,
      { pattern, tz },
      { name: queue, data, opts: DEFAULT_JOB_OPTIONS },
    );
    const nextRunAt = new Date(next.opts.prevMillis ?? next.timestamp + next.delay).toISOString();
    logger.info({ scheduler: id, queue, pattern, tz, nextRunAt }, 'job scheduler registered');
  }
}
