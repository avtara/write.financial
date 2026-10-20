// SPDX-License-Identifier: AGPL-3.0-only
import type { BalanceCheckResult } from '@wf/db/balance-checks';
import { JOBS } from '@wf/jobs/queues';
import type { ProcessorDeps, ProcessorJob } from '../processors.ts';

/**
 * Daily per user from 07.00 local (`bal.{userId}.{date}`): low balance, accounts not checked for 14 days, and bills
 * of the next 3 days the paying account cannot cover (FR-SUB6). Notifications only, keyed by account and day.
 */
export function createBalanceChecksProcessor({
  db,
  now,
}: ProcessorDeps): (job: ProcessorJob) => Promise<BalanceCheckResult> {
  return async (job) => {
    const { userId } = JOBS['balance-checks'].parse(job.data);
    return db.balanceChecks.check(userId, now());
  };
}
