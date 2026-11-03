// SPDX-License-Identifier: AGPL-3.0-only
import { JOBS } from '@wf/jobs/queues';
import type { Enqueue } from '@wf/jobs/enqueue';
import type { ProcessorJob } from '../processors.ts';
import type { WorkerDb } from '../worker-db.ts';

export interface ReportsResult {
  readonly generated: number;
  readonly autoSent: number;
}

export interface ReportsProcessorDeps {
  readonly db: Pick<WorkerDb, 'reports' | 'preferences'>;
  readonly now: () => Date;
  readonly enqueue: Enqueue;
}

/** Drain previously queued report jobs without generating snapshots or sending report emails. */
export const createReportsProcessor: (deps: ReportsProcessorDeps) => (job: ProcessorJob) => Promise<ReportsResult> =
  () => (job) => {
    JOBS.reports.parse(job.data);
    return Promise.resolve({ generated: 0, autoSent: 0 });
  };
