// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Runs the real `rules-backfill` worker job for the queued requests of the E2E instance (no worker runs in the E2E
 * stack). It consumes the actual queue with the production repository, returns only the proposal previews, and exits.
 */
import { once } from 'node:events';
import { createDb } from '@wf/db/db';
import { createRuleBackfillProposals } from '@wf/db/rule-backfill';
import { JOBS, QUEUE_PREFIX } from '@wf/jobs/queues';
import { Worker } from 'bullmq';
import { Redis } from 'ioredis';

const connection = new Redis(process.env['REDIS_URL'] ?? '', { maxRetriesPerRequest: null });
const app = createDb(process.env['DATABASE_URL_WORKER'] ?? '', { max: 1 });
const proposals = createRuleBackfillProposals(app);
const worker = new Worker(
  'rules-backfill',
  async (job) => {
    const payload = JOBS['rules-backfill'].parse(job.data);
    return proposals.preview(payload.userId, payload.ruleIds);
  },
  { connection, prefix: QUEUE_PREFIX },
);
const completed = once(worker, 'completed');
try {
  await worker.waitUntilReady();
  const [job] = (await completed) as [{ returnvalue?: { proposals?: unknown[] } }];
  console.log(JSON.stringify({ proposals: job.returnvalue?.proposals?.length ?? 0 }));
} finally {
  await worker.close();
  await app.$client.end();
  connection.disconnect();
}
