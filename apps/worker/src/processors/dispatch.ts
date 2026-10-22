// SPDX-License-Identifier: AGPL-3.0-only
import { parseLocalDate, type LocalDate } from '@wf/domain/period';
import { JOBS, jobIds } from '@wf/jobs/queues';
import type { ProcessorDeps, ProcessorJob } from '../processors.ts';

/** Most reminders and emails one dispatch enqueues; the rest follow a minute later. */
export const DISPATCH_LIMIT = 500;

/**
 * Local times (`HH:MM`, the user's time zone) from which each daily job runs (plan §6). The jobs are keyed by the
 * user's local date, so the first dispatch at or after the time enqueues them and later ones that day are no-ops;
 * a worker that was down catches up at its first dispatch.
 */
export const DAILY_AT = {
  occurrences: '00:05',
  'period-close': '00:05',
  'detect-recurring': '03:00',
  'balance-checks': '07:00',
  // The day's portfolio value, once the day's prices are in (plan §6 `snapshots`, 23.55).
  snapshots: '23:55',
} as const;

/** Budget alerts run hourly from 09.00 (`bud.{userId}.{date}.{HH}`). */
export const BUDGET_ALERTS_FROM = '09:00';

export interface DispatchResult {
  readonly users: number;
  /** Jobs handed to BullMQ per queue (duplicates of existing job ids included; BullMQ ignores them). */
  readonly enqueued: Readonly<Record<string, number>>;
}

/** The calendar date, `HH:MM`, and hour at `now` in `timeZone`. */
export function localClock(now: Date, timeZone: string): { date: LocalDate; time: string; hour: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(now)
      .map(({ type, value }) => [type, value]),
  ) as Record<'year' | 'month' | 'day' | 'hour' | 'minute', string>;
  return {
    date: parseLocalDate(`${parts.year}-${parts.month}-${parts.day}`),
    time: `${parts.hour}:${parts.minute}`,
    hour: Number(parts.hour),
  };
}

/**
 * The minute dispatch (plan §6 `dispatch`, scheduled `* * * * *`): for every user, enqueues the daily jobs whose
 * local time has come and the hourly budget alerts, then a `reminders` job per due reminder and a `notify` job per
 * pending outbox row. Every job id is deterministic, so re-enqueuing each minute adds nothing while the job exists
 * (BullMQ keeps completed ids for a week), and every processor is idempotent besides.
 */
export function createDispatchProcessor({
  db,
  now,
  enqueue,
}: ProcessorDeps): (job: ProcessorJob) => Promise<DispatchResult> {
  return async (job) => {
    JOBS.dispatch.parse(job.data);
    const at = now();
    const enqueued: Record<string, number> = {};
    const count = (queue: string) => {
      enqueued[queue] = (enqueued[queue] ?? 0) + 1;
    };
    const users = await db.dispatch.users();
    for (const { userId, timeZone } of users) {
      const { date, time, hour } = localClock(at, timeZone);
      for (const [queue, from] of Object.entries(DAILY_AT) as [keyof typeof DAILY_AT, string][]) {
        if (time < from) continue;
        await enqueue(queue, { userId }, { jobId: jobIds[queue](userId, date) });
        count(queue);
      }
      if (time >= BUDGET_ALERTS_FROM) {
        await enqueue('budget-alerts', { userId }, { jobId: jobIds['budget-alerts'](userId, date, hour) });
        count('budget-alerts');
      }
    }
    for (const { userId, occurrenceId } of await db.dispatch.dueReminders(at, DISPATCH_LIMIT)) {
      await enqueue('reminders', { userId, occurrenceId }, { jobId: jobIds.reminders(occurrenceId) });
      count('reminders');
    }
    for (const { userId, outboxId } of await db.dispatch.pendingOutbox(at, DISPATCH_LIMIT)) {
      await enqueue('notify', { userId, outboxId }, { jobId: jobIds.notify(outboxId) });
      count('notify');
    }
    // Own-key prices: one check per user with a key and 5-minute slot; the job decides which markets are due.
    for (const { userId } of await db.marketJobs.byokUsers()) {
      await enqueue('market-byok', { userId }, { jobId: jobIds['market-byok'](userId, at) });
      count('market-byok');
    }
    return { users: users.length, enqueued };
  };
}
