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
import { createAccounts, type AccountsRepository } from '@wf/db/accounts';
import { createBudgets, type BudgetsRepository } from '@wf/db/budgets';
import { createCategories, type CategoriesRepository } from '@wf/db/categories';
import { createDashboard, type DashboardRepository } from '@wf/db/dashboard';
import { createDb } from '@wf/db/db';
import { createDrafts, type DraftsRepository } from '@wf/db/drafts';
import { createFxRates, type FxRatesRepository } from '@wf/db/fx-rates';
import { createInstanceSettings } from '@wf/db/instance-settings';
import { createInvitations } from '@wf/db/invitations';
import { createNotifications, type NotificationsRepository } from '@wf/db/notifications';
import { createProfiles, type ProfilesRepository } from '@wf/db/profiles';
import { createRecentItems, type RecentItemsRepository } from '@wf/db/recent-items';
import { createPreferences, type PreferencesRepository } from '@wf/db/preferences';
import { createReview, type ReviewRepository } from '@wf/db/review';
import { createSchedules, type SchedulesRepository } from '@wf/db/schedules';
import { createSecurityEvents, type SecurityEvents } from '@wf/db/security-events';
import { createPeriods, type PeriodsRepository } from '@wf/db/periods';
import { createTags, type TagsRepository } from '@wf/db/tags';
import { createTransactionQuery, type TransactionQueryRepository } from '@wf/db/transaction-query';
import { createTransactions, type TransactionsRepository } from '@wf/db/transactions';
import { createUserKeys } from '@wf/db/user-keys';
import type { Locale } from '@wf/i18n/locale';
import { overwriteServerAsyncLocalStorage } from '@wf/i18n/runtime';
import { createInstanceMailer, instanceSmtp, sendWith } from '@wf/integrations/instance-mailer';
import type { Mailer } from '@wf/integrations/mailer';
import { createObjectStore, type ObjectStore } from '@wf/integrations/objectstore';
import { Redis } from 'ioredis';
import { pino, type Logger } from 'pino';
import { createInstanceStore, type InstanceStore } from './instance-store.ts';
import { createLogger } from './logger.ts';
import { createQueueBoard, type QueueBoard } from './queue-board.ts';

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
  readonly securityEvents: Pick<SecurityEvents, 'list'>;
  /** Ledger repositories, on `wf_app`. */
  readonly accounts: AccountsRepository;
  readonly categories: CategoriesRepository;
  readonly tags: TagsRepository;
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
  /** Review queue, notifications, recurrences, and subscriptions (M3), on `wf_app`. */
  readonly review: ReviewRepository;
  readonly notifications: NotificationsRepository;
  readonly schedules: SchedulesRepository;
  /** ⌘K "Baru dibuka". */
  readonly recentItems: RecentItemsRepository;
  readonly mailer: Mailer;
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
    accounts: createAccounts(appDb, { now }),
    categories: createCategories(appDb, { getDek }),
    tags: createTags(appDb),
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
    review: createReview(appDb, { getDek, now }),
    notifications: createNotifications(appDb, { now }),
    schedules: createSchedules(appDb, { now }),
    recentItems: createRecentItems(appDb, { now }),
    mailer,
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
