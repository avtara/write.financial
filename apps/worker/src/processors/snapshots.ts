// SPDX-License-Identifier: AGPL-3.0-only
import type { SnapshotView } from '@wf/db/portfolio-snapshots';
import { JOBS } from '@wf/jobs/queues';
import type { ProcessorDeps, ProcessorJob } from '../processors.ts';

export interface SnapshotsResult {
  /** The snapshot recorded, `null` for a user without investments. */
  readonly snapshot: Pick<SnapshotView, 'date'> | null;
}

/**
 * The daily portfolio snapshot (plan §6 `snapshots`, from 23.55 in the user's time zone through the dispatch): the
 * day's value and cost basis for the growth chart (FR-I3). Keyed by the user's local date; a rerun replaces the row.
 */
export function createSnapshotsProcessor({ db, now }: ProcessorDeps): (job: ProcessorJob) => Promise<SnapshotsResult> {
  return async (job) => {
    const { userId } = JOBS.snapshots.parse(job.data);
    const snapshot = await db.portfolioSnapshots.record(userId, now());
    // Only the date goes to the job log: values are financial data (plan §6 worker principles).
    return { snapshot: snapshot === null ? null : { date: snapshot.date } };
  };
}
