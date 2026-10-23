// SPDX-License-Identifier: AGPL-3.0-only
import type { SnapshotView } from '@wf/db/portfolio-snapshots';
import { JOBS } from '@wf/jobs/queues';
import type { ProcessorJob } from '../processors.ts';
import type { WorkerDb } from '../worker-db.ts';

export interface SnapshotsResult {
  /** The snapshot recorded, `null` for a user without investments. */
  readonly snapshot: Pick<SnapshotView, 'date'> | null;
}

export interface SnapshotsProcessorDeps {
  readonly db: Pick<WorkerDb, 'portfolioSnapshots' | 'goalSnapshots'>;
  readonly now: () => Date;
}

/**
 * Daily portfolio and goal positions (plan §6 `snapshots`, from 23.55 in the user's time zone through dispatch):
 * portfolio growth (FR-I3) and period-end goal values (FR-LP1), keyed by local date. A rerun replaces only that day.
 */
export function createSnapshotsProcessor({
  db,
  now,
}: SnapshotsProcessorDeps): (job: ProcessorJob) => Promise<SnapshotsResult> {
  return async (job) => {
    const { userId } = JOBS.snapshots.parse(job.data);
    const at = now();
    const snapshot = await db.portfolioSnapshots.record(userId, at);
    await db.goalSnapshots.record(userId, at);
    // Only the date goes to the job log: values are financial data (plan §6 worker principles).
    return { snapshot: snapshot === null ? null : { date: snapshot.date } };
  };
}
