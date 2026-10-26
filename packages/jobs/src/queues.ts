// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Queue registry (plan §6). Every queue of the plan has a name in {@link QueueName}, but only queues listed in
 * {@link JOBS} can be enqueued, and the worker must register a processor for every one of them (its processor map is
 * typed `Record<JobQueue, …>`). A queue is added to `JOBS` in the same change as its processor, so nothing can enqueue
 * work that no process would run.
 */
import type { LocalDate } from '@wf/domain/period';
import {
  DEFAULT_REPORT_EXPORT_OPTIONS,
  REPORT_EXPORT_SECTIONS,
  REPORT_FORMATS,
  type ReportExportOptions,
  type ReportFormat,
} from '@wf/domain/report';
import * as z from 'zod';

/** The auto-send export options (FR-LP4), re-exported so callers of the `report-export` queue have one import. */
export { DEFAULT_REPORT_EXPORT_OPTIONS };
export type { ReportExportOptions };

/** Every queue of plan §6. Names outside {@link JobQueue} have no processor yet and cannot be enqueued. */
export type QueueName =
  | 'dispatch'
  | 'occurrences'
  | 'reminders'
  | 'budget-alerts'
  | 'balance-checks'
  | 'period-close'
  | 'reports'
  | 'report-export'
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

/** The payload of every per-user job: the user is the only input, the rest comes from the database. */
const userJob = z.strictObject({ userId: z.uuid() });

/**
 * Payload schema per enqueueable queue. Payloads carry IDs only, never secrets or financial data (plan §6 worker
 * principles); the schemas are strict, so an unknown key is rejected rather than silently stored in Redis.
 */
export const JOBS = {
  /** Receipt inference: IDs only; images, credentials and OCR evidence stay encrypted outside Redis. */
  ocr: z.strictObject({ userId: z.uuid(), receiptId: z.uuid() }),
  /**
   * The daily account-deletion run (plan §6 `account-deletion`, FR-A11): with no `userId` the processor scans for
   * users whose 7-day grace period has passed and deletes each; with one it deletes just that user (the retry of a
   * failed scan). Deleting is the worker's SECURITY DEFINER function's decision either way, so an early call is a
   * harmless no-op.
   */
  'account-deletion': z.strictObject({ userId: z.uuid().optional() }),
  /** Daily purge of expired auth rows and of notifications older than 90 days (plan §6 `maintenance`). */
  maintenance: z.strictObject({}),
  /**
   * Built-in FX reference rates (plan §6 `fx`): scheduled 17.00 and 08.00 WIB, or "Perbarui sekarang" (FR-ST1). The
   * currencies come from the database when the job runs, so the payload is empty.
   */
  fx: z.strictObject({}),
  /** Every minute: enqueues each user's daily jobs at their local times, the due reminders, and the pending emails. */
  dispatch: z.strictObject({}),
  /** Materializes the next 90 days of schedules and moves due occurrences to the Review queue (FR-L7, FR-SUB2). */
  occurrences: userJob,
  /** One bill reminder (notification and email) of a scheduled occurrence. */
  reminders: z.strictObject({ userId: z.uuid(), occurrenceId: z.uuid() }),
  /** FR-B5 threshold notifications of the current period. */
  'budget-alerts': userJob,
  /** Low balance, accounts not checked for 14 days, not enough money for the next bills (FR-SUB6). */
  'balance-checks': userJob,
  /** FR-P4: locks ended periods and proposes the rollover and leftover moves in the Review queue. */
  'period-close': userJob,
  /** FR-LP1: the monthly report of every closed period that has none yet (after `period-close`). */
  reports: userJob,
  /**
   * FR-LP4: exports one stored report to PDF, XLSX, or CSV and stores it in the `reports` bucket; with `email` it is
   * attached to the notification email ("Kirim otomatis"). The options are the export dialog's choices (design yLlRY)
   * — rendering preferences, not secrets or financial data; the figures come from the stored report row.
   */
  'report-export': z.strictObject({
    userId: z.uuid(),
    reportId: z.uuid(),
    format: z.enum(REPORT_FORMATS),
    email: z.boolean(),
    options: z.strictObject({
      sections: z.array(z.enum(REPORT_EXPORT_SECTIONS)).min(1),
      theme: z.enum(['light', 'dark']),
      paper: z.enum(['a4', 'letter']),
      maskAccountNumbers: z.boolean(),
    }),
  }),
  /** Sends one outbox row (email). */
  notify: z.strictObject({ userId: z.uuid(), outboxId: z.uuid() }),
  /** FR-SUB4 subscription candidates (suggestions only). */
  'detect-recurring': userJob,
  /**
   * FR-AI1 "Terapkan ke transaksi lama": builds the proposal list only (no transaction, posting, budget, or goal write).
   * `requestId` keeps a repeated request distinct; `ruleIds` keeps the confirmation's rule scope. The web dialog applies
   * selected proposals through the app role after the user confirms.
   */
  'rules-backfill': z.strictObject({
    userId: z.uuid(),
    requestId: z.uuid(),
    ruleIds: z.array(z.uuid()).min(1).max(100).optional(),
  }),
  /**
   * Built-in market prices (FR-I6, plan §6 `market-server`): `crypto` every 5 minutes (CoinMarketCap, one call for the
   * union of every user's symbols), `gold` twice a day (fawazahmed0 XAU spot). The symbols come from the database.
   */
  'market-server': z.strictObject({ source: z.enum(['crypto', 'gold']) }),
  /** A user's own-key prices (FR-I6 BYOK, plan §6 `market-byok`): each market's providers when their refresh is due. */
  'market-byok': userJob,
  /** The daily portfolio snapshot (FR-I3 growth chart, plan §6 `snapshots`). */
  snapshots: userJob,
} as const satisfies { readonly [Q in QueueName]?: z.ZodType<object> };

/** Queues that have a processor. */
export type JobQueue = keyof typeof JOBS;

export type JobPayload<Q extends JobQueue> = z.infer<(typeof JOBS)[Q]>;

declare const jobIdOf: unique symbol;

/** A deterministic job id of queue `Q` (plan §6 idempotency column); only {@link jobIds} creates one. */
export type JobId<Q extends JobQueue> = string & { readonly [jobIdOf]: Q };

/** The UTC minute of `at` without `:` (`2026-10-18T2030`), the slot part of minute-based job ids. */
const minuteOf = (at: Date): string => at.toISOString().slice(0, 16).replace(':', '');

/**
 * Builders for the deterministic job ids: enqueuing the same work twice yields one job. The plan writes them with `:`
 * (`mt:{date}`), but BullMQ rejects custom ids containing `:` (it separates Redis key parts), so the parts are joined
 * with `.` instead: `mt.{date}`. Per-user jobs are daily in the user's own calendar (`{date}` is the user's local
 * date; budget alerts hourly): the minute dispatch enqueues them again and again, and the id makes that one job.
 */
export const jobIds = {
  ocr: (userId: string, receiptId: string) => `ocr.${userId}.${receiptId}` as JobId<'ocr'>,
  maintenance: (date: LocalDate) => `mt.${date}` as JobId<'maintenance'>,
  fx: (date: LocalDate) => `fx.${date}` as JobId<'fx'>,
  /** One dispatch per UTC minute (`dsp.2026-10-18T2030`). */
  dispatch: (at: Date) => `dsp.${minuteOf(at)}` as JobId<'dispatch'>,
  occurrences: (userId: string, date: LocalDate) => `occ.${userId}.${date}` as JobId<'occurrences'>,
  reminders: (occurrenceId: string) => `rem.${occurrenceId}` as JobId<'reminders'>,
  'budget-alerts': (userId: string, date: LocalDate, hour: number) =>
    `bud.${userId}.${date}.${String(hour).padStart(2, '0')}` as JobId<'budget-alerts'>,
  'balance-checks': (userId: string, date: LocalDate) => `bal.${userId}.${date}` as JobId<'balance-checks'>,
  'period-close': (userId: string, date: LocalDate) => `close.${userId}.${date}` as JobId<'period-close'>,
  reports: (userId: string, date: LocalDate) => `rep.${userId}.${date}` as JobId<'reports'>,
  /**
   * One export per stored report and format (`rep.{reportId}.{format}`, plan §6's logical `rep:{periodId}:{format}`
   * keyed on the stored report so quarterly and custom ranges work too). A retry deduplicates; a re-export with
   * different options (or the next month's auto-send of the same report) adds the optional `requestId` suffix.
   */
  'report-export': (reportId: string, format: ReportFormat, requestId?: string) =>
    `rep.${reportId}.${format}${requestId === undefined ? '' : `.${requestId}`}` as JobId<'report-export'>,
  notify: (outboxId: string) => `ntf.${outboxId}` as JobId<'notify'>,
  'detect-recurring': (userId: string, date: LocalDate) => `det.${userId}.${date}` as JobId<'detect-recurring'>,
  /** One proposal build per request (`rb.{userId}.{requestId}`, plan §6's `{kind}:{requestId}`). */
  'rules-backfill': (userId: string, requestId: string) => `rb.${userId}.${requestId}` as JobId<'rules-backfill'>,
  /** One built-in run per source and UTC minute (`mks.crypto.2026-10-15T0940`). */
  'market-server': (source: 'crypto' | 'gold', at: Date) => `mks.${source}.${minuteOf(at)}` as JobId<'market-server'>,
  /** One own-key run per user and 5-minute slot (`mkb.{userId}.2026-10-15T0940`). */
  'market-byok': (userId: string, at: Date) =>
    `mkb.${userId}.${minuteOf(new Date(Math.floor(at.getTime() / 300_000) * 300_000))}` as JobId<'market-byok'>,
  snapshots: (userId: string, date: LocalDate) => `snap.${userId}.${date}` as JobId<'snapshots'>,
  /** One deletion per user (`del.{userId}`); a second run finds no user and does nothing. */
  'account-deletion': (userId: string) => `del.${userId}` as JobId<'account-deletion'>,
} as const satisfies { readonly [Q in JobQueue]: (...args: never[]) => JobId<Q> };

/** Redis key prefix of every queue. */
export const QUEUE_PREFIX = 'wf';

const DAY_SECONDS = 24 * 60 * 60;

/**
 * Options of every job: 5 attempts with exponential backoff (30 s, 1 min, 2 min, 4 min), completed jobs kept for a
 * week (so a deterministic job id still deduplicates a repeat within that time), failed jobs for 30 days. Beyond the
 * last 1000 completed jobs of a queue an id can run again; every processor is idempotent, so that only costs work.
 */
export const DEFAULT_JOB_OPTIONS = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 30_000 },
  removeOnComplete: { age: 7 * DAY_SECONDS, count: 1000 },
  removeOnFail: { age: 30 * DAY_SECONDS },
} as const;
