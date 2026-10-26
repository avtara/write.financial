// SPDX-License-Identifier: AGPL-3.0-only
import type { AuthPurgeCounts } from '@wf/db/maintenance';
import { JOBS } from '@wf/jobs/queues';
import type { ProcessorDeps, ProcessorJob } from '../processors.ts';

export interface MaintenanceResult {
  /** Rows deleted from the auth tables (expired verifications and sessions, invitations dead for 30 days). */
  readonly purged: AuthPurgeCounts;
  /** Notifications older than 90 days deleted, with their outbox rows (FR-S5). */
  readonly notifications: number;
  /** Metadata-only AI activity older than 30 days (FR-AI2). */
  readonly aiLogs: number;
}

/**
 * Daily maintenance (plan §6 `maintenance`). Each purge is a single statement, so it commits as a whole or not at
 * all, and deletes only rows that are dead as of the job's clock, so a retry or a second run the same day is harmless.
 */
export function createMaintenanceProcessor({
  db,
  now,
  receipt,
}: ProcessorDeps): (job: ProcessorJob) => Promise<MaintenanceResult> {
  return async (job) => {
    JOBS.maintenance.parse(job.data);
    const at = now();
    if (receipt !== undefined) {
      for (const { userId } of await db.dispatch.users()) {
        for (const key of await db.receipts.cleanup(userId)) await receipt.objects.delete(userId, key);
      }
    }
    return {
      purged: await db.maintenance.purgeExpiredAuth(at),
      notifications: await db.maintenance.purgeNotifications(at),
      aiLogs: await db.maintenance.purgeAiLogs(at),
    };
  };
}
