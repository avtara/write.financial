// SPDX-License-Identifier: AGPL-3.0-only
import type { RemindResult } from '@wf/db/occurrence-jobs';
import { JOBS } from '@wf/jobs/queues';
import type { ProcessorDeps, ProcessorJob } from '../processors.ts';

/**
 * One bill reminder (`rem.{occurrenceId}`), at its `remind_at` (09.00 local, H-N): the notification, its email
 * (queued in the outbox, sent by `notify`), and `reminded_at` in one transaction, so it happens exactly once however
 * often the dispatch enqueues it or BullMQ retries it.
 */
export function createRemindersProcessor({ db, now }: ProcessorDeps): (job: ProcessorJob) => Promise<RemindResult> {
  return async (job) => {
    const { userId, occurrenceId } = JOBS.reminders.parse(job.data);
    return db.occurrences.remind(userId, occurrenceId, now());
  };
}
