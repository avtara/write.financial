// SPDX-License-Identifier: AGPL-3.0-only
import { JOBS } from '@wf/jobs/queues';
import type { ProcessorJob } from '../processors.ts';
import type { WorkerDb } from '../worker-db.ts';

export interface ReportsResult {
  /** Closed periods processed (0 when every closed period already has a report). */
  readonly generated: number;
}

export interface ReportsProcessorDeps {
  readonly db: Pick<WorkerDb, 'reports'>;
  readonly now: () => Date;
}

/**
 * Daily per user after 00.10 local (`rep.{userId}.{date}`), FR-LP1: every closed period that has no monthly report yet
 * gets one. It runs after `period-close` (00.05), so the period is locked and final first; a stored report is never
 * rewritten, so a retry or a later dispatch only fills what is missing.
 */
export function createReportsProcessor({
  db,
  now,
}: ReportsProcessorDeps): (job: ProcessorJob) => Promise<ReportsResult> {
  return async (job) => {
    const { userId } = JOBS.reports.parse(job.data);
    const at = now();
    const pending = await db.reports.pendingMonthly(userId);
    for (const period of pending) {
      await db.reports.generate(userId, { kind: 'monthly', periodId: period.id }, at);
    }
    return { generated: pending.length };
  };
}
