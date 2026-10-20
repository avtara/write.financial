// SPDX-License-Identifier: AGPL-3.0-only
import type { DetectResult } from '@wf/db/detect-recurring';
import { JOBS } from '@wf/jobs/queues';
import type { ProcessorDeps, ProcessorJob } from '../processors.ts';

/** Daily per user from 03.00 local (`det.{userId}.{date}`): FR-SUB4 subscription candidates, suggestions only. */
export function createDetectRecurringProcessor({
  db,
  now,
}: ProcessorDeps): (job: ProcessorJob) => Promise<DetectResult> {
  return async (job) => {
    const { userId } = JOBS['detect-recurring'].parse(job.data);
    return db.detectRecurring.detect(userId, now());
  };
}
