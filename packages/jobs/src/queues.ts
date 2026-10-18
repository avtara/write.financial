// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Queue registry (plan §6). Every queue of the plan has a name in {@link QueueName}, but only queues listed in
 * {@link JOBS} can be enqueued, and the worker must register a processor for every one of them (its processor map is
 * typed `Record<JobQueue, …>`). A queue is added to `JOBS` in the same change as its processor, so nothing can enqueue
 * work that no process would run.
 */
import type { LocalDate } from '@wf/domain/period';
import * as z from 'zod';

/** Every queue of plan §6. Names outside {@link JobQueue} have no processor yet and cannot be enqueued. */
export type QueueName =
  | 'dispatch'
  | 'occurrences'
  | 'reminders'
  | 'budget-alerts'
  | 'balance-checks'
  | 'period-close'
  | 'reports'
  | 'fx'
  | 'market-server'
  | 'market-byok'
  | 'market-test'
  | 'snapshots'
  | 'weekly-summary'
  | 'notify'
  | 'detect-recurring'
  | 'ocr'
  | 'gmail'
  | 'rules-backfill'
  | 'recalc-period'
  | 'tag-merge'
  | 'backup'
  | 'account-deletion'
  | 'maintenance';

/**
 * Payload schema per enqueueable queue. Payloads carry IDs only, never secrets or financial data (plan §6 worker
 * principles); the schemas are strict, so an unknown key is rejected rather than silently stored in Redis.
 */
export const JOBS = {
  /** Daily purge of expired auth rows (plan §6 `maintenance`); the work depends only on the clock. */
  maintenance: z.strictObject({}),
} as const satisfies { readonly [Q in QueueName]?: z.ZodType<object> };

/** Queues that have a processor. */
export type JobQueue = keyof typeof JOBS;

export type JobPayload<Q extends JobQueue> = z.infer<(typeof JOBS)[Q]>;

declare const jobIdOf: unique symbol;

/** A deterministic job id of queue `Q` (plan §6 idempotency column); only {@link jobIds} creates one. */
export type JobId<Q extends JobQueue> = string & { readonly [jobIdOf]: Q };

/**
 * Builders for the deterministic job ids: enqueuing the same work twice yields one job. The plan writes them with `:`
 * (`mt:{date}`), but BullMQ rejects custom ids containing `:` (it separates Redis key parts), so the parts are joined
 * with `.` instead: `mt.{date}`.
 */
export const jobIds = {
  maintenance: (date: LocalDate) => `mt.${date}` as JobId<'maintenance'>,
} as const satisfies { readonly [Q in JobQueue]: (...args: never[]) => JobId<Q> };

/** Redis key prefix of every queue. */
export const QUEUE_PREFIX = 'wf';

const DAY_SECONDS = 24 * 60 * 60;

/**
 * Options of every job: 5 attempts with exponential backoff (30 s, 1 min, 2 min, 4 min), completed jobs kept for a
 * week (so a deterministic job id still deduplicates a repeat within that time), failed jobs for 30 days.
 */
export const DEFAULT_JOB_OPTIONS = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 30_000 },
  removeOnComplete: { age: 7 * DAY_SECONDS, count: 1000 },
  removeOnFail: { age: 30 * DAY_SECONDS },
} as const;
