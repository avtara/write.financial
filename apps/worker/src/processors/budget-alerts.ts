// SPDX-License-Identifier: AGPL-3.0-only
import { JOBS } from '@wf/jobs/queues';
import type { ProcessorDeps, ProcessorJob } from '../processors.ts';

/** Hourly per user from 09.00 local (`bud.{userId}.{date}.{HH}`): FR-B5 threshold notifications, once per threshold. */
export function createBudgetAlertsProcessor({
  db,
  now,
}: ProcessorDeps): (job: ProcessorJob) => Promise<{ readonly created: number }> {
  return async (job) => {
    const { userId } = JOBS['budget-alerts'].parse(job.data);
    return db.budgetAlerts.check(userId, now());
  };
}
