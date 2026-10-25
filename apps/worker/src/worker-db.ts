// SPDX-License-Identifier: AGPL-3.0-only
import type { Config } from '@wf/config';
import type { Keyring } from '@wf/crypto/keyring';
import { createBalanceChecks, type BalanceChecks } from '@wf/db/balance-checks';
import { createBudgetAlerts, type BudgetAlerts } from '@wf/db/budget-alerts';
import { createDb } from '@wf/db/db';
import { createAccountDeletion, type AccountDeletion } from '@wf/db/account-deletion';
import { createDetectRecurring, type DetectRecurring } from '@wf/db/detect-recurring';
import { createDispatch, type Dispatch } from '@wf/db/dispatch';
import { createFxRates, type FxRatesRepository } from '@wf/db/fx-rates';
import { createInstanceSettings } from '@wf/db/instance-settings';
import { createMaintenance, type Maintenance } from '@wf/db/maintenance';
import { createMarketCredentials, type MarketCredentialsRepository } from '@wf/db/market-credentials';
import { createMarketData, type MarketDataRepository } from '@wf/db/market-data';
import { createMarketJobs, type MarketJobs } from '@wf/db/market-jobs';
import { createOccurrenceJobs, type OccurrenceJobs } from '@wf/db/occurrence-jobs';
import { createOutbox, type Outbox } from '@wf/db/outbox';
import { createPeriodClose, type PeriodClose } from '@wf/db/period-close';
import { createPeriods, type PeriodsRepository } from '@wf/db/periods';
import { createPortfolioSnapshots, type PortfolioSnapshots } from '@wf/db/portfolio-snapshots';
import { createGoalSnapshots, type GoalSnapshots } from '@wf/db/goal-snapshots';
import { createPreferences, type PreferencesRepository } from '@wf/db/preferences';
import { createRuleBackfillProposals, type RuleBackfillProposalsRepository } from '@wf/db/rule-backfill';
import { createReportFiles, type ReportFilesRepository } from '@wf/db/report-files';
import { createReports, type ReportsRepository, type ReportView } from '@wf/db/reports';
import { createUserKeys } from '@wf/db/user-keys';
import { createObjectStore } from '@wf/integrations/objectstore';
import { instanceSmtp, type SmtpConnection } from '@wf/integrations/instance-mailer';

/**
 * The only database access processors get (D14, plan §6): one key per repository in `WORKER_REPOSITORIES` (d14.ts),
 * each narrowed to the worker's methods, nothing else. There is deliberately no raw connection or transaction here;
 * none of these repositories writes transactions, postings, budgets, or goals (wf_worker has no grant either).
 */
export interface WorkerDb {
  /** Auth purge and the 90-day notification retention. */
  readonly maintenance: Maintenance;
  /** The daily account-deletion scan and the per-user purge (FR-A11); requesting and cancelling are the app's. */
  readonly accountDeletion: Pick<AccountDeletion, 'due' | 'deleteUser'>;
  /** The built-in side of `fx_rates` only; a user's manual rates stay out of reach. */
  readonly fxRates: Pick<FxRatesRepository, 'currenciesInUse' | 'upsertGlobal'>;
  /** Instance-wide scans of the minute dispatch (ids and time zones only). */
  readonly dispatch: Dispatch;
  /** Materialize, move due occurrences to review, reminders. */
  readonly occurrences: OccurrenceJobs;
  /** FR-P3/P4: closing an ended period, nothing else of the periods repository. */
  readonly periods: Pick<PeriodsRepository, 'lock'>;
  /** FR-P4 proposals in the Review queue. */
  readonly periodClose: PeriodClose;
  readonly budgetAlerts: BudgetAlerts;
  readonly balanceChecks: BalanceChecks;
  readonly detectRecurring: DetectRecurring;
  /** FR-AI1: read-only backfill proposals; applying them stays the user's confirmation in the web app. */
  readonly ruleBackfill: RuleBackfillProposalsRepository;
  /** Email delivery of notifications. */
  readonly outbox: Outbox;
  /** Market data writes: built-in quotes (global), the user's own-key quotes, the request log. */
  readonly marketData: Pick<MarketDataRepository, 'recordServerQuotes' | 'recordUserQuotes' | 'logRequest'>;
  /** The user's keys: which exist (last 4 only) and the outcome of a request (status, quota, pause). */
  readonly marketCredentials: Pick<MarketCredentialsRepository, 'list' | 'setStatus'>;
  /** What the market jobs read (targets, decrypted key for a request) and the built-in sources' state. */
  readonly marketJobs: Pick<
    MarketJobs,
    | 'serverTargets'
    | 'byokUsers'
    | 'userTargets'
    | 'credential'
    | 'lastRequests'
    | 'providerState'
    | 'setProviderState'
    | 'purgeLogs'
    | 'baselineExists'
  >;
  /** The daily portfolio snapshot (reads the portfolio, writes `portfolio_snapshots` only). */
  readonly portfolioSnapshots: PortfolioSnapshots;
  /** Dated goal positions, including explicit empty days (writes only `goal_snapshots`). */
  readonly goalSnapshots: GoalSnapshots;
  /** FR-LP1: generate snapshots, exposing only their ids to the worker (no financial values in job results). */
  readonly reports: {
    readonly pendingMonthly: ReportsRepository['pendingMonthly'];
    readonly generate: (...args: Parameters<ReportsRepository['generate']>) => Promise<{ readonly id: string }>;
    /** The full stored view for the export processor (in-process only; job payloads keep ids). */
    readonly get: (userId: string, id: string) => Promise<ReportView>;
  };
  /** FR-LP4: stores export bytes in the `reports` bucket and the meta row; resolves the email recipient. */
  readonly reportFiles: Pick<ReportFilesRepository, 'save' | 'recipient'>;
  /** The auto-send opt-in (FR-LP4) and nothing else of the preferences. */
  readonly preferences: Pick<PreferencesRepository, 'get'>;
}

export interface WorkerDbConnection {
  readonly db: WorkerDb;
  /** The SMTP settings saved in the setup wizard with the decrypted password, for the mailer; `null` when none. */
  readonly smtp: () => Promise<SmtpConnection | null>;
  /** Ends the pool; waits for running queries. */
  close(): Promise<void>;
}

export interface WorkerDbOptions {
  /** Clock of `periods.lock` (tests); the other repositories take the job's clock per call. */
  readonly now?: () => Date;
  /** The S3 settings (the `reports` bucket) for the encrypted report export files (FR-LP4). */
  readonly s3: Config['s3'];
}

/**
 * Opens a lazily connecting pool as `wf_worker` (`DATABASE_URL_WORKER`). The keyring unwraps users' DEKs (review item
 * payloads and market keys are encrypted) and the instance DEK (SMTP password).
 */
export function openWorkerDb(url: string, keyring: Keyring, options: WorkerDbOptions): WorkerDbConnection {
  const database = createDb(url, { max: 4 });
  const { getOrCreateDek: getDek } = createUserKeys(database, keyring);
  const { currenciesInUse, upsertGlobal } = createFxRates(database);
  const { lock } = createPeriods(database, options);
  const { advance, remind } = createOccurrenceJobs(database, { getDek });
  const { endedPeriods, propose } = createPeriodClose(database, { getDek });
  const { purgeExpiredAuth, purgeNotifications, purgeAiLogs } = createMaintenance(database);
  const { due, deleteUser } = createAccountDeletion(database);
  const { users, dueReminders, pendingOutbox } = createDispatch(database);
  const { check: checkBudgets } = createBudgetAlerts(database);
  const { check: checkBalances } = createBalanceChecks(database);
  const { detect } = createDetectRecurring(database);
  const { preview: previewRuleBackfill } = createRuleBackfillProposals(database);
  const { get, markSent, markFailed } = createOutbox(database);
  const { generate: generateReport, pendingMonthly, get: getReport } = createReports(database);
  const { record: recordGoals } = createGoalSnapshots(database);
  // The export files are encrypted with the owner's DEK before they leave for object storage (PRD §9.1).
  const { save: saveReportFile, recipient: reportRecipient } = createReportFiles(
    database,
    createObjectStore({ s3: options.s3, bucket: 'reports', getDek }),
  );
  const { get: getPreferences } = createPreferences(database);
  const { get: settings, smtpPassword } = createInstanceSettings(database, keyring);
  const { recordServerQuotes, recordUserQuotes, logRequest } = createMarketData(database);
  const { list: listKeys, setStatus } = createMarketCredentials(database, { getDek });
  const {
    serverTargets,
    byokUsers,
    userTargets,
    credential,
    lastRequests,
    providerState,
    setProviderState,
    purgeLogs,
    baselineExists,
  } = createMarketJobs(database, { getDek });
  const { record: recordSnapshot } = createPortfolioSnapshots(database);
  return {
    db: Object.freeze({
      maintenance: Object.freeze({ purgeExpiredAuth, purgeNotifications, purgeAiLogs }),
      accountDeletion: Object.freeze({ due, deleteUser }),
      fxRates: Object.freeze({ currenciesInUse, upsertGlobal }),
      dispatch: Object.freeze({ users, dueReminders, pendingOutbox }),
      occurrences: Object.freeze({ advance, remind }),
      periods: Object.freeze({ lock }),
      periodClose: Object.freeze({ endedPeriods, propose }),
      budgetAlerts: Object.freeze({ check: checkBudgets }),
      balanceChecks: Object.freeze({ check: checkBalances }),
      detectRecurring: Object.freeze({ detect }),
      ruleBackfill: Object.freeze({ preview: previewRuleBackfill }),
      outbox: Object.freeze({ get, markSent, markFailed }),
      marketData: Object.freeze({ recordServerQuotes, recordUserQuotes, logRequest }),
      marketCredentials: Object.freeze({ list: listKeys, setStatus }),
      marketJobs: Object.freeze({
        serverTargets,
        byokUsers,
        userTargets,
        credential,
        lastRequests,
        providerState,
        setProviderState,
        purgeLogs,
        baselineExists,
      }),
      portfolioSnapshots: Object.freeze({ record: recordSnapshot }),
      goalSnapshots: Object.freeze({ record: recordGoals }),
      reports: Object.freeze({ generate: generateReport, pendingMonthly, get: getReport }),
      reportFiles: Object.freeze({ save: saveReportFile, recipient: reportRecipient }),
      preferences: Object.freeze({ get: getPreferences }),
    }),
    smtp: instanceSmtp({ get: settings, smtpPassword }),
    close: () => database.$client.end(),
  };
}
