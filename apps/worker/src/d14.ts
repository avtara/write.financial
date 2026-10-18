// SPDX-License-Identifier: AGPL-3.0-only
/**
 * D14 (confirmation is a system boundary): the worker never creates or changes transactions, postings, budgets, or
 * goals. Two checks enforce it, both reading this file (plan §6):
 * - `WorkerDb`, the only database access processors get, has exactly the keys in {@link WORKER_REPOSITORIES}
 *   (type-level test in worker-db.test.ts).
 * - The architecture test (d14.test.ts) parses every import of `apps/worker/src` and fails on {@link FORBIDDEN_IMPORTS},
 *   on {@link DB_CONNECTION_MODULE} outside {@link DB_CONNECTION_FILE}, and on relative imports leaving the app.
 */

/**
 * Repositories processors may use. Plan §6 allows `review_items`, `scheduled_occurrences`, `notifications`,
 * `notification_outbox`, `market_quotes`, `user_quotes`, `fx_rates`, `snapshots`, `reports`, `periods.lock`,
 * `job_status`, and logs; each is added here when its processor lands. M0 has only maintenance.
 */
export const WORKER_REPOSITORIES = ['maintenance'] as const;

export type WorkerRepository = (typeof WORKER_REPOSITORIES)[number];

/**
 * Modules the worker must not import: a specifier matches when it equals the module or continues with `/`.
 * Add every transaction, posting, budget, and goal repository module here in the change that creates it.
 */
export const FORBIDDEN_IMPORTS: readonly { readonly module: string; readonly reason: string }[] = [
  { module: '@wf/auth', reason: 'the worker has no access to sessions or credentials (it connects as wf_worker)' },
  { module: '@wf/db/transactions', reason: 'D14: only a user confirmation creates or changes transactions' },
  { module: '@wf/db/postings', reason: 'D14: postings belong to confirmed transactions' },
  { module: '@wf/db/budgets', reason: 'D14: the worker proposes budget changes as review items' },
  { module: '@wf/db/goals', reason: 'D14: the worker proposes goal contributions as review items' },
  { module: '@wf/db/schema', reason: 'raw tables bypass the WorkerDb repositories' },
  { module: 'drizzle-orm', reason: 'only @wf/db queries Postgres (plan §3)' },
  { module: 'postgres', reason: 'only @wf/db opens Postgres connections (plan §3)' },
];

/** Opens raw connections; allowed only in the file that builds `WorkerDb`. */
export const DB_CONNECTION_MODULE = '@wf/db/db';
export const DB_CONNECTION_FILE = 'worker-db.ts';
