// SPDX-License-Identifier: AGPL-3.0-only
import { JOBS } from '@wf/jobs/queues';
import type { ProcessorDeps, ProcessorJob } from '../processors.ts';

export interface PeriodCloseResult {
  /** Ended open periods handled. */
  readonly periods: number;
  /** Review items this run created. */
  readonly proposals: number;
}

/**
 * Daily per user after 00.05 local (`close.{userId}.{date}`), FR-P4: for every open period that has ended, puts its
 * rollover and leftover proposals in the Review queue, then locks it (`periods.lock`). Proposals come first because
 * `endedPeriods` lists open periods only: an attempt that fails after proposing is retried in full (the proposals are
 * keyed, so nothing doubles), while a period is never locked without its proposals.
 */
export function createPeriodCloseProcessor({
  db,
  now,
}: ProcessorDeps): (job: ProcessorJob) => Promise<PeriodCloseResult> {
  return async (job) => {
    const { userId } = JOBS['period-close'].parse(job.data);
    const at = now();
    const ended = await db.periodClose.endedPeriods(userId, at);
    let proposals = 0;
    for (const period of ended) {
      proposals += (await db.periodClose.propose(userId, period.id, at)).created;
      await db.periods.lock(userId, period.id);
    }
    return { periods: ended.length, proposals };
  };
}
