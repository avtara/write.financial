// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `rules-backfill` (FR-AI1): builds the proposal list for a user and a rule scope. The worker never applies a
 * proposal — D14 keeps every category/tag write behind the user's confirmation in the web app, and `wf_worker` has no
 * write grant on rules or transactions. The result carries descriptions, categories, and tags, never amounts.
 */
import type { RuleBackfillPreview } from '@wf/db/rule-backfill';
import { JOBS } from '@wf/jobs/queues';
import type { ProcessorDeps, ProcessorJob } from '../processors.ts';

export function createRulesBackfillProcessor({
  db,
}: ProcessorDeps): (job: ProcessorJob) => Promise<RuleBackfillPreview> {
  return async (job) => {
    const { userId, ruleIds } = JOBS['rules-backfill'].parse(job.data);
    return db.ruleBackfill.preview(userId, ruleIds);
  };
}
