// SPDX-License-Identifier: AGPL-3.0-only
import { createBuiltInFxProviders } from '@wf/integrations/fx/rates';
import type { Mailer } from '@wf/integrations/mailer';
import type { MarketAdapters } from '@wf/integrations/market/adapters';
import type { ObjectStore } from '@wf/integrations/objectstore';
import type { Enqueue } from '@wf/jobs/enqueue';
import type { JobQueue } from '@wf/jobs/queues';
import { createAccountDeletionProcessor } from './processors/account-deletion.ts';
import { createBalanceChecksProcessor } from './processors/balance-checks.ts';
import { createBudgetAlertsProcessor } from './processors/budget-alerts.ts';
import { createDetectRecurringProcessor } from './processors/detect-recurring.ts';
import { createDispatchProcessor } from './processors/dispatch.ts';
import { createFxProcessor } from './processors/fx.ts';
import { createMaintenanceProcessor } from './processors/maintenance.ts';
import { createMarketByokProcessor } from './processors/market-byok.ts';
import { createMarketServerProcessor } from './processors/market-server.ts';
import { createNotifyProcessor } from './processors/notify.ts';
import { createOccurrencesProcessor } from './processors/occurrences.ts';
import { createPeriodCloseProcessor } from './processors/period-close.ts';
import type { ReportPdfRenderer } from './processors/report-export.ts';
import { createReportExportProcessor } from './processors/report-export.ts';
import { createRemindersProcessor } from './processors/reminders.ts';
import { createRulesBackfillProcessor } from './processors/rules-backfill.ts';
import { createSnapshotsProcessor } from './processors/snapshots.ts';
import { createReportsProcessor } from './processors/reports.ts';
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
  /** Prints the self-contained report HTML into PDF bytes (`report-export`; `createChromiumRenderer`). */
  readonly render: ReportPdfRenderer;
  /** Market quote adapters (egress-allowlisted) and the operator's CoinMarketCap key (`CMC_API_KEY`, null: none). */
  readonly market: { readonly adapters: MarketAdapters; readonly cmcApiKey: string | null };
  /**
   * The encrypted object stores (`account-deletion` purges a leaving user's blobs from both buckets before the
   * database deletes their rows and their DEK).
   */
  readonly objects: { readonly attachments: ObjectPurgePort; readonly avatars: ObjectPurgePort };
}

export type Processor = (job: ProcessorJob) => Promise<object>;

/** The one store method deletion needs; keyed like `Config['s3'].buckets` uses it. */
export type ObjectPurgePort = Pick<ObjectStore, 'deletePrefix'>;

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
  // One deletion at a time: each is a large transaction, and they are rare.
  'account-deletion': { concurrency: 1, create: createAccountDeletionProcessor },
  maintenance: { concurrency: 1, create: createMaintenanceProcessor },
  fx: { concurrency: 1, create: (deps) => createFxProcessor(deps, (onCall) => createBuiltInFxProviders({ onCall })) },
  dispatch: { concurrency: 1, create: createDispatchProcessor },
  occurrences: { concurrency: 2, create: createOccurrencesProcessor },
  reminders: { concurrency: 4, create: createRemindersProcessor },
  'budget-alerts': { concurrency: 2, create: createBudgetAlertsProcessor },
  'balance-checks': { concurrency: 2, create: createBalanceChecksProcessor },
  'period-close': { concurrency: 2, create: createPeriodCloseProcessor },
  reports: { concurrency: 2, create: createReportsProcessor },
  'report-export': { concurrency: 2, create: createReportExportProcessor },
  notify: { concurrency: 2, create: createNotifyProcessor },
  'detect-recurring': { concurrency: 1, create: createDetectRecurringProcessor },
  'rules-backfill': { concurrency: 2, create: createRulesBackfillProcessor },
  'market-server': { concurrency: 1, create: createMarketServerProcessor },
  'market-byok': { concurrency: 2, create: createMarketByokProcessor },
  snapshots: { concurrency: 2, create: createSnapshotsProcessor },
};
