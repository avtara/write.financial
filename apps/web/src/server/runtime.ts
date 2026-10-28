// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The web process's long-lived objects, created once per process on first use:
 * - {@link baseRuntime}: configuration, logger, and Paraglide's per-request locale storage (every request).
 * - {@link services}: the database pools (`wf_app` for app data through `withUser`, `wf_auth` for Better Auth only),
 *   Valkey/Redis, the instance settings, the mailer, and the Better Auth instance. Built lazily so `/healthz` answers
 *   without touching Postgres, Valkey, or the key file.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { createAuth, type WfAuth } from '@wf/auth/auth';
import { createInviter, type Invitation, type Inviter, type InviteInput } from '@wf/auth/invitations';
import { loadConfig, type Config } from '@wf/config';
import { loadKeyring } from '@wf/crypto/keyring';
import { createAiRepository, type AiRepository } from '@wf/db/ai';
import { createAccounts, type AccountsRepository } from '@wf/db/accounts';
import { createAutoRules, type AutoRulesRepository } from '@wf/db/auto-rules';
import { createAccountDeletion, type AccountDeletion } from '@wf/db/account-deletion';
import { createExport, type DataExporter } from '@wf/db/export';
import { createBudgets, type BudgetsRepository } from '@wf/db/budgets';
import { createCategories, type CategoriesRepository } from '@wf/db/categories';
import { createDashboard, type DashboardRepository } from '@wf/db/dashboard';
import { createDebts, type DebtsRepository } from '@wf/db/debts';
import { createDb } from '@wf/db/db';
import { createDrafts, type DraftsRepository } from '@wf/db/drafts';
import { createFxRates, type FxRatesRepository } from '@wf/db/fx-rates';
import { createGmail, type GmailRepository } from '@wf/db/gmail';
import { createGoals, type GoalsRepository } from '@wf/db/goals';
import { createInstanceSettings } from '@wf/db/instance-settings';
import { createInvestments, type InvestmentsRepository } from '@wf/db/investments';
import { createInvitations } from '@wf/db/invitations';
import { createMarketCredentials, type MarketCredentialsRepository } from '@wf/db/market-credentials';
import { createMarketData, type MarketDataRepository } from '@wf/db/market-data';
import { createMarketJobs, type MarketJobs } from '@wf/db/market-jobs';
import {
  createNotifications,
  createNotificationSettings,
  type NotificationSettingsRepository,
  type NotificationsRepository,
} from '@wf/db/notifications';
import { createOnboarding, type OnboardingRepository } from '@wf/db/onboarding';
import { createProfiles, type ProfilesRepository } from '@wf/db/profiles';
import { createRecentItems, type RecentItemsRepository } from '@wf/db/recent-items';
import { createReceivables, type ReceivablesRepository } from '@wf/db/receivables';
import { createReportFiles, type ReportFilesRepository } from '@wf/db/report-files';
import { createReports, type ReportsRepository } from '@wf/db/reports';
import { createPreferences, type PreferencesRepository } from '@wf/db/preferences';
import { createImportReview, type ImportReviewRepository } from '@wf/db/import-review';
import { createReview, type ReviewRepository } from '@wf/db/review';
import { createReceipts, type ReceiptsRepository } from '@wf/db/receipts';
import { createSchedules, type SchedulesRepository } from '@wf/db/schedules';
import { createSecurityEvents, type SecurityEvents } from '@wf/db/security-events';
import { createPeriods, type PeriodsRepository } from '@wf/db/periods';
import { createTags, type TagsRepository } from '@wf/db/tags';
import { createTransactionQuery, type TransactionQueryRepository } from '@wf/db/transaction-query';
import { createTransactions, type TransactionsRepository } from '@wf/db/transactions';
import { createUserKeys } from '@wf/db/user-keys';
import type { Locale } from '@wf/i18n/locale';
import { overwriteServerAsyncLocalStorage } from '@wf/i18n/runtime';
import { createAiClient, type AiClient } from '@wf/integrations/ai';
import { createGmailClient, type GmailFetchPort } from '@wf/integrations/gmail';
import { createInstanceMailer, instanceSmtp, sendWith } from '@wf/integrations/instance-mailer';
import type { Mailer } from '@wf/integrations/mailer';
import { createMarketAdapters, type MarketAdapters } from '@wf/integrations/market/adapters';
import { createObjectStore, type ObjectStore } from '@wf/integrations/objectstore';
import { prepareReceipt } from '@wf/integrations/receipt';
import { Redis } from 'ioredis';
import { pino, type Logger } from 'pino';
import { createInstanceStore, type InstanceStore } from './instance-store.ts';
import { createLogger } from './logger.ts';
import { createQueueBoard, type QueueBoard } from './queue-board.ts';
import { createReportExportQueue, type ReportExportQueue } from './report-queue.ts';
import { createRulesBackfillQueue, type RulesBackfillQueue } from './rules-backfill-queue.ts';
import { createReceiptQueue, type ReceiptQueue } from './receipt-queue.ts';
import { createGmailQueue, type GmailQueue } from './gmail-queue.ts';

export interface LocaleStore {
  locale?: Locale;
  origin?: string;
  messageCalls?: Set<string>;
}

export interface BaseRuntime {
  readonly config: Config;
  readonly logger: Logger;
  readonly localeStorage: AsyncLocalStorage<LocaleStore>;
}

let base: BaseRuntime | undefined;

/** Loaded on the first request, so an invalid environment fails loudly and the client bundle stays free of it. */
export function baseRuntime(): BaseRuntime {
  if (base === undefined) {
    const config = loadConfig(process.env);
    const localeStorage = new AsyncLocalStorage<LocaleStore>();
    overwriteServerAsyncLocalStorage(localeStorage);
    base = { config, logger: createLogger(config.log.level, pino.destination(1)), localeStorage };
  }
  return base;
}

export interface Services extends BaseRuntime {
  readonly now: () => Date;
  readonly auth: WfAuth;
  /** Whether an admin exists; once one does, the answer is kept (admins are never removed in v1). */
  readonly hasAdmin: () => Promise<boolean>;
  readonly instance: InstanceStore;
  /** On `wf_app`. */
  readonly profiles: ProfilesRepository;
  /** On `wf_app`. */
  readonly securityEvents: Pick<SecurityEvents, 'list' | 'append'>;
  /** FR-A11: request/cancel account deletion (the worker does the purge itself). */
  readonly accountDeletion: Pick<AccountDeletion, 'request' | 'cancel'>;
  /** FR-A11: the data export (JSON + CSV), inside the user's RLS scope. */
  readonly export: DataExporter;
  /** Ledger repositories, on `wf_app`. */
  readonly accounts: AccountsRepository;
  readonly categories: CategoriesRepository;
  readonly tags: TagsRepository;
  /** FR-AI1: the user's ordered rules, correction suggestions, preview, and confirmed backfill. */
  readonly autoRules: AutoRulesRepository;
  /** FR-AI2: encrypted configuration, exact budget reservations and metadata-only activity. */
  readonly ai: AiRepository;
  readonly aiClient: AiClient;
  readonly receipts: ReceiptsRepository;
  readonly receiptQueue: ReceiptQueue;
  /** PDF/image rasterization for receipt uploads (FR-T7): lazily imported so `sharp` stays out of the browser graph. */
  readonly receiptPrepare: (
    bytes: Uint8Array,
    mime: string,
  ) => Promise<{
    /** The original bytes (a PDF) or the rasterized WebP page images. */
    readonly bytes: Uint8Array;
    readonly mime: string;
    readonly images: readonly { readonly bytes: Uint8Array; readonly mime: string }[];
  }>;
  readonly fxRates: FxRatesRepository;
  /** Periods, budgets, and the dashboard (M2), on `wf_app`. */
  readonly periods: PeriodsRepository;
  readonly budgets: BudgetsRepository;
  readonly dashboard: DashboardRepository;
  readonly transactions: TransactionsRepository;
  readonly transactionQuery: TransactionQueryRepository;
  readonly drafts: DraftsRepository;
  /** `user_preferences` (table prefs), on `wf_app`. */
  readonly preferences: PreferencesRepository;
  /** Receipts and other transaction attachments (encrypted per user). */
  readonly attachmentStore: ObjectStore;
  /** Uploaded account logos (FR-R1), in the avatars bucket (encrypted per user). */
  readonly logoStore: ObjectStore;
  /** Stored report exports ("Laporan tersimpan", FR-LP4), in the reports bucket (encrypted per user). */
  readonly reportFiles: ReportFilesRepository;
  /** Review queue, notifications, recurrences, and subscriptions (M3), on `wf_app`. */
  readonly review: ReviewRepository;
  /** Statement import (FR-L9): turns the browser's parsed rows into review items, on `wf_app`. */
  readonly importReview: ImportReviewRepository;
  readonly notifications: NotificationsRepository;
  /** Settings › Notifikasi (FR-ST3). */
  readonly notificationSettings: NotificationSettingsRepository;
  readonly schedules: SchedulesRepository;
  /** ⌘K "Baru dibuka". */
  readonly recentItems: RecentItemsRepository;
  /** FR-A4 onboarding progress and the first savings goal (step 4), on `wf_app`. */
  readonly onboarding: OnboardingRepository;
  readonly goals: GoalsRepository;
  /** Debts, installments, and credit card payments (M4), on `wf_app`. */
  readonly debts: DebtsRepository;
  /** Receivables (M4); the Debts page reads their total. */
  readonly receivables: ReceivablesRepository;
  /** Investments (M5): assets, trades, the portfolio, and the quotes behind it, on `wf_app`. */
  readonly investments: InvestmentsRepository;
  /** Market data (M5, FR-I5/I6): quotes, the user's own-key results, the request log. */
  readonly marketData: MarketDataRepository;
  /** Reports (M6): the stored report snapshots and their generation, on `wf_app`. */
  readonly reports: ReportsRepository;
  /** Settings › "API kurs & pasar": the user's keys (FR-ST4). */
  readonly marketCredentials: MarketCredentialsRepository;
  /** Settings › Gmail and the ingest log (FR-AI4), on `wf_app` (tokens stay sealed). */
  readonly gmail: GmailRepository;
  /** The real Gmail fetch port, for the card's filter dry run (nothing it answers is stored). */
  readonly gmailFetch: GmailFetchPort;
  readonly gmailQueue: GmailQueue;
  /** Sync targets, the decrypted key for a request, tests per hour, the built-in sources' state. */
  readonly marketJobs: MarketJobs;
  /** Quote adapters (egress-allowlisted) for "Tes koneksi" and "Sinkronkan harga" with the user's key. */
  readonly marketAdapters: MarketAdapters;
  readonly mailer: Mailer;
  /** BullMQ producer for `report-export` (FR-LP4): the web asks the worker to render a stored report. */
  readonly reportExportQueue: ReportExportQueue;
  /** BullMQ producer/reader for `rules-backfill` (FR-AI1): proposal-only work in the worker. */
  readonly rulesBackfillQueue: RulesBackfillQueue;
  /** Sends one message through SMTP settings that are not saved yet ("Kirim email uji"). */
  readonly sendWith: typeof sendWith;
  readonly invite: (inviter: Inviter, input: InviteInput) => Promise<Invitation>;
  /** Bull Board over the `@wf/jobs` queues; the queues connect on first use. */
  readonly queueBoard: () => QueueBoard;
}

/** Builds every service from `runtime`; separate from {@link services} so tests can call it with their own config. */
export async function createServices(runtime: BaseRuntime): Promise<Services> {
  const { config, logger } = runtime;
  const now = () => new Date();
  const keyring = await loadKeyring(config.crypto.kekFile);
  const appDb = createDb(config.db.appUrl);
  const authDb = createDb(config.db.authUrl);
  // Commands wait while Valkey restarts instead of failing the request at once.
  const redis = new Redis(config.redis.url, { lazyConnect: true, maxRetriesPerRequest: 3 });
  redis.on('error', (error: Error) => {
    logger.error({ err: error }, 'redis connection error');
  });

  const instance = createInstanceStore(createInstanceSettings(appDb, keyring), Date.now);
  const mailer = createInstanceMailer({ env: config.mail, smtp: instanceSmtp(instance), send: sendWith });
  const auth = createAuth({ config, db: authDb, redis, mailer, settings: instance.get, logger, now });

  let adminExists = false;
  let board: QueueBoard | undefined;
  const getDek = createUserKeys(appDb, keyring).getOrCreateDek;
  return {
    ...runtime,
    now,
    auth,
    hasAdmin: async () => {
      adminExists ||= await auth.hasAdmin();
      return adminExists;
    },
    instance,
    profiles: createProfiles(appDb),
    securityEvents: createSecurityEvents(appDb),
    accountDeletion: createAccountDeletion(appDb),
    export: createExport(appDb),
    accounts: createAccounts(appDb, { now }),
    categories: createCategories(appDb, { getDek }),
    tags: createTags(appDb),
    autoRules: createAutoRules(appDb, { now }),
    ai: createAiRepository(appDb, { getDek, now, allowedBaseUrls: config.ai.allowedBaseUrls }),
    aiClient: createAiClient({ now, allowedBaseUrls: config.ai.allowedBaseUrls }),
    receipts: createReceipts(appDb, { getDek, now }),
    receiptQueue: createReceiptQueue({ redis: config.redis.url, logger }),
    receiptPrepare: prepareReceipt,
    fxRates: createFxRates(appDb),
    periods: createPeriods(appDb, { now }),
    budgets: createBudgets(appDb, { now }),
    dashboard: createDashboard(appDb, { now }),
    transactions: createTransactions(appDb, { getDek, now }),
    transactionQuery: createTransactionQuery(appDb, { getDek }),
    drafts: createDrafts(appDb, { getDek }),
    preferences: createPreferences(appDb),
    attachmentStore: createObjectStore({ s3: config.s3, bucket: 'attachments', getDek }),
    logoStore: createObjectStore({ s3: config.s3, bucket: 'avatars', getDek }),
    reportFiles: createReportFiles(appDb, createObjectStore({ s3: config.s3, bucket: 'reports', getDek })),
    review: createReview(appDb, { getDek, now }),
    importReview: createImportReview(appDb, { getDek }),
    notifications: createNotifications(appDb, { now }),
    notificationSettings: createNotificationSettings(appDb, { now }),
    schedules: createSchedules(appDb, { now }),
    recentItems: createRecentItems(appDb, { now }),
    onboarding: createOnboarding(appDb, { now }),
    goals: createGoals(appDb, { getDek, now }),
    debts: createDebts(appDb, { getDek, now }),
    receivables: createReceivables(appDb, { getDek, now }),
    investments: createInvestments(appDb, { now }),
    marketData: createMarketData(appDb, { now }),
    reports: createReports(appDb),
    marketCredentials: createMarketCredentials(appDb, { getDek, now }),
    marketJobs: createMarketJobs(appDb, { getDek }),
    marketAdapters: createMarketAdapters(),
    gmail: createGmail(appDb, { getDek, now }),
    gmailQueue: createGmailQueue({ redis: config.redis.url, logger }),
    gmailFetch: createGmailClient({
      oauth: { clientId: config.google?.clientId ?? '', clientSecret: config.google?.clientSecret ?? '' },
    }),
    mailer,
    reportExportQueue: createReportExportQueue({ redis: config.redis.url, logger }),
    rulesBackfillQueue: createRulesBackfillQueue({ redis: config.redis.url, logger }),
    sendWith,
    invite: createInviter({
      invitations: createInvitations(appDb),
      settings: instance.get,
      mailer,
      publicUrl: config.publicUrl,
      now,
    }),
    queueBoard: () => (board ??= createQueueBoard({ redis: config.redis.url, logger })),
  };
}

let pending: Promise<Services> | undefined;

/** The process's services, created on the first call. A failed start is not cached, so the next request retries. */
export function services(): Promise<Services> {
  if (pending === undefined) {
    pending = createServices(baseRuntime());
    // Only this start can be pending: a new one begins after this one is dropped.
    pending.catch(() => {
      pending = undefined;
    });
  }
  return pending;
}
