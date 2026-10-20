// SPDX-License-Identifier: AGPL-3.0-only
import type { Mailer } from '@wf/integrations/mailer';
import { createBuiltInFxProviders } from '@wf/integrations/fx/rates';
import type { Enqueue } from '@wf/jobs/enqueue';
import type { JobQueue } from '@wf/jobs/queues';
import { createBalanceChecksProcessor } from './processors/balance-checks.ts';
import { createBudgetAlertsProcessor } from './processors/budget-alerts.ts';
import { createDetectRecurringProcessor } from './processors/detect-recurring.ts';
import { createDispatchProcessor } from './processors/dispatch.ts';
import { createFxProcessor } from './processors/fx.ts';
import { createMaintenanceProcessor } from './processors/maintenance.ts';
import { createNotifyProcessor } from './processors/notify.ts';
import { createOccurrencesProcessor } from './processors/occurrences.ts';
import { createPeriodCloseProcessor } from './processors/period-close.ts';
import { createRemindersProcessor } from './processors/reminders.ts';
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
  /** Adds follow-up jobs (the minute dispatch) under their deterministic ids. */
  readonly enqueue: Enqueue;
  /** Instance or environment SMTP (`notify`). */
  readonly mailer: Mailer;
  /** `PUBLIC_URL`: links in emails. */
  readonly publicUrl: string;
}

export type Processor = (job: ProcessorJob) => Promise<object>;

export interface ProcessorDefinition {
  /** Jobs of this queue that one worker process runs at once. */
  readonly concurrency: number;
  readonly create: (deps: ProcessorDeps) => Processor;
}

/**
 * One processor per enqueueable queue: `@wf/jobs` adding a queue without one here fails to compile. Per-user jobs run
 * a few at a time (each is one short transaction of one user); the instance-wide ones one at a time.
 */
export const PROCESSORS: { readonly [Q in JobQueue]: ProcessorDefinition } = {
  maintenance: { concurrency: 1, create: createMaintenanceProcessor },
  fx: { concurrency: 1, create: (deps) => createFxProcessor(deps, createBuiltInFxProviders()) },
  dispatch: { concurrency: 1, create: createDispatchProcessor },
  occurrences: { concurrency: 2, create: createOccurrencesProcessor },
  reminders: { concurrency: 4, create: createRemindersProcessor },
  'budget-alerts': { concurrency: 2, create: createBudgetAlertsProcessor },
  'balance-checks': { concurrency: 2, create: createBalanceChecksProcessor },
  'period-close': { concurrency: 2, create: createPeriodCloseProcessor },
  notify: { concurrency: 2, create: createNotifyProcessor },
  'detect-recurring': { concurrency: 1, create: createDetectRecurringProcessor },
};
