// SPDX-License-Identifier: AGPL-3.0-only
import type { AdvanceResult } from '@wf/db/occurrence-jobs';
import { JOBS } from '@wf/jobs/queues';
import type { ProcessorDeps, ProcessorJob } from '../processors.ts';

/**
 * Daily per user after 00.05 local (`occ.{userId}.{date}`): materializes 90 days of schedules, moves due occurrences
 * to the Review queue (D14: proposals only), marks overdue ones, and notifies ending trials and pauses. One
 * transaction with keyed writes, so a retry or a second run the same day creates nothing twice.
 */
export function createOccurrencesProcessor({ db, now }: ProcessorDeps): (job: ProcessorJob) => Promise<AdvanceResult> {
  return async (job) => {
    const { userId } = JOBS.occurrences.parse(job.data);
    return db.occurrences.advance(userId, now());
  };
}
