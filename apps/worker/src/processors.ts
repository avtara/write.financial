// SPDX-License-Identifier: AGPL-3.0-only
import type { JobQueue } from '@wf/jobs/queues';
import { createMaintenanceProcessor } from './processors/maintenance.ts';
import type { WorkerDb } from './worker-db.ts';

/** What a processor sees of a BullMQ job: the payload is validated by the processor against its queue's schema. */
export interface ProcessorJob {
  readonly id: string | undefined;
  readonly data: unknown;
  /** Attempts already made before this one. */
  readonly attemptsMade: number;
}

export interface ProcessorDeps {
  readonly db: WorkerDb;
  readonly now: () => Date;
}

export type Processor = (job: ProcessorJob) => Promise<object>;

export interface ProcessorDefinition {
  /** Jobs of this queue that one worker process runs at once. */
  readonly concurrency: number;
  readonly create: (deps: ProcessorDeps) => Processor;
}

/** One processor per enqueueable queue: `@wf/jobs` adding a queue without one here fails to compile. */
export const PROCESSORS: { readonly [Q in JobQueue]: ProcessorDefinition } = {
  maintenance: { concurrency: 1, create: createMaintenanceProcessor },
};
