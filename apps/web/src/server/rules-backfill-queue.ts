// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The web's `rules-backfill` producer and result reader (FR-AI1, plan §6): the dialog asks the worker to build the
 * proposal list, polls the job, and only applies selected rows in the app after the user confirms. The job id embeds
 * the owner (`rb.{userId}.{requestId}`), and the result reader re-checks the job's payload, so one user can never read
 * another user's proposals (which carry descriptions, categories, and tags — never amounts).
 */
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { createEnqueue, type Enqueue } from '@wf/jobs/enqueue';
import { jobIds, JOBS, QUEUE_PREFIX, type JobPayload } from '@wf/jobs/queues';
import type { RuleBackfillPreview } from '@wf/db/rule-backfill';

export type RuleBackfillJobStatus =
  | { readonly status: 'pending' }
  | { readonly status: 'completed'; readonly preview: RuleBackfillPreview }
  | { readonly status: 'failed' };

export interface RulesBackfillQueue {
  /** Adds one proposal build; returns the deterministic job id the dialog polls. */
  readonly enqueue: (payload: JobPayload<'rules-backfill'>, requestId: string) => Promise<string>;
  /** The job's state, only for the job's owner; another user's job is reported as `failed` (no leak). */
  readonly status: (jobId: string, userId: string) => Promise<RuleBackfillJobStatus>;
}

/** The part of a BullMQ job the owner check and result reader need. */
export interface RulesBackfillJob {
  readonly data: unknown;
  readonly returnvalue: unknown;
  state: () => Promise<string>;
}

/** The job's state for `userId`, refusing another owner's job without reading its result. */
export async function ruleBackfillJobStatus(job: RulesBackfillJob, userId: string): Promise<RuleBackfillJobStatus> {
  const owner = JOBS['rules-backfill'].safeParse(job.data);
  if (!owner.success || owner.data.userId !== userId) return { status: 'failed' };
  const state = await job.state();
  if (state === 'completed') return { status: 'completed', preview: job.returnvalue as RuleBackfillPreview };
  if (state === 'failed') return { status: 'failed' };
  return { status: 'pending' };
}

export interface RulesBackfillQueueOptions {
  readonly redis: string;
  readonly logger: { error: (fields: object, message: string) => void };
}

export function createRulesBackfillQueue({ redis: url, logger }: RulesBackfillQueueOptions): RulesBackfillQueue {
  // BullMQ requires `maxRetriesPerRequest: null` on its connection; it connects on the first command.
  const connection = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: null });
  connection.on('error', (error: Error) => {
    logger.error({ err: error }, 'rules backfill redis connection error');
  });
  let queue: Queue | undefined;
  const port: Enqueue = createEnqueue((name) => (queue ??= new Queue(name, { connection, prefix: QUEUE_PREFIX })));
  const getQueue = () => (queue ??= new Queue('rules-backfill', { connection, prefix: QUEUE_PREFIX }));
  return {
    enqueue: async (payload, requestId) => {
      const id = jobIds['rules-backfill'](payload.userId, requestId);
      await port('rules-backfill', payload, { jobId: id });
      return id;
    },
    status: async (id, userId) => {
      const job = await getQueue().getJob(id);
      if (job === undefined) return { status: 'failed' };
      return ruleBackfillJobStatus(
        { data: job.data, returnvalue: job.returnvalue, state: () => job.getState() },
        userId,
      );
    },
  };
}
