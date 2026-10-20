// SPDX-License-Identifier: AGPL-3.0-only
import type { AuthPurgeCounts } from '@wf/db/maintenance';
import { JOBS } from '@wf/jobs/queues';
import type { ProcessorDeps, ProcessorJob } from '../processors.ts';

export interface MaintenanceResult {
  /** Rows deleted from the auth tables (expired verifications and sessions, invitations dead for 30 days). */
  readonly purged: AuthPurgeCounts;
  /** Notifications older than 90 days deleted, with their outbox rows (FR-S5). */
  readonly notifications: number;
}

/**
 * Daily maintenance (plan §6 `maintenance`). Each purge is a single statement, so it commits as a whole or not at
 * all, and deletes only rows that are dead as of the job's clock, so a retry or a second run the same day is harmless.
 */
export function createMaintenanceProcessor({
  db,
  now,
}: ProcessorDeps): (job: ProcessorJob) => Promise<MaintenanceResult> {
  return async (job) => {
    JOBS.maintenance.parse(job.data);
    const at = now();
    return {
      purged: await db.maintenance.purgeExpiredAuth(at),
      notifications: await db.maintenance.purgeNotifications(at),
    };
  };
}
