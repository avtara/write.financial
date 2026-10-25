// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Drizzle schema (plan §4.0–4.2: M0, the M1 ledger, and the M2 periods and budgets). Source of the generated migrations in `migrations/`; roles,
 * grants, Row-Level Security, triggers, and seed rows live in the hand-written SQL next to the generated tables.
 *
 * Better Auth tables (`users` … `passkeys`) follow `npx auth generate` of Better Auth 1.7.10 with the two-factor
 * and passkey plugins, `advanced.database.generateId: 'uuid'`, and these model names. Property names are Better
 * Auth's field names (the Drizzle adapter maps by property), columns are snake_case. Deviations from the generator:
 * ids default to `uuidv7()` (PostgreSQL 18) instead of `gen_random_uuid()`, timestamps are `timestamptz`, and
 * `users` has the app's own columns, which the auth module declares as Better Auth `additionalFields`.
 */
import { AI_FEATURES, AI_LOG_STATUSES, AI_PROVIDERS } from '@wf/domain/ai';
import type { AiConnectionStatus, AiCostSource, AiPricing } from '@wf/domain/ai';
import { ACCOUNT_TYPES } from '@wf/domain/ledger';
import { CATEGORY_GROUPS, CATEGORY_KINDS } from '@wf/domain/categories';
import { POSTING_ROLES, TRANSACTION_SOURCES, TRANSACTION_TYPES } from '@wf/domain/transactions';
import { RECURRENCE_END_TYPES, RECURRENCE_FREQS } from '@wf/domain/recurrence';
import { CANCEL_MODES, SUBSCRIPTION_CYCLES, SUBSCRIPTION_STATUSES, USAGE_RATINGS } from '@wf/domain/subscriptions';
import { GOAL_KINDS, GOAL_STATUSES, GOAL_TARGET_MODES } from '@wf/domain/goals';
import type { GoalValuation } from '@wf/domain/goals';
import { DEBT_KINDS, INTEREST_METHODS, RECALC_MODES } from '@wf/domain/debt';
import { RECEIVABLE_SOURCES, RECEIVABLE_STATUSES } from '@wf/domain/receivables';
import { REPORT_KINDS, REPORT_STATUSES } from '@wf/domain/report';
import type { ReportExportOptions, ReportFormat } from '@wf/domain/report';
import type { RuleAction, RuleCondition } from '@wf/domain/rules';
import { ASSET_CLASSES, DIVIDEND_MODES, PRICE_MODES, TRADE_KINDS, TRADE_STATUSES } from '@wf/domain/investments';
import { CREDENTIAL_STATUSES, MARKET_PROVIDERS, MARKETS } from '@wf/domain/market';
import { LOCALES } from '@wf/i18n/locale';
import type { AlertPct } from '@wf/domain/budget';
import type { LocalDate, PeriodStartDay, YearMonth } from '@wf/domain/period';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  char,
  check,
  customType,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  pgView,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import type { PgTableExtraConfigValue } from 'drizzle-orm/pg-core';

/** `bytea` as `Uint8Array` (postgres.js returns `Buffer`, a `Uint8Array` subclass). */
const bytea = customType<{ data: Uint8Array; driverData: Uint8Array }>({
  dataType: () => 'bytea',
});

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const id = () =>
  uuid('id')
    .primaryKey()
    .default(sql`uuidv7()`);
const createdAt = () => timestamptz('created_at').notNull().defaultNow();
const updatedAt = () =>
  timestamptz('updated_at')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
/** `user_id` of a user-owned row; deleting the user deletes the row. */
const ownerId = () =>
  uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' });

export const locale = pgEnum('locale', LOCALES);
export const userRole = pgEnum('user_role', ['admin', 'user']);

// ---------------------------------------------------------------------------------------------------------------
// Better Auth
// ---------------------------------------------------------------------------------------------------------------

export const users = pgTable(
  'users',
  {
    id: id(),
    name: text('name').notNull(),
    email: text('email').notNull().unique(),
    emailVerified: boolean('email_verified').notNull().default(false),
    image: text('image'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    twoFactorEnabled: boolean('two_factor_enabled').default(false),
    /** Preferred name for greetings (FR-A7). */
    nickname: text('nickname'),
    /** IANA time zone; day and period boundaries are computed in it. */
    timezone: text('timezone').notNull().default('Asia/Jakarta'),
    locale: locale('locale').notNull().default('id'),
    baseCurrency: char('base_currency', { length: 3 }).notNull().default('IDR'),
    role: userRole('role').notNull().default('user'),
    onboardingCompletedAt: timestamptz('onboarding_completed_at'),
    /** FR-A4: the onboarding step to resume at (1 Profil … 5 Selesai) while `onboarding_completed_at` is null. */
    onboardingStep: smallint('onboarding_step').notNull().default(1),
    /** Start of the 7-day deletion grace period (FR-A11). */
    deletionRequestedAt: timestamptz('deletion_requested_at'),
  },
  (table) => [
    check('users_base_currency_check', sql`${table.baseCurrency} ~ '^[A-Z]{3}$'`),
    check('users_onboarding_step_check', sql`${table.onboardingStep} between 1 and 5`),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    id: id(),
    expiresAt: timestamptz('expires_at').notNull(),
    token: text('token').notNull().unique(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: ownerId(),
  },
  (table) => [index('sessions_user_id_idx').on(table.userId)],
);

/** Better Auth's `account` model (`account.modelName = 'accounts_auth'`); `accounts` is reserved for M1 money accounts. */
export const accountsAuth = pgTable(
  'accounts_auth',
  {
    id: id(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: ownerId(),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamptz('access_token_expires_at'),
    refreshTokenExpiresAt: timestamptz('refresh_token_expires_at'),
    scope: text('scope'),
    password: text('password'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index('accounts_auth_user_id_idx').on(table.userId)],
);

export const verifications = pgTable(
  'verifications',
  {
    id: id(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamptz('expires_at').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index('verifications_identifier_idx').on(table.identifier)],
);

export const twoFactors = pgTable(
  'two_factors',
  {
    id: id(),
    secret: text('secret').notNull(),
    backupCodes: text('backup_codes').notNull(),
    userId: ownerId(),
    verified: boolean('verified').default(true),
    failedVerificationCount: integer('failed_verification_count').default(0),
    lockedUntil: timestamptz('locked_until'),
  },
  (table) => [index('two_factors_secret_idx').on(table.secret), index('two_factors_user_id_idx').on(table.userId)],
);

export const passkeys = pgTable(
  'passkeys',
  {
    id: id(),
    name: text('name'),
    publicKey: text('public_key').notNull(),
    userId: ownerId(),
    credentialID: text('credential_id').notNull(),
    counter: integer('counter').notNull(),
    deviceType: text('device_type').notNull(),
    backedUp: boolean('backed_up').notNull(),
    transports: text('transports'),
    createdAt: timestamptz('created_at'),
    aaguid: text('aaguid'),
  },
  (table) => [
    index('passkeys_user_id_idx').on(table.userId),
    index('passkeys_credential_id_idx').on(table.credentialID),
  ],
);

// ---------------------------------------------------------------------------------------------------------------
// User-owned
// ---------------------------------------------------------------------------------------------------------------

export const theme = pgEnum('theme', ['dark', 'light', 'system']);
/** `locale` follows `users.locale`; `id`/`en` override the separators (FR-ST2). */
export const numberFormat = pgEnum('number_format', ['locale', 'id', 'en']);
/** `medium` = 15 Okt 2026, `numeric` = 15/10/2026, `iso` = 2026-10-15. */
export const dateFormat = pgEnum('date_format', ['medium', 'numeric', 'iso']);
export const weekStart = pgEnum('week_start', ['monday', 'sunday']);
/** `fixed_day` uses `period_start_day`; `follow_payday` takes the day from the recurring salary (FR-P1). */
export const periodMode = pgEnum('period_mode', ['fixed_day', 'follow_payday']);

export type JsonValue = string | number | boolean | null | readonly JsonValue[] | { readonly [key: string]: JsonValue };
export type JsonObject = { readonly [key: string]: JsonValue };

/** 1:1 with `users`. The UI language is `users.locale` (one source of truth, also read by Better Auth sessions). */
export const userPreferences = pgTable(
  'user_preferences',
  {
    userId: ownerId().primaryKey(),
    theme: theme('theme').notNull().default('dark'),
    numberFormat: numberFormat('number_format').notNull().default('locale'),
    dateFormat: dateFormat('date_format').notNull().default('medium'),
    weekStart: weekStart('week_start').notNull().default('monday'),
    hideBalances: boolean('hide_balances').notNull().default(false),
    periodStartDay: smallint('period_start_day')
      .$type<PeriodStartDay>()
      .notNull()
      .default(1 as PeriodStartDay),
    periodMode: periodMode('period_mode').notNull().default('fixed_day'),
    notif: jsonb('notif').$type<JsonObject>().notNull().default({}),
    dashboardLayout: jsonb('dashboard_layout').$type<JsonObject>().notNull().default({}),
    tablePrefs: jsonb('table_prefs').$type<JsonObject>().notNull().default({}),
    /** FR-U4 card payment buckets in allocation order (`installments`, `spending`); overpayment is always last. */
    ccPaymentPriority: jsonb('cc_payment_priority').$type<readonly string[]>().notNull().default([]),
    /** FR-LP4 "Kirim otomatis tiap tanggal 1": the newest final monthly report is emailed as a PDF when it appears. */
    reportAutoSend: boolean('report_auto_send').notNull().default(false) /**
     * FR-ST1 "Mata uang tambahan" (onboarding step 1): currencies besides the base one the user wants rates for,
     * even before an account uses them. ISO 4217 codes, at most 20.
     */,
    extraCurrencies: char('extra_currencies', { length: 3 })
      .array()
      .notNull()
      .default(sql`'{}'`),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    check('user_preferences_period_start_day_check', sql`${table.periodStartDay} between 1 and 28`),
    check('user_preferences_cc_payment_priority_check', sql`jsonb_typeof(${table.ccPaymentPriority}) = 'array'`),
    check(
      'user_preferences_extra_currencies_check',
      sql`cardinality(${table.extraCurrencies}) <= 20 and array_to_string(${table.extraCurrencies}, ',') ~ '^([A-Z]{3}(,[A-Z]{3})*)?$'`,
    ),
  ],
);

/** The user's DEK wrapped by the KEK (envelope encryption, PRD §9.1). Deleting the row crypto-shreds the user. */
export const userKeys = pgTable(
  'user_keys',
  {
    userId: ownerId().primaryKey(),
    dekWrapped: bytea('dek_wrapped').notNull(),
    kekVersion: integer('kek_version').notNull(),
    createdAt: createdAt(),
    rotatedAt: timestamptz('rotated_at'),
  },
  (table) => [
    check('user_keys_kek_version_check', sql`${table.kekVersion} > 0`),
    index('user_keys_kek_version_idx').on(table.kekVersion),
  ],
);

export const SECURITY_EVENT_TYPES = [
  'sign_in',
  /** Wrong password or second factor for an existing account (FR-A2). */
  'sign_in_failed',
  /** Too many failed attempts; `meta.lockedUntil` says until when (FR-A2). */
  'account_locked',
  'sign_out',
  'session_revoked',
  'password_changed',
  'password_reset',
  'two_factor_enabled',
  'two_factor_disabled',
  'backup_codes_regenerated',
  'passkey_added',
  'passkey_removed',
  'api_key_added',
  'api_key_removed',
  'gmail_connected',
  'gmail_disconnected',
  'data_exported',
  'account_deletion_requested',
  'account_deletion_cancelled',
] as const;
export const securityEventType = pgEnum('security_event_type', SECURITY_EVENT_TYPES);

/** Append-only security history (FR-A10): a trigger rejects UPDATE, DELETE (except the user cascade), and TRUNCATE. */
export const securityEvents = pgTable(
  'security_events',
  {
    id: id(),
    userId: ownerId(),
    type: securityEventType('type').notNull(),
    /** Keyed hash of the client IP, never the IP itself. */
    ipHash: text('ip_hash'),
    userAgent: text('user_agent'),
    meta: jsonb('meta').$type<JsonObject>().notNull().default({}),
    at: timestamptz('at').notNull().defaultNow(),
  },
  (table) => [
    index('security_events_user_id_id_idx').on(table.userId, table.id.desc()),
    check('security_events_ip_hash_check', sql`${table.ipHash} ~ '^[0-9a-f]{64}$'`),
    check('security_events_user_agent_check', sql`length(${table.userAgent}) <= 512`),
    check('security_events_meta_check', sql`jsonb_typeof(${table.meta}) = 'object'`),
  ],
);

// ---------------------------------------------------------------------------------------------------------------
// Instance (global)
// ---------------------------------------------------------------------------------------------------------------

export const registrationMode = pgEnum('registration_mode', ['closed', 'open', 'invite']);

/** Exactly one row (seeded by the migration), edited by the setup wizard (FR-OP1). */
export const instanceSettings = pgTable(
  'instance_settings',
  {
    singleton: boolean('singleton').primaryKey().default(true),
    instanceName: text('instance_name').notNull().default('write.financial'),
    publicUrl: text('public_url'),
    defaultLocale: locale('default_locale').notNull().default('id'),
    defaultTimezone: text('default_timezone').notNull().default('Asia/Jakarta'),
    registrationMode: registrationMode('registration_mode').notNull().default('closed'),
    setupCompletedAt: timestamptz('setup_completed_at'),
    smtpHost: text('smtp_host'),
    smtpPort: integer('smtp_port'),
    /** Implicit TLS (port 465); otherwise STARTTLS when the server offers it. */
    smtpSecure: boolean('smtp_secure').notNull().default(false),
    smtpUsername: text('smtp_username'),
    /** Encrypted with the instance DEK, AAD user `instance`. */
    smtpPasswordEnc: bytea('smtp_password_enc'),
    smtpFrom: text('smtp_from'),
    /** Instance DEK wrapped by the KEK with AAD user `instance`; created on first use. */
    instanceDekWrapped: bytea('instance_dek_wrapped'),
    updatedAt: updatedAt(),
  },
  (table) => [
    check('instance_settings_singleton_check', sql`${table.singleton}`),
    check('instance_settings_smtp_port_check', sql`${table.smtpPort} between 1 and 65535`),
    check(
      'instance_settings_smtp_check',
      sql`(${table.smtpHost} is null) = (${table.smtpPort} is null) and (${table.smtpHost} is null) = (${table.smtpFrom} is null) and (${table.smtpHost} is not null or (${table.smtpUsername} is null and ${table.smtpPasswordEnc} is null))`,
    ),
    check(
      'instance_settings_smtp_password_check',
      sql`${table.smtpPasswordEnc} is null or ${table.instanceDekWrapped} is not null`,
    ),
  ],
);

/** Invitations for `registration_mode = 'invite'`; the token itself is only ever sent by email. */
export const invitations = pgTable(
  'invitations',
  {
    id: id(),
    email: text('email').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamptz('expires_at').notNull(),
    invitedBy: uuid('invited_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    usedAt: timestamptz('used_at'),
    createdAt: createdAt(),
  },
  (table) => [
    index('invitations_invited_by_idx').on(table.invitedBy),
    index('invitations_email_idx').on(sql`lower(${table.email})`),
    check('invitations_token_hash_check', sql`${table.tokenHash} ~ '^[0-9a-f]{64}$'`),
  ],
);

/** Hosting plans (D17); every user is on {@link DEFAULT_PLAN} unless `user_plans` says otherwise. */
export const plans = pgTable('plans', {
  code: text('code').primaryKey(),
  name: text('name').notNull(),
  createdAt: createdAt(),
});

export const DEFAULT_PLAN = 'personal';

export const userPlans = pgTable('user_plans', {
  userId: ownerId().primaryKey(),
  planCode: text('plan_code')
    .notNull()
    .references(() => plans.code),
  since: timestamptz('since').notNull().defaultNow(),
});

export const FEATURES = ['attachments', 'ai_assistant', 'gmail_import', 'market_byok', 'data_export'] as const;
export const feature = pgEnum('feature', FEATURES);

/** What a plan includes; `limit` is a quota in the feature's unit, `null` = unlimited. */
export const entitlements = pgTable(
  'entitlements',
  {
    planCode: text('plan_code')
      .notNull()
      .references(() => plans.code, { onDelete: 'cascade' }),
    feature: feature('feature').notNull(),
    limit: bigint('limit', { mode: 'bigint' }),
  },
  (table) => [
    primaryKey({ columns: [table.planCode, table.feature] }),
    check('entitlements_limit_check', sql`${table.limit} >= 0`),
  ],
);

// ---------------------------------------------------------------------------------------------------------------
// Ledger (M1, plan §4.1). Child rows reference their parents with composite `(user_id, id)` foreign keys, so a row
// can never point at another user's account, category, transaction, or tag (foreign-key checks bypass RLS).
// ---------------------------------------------------------------------------------------------------------------

const money = (name: string) => bigint(name, { mode: 'bigint' });
const currency = (name: string) => char(name, { length: 3 });
const localDate = (name: string) => date(name, { mode: 'string' }).$type<LocalDate>();
/** `numeric(20,8)` exchange rate as a decimal string (`@wf/domain/fx`). */
const rate = (name: string) => numeric(name, { precision: 20, scale: 8 });
const currencyCheck = (name: string, column: unknown) => check(name, sql`${column} ~ '^[A-Z]{3}$'`);

export const accountType = pgEnum('account_type', ACCOUNT_TYPES);
export const accountStatus = pgEnum('account_status', ['active', 'archived']);

/** Money accounts (FR-R1–R6). Balance = opening + Σ postings of non-deleted transactions + Σ adjustments. */
export const accounts = pgTable(
  'accounts',
  {
    id: id(),
    userId: ownerId(),
    type: accountType('type').notNull(),
    providerName: text('provider_name').notNull(),
    logoKey: text('logo_key'),
    displayName: varchar('display_name', { length: 40 }).notNull(),
    last4: char('last4', { length: 4 }),
    phoneMasked: text('phone_masked'),
    currency: currency('currency').notNull(),
    openingBalanceMinor: money('opening_balance_minor')
      .notNull()
      .default(sql`0`),
    openingDate: localDate('opening_date').notNull(),
    color: text('color').notNull(),
    includeInAvailable: boolean('include_in_available').notNull().default(true),
    showAsCard: boolean('show_as_card').notNull().default(false),
    isDefaultQuickEntry: boolean('is_default_quick_entry').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    status: accountStatus('status').notNull().default('active'),
    archivedAt: timestamptz('archived_at'),
    lowBalanceThresholdMinor: money('low_balance_threshold_minor'),
    lastReconciledAt: timestamptz('last_reconciled_at'),
    ccLimitMinor: money('cc_limit_minor'),
    ccStatementDay: smallint('cc_statement_day'),
    ccDueDay: smallint('cc_due_day'),
    parentAccountId: uuid('parent_account_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique('accounts_user_id_id_key').on(table.userId, table.id),
    index('accounts_user_id_sort_order_idx').on(table.userId, table.sortOrder),
    uniqueIndex('accounts_default_quick_entry_key')
      .on(table.userId)
      .where(sql`${table.isDefaultQuickEntry}`),
    foreignKey({
      name: 'accounts_parent_account_fk',
      columns: [table.userId, table.parentAccountId],
      foreignColumns: [table.userId, table.id],
    }),
    currencyCheck('accounts_currency_check', table.currency),
    check('accounts_last4_check', sql`${table.last4} ~ '^[0-9]{4}$'`),
    check(
      'accounts_cc_days_check',
      sql`${table.ccStatementDay} between 1 and 31 and ${table.ccDueDay} between 1 and 31`,
    ),
    check('accounts_archived_check', sql`(${table.status} = 'archived') = (${table.archivedAt} is not null)`),
    check('accounts_default_active_check', sql`not ${table.isDefaultQuickEntry} or ${table.status} = 'active'`),
  ],
);

export const categoryKind = pgEnum('category_kind', CATEGORY_KINDS);
export const categoryGroup = pgEnum('category_group', CATEGORY_GROUPS);

/** FR-K1/K2. Built-in categories store their key as the name (`system:food`); the UI renders it per locale. */
export const categories = pgTable(
  'categories',
  {
    id: id(),
    userId: ownerId(),
    kind: categoryKind('kind').notNull(),
    group: categoryGroup('group').notNull(),
    name: varchar('name', { length: 24 }).notNull(),
    icon: text('icon').notNull(),
    color: text('color').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    isFixed: boolean('is_fixed').notNull().default(false),
    /** System categories (the "Biaya keuangan" group, "Selisih kurs") cannot be deleted. */
    isSystem: boolean('is_system').notNull().default(false),
    archivedAt: timestamptz('archived_at'),
    deletedAt: timestamptz('deleted_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique('categories_user_id_id_key').on(table.userId, table.id),
    uniqueIndex('categories_name_key')
      .on(table.userId, table.kind, sql`lower(${table.name})`)
      .where(sql`${table.deletedAt} is null`),
    check('categories_name_check', sql`length(btrim(${table.name})) > 0`),
    check(
      'categories_group_check',
      sql`case ${table.kind} when 'expense' then ${table.group} in ('needs', 'wants') when 'income' then ${table.group} in ('active', 'passive', 'other') else ${table.group} = 'financial' end`,
    ),
  ],
);

/** FR-K3. Usage counts are computed from `transaction_tags`. */
export const tags = pgTable(
  'tags',
  {
    id: id(),
    userId: ownerId(),
    slug: varchar('slug', { length: 32 }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique('tags_user_id_id_key').on(table.userId, table.id),
    unique('tags_user_id_slug_key').on(table.userId, table.slug),
    check('tags_slug_check', sql`${table.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
  ],
);

/** The old slug of a merged tag, resolving to the tag it was merged into (FR-K3). */
export const tagAliases = pgTable(
  'tag_aliases',
  {
    id: id(),
    userId: ownerId(),
    tagId: uuid('tag_id').notNull(),
    slug: varchar('slug', { length: 32 }).notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    unique('tag_aliases_user_id_slug_key').on(table.userId, table.slug),
    index('tag_aliases_tag_id_idx').on(table.tagId),
    foreignKey({
      name: 'tag_aliases_tag_fk',
      columns: [table.userId, table.tagId],
      foreignColumns: [tags.userId, tags.id],
    }).onDelete('cascade'),
    check('tag_aliases_slug_check', sql`${table.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
  ],
);

export const transactionType = pgEnum('transaction_type', TRANSACTION_TYPES);
export const transactionSource = pgEnum('transaction_source', TRANSACTION_SOURCES);

/**
 * Confirmed transactions only (D14): candidates live in `review_items`, so `confirmed_by_user_at` is never null.
 * `client_id` makes a form submission idempotent. Soft-deleted rows (`deleted_at`) keep Undo possible.
 */
export const transactions = pgTable(
  'transactions',
  {
    id: id(),
    userId: ownerId(),
    type: transactionType('type').notNull(),
    occurredAt: timestamptz('occurred_at').notNull(),
    /** `occurred_at` as a calendar date in the user's time zone. */
    localDate: localDate('local_date').notNull(),
    description: text('description'),
    merchant: text('merchant'),
    noteEnc: bytea('note_enc'),
    categoryId: uuid('category_id'),
    source: transactionSource('source').notNull().default('manual'),
    recurrenceId: uuid('recurrence_id'),
    splitParentId: uuid('split_parent_id'),
    duplicatedFromId: uuid('duplicated_from_id'),
    importBatchId: uuid('import_batch_id'),
    externalHash: text('external_hash'),
    goalId: uuid('goal_id'),
    paidFromGoalId: uuid('paid_from_goal_id'),
    receivableId: uuid('receivable_id'),
    clientId: uuid('client_id').notNull(),
    confirmedByUserAt: timestamptz('confirmed_by_user_at').notNull(),
    deletedAt: timestamptz('deleted_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  // Annotated: transactions and receivables reference each other, which TypeScript cannot infer.
  (table): PgTableExtraConfigValue[] => [
    unique('transactions_user_id_id_key').on(table.userId, table.id),
    unique('transactions_user_id_client_id_key').on(table.userId, table.clientId),
    unique('transactions_import_key').on(table.userId, table.importBatchId, table.externalHash),
    index('transactions_user_id_local_date_idx').on(table.userId, table.localDate.desc(), table.occurredAt.desc()),
    index('transactions_user_id_category_id_idx').on(table.userId, table.categoryId),
    index('transactions_split_parent_id_idx').on(table.splitParentId),
    index('transactions_merchant_trgm_idx').using('gin', table.merchant.op('gin_trgm_ops')),
    index('transactions_description_trgm_idx').using('gin', table.description.op('gin_trgm_ops')),
    foreignKey({
      name: 'transactions_category_fk',
      columns: [table.userId, table.categoryId],
      foreignColumns: [categories.userId, categories.id],
    }),
    foreignKey({
      name: 'transactions_split_parent_fk',
      columns: [table.userId, table.splitParentId],
      foreignColumns: [table.userId, table.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'transactions_goal_fk',
      columns: [table.userId, table.goalId],
      foreignColumns: [goals.userId, goals.id],
    }),
    foreignKey({
      name: 'transactions_paid_from_goal_fk',
      columns: [table.userId, table.paidFromGoalId],
      foreignColumns: [goals.userId, goals.id],
    }),
    foreignKey({
      name: 'transactions_receivable_fk',
      columns: [table.userId, table.receivableId],
      foreignColumns: [receivables.userId, receivables.id],
    }),
    index('transactions_receivable_id_idx').on(table.userId, table.receivableId),
    check('transactions_confirmed_check', sql`${table.confirmedByUserAt} is not null`),
    check('transactions_category_type_check', sql`${table.categoryId} is null or ${table.type} <> 'transfer'`),
  ],
);

export const postingRole = pgEnum('posting_role', POSTING_ROLES);

/** One line per account (plan §4.1); see `@wf/domain/transactions` for how transactions map to postings. */
export const postings = pgTable(
  'postings',
  {
    id: id(),
    userId: ownerId(),
    transactionId: uuid('transaction_id').notNull(),
    accountId: uuid('account_id').notNull(),
    /** Signed, in `currency` (the account's). */
    amountMinor: money('amount_minor').notNull(),
    currency: currency('currency').notNull(),
    /** Units of the base currency per unit of `currency`; null in the base currency. */
    fxRateToBase: rate('fx_rate_to_base'),
    amountBaseMinor: money('amount_base_minor').notNull(),
    role: postingRole('role').notNull().default('principal'),
    /** The fee or "Selisih kurs" category of `fee`/`fx_diff` postings; principal postings use the transaction's. */
    categoryId: uuid('category_id'),
    createdAt: createdAt(),
  },
  (table) => [
    index('postings_user_id_account_id_idx').on(table.userId, table.accountId),
    index('postings_transaction_id_idx').on(table.transactionId),
    foreignKey({
      name: 'postings_transaction_fk',
      columns: [table.userId, table.transactionId],
      foreignColumns: [transactions.userId, transactions.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'postings_account_fk',
      columns: [table.userId, table.accountId],
      foreignColumns: [accounts.userId, accounts.id],
    }),
    foreignKey({
      name: 'postings_category_fk',
      columns: [table.userId, table.categoryId],
      foreignColumns: [categories.userId, categories.id],
    }),
    currencyCheck('postings_currency_check', table.currency),
    check('postings_category_role_check', sql`${table.categoryId} is null or ${table.role} in ('fee', 'fx_diff')`),
    check('postings_fx_diff_check', sql`${table.role} <> 'fx_diff' or ${table.amountMinor} = 0`),
  ],
);

/** Both legs of a transfer as entered, and the rate the FX difference was computed with (FR-T4). */
export const transferMeta = pgTable(
  'transfer_meta',
  {
    transactionId: uuid('transaction_id').primaryKey(),
    userId: ownerId(),
    sentMinor: money('sent_minor').notNull(),
    sentCurrency: currency('sent_currency').notNull(),
    receivedMinor: money('received_minor').notNull(),
    receivedCurrency: currency('received_currency').notNull(),
    /** 1 `rate_base` = `reference_rate` `rate_quote` (the `fx_rates` orientation); null within one currency. */
    referenceRate: rate('reference_rate'),
    rateBase: currency('rate_base'),
    rateQuote: currency('rate_quote'),
    /** `manual` or the provider of the built-in rate. */
    rateSource: text('rate_source'),
    rateAsOf: localDate('rate_as_of'),
    fxDiffBaseMinor: money('fx_diff_base_minor')
      .notNull()
      .default(sql`0`),
  },
  (table) => [
    foreignKey({
      name: 'transfer_meta_transaction_fk',
      columns: [table.userId, table.transactionId],
      foreignColumns: [transactions.userId, transactions.id],
    }).onDelete('cascade'),
    check('transfer_meta_amounts_check', sql`${table.sentMinor} > 0 and ${table.receivedMinor} > 0`),
    check(
      'transfer_meta_rate_check',
      sql`(${table.referenceRate} is null) = (${table.rateBase} is null) and (${table.referenceRate} is null) = (${table.rateQuote} is null) and (${table.referenceRate} is null or ${table.referenceRate} > 0)`,
    ),
  ],
);

/** FR-R4 (c): a correction without a transaction; it changes the balance but is excluded from reports. */
export const balanceAdjustments = pgTable(
  'balance_adjustments',
  {
    id: id(),
    userId: ownerId(),
    accountId: uuid('account_id').notNull(),
    /** Signed change, in the account currency. */
    amountMinor: money('amount_minor').notNull(),
    /** The balance the user entered. */
    actualBalanceMinor: money('actual_balance_minor').notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    index('balance_adjustments_user_id_account_id_idx').on(table.userId, table.accountId),
    foreignKey({
      name: 'balance_adjustments_account_fk',
      columns: [table.userId, table.accountId],
      foreignColumns: [accounts.userId, accounts.id],
    }).onDelete('cascade'),
    check('balance_adjustments_amount_check', sql`${table.amountMinor} <> 0`),
  ],
);

export const ACTIVITY_ENTITIES = ['transaction', 'account', 'category', 'tag'] as const;
export const activityEntity = pgEnum('activity_entity', ACTIVITY_ENTITIES);
export const ACTIVITY_ACTIONS = [
  'created',
  'updated',
  'deleted',
  'restored',
  'duplicated',
  'split',
  'merged',
  'archived',
  'reconciled',
  'recurrence_set',
  'recurrence_stopped',
  'recurrence_resumed',
] as const;
export const activityAction = pgEnum('activity_action', ACTIVITY_ACTIONS);

/** Per-entity timeline (FR-L4): what happened, through which source; no amounts or notes in `meta`. */
export const activityLog = pgTable(
  'activity_log',
  {
    id: id(),
    userId: ownerId(),
    entity: activityEntity('entity').notNull(),
    entityId: uuid('entity_id').notNull(),
    action: activityAction('action').notNull(),
    meta: jsonb('meta').$type<JsonObject>().notNull().default({}),
    at: timestamptz('at').notNull().defaultNow(),
  },
  (table) => [
    index('activity_log_entity_idx').on(table.userId, table.entity, table.entityId, table.at),
    check('activity_log_meta_check', sql`jsonb_typeof(${table.meta}) = 'object'`),
  ],
);

export const attachmentKind = pgEnum('attachment_kind', ['receipt', 'image', 'document']);

/** Transaction attachments; the bytes are encrypted with the user's DEK in object storage (D25). */
export const attachments = pgTable(
  'attachments',
  {
    id: id(),
    userId: ownerId(),
    transactionId: uuid('transaction_id').notNull(),
    bucket: text('bucket').notNull(),
    /** `u/{userId}/{uuid}`; split parts share their parent's objects. */
    objectKey: text('object_key').notNull(),
    thumbnailKey: text('thumbnail_key'),
    mime: text('mime').notNull(),
    size: integer('size').notNull(),
    /** SHA-256 of the plaintext, hex. */
    sha256: char('sha256', { length: 64 }).notNull(),
    kind: attachmentKind('kind').notNull(),
    nameEnc: bytea('name_enc'),
    ocrEnc: bytea('ocr_enc'),
    createdAt: createdAt(),
  },
  (table) => [
    index('attachments_user_id_transaction_id_idx').on(table.userId, table.transactionId),
    foreignKey({
      name: 'attachments_transaction_fk',
      columns: [table.userId, table.transactionId],
      foreignColumns: [transactions.userId, transactions.id],
    }).onDelete('cascade'),
    check('attachments_size_check', sql`${table.size} > 0`),
    check('attachments_sha256_check', sql`${table.sha256} ~ '^[0-9a-f]{64}$'`),
  ],
);

/** Unsaved forms ("Simpan draf", FR-T9); the payload is encrypted JSON. */
export const drafts = pgTable(
  'drafts',
  {
    id: id(),
    userId: ownerId(),
    kind: text('kind').notNull(),
    payloadEnc: bytea('payload_enc').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index('drafts_user_id_kind_idx').on(table.userId, table.kind, table.updatedAt.desc())],
);

export const RECENT_ITEM_KINDS = [
  'transaction',
  'account',
  'category',
  'tag',
  'goal',
  'page',
  'subscription',
  'review',
] as const;
export const recentItemKind = pgEnum('recent_item_kind', RECENT_ITEM_KINDS);

/** "Baru dibuka" in ⌘K (FR-S4). `ref` is an entity id or a page path. */
export const recentItems = pgTable(
  'recent_items',
  {
    userId: ownerId(),
    kind: recentItemKind('kind').notNull(),
    ref: text('ref').notNull(),
    openedAt: timestamptz('opened_at').notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.kind, table.ref] }),
    index('recent_items_user_id_opened_at_idx').on(table.userId, table.openedAt.desc()),
    check('recent_items_ref_check', sql`length(${table.ref}) between 1 and 200`),
  ],
);

export const goalKind = pgEnum('goal_kind', GOAL_KINDS);
export const goalTargetMode = pgEnum('goal_target_mode', GOAL_TARGET_MODES);
/** "Tercapai" (reached) is not stored: it is the balance reaching the target while the goal is still `active`. */
export const goalStatus = pgEnum('goal_status', GOAL_STATUSES);

/**
 * Savings goals and sinking funds (FR-G1–G4, FR-B6: one entity, `kind`). Progress comes from the funding sources
 * (`goal_funding_sources`); recurring contributions are recurrences linked by `goal_contribution_plans`.
 */
export const goals = pgTable(
  'goals',
  {
    id: id(),
    userId: ownerId(),
    name: varchar('name', { length: 40 }).notNull(),
    icon: text('icon').notNull(),
    color: text('color').notNull(),
    kind: goalKind('kind').notNull().default('savings'),
    /** The target in force; for `monthly_expenses` the value last computed from `target_months`. */
    targetMinor: money('target_minor').notNull(),
    targetMode: goalTargetMode('target_mode').notNull().default('fixed'),
    /** `monthly_expenses`: "N× pengeluaran bulanan" (an emergency fund is 3). */
    targetMonths: smallint('target_months'),
    currency: currency('currency').notNull(),
    /** First day of the deadline month. */
    deadlineMonth: localDate('deadline_month'),
    tagId: uuid('tag_id'),
    /** "Simpan di": the account deposits go to by default (onboarding step 4, "Setor manual" › Ke). */
    accountId: uuid('account_id'),
    status: goalStatus('status').notNull().default('active'),
    /** When the goal was marked completed ("Tandai selesai") or used ("Terpakai"); null while active. */
    completedAt: timestamptz('completed_at'),
    sortOrder: integer('sort_order').notNull().default(0),
    archivedAt: timestamptz('archived_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique('goals_user_id_id_key').on(table.userId, table.id),
    index('goals_name_trgm_idx').using('gin', table.name.op('gin_trgm_ops')),
    foreignKey({
      name: 'goals_tag_fk',
      columns: [table.userId, table.tagId],
      foreignColumns: [tags.userId, tags.id],
    }),
    foreignKey({
      name: 'goals_account_fk',
      columns: [table.userId, table.accountId],
      foreignColumns: [accounts.userId, accounts.id],
    }),
    currencyCheck('goals_currency_check', table.currency),
    check('goals_target_check', sql`${table.targetMinor} > 0`),
    check('goals_deadline_check', sql`extract(day from ${table.deadlineMonth}) = 1`),
    check('goals_name_check', sql`length(btrim(${table.name})) > 0`),
    check(
      'goals_target_months_check',
      sql`(${table.targetMode} = 'monthly_expenses') = (${table.targetMonths} is not null) and (${table.targetMonths} is null or ${table.targetMonths} between 1 and 24)`,
    ),
    check('goals_completed_check', sql`(${table.status} = 'active') = (${table.completedAt} is null)`),
  ],
);

/**
 * Accounts: `whole` (the balance counts; one goal per account) or `fixed` (an amount of it, "Nominal tetap").
 * Investment assets (FR-G2, `@wf/domain/goal-assets`): `whole` (the whole asset) or `percent` (`pct_bps` of its units).
 */
export const GOAL_SOURCE_MODES = ['whole', 'fixed', 'percent'] as const;
export const goalSourceMode = pgEnum('goal_source_mode', GOAL_SOURCE_MODES);

/**
 * FR-G2 funding sources of a goal: an account (wholly or a fixed amount ≤ the free balance, checked by the repository)
 * or an investment asset (wholly or a percentage of its units; Σ per asset across goals ≤ 100%, a whole asset counting
 * 100%: trigger `goal_funding_sources_asset_within_100`). Units a DCA buy adds are split by the same percentages.
 */
export const goalFundingSources = pgTable(
  'goal_funding_sources',
  {
    id: id(),
    userId: ownerId(),
    goalId: uuid('goal_id').notNull(),
    /** Exactly one of `account_id` and `asset_id`. */
    accountId: uuid('account_id'),
    assetId: uuid('asset_id'),
    mode: goalSourceMode('mode').notNull(),
    /** `fixed` only, in the account currency. */
    amountMinor: money('amount_minor'),
    /** `percent` (asset) only: basis points of the asset's units, 1–10 000. */
    pctBps: integer('pct_bps'),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table): PgTableExtraConfigValue[] => [
    unique('goal_funding_sources_user_id_id_key').on(table.userId, table.id),
    unique('goal_funding_sources_goal_account_key').on(table.goalId, table.accountId),
    unique('goal_funding_sources_goal_asset_key').on(table.goalId, table.assetId),
    uniqueIndex('goal_funding_sources_whole_key')
      .on(table.userId, table.accountId)
      .where(sql`${table.mode} = 'whole'`),
    index('goal_funding_sources_account_idx').on(table.userId, table.accountId),
    index('goal_funding_sources_asset_idx').on(table.userId, table.assetId),
    foreignKey({
      name: 'goal_funding_sources_goal_fk',
      columns: [table.userId, table.goalId],
      foreignColumns: [goals.userId, goals.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'goal_funding_sources_account_fk',
      columns: [table.userId, table.accountId],
      foreignColumns: [accounts.userId, accounts.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'goal_funding_sources_asset_fk',
      columns: [table.userId, table.assetId],
      foreignColumns: [assets.userId, assets.id],
    }).onDelete('cascade'),
    check('goal_funding_sources_target_check', sql`num_nonnulls(${table.accountId}, ${table.assetId}) = 1`),
    check(
      'goal_funding_sources_amount_check',
      sql`(${table.mode} = 'fixed') = (${table.amountMinor} is not null) and (${table.amountMinor} is null or ${table.amountMinor} > 0)`,
    ),
    // Written without the 'percent' literal: the migration that adds the enum value cannot use it in the same
    // transaction. An account source is whole or fixed; an asset source is whole or (with `pct_bps`) percent.
    check(
      'goal_funding_sources_mode_check',
      sql`(${table.accountId} is null or ${table.mode} in ('whole', 'fixed')) and (${table.assetId} is null or ${table.mode} <> 'fixed')`,
    ),
    check(
      'goal_funding_sources_pct_check',
      sql`(${table.pctBps} is not null) = (${table.assetId} is not null and ${table.mode} <> 'whole') and (${table.pctBps} is null or ${table.pctBps} between 1 and 10000)`,
    ),
  ],
);

export const FX_RATE_TYPES = ['bi_transaction', 'blended', 'manual'] as const;
export const fxRateType = pgEnum('fx_rate_type', FX_RATE_TYPES);

/**
 * 1 `base` = `rate` `quote`. Built-in rows (`user_id` null) are global: the worker writes them, everyone reads them.
 * Manual rows belong to a user (`as_of` = effective from).
 */
export const fxRates = pgTable(
  'fx_rates',
  {
    id: id(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    base: currency('base').notNull(),
    quote: currency('quote').notNull(),
    rate: rate('rate').notNull(),
    provider: text('provider').notNull(),
    rateType: fxRateType('rate_type').notNull(),
    asOf: localDate('as_of').notNull(),
    fetchedAt: timestamptz('fetched_at').notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('fx_rates_global_key')
      .on(table.provider, table.base, table.quote, table.asOf)
      .where(sql`${table.userId} is null`),
    uniqueIndex('fx_rates_manual_key')
      .on(table.userId, table.base, table.quote, table.asOf)
      .where(sql`${table.userId} is not null`),
    index('fx_rates_pair_idx').on(table.base, table.quote, table.asOf.desc()),
    currencyCheck('fx_rates_base_check', table.base),
    currencyCheck('fx_rates_quote_check', table.quote),
    check('fx_rates_pair_check', sql`${table.base} <> ${table.quote}`),
    check('fx_rates_rate_check', sql`${table.rate} > 0`),
    check('fx_rates_manual_check', sql`(${table.userId} is null) = (${table.rateType} <> 'manual')`),
  ],
);

/** Tags on a transaction, at most five (a trigger enforces it, FR-K3). */
export const transactionTags = pgTable(
  'transaction_tags',
  {
    userId: ownerId(),
    transactionId: uuid('transaction_id').notNull(),
    tagId: uuid('tag_id').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.transactionId, table.tagId] }),
    index('transaction_tags_user_id_tag_id_idx').on(table.userId, table.tagId),
    foreignKey({
      name: 'transaction_tags_transaction_fk',
      columns: [table.userId, table.transactionId],
      foreignColumns: [transactions.userId, transactions.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'transaction_tags_tag_fk',
      columns: [table.userId, table.tagId],
      foreignColumns: [tags.userId, tags.id],
    }).onDelete('cascade'),
  ],
);

// ---------------------------------------------------------------------------------------------------------------
// Periods and budgets (M2, plan §4.2). Transactions belong to a period by `local_date` (no `period_id`): a period is
// a date range, so FR-P2 recalculation only moves the range of the open period, and a closed period keeps its range
// and numbers (FR-P3; writes dated inside it are refused).
// ---------------------------------------------------------------------------------------------------------------

export const PERIOD_KINDS = ['normal', 'transition'] as const;
export const periodKind = pgEnum('period_kind', PERIOD_KINDS);
export const PERIOD_STATUSES = ['open', 'closed'] as const;
export const periodStatus = pgEnum('period_status', PERIOD_STATUSES);

/**
 * Materialized monthly periods (FR-P1–P3), contiguous from the first one created. `label` is the month the period
 * ends in (`YYYY-MM`, 25 Sep – 24 Okt = "Oktober"). A recalculated open period may overlap the closed one before it.
 */
export const periods = pgTable(
  'periods',
  {
    id: id(),
    userId: ownerId(),
    label: char('label', { length: 7 }).$type<YearMonth>().notNull(),
    startDate: localDate('start_date').notNull(),
    endDate: localDate('end_date').notNull(),
    days: smallint('days').notNull(),
    kind: periodKind('kind').notNull().default('normal'),
    status: periodStatus('status').notNull().default('open'),
    closedAt: timestamptz('closed_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique('periods_user_id_id_key').on(table.userId, table.id),
    unique('periods_user_id_start_date_key').on(table.userId, table.startDate),
    index('periods_user_id_end_date_idx').on(table.userId, table.endDate),
    check('periods_label_check', sql`${table.label} = to_char(${table.endDate}, 'YYYY-MM')`),
    check(
      'periods_days_check',
      sql`${table.days} = ${table.endDate} - ${table.startDate} + 1 and ${table.days} between 1 and 62`,
    ),
    check('periods_closed_check', sql`(${table.status} = 'closed') = (${table.closedAt} is not null)`),
  ],
);

/** FR-B1: per-category limits from the period labelled `effective_from` until the next version. */
export const budgetVersions = pgTable(
  'budget_versions',
  {
    id: id(),
    userId: ownerId(),
    effectiveFrom: char('effective_from', { length: 7 }).$type<YearMonth>().notNull(),
    /** "Atur anggaran · pemasukan Rp26.000.000": the income the allocation is compared with. */
    expectedIncomeMinor: money('expected_income_minor'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique('budget_versions_user_id_id_key').on(table.userId, table.id),
    unique('budget_versions_user_id_effective_from_key').on(table.userId, table.effectiveFrom),
    check('budget_versions_effective_from_check', sql`${table.effectiveFrom} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`),
    check(
      'budget_versions_expected_income_check',
      sql`${table.expectedIncomeMinor} is null or ${table.expectedIncomeMinor} >= 0`,
    ),
  ],
);

/** One category's limit and options in a version (FR-B1, FR-B4). */
export const budgetLines = pgTable(
  'budget_lines',
  {
    id: id(),
    userId: ownerId(),
    versionId: uuid('version_id').notNull(),
    categoryId: uuid('category_id').notNull(),
    limitMinor: money('limit_minor').notNull(),
    /** "Bawa sisa ke bulan depan". */
    rollover: boolean('rollover').notNull().default(false),
    /** "Anggaran tetap": no daily rate, "lunas" once spent. */
    isFixed: boolean('is_fixed').notNull().default(false),
    /** "Ingatkan di 85%". */
    alertPct: smallint('alert_pct').$type<AlertPct>().notNull().default(85),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique('budget_lines_version_id_category_id_key').on(table.versionId, table.categoryId),
    index('budget_lines_user_id_category_id_idx').on(table.userId, table.categoryId),
    foreignKey({
      name: 'budget_lines_version_fk',
      columns: [table.userId, table.versionId],
      foreignColumns: [budgetVersions.userId, budgetVersions.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'budget_lines_category_fk',
      columns: [table.userId, table.categoryId],
      foreignColumns: [categories.userId, categories.id],
    }),
    check('budget_lines_limit_check', sql`${table.limitMinor} >= 0`),
    check('budget_lines_alert_pct_check', sql`${table.alertPct} in (50, 80, 85, 100)`),
  ],
);

export const BUDGET_OVERRIDE_REASONS = ['transfer', 'rollover'] as const;
export const budgetOverrideReason = pgEnum('budget_override_reason', BUDGET_OVERRIDE_REASONS);

/**
 * A change of one category's limit in one period only: moved leftover (FR-B3, `transfer`, grouped by `move_id` for
 * Undo) or a confirmed rollover proposal (FR-P4, `rollover`, M3 sets `review_item_id`). Transition proration is not
 * stored: it follows from the period's `kind` and `days`.
 */
export const budgetPeriodOverrides = pgTable(
  'budget_period_overrides',
  {
    id: id(),
    userId: ownerId(),
    periodId: uuid('period_id').notNull(),
    categoryId: uuid('category_id').notNull(),
    deltaMinor: money('delta_minor').notNull(),
    reason: budgetOverrideReason('reason').notNull(),
    moveId: uuid('move_id'),
    /** The confirmed period-close proposal (`review_items`) that created a `rollover` override. */
    reviewItemId: uuid('review_item_id'),
    createdAt: createdAt(),
  },
  (table) => [
    index('budget_period_overrides_user_id_period_id_idx').on(table.userId, table.periodId),
    index('budget_period_overrides_move_id_idx').on(table.moveId),
    foreignKey({
      name: 'budget_period_overrides_period_fk',
      columns: [table.userId, table.periodId],
      foreignColumns: [periods.userId, periods.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'budget_period_overrides_category_fk',
      columns: [table.userId, table.categoryId],
      foreignColumns: [categories.userId, categories.id],
    }),
    foreignKey({
      name: 'budget_period_overrides_review_item_fk',
      columns: [table.userId, table.reviewItemId],
      foreignColumns: [reviewItems.userId, reviewItems.id],
    }),
    check('budget_period_overrides_delta_check', sql`${table.deltaMinor} <> 0`),
    check('budget_period_overrides_move_check', sql`(${table.reason} = 'transfer') = (${table.moveId} is not null)`),
  ],
);

/** FR-B5 "Abaikan": a category's warning hidden until the end of the period. */
export const budgetAlertDismissals = pgTable(
  'budget_alert_dismissals',
  {
    userId: ownerId(),
    periodId: uuid('period_id').notNull(),
    categoryId: uuid('category_id').notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.periodId, table.categoryId] }),
    foreignKey({
      name: 'budget_alert_dismissals_period_fk',
      columns: [table.userId, table.periodId],
      foreignColumns: [periods.userId, periods.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'budget_alert_dismissals_category_fk',
      columns: [table.userId, table.categoryId],
      foreignColumns: [categories.userId, categories.id],
    }),
  ],
);

// ---------------------------------------------------------------------------------------------------------------
// Schedules, Review queue, subscriptions, notifications (M3, plan §4.3). D14: the worker never writes transactions,
// postings, budgets, or goals; everything it creates that would change them is a `review_items` row that only a user
// confirmation (`confirmReview`, wf_app) applies.
// ---------------------------------------------------------------------------------------------------------------

export const recurrenceFreq = pgEnum('recurrence_freq', RECURRENCE_FREQS);
export const recurrenceEndType = pgEnum('recurrence_end_type', RECURRENCE_END_TYPES);
export const RECURRENCE_STATUSES = ['active', 'stopped'] as const;
export const recurrenceStatus = pgEnum('recurrence_status', RECURRENCE_STATUSES);

/**
 * A repeating transaction or contribution (FR-T6). `template` is the transaction draft every occurrence proposes
 * (shape: `RecurrenceTemplate` in `@wf/db/schedules`); `start_on` is the first occurrence and anchors the interval
 * (yearly: its month and day). Stopping (FR-L8) deletes the future occurrences and keeps past transactions.
 */
export const recurrences = pgTable(
  'recurrences',
  {
    id: id(),
    userId: ownerId(),
    template: jsonb('template').$type<JsonObject>().notNull(),
    freq: recurrenceFreq('freq').notNull(),
    interval: smallint('interval').notNull().default(1),
    startOn: localDate('start_on').notNull(),
    /** ISO weekday 1 (Monday) – 7 (Sunday); weekly only. */
    weekday: smallint('weekday'),
    /** 1–31, clamped to the month's last day; monthly only. */
    monthDay: smallint('month_day'),
    endType: recurrenceEndType('end_type').notNull().default('never'),
    endCount: smallint('end_count'),
    /** Days before the due date for the 09.00 reminder (FR-T6 H-1 = 1); `null` = no reminder. */
    remindOffsetDays: smallint('remind_offset_days'),
    status: recurrenceStatus('status').notNull().default('active'),
    stoppedAt: timestamptz('stopped_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique('recurrences_user_id_id_key').on(table.userId, table.id),
    index('recurrences_user_id_status_idx').on(table.userId, table.status),
    check('recurrences_interval_check', sql`${table.interval} between 1 and 99`),
    check('recurrences_weekday_check', sql`(${table.freq} = 'weekly') = (${table.weekday} is not null)`),
    check('recurrences_weekday_range_check', sql`${table.weekday} is null or ${table.weekday} between 1 and 7`),
    check('recurrences_month_day_check', sql`(${table.freq} = 'monthly') = (${table.monthDay} is not null)`),
    check('recurrences_month_day_range_check', sql`${table.monthDay} is null or ${table.monthDay} between 1 and 31`),
    check(
      'recurrences_end_check',
      sql`(${table.endType} = 'after') = (${table.endCount} is not null) and (${table.endCount} is null or ${table.endCount} between 1 and 999)`,
    ),
    check(
      'recurrences_remind_check',
      sql`${table.remindOffsetDays} is null or ${table.remindOffsetDays} between 0 and 30`,
    ),
    check('recurrences_stopped_check', sql`(${table.status} = 'stopped') = (${table.stoppedAt} is not null)`),
    check('recurrences_template_check', sql`jsonb_typeof(${table.template}) = 'object'`),
  ],
);

export const subscriptionCycle = pgEnum('subscription_cycle', SUBSCRIPTION_CYCLES);
export const subscriptionStatus = pgEnum('subscription_status', SUBSCRIPTION_STATUSES);
export const cancelMode = pgEnum('subscription_cancel_mode', CANCEL_MODES);
export const usageRating = pgEnum('subscription_usage_rating', USAGE_RATINGS);

/**
 * A subscription (FR-SUB1–SUB6). `next_billing_date` is the next bill that is neither confirmed nor skipped; bills are
 * materialized from it as `scheduled_occurrences` (source `subscription`) and paid only through the Review queue.
 * Pause and cancel are stored as dates, so the effective state needs no worker write: paused while
 * `paused_until > today`, ended once `ends_on` has passed.
 */
export const subscriptions = pgTable(
  'subscriptions',
  {
    id: id(),
    userId: ownerId(),
    name: varchar('name', { length: 40 }).notNull(),
    plan: varchar('plan', { length: 40 }),
    icon: text('icon'),
    logoKey: text('logo_key'),
    description: text('description'),
    priceMinor: money('price_minor').notNull(),
    currency: currency('currency').notNull(),
    cycle: subscriptionCycle('cycle').notNull(),
    nextBillingDate: localDate('next_billing_date').notNull(),
    payFromAccountId: uuid('pay_from_account_id').notNull(),
    categoryId: uuid('category_id'),
    /** Days before a bill for the 09.00 reminder (FR-SUB1, default 3); `null` = no reminder. */
    remindDaysBefore: smallint('remind_days_before').default(3),
    startedOn: localDate('started_on').notNull(),
    /** Last day of the free trial; the first bill is the day after (FR-SUB1). */
    trialEndsOn: localDate('trial_ends_on'),
    status: subscriptionStatus('status').notNull().default('active'),
    pausedOn: localDate('paused_on'),
    /** The day billing resumes (FR-SUB3 "aktif lagi"). */
    pausedUntil: localDate('paused_until'),
    /** Days before `paused_until` for the "aktif lagi" reminder; `null` = none. */
    pauseRemindDays: smallint('pause_remind_days'),
    cancelMode: cancelMode('cancel_mode'),
    /** Last day of the subscription after a cancel (after the next bill, or the cancel day). */
    endsOn: localDate('ends_on'),
    cancelledAt: timestamptz('cancelled_at'),
    usageRating: usageRating('usage_rating'),
    ratedAt: timestamptz('rated_at'),
    /** FR-SUB5 monthly usage review: when to ask again. */
    nextReviewOn: localDate('next_review_on'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique('subscriptions_user_id_id_key').on(table.userId, table.id),
    index('subscriptions_user_id_status_idx').on(table.userId, table.status),
    index('subscriptions_name_trgm_idx').using('gin', table.name.op('gin_trgm_ops')),
    foreignKey({
      name: 'subscriptions_account_fk',
      columns: [table.userId, table.payFromAccountId],
      foreignColumns: [accounts.userId, accounts.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'subscriptions_category_fk',
      columns: [table.userId, table.categoryId],
      foreignColumns: [categories.userId, categories.id],
    }),
    currencyCheck('subscriptions_currency_check', table.currency),
    check('subscriptions_price_check', sql`${table.priceMinor} > 0`),
    check('subscriptions_name_check', sql`length(btrim(${table.name})) > 0`),
    check(
      'subscriptions_remind_check',
      sql`${table.remindDaysBefore} is null or ${table.remindDaysBefore} between 0 and 30`,
    ),
    check(
      'subscriptions_paused_check',
      sql`(${table.status} = 'paused') = (${table.pausedUntil} is not null and ${table.pausedOn} is not null)`,
    ),
    check(
      'subscriptions_cancelled_check',
      sql`(${table.status} = 'cancelled') = (${table.endsOn} is not null and ${table.cancelMode} is not null and ${table.cancelledAt} is not null)`,
    ),
  ],
);

export const OCCURRENCE_SOURCES = [
  'recurrence',
  'subscription',
  'goal_plan',
  'installment',
  'cc_statement',
  'receivable',
] as const;
export const occurrenceSource = pgEnum('occurrence_source', OCCURRENCE_SOURCES);
export const OCCURRENCE_STATUSES = ['scheduled', 'due_review', 'confirmed', 'skipped', 'unconfirmed'] as const;
export const occurrenceStatus = pgEnum('occurrence_status', OCCURRENCE_STATUSES);

/**
 * One due date of a schedule (plan §4.3), materialized 90 days ahead. `scheduled` → `due_review` on the due date
 * (a `review_items` row is created) → `unconfirmed` once overdue; `confirmed` (with the transaction) or `skipped` only
 * by a user action. The unique source key makes materializing idempotent.
 */
export const scheduledOccurrences = pgTable(
  'scheduled_occurrences',
  {
    id: id(),
    userId: ownerId(),
    sourceType: occurrenceSource('source_type').notNull(),
    sourceId: uuid('source_id').notNull(),
    dueDate: localDate('due_date').notNull(),
    expectedMinor: money('expected_minor').notNull(),
    currency: currency('currency').notNull(),
    status: occurrenceStatus('status').notNull().default('scheduled'),
    transactionId: uuid('transaction_id'),
    remindAt: timestamptz('remind_at'),
    remindedAt: timestamptz('reminded_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique('scheduled_occurrences_user_id_id_key').on(table.userId, table.id),
    unique('scheduled_occurrences_source_key').on(table.sourceType, table.sourceId, table.dueDate),
    index('scheduled_occurrences_user_id_due_date_idx').on(table.userId, table.dueDate),
    index('scheduled_occurrences_remind_at_idx')
      .on(table.remindAt)
      .where(sql`${table.remindedAt} is null and ${table.remindAt} is not null`),
    foreignKey({
      name: 'scheduled_occurrences_transaction_fk',
      columns: [table.userId, table.transactionId],
      foreignColumns: [transactions.userId, transactions.id],
    }).onDelete('cascade'),
    currencyCheck('scheduled_occurrences_currency_check', table.currency),
    check('scheduled_occurrences_expected_check', sql`${table.expectedMinor} >= 0`),
    check(
      'scheduled_occurrences_confirmed_check',
      sql`${table.status} <> 'confirmed' or ${table.transactionId} is not null`,
    ),
  ],
);

export const REVIEW_REASONS = [
  'ai_suggestion',
  'category_deleted',
  'due_occurrence',
  'import_row',
  'period_close_proposal',
] as const;
export const reviewReason = pgEnum('review_reason', REVIEW_REASONS);
export const REVIEW_SOURCES = ['gmail', 'assistant', 'receipt', 'schedule', 'period_close', 'system'] as const;
export const reviewSource = pgEnum('review_source', REVIEW_SOURCES);
export const REVIEW_STATUSES = ['pending', 'confirmed', 'ignored'] as const;
export const reviewStatus = pgEnum('review_status', REVIEW_STATUSES);

/**
 * The single Review queue (FR-L7). `payload_enc` is the encrypted proposal (transaction draft, category assignment,
 * or period-close proposal; shapes in `@wf/db/review-items`); `dedupe_key` makes every producer idempotent (a worker
 * restart or retry never creates a second item). Plain columns hold only what ordering and badges need.
 */
export const reviewItems = pgTable(
  'review_items',
  {
    id: id(),
    userId: ownerId(),
    reason: reviewReason('reason').notNull(),
    source: reviewSource('source').notNull(),
    dedupeKey: text('dedupe_key').notNull(),
    occurrenceId: uuid('occurrence_id'),
    /** `category_deleted`: the transaction that lost its category. */
    subjectTransactionId: uuid('subject_transaction_id'),
    /** `period_close_proposal`: the closed period. */
    periodId: uuid('period_id'),
    /** Due date or date of the proposed transaction, for ordering and grouping. */
    dueDate: localDate('due_date'),
    payloadEnc: bytea('payload_enc').notNull(),
    /** AI confidence in percent (0–100); shown and used for ordering only (FR-L7). */
    aiConfidence: smallint('ai_confidence'),
    status: reviewStatus('status').notNull().default('pending'),
    resolvedAt: timestamptz('resolved_at'),
    resultingTransactionId: uuid('resulting_transaction_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique('review_items_user_id_id_key').on(table.userId, table.id),
    unique('review_items_dedupe_key').on(table.userId, table.dedupeKey),
    index('review_items_user_id_status_idx').on(table.userId, table.status, table.reason),
    foreignKey({
      name: 'review_items_occurrence_fk',
      columns: [table.userId, table.occurrenceId],
      foreignColumns: [scheduledOccurrences.userId, scheduledOccurrences.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'review_items_subject_transaction_fk',
      columns: [table.userId, table.subjectTransactionId],
      foreignColumns: [transactions.userId, transactions.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'review_items_period_fk',
      columns: [table.userId, table.periodId],
      foreignColumns: [periods.userId, periods.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'review_items_resulting_transaction_fk',
      columns: [table.userId, table.resultingTransactionId],
      foreignColumns: [transactions.userId, transactions.id],
    }).onDelete('cascade'),
    check(
      'review_items_confidence_check',
      sql`${table.aiConfidence} is null or ${table.aiConfidence} between 0 and 100`,
    ),
    check('review_items_resolved_check', sql`(${table.status} = 'pending') = (${table.resolvedAt} is null)`),
  ],
);

export const DETECTED_RECURRING_STATUSES = ['new', 'added', 'dismissed'] as const;
export const detectedRecurringStatus = pgEnum('detected_recurring_status', DETECTED_RECURRING_STATUSES);

/** FR-SUB4 subscription candidates found in transactions (suggestions only; "Tambahkan" creates the subscription). */
export const detectedRecurring = pgTable(
  'detected_recurring',
  {
    id: id(),
    userId: ownerId(),
    /** Normalized merchant (`@wf/domain/subscriptions`). */
    merchantKey: text('merchant_key').notNull(),
    merchant: text('merchant').notNull(),
    dayOfMonth: smallint('day_of_month').notNull(),
    amountMinor: money('amount_minor').notNull(),
    currency: currency('currency').notNull(),
    occurrences: smallint('occurrences').notNull(),
    lastSeenOn: localDate('last_seen_on').notNull(),
    accountId: uuid('account_id'),
    categoryId: uuid('category_id'),
    status: detectedRecurringStatus('status').notNull().default('new'),
    subscriptionId: uuid('subscription_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique('detected_recurring_user_id_id_key').on(table.userId, table.id),
    unique('detected_recurring_merchant_key').on(table.userId, table.merchantKey),
    foreignKey({
      name: 'detected_recurring_account_fk',
      columns: [table.userId, table.accountId],
      foreignColumns: [accounts.userId, accounts.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'detected_recurring_category_fk',
      columns: [table.userId, table.categoryId],
      foreignColumns: [categories.userId, categories.id],
    }),
    foreignKey({
      name: 'detected_recurring_subscription_fk',
      columns: [table.userId, table.subscriptionId],
      foreignColumns: [subscriptions.userId, subscriptions.id],
    }).onDelete('cascade'),
    currencyCheck('detected_recurring_currency_check', table.currency),
    check('detected_recurring_day_check', sql`${table.dayOfMonth} between 1 and 31`),
    check('detected_recurring_amount_check', sql`${table.amountMinor} > 0`),
  ],
);

export const NOTIFICATION_TYPES = [
  'bill_reminder',
  'trial_ending',
  'pause_ending',
  'review_due',
  'bill_overdue',
  'budget_threshold',
  'low_balance',
  'account_unchecked',
  'insufficient_balance',
  'period_closed',
  'subscriptions_detected',
  'system',
  /** FR-U7: H-1 09.00 reminder of a receivable's due date, to the user only. */
  'receivable_due',
] as const;
export const notificationType = pgEnum('notification_type', NOTIFICATION_TYPES);
export const NOTIFICATION_CATEGORIES = ['budget_bills', 'system'] as const;
export const notificationCategory = pgEnum('notification_category', NOTIFICATION_CATEGORIES);

/**
 * In-app notifications (FR-S5): message keys plus params (rendered per locale and privacy mode in the UI), an action
 * that opens a page (never records anything), and `ref`, the producer's idempotency key. Kept 90 days (maintenance).
 */
export const notifications = pgTable(
  'notifications',
  {
    id: id(),
    userId: ownerId(),
    type: notificationType('type').notNull(),
    category: notificationCategory('category').notNull(),
    titleKey: text('title_key').notNull(),
    bodyKey: text('body_key').notNull(),
    params: jsonb('params').$type<JsonObject>().notNull().default({}),
    action: jsonb('action').$type<JsonObject>(),
    ref: text('ref').notNull(),
    readAt: timestamptz('read_at'),
    createdAt: createdAt(),
  },
  (table) => [
    unique('notifications_user_id_id_key').on(table.userId, table.id),
    unique('notifications_ref_key').on(table.userId, table.ref),
    index('notifications_user_id_created_at_idx').on(table.userId, table.createdAt.desc()),
    check('notifications_params_check', sql`jsonb_typeof(${table.params}) = 'object'`),
  ],
);

export const NOTIFICATION_CHANNELS = ['email'] as const;
export const notificationChannel = pgEnum('notification_channel', NOTIFICATION_CHANNELS);

/**
 * Notifications to deliver outside the app (plan §4.3): one row per notification and channel, sent by the `notify`
 * job with retries. `payload` is the email template data, built with the user's privacy mode (no amounts when hidden).
 */
export const notificationOutbox = pgTable(
  'notification_outbox',
  {
    id: id(),
    userId: ownerId(),
    notificationId: uuid('notification_id').notNull(),
    channel: notificationChannel('channel').notNull().default('email'),
    payload: jsonb('payload').$type<JsonObject>().notNull(),
    sendAt: timestamptz('send_at').notNull().defaultNow(),
    sentAt: timestamptz('sent_at'),
    attempts: smallint('attempts').notNull().default(0),
    lastError: text('last_error'),
    createdAt: createdAt(),
  },
  (table) => [
    unique('notification_outbox_user_id_id_key').on(table.userId, table.id),
    unique('notification_outbox_notification_key').on(table.notificationId, table.channel),
    index('notification_outbox_pending_idx')
      .on(table.sendAt)
      .where(sql`${table.sentAt} is null`),
    foreignKey({
      name: 'notification_outbox_notification_fk',
      columns: [table.userId, table.notificationId],
      foreignColumns: [notifications.userId, notifications.id],
    }).onDelete('cascade'),
  ],
);

// ---------------------------------------------------------------------------------------------------------------
// Goal contributions, debts and installments, credit card payments, receivables (M4, plan §4.4). The worker only
// reads them (reminders, installment occurrences); every write is a user action through wf_app (D14).
// ---------------------------------------------------------------------------------------------------------------

/**
 * FR-G1 "Setoran rutin": the part of a recurring transfer (`recurrences`) that goes to a goal; several per goal and
 * several goals per recurrence ("Sisihkan dana tidak rutin" splits one transfer over three sinking funds). Day,
 * from → to, and the Review-queue flow come from the recurrence; an inactive plan no longer contributes.
 */
export const goalContributionPlans = pgTable(
  'goal_contribution_plans',
  {
    id: id(),
    userId: ownerId(),
    goalId: uuid('goal_id').notNull(),
    recurrenceId: uuid('recurrence_id').notNull(),
    /** In the currency of the recurrence's destination account. */
    amountMinor: money('amount_minor').notNull(),
    active: boolean('active').notNull().default(true),
    /** First day of the first month the plan sends its share in (FR-B6 "Nov–Apr" starts in November). */
    startMonth: localDate('start_month').notNull(),
    /** First day of the last month it sends in; null = until changed. */
    endMonth: localDate('end_month'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique('goal_contribution_plans_user_id_id_key').on(table.userId, table.id),
    unique('goal_contribution_plans_recurrence_goal_key').on(table.recurrenceId, table.goalId),
    index('goal_contribution_plans_goal_idx').on(table.userId, table.goalId),
    foreignKey({
      name: 'goal_contribution_plans_goal_fk',
      columns: [table.userId, table.goalId],
      foreignColumns: [goals.userId, goals.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'goal_contribution_plans_recurrence_fk',
      columns: [table.userId, table.recurrenceId],
      foreignColumns: [recurrences.userId, recurrences.id],
    }).onDelete('cascade'),
    check('goal_contribution_plans_amount_check', sql`${table.amountMinor} > 0`),
    check(
      'goal_contribution_plans_months_check',
      sql`extract(day from ${table.startMonth}) = 1 and (${table.endMonth} is null or (extract(day from ${table.endMonth}) = 1 and ${table.endMonth} >= ${table.startMonth}))`,
    ),
  ],
);

export const debtKind = pgEnum('debt_kind', DEBT_KINDS);
/** D12: cards and paylater charge flat interest, mortgages and loans annuity. */
export const interestMethod = pgEnum('interest_method', INTEREST_METHODS);
/** FR-U4 after a partial payoff: "Kurangi nominal (tenor tetap)" or "Persingkat tenor". */
export const recalcMode = pgEnum('recalc_mode', RECALC_MODES);
export const DEBT_STATUSES = ['active', 'paid_off'] as const;
export const debtStatus = pgEnum('debt_status', DEBT_STATUSES);

/**
 * Debts and installment plans (FR-U1–U6). A card installment is held against its card's limit and is made from a
 * card expense (FR-U2: the expense stays recorded on its date); other debts are paid from `pay_from_account_id`
 * through the Review queue (FR-U6). The schedule is in `debt_installments` (computed by `@wf/domain/debt`).
 */
export const debts = pgTable(
  'debts',
  {
    id: id(),
    userId: ownerId(),
    kind: debtKind('kind').notNull(),
    name: varchar('name', { length: 60 }).notNull(),
    /** "Penyedia" (Kredivo, BCA, …). */
    provider: varchar('provider', { length: 40 }),
    /** `card_installment` only: the credit card account. */
    cardAccountId: uuid('card_account_id'),
    /** Other kinds: the account the installments are paid from ("Bayar dari"). */
    payFromAccountId: uuid('pay_from_account_id'),
    /** `card_installment` made from a card expense ("Ubah jadi cicilan"). */
    sourceTransactionId: uuid('source_transaction_id'),
    /** Expense category of the installment payments (other kinds). */
    categoryId: uuid('category_id'),
    principalMinor: money('principal_minor').notNull(),
    currency: currency('currency').notNull(),
    interestMethod: interestMethod('interest_method').notNull().default('flat'),
    /** Monthly interest in basis points (150 = 1,5% per bulan). */
    monthlyRateBps: integer('monthly_rate_bps').notNull().default(0),
    adminFeeMinor: money('admin_fee_minor')
      .notNull()
      .default(sql`0`),
    tenorMonths: smallint('tenor_months').notNull(),
    firstDueDate: localDate('first_due_date').notNull(),
    /** The choice of the last recalculation after an early payoff. */
    recalcMode: recalcMode('recalc_mode'),
    recalculatedAt: timestamptz('recalculated_at'),
    status: debtStatus('status').notNull().default('active'),
    paidOffAt: timestamptz('paid_off_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique('debts_user_id_id_key').on(table.userId, table.id),
    index('debts_user_id_status_idx').on(table.userId, table.status),
    uniqueIndex('debts_source_transaction_key')
      .on(table.userId, table.sourceTransactionId)
      .where(sql`${table.sourceTransactionId} is not null`),
    foreignKey({
      name: 'debts_card_account_fk',
      columns: [table.userId, table.cardAccountId],
      foreignColumns: [accounts.userId, accounts.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'debts_pay_from_account_fk',
      columns: [table.userId, table.payFromAccountId],
      foreignColumns: [accounts.userId, accounts.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'debts_source_transaction_fk',
      columns: [table.userId, table.sourceTransactionId],
      foreignColumns: [transactions.userId, transactions.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'debts_category_fk',
      columns: [table.userId, table.categoryId],
      foreignColumns: [categories.userId, categories.id],
    }),
    currencyCheck('debts_currency_check', table.currency),
    check('debts_name_check', sql`length(btrim(${table.name})) > 0`),
    check('debts_principal_check', sql`${table.principalMinor} > 0`),
    check('debts_rate_check', sql`${table.monthlyRateBps} between 0 and 10000`),
    check('debts_admin_fee_check', sql`${table.adminFeeMinor} >= 0`),
    check('debts_tenor_check', sql`${table.tenorMonths} between 1 and 360`),
    check(
      'debts_accounts_check',
      sql`(${table.kind} = 'card_installment') = (${table.cardAccountId} is not null) and (${table.kind} = 'card_installment') = (${table.payFromAccountId} is null)`,
    ),
    check(
      'debts_source_transaction_check',
      sql`${table.sourceTransactionId} is null or ${table.kind} = 'card_installment'`,
    ),
    check('debts_recalc_check', sql`(${table.recalcMode} is null) = (${table.recalculatedAt} is null)`),
    check('debts_paid_off_check', sql`(${table.status} = 'paid_off') = (${table.paidOffAt} is not null)`),
  ],
);

export const INSTALLMENT_STATUSES = ['scheduled', 'paid'] as const;
export const installmentStatus = pgEnum('installment_status', INSTALLMENT_STATUSES);

/**
 * The schedule of a debt (FR-U3: a 0% split puts the rounding remainder in the first installment). A card
 * installment is billed on its card statement on `due_date` and paid with the card; other installments are paid by
 * an expense (`transaction_id`). A recalculation (FR-U4) replaces the rows not yet billed or paid.
 */
export const debtInstallments = pgTable(
  'debt_installments',
  {
    id: id(),
    userId: ownerId(),
    debtId: uuid('debt_id').notNull(),
    /** 1-based position ("1/3"). */
    seq: smallint('seq').notNull(),
    dueDate: localDate('due_date').notNull(),
    principalMinor: money('principal_minor').notNull(),
    interestMinor: money('interest_minor')
      .notNull()
      .default(sql`0`),
    feeMinor: money('fee_minor')
      .notNull()
      .default(sql`0`),
    status: installmentStatus('status').notNull().default('scheduled'),
    paidAt: timestamptz('paid_at'),
    /** The expense that paid it (non-card debts). */
    transactionId: uuid('transaction_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique('debt_installments_user_id_id_key').on(table.userId, table.id),
    unique('debt_installments_debt_seq_key').on(table.debtId, table.seq),
    index('debt_installments_user_id_due_date_idx').on(table.userId, table.dueDate),
    foreignKey({
      name: 'debt_installments_debt_fk',
      columns: [table.userId, table.debtId],
      foreignColumns: [debts.userId, debts.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'debt_installments_transaction_fk',
      columns: [table.userId, table.transactionId],
      foreignColumns: [transactions.userId, transactions.id],
    }).onDelete('cascade'),
    check('debt_installments_seq_check', sql`${table.seq} between 1 and 360`),
    check(
      'debt_installments_amounts_check',
      sql`${table.principalMinor} >= 0 and ${table.interestMinor} >= 0 and ${table.feeMinor} >= 0 and ${table.principalMinor} + ${table.interestMinor} + ${table.feeMinor} > 0`,
    ),
    check('debt_installments_paid_check', sql`(${table.status} = 'paid') = (${table.paidAt} is not null)`),
    check('debt_installments_transaction_check', sql`${table.transactionId} is null or ${table.status} = 'paid'`),
  ],
);

/** FR-U4 buckets of a card payment; `credit` is the overpayment kept as the card's credit balance. */
export const CARD_PAYMENT_BUCKETS = ['installments', 'spending', 'credit'] as const;
export const cardPaymentBucket = pgEnum('card_payment_bucket', CARD_PAYMENT_BUCKETS);

/** How a payment to a credit card (a transfer into the card account) was allocated (FR-U4). */
export const cardPaymentAllocations = pgTable(
  'card_payment_allocations',
  {
    id: id(),
    userId: ownerId(),
    /** The transfer into the card account. */
    transactionId: uuid('transaction_id').notNull(),
    bucket: cardPaymentBucket('bucket').notNull(),
    /** `installments` only: the card installment paid off early. */
    debtId: uuid('debt_id'),
    amountMinor: money('amount_minor').notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    unique('card_payment_allocations_key').on(table.transactionId, table.bucket, table.debtId).nullsNotDistinct(),
    index('card_payment_allocations_debt_idx').on(table.userId, table.debtId),
    foreignKey({
      name: 'card_payment_allocations_transaction_fk',
      columns: [table.userId, table.transactionId],
      foreignColumns: [transactions.userId, transactions.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'card_payment_allocations_debt_fk',
      columns: [table.userId, table.debtId],
      foreignColumns: [debts.userId, debts.id],
    }).onDelete('cascade'),
    check('card_payment_allocations_amount_check', sql`${table.amountMinor} > 0`),
    check(
      'card_payment_allocations_debt_check',
      sql`(${table.bucket} = 'installments') = (${table.debtId} is not null)`,
    ),
  ],
);

export const receivableSource = pgEnum('receivable_source', RECEIVABLE_SOURCES);
export const receivableStatus = pgEnum('receivable_status', RECEIVABLE_STATUSES);

/**
 * Money other people owe the user (FR-U7, FR-L5). Lending is a `receivable_out` transaction (not an expense),
 * payments are `receivable_in` (not income), a write-off is a `writeoff` expense in "Piutang tak tertagih".
 * `transaction_id` is null for a receivable recorded without moving money (lent before the ledger started, already
 * reflected in the account balance). The person is personal data: `counterparty_enc` (user DEK).
 */
export const receivables = pgTable(
  'receivables',
  {
    id: id(),
    userId: ownerId(),
    counterpartyEnc: bytea('counterparty_enc').notNull(),
    /** What it was for ("Nonton bareng CGV Grand Indonesia"); also the lending transaction's description. */
    description: text('description'),
    noteEnc: bytea('note_enc'),
    principalMinor: money('principal_minor').notNull(),
    currency: currency('currency').notNull(),
    /** The account the money left ("dari BCA Tahapan"). */
    fromAccountId: uuid('from_account_id').notNull(),
    source: receivableSource('source').notNull(),
    /** `split_bill`: the user's own part of the split bill (FR-L5). */
    sourceTransactionId: uuid('source_transaction_id'),
    /** The `receivable_out` transaction; null when recorded without one. */
    transactionId: uuid('transaction_id'),
    lentOn: localDate('lent_on').notNull(),
    dueDate: localDate('due_date'),
    /** H-1 09.00 reminder to the user only. */
    remind: boolean('remind').notNull().default(false),
    status: receivableStatus('status').notNull().default('open'),
    settledAt: timestamptz('settled_at'),
    writtenOffAt: timestamptz('written_off_at'),
    /** The `writeoff` expense ("Hapuskan"). */
    writeoffTransactionId: uuid('writeoff_transaction_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table): PgTableExtraConfigValue[] => [
    unique('receivables_user_id_id_key').on(table.userId, table.id),
    index('receivables_user_id_status_idx').on(table.userId, table.status),
    foreignKey({
      name: 'receivables_from_account_fk',
      columns: [table.userId, table.fromAccountId],
      foreignColumns: [accounts.userId, accounts.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'receivables_source_transaction_fk',
      columns: [table.userId, table.sourceTransactionId],
      foreignColumns: [transactions.userId, transactions.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'receivables_transaction_fk',
      columns: [table.userId, table.transactionId],
      foreignColumns: [transactions.userId, transactions.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'receivables_writeoff_transaction_fk',
      columns: [table.userId, table.writeoffTransactionId],
      foreignColumns: [transactions.userId, transactions.id],
    }).onDelete('cascade'),
    currencyCheck('receivables_currency_check', table.currency),
    check('receivables_principal_check', sql`${table.principalMinor} > 0`),
    check('receivables_due_check', sql`${table.dueDate} is null or ${table.dueDate} >= ${table.lentOn}`),
    check('receivables_remind_check', sql`not ${table.remind} or ${table.dueDate} is not null`),
    check('receivables_settled_check', sql`(${table.status} = 'settled') = (${table.settledAt} is not null)`),
    check(
      'receivables_written_off_check',
      sql`(${table.status} = 'written_off') = (${table.writtenOffAt} is not null) and (${table.writeoffTransactionId} is null or ${table.status} = 'written_off')`,
    ),
  ],
);

/**
 * Repayments of a receivable (FR-U7 "Terima pembayaran"): Σ amount ≤ principal (trigger
 * `receivable_payments_within_principal`). `transaction_id` is the `receivable_in` transaction, null when recorded
 * without one.
 */
export const receivablePayments = pgTable(
  'receivable_payments',
  {
    id: id(),
    userId: ownerId(),
    receivableId: uuid('receivable_id').notNull(),
    /** The account the money came into ("Masuk ke"). */
    accountId: uuid('account_id').notNull(),
    amountMinor: money('amount_minor').notNull(),
    receivedOn: localDate('received_on').notNull(),
    transactionId: uuid('transaction_id'),
    createdAt: createdAt(),
  },
  (table) => [
    unique('receivable_payments_user_id_id_key').on(table.userId, table.id),
    index('receivable_payments_receivable_idx').on(table.userId, table.receivableId),
    foreignKey({
      name: 'receivable_payments_receivable_fk',
      columns: [table.userId, table.receivableId],
      foreignColumns: [receivables.userId, receivables.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'receivable_payments_account_fk',
      columns: [table.userId, table.accountId],
      foreignColumns: [accounts.userId, accounts.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'receivable_payments_transaction_fk',
      columns: [table.userId, table.transactionId],
      foreignColumns: [transactions.userId, transactions.id],
    }).onDelete('cascade'),
    check('receivable_payments_amount_check', sql`${table.amountMinor} > 0`),
  ],
);

// ---------------------------------------------------------------------------------------------------------------
// Investments and market data (M5, plan §4.5). Assets, trades, categories, targets, and snapshots are the user's
// (wf_app writes them; the worker only reads them or, for snapshots, writes the daily value). `market_quotes` is the
// global cache of built-in sources only (the worker writes it, the app reads it through `market_quotes_latest`);
// BYOK results live per user in `user_quotes` under Row-Level Security, so one user's key never serves another.
// ---------------------------------------------------------------------------------------------------------------

/** Units and prices: `numeric(38,18)` decimal strings (`@wf/domain/decimal`), prices in major units of the quote. */
const decimal = (name: string) => numeric(name, { precision: 38, scale: 18 });

export const assetClass = pgEnum('asset_class', ASSET_CLASSES);
export const priceMode = pgEnum('price_mode', PRICE_MODES);
export const tradeKind = pgEnum('trade_kind', TRADE_KINDS);
export const tradeStatus = pgEnum('trade_status', TRADE_STATUSES);
export const dividendMode = pgEnum('dividend_mode', DIVIDEND_MODES);
export const marketProvider = pgEnum('market_provider', MARKET_PROVIDERS);
export const credentialStatus = pgEnum('market_credential_status', CREDENTIAL_STATUSES);
/** Which market an asset trades in: its staleness threshold and price label (`@wf/domain/market`). */
export const market = pgEnum('market', MARKETS);

/** "Daftar saya" (FR-I1): a grouping of assets; an asset is in at most one. Its class is used for new members. */
export const assetCategories = pgTable(
  'asset_categories',
  {
    id: id(),
    userId: ownerId(),
    name: varchar('name', { length: 40 }).notNull(),
    assetClass: assetClass('asset_class').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique('asset_categories_user_id_id_key').on(table.userId, table.id),
    check('asset_categories_name_check', sql`length(btrim(${table.name})) > 0`),
  ],
);

/**
 * An asset held on a platform (FR-I1): `account_id` is the investment account whose cash pays for it, in the asset's
 * quote currency. Its holding (units, cost basis, realized gain) is the view `holdings` over `investment_trades`.
 * `price_mode` picks the price source (FR-I6); `manual_price` is the user's last price, `premium_bps` the Antam
 * premium over spot (the plan's `premium_pct`, in basis points like every ratio here), `meta` the provider symbols
 * (`meta.symbols[provider]`), ORI coupon, or dividend schedule.
 */
export const assets = pgTable(
  'assets',
  {
    id: id(),
    userId: ownerId(),
    accountId: uuid('account_id').notNull(),
    symbol: varchar('symbol', { length: 20 }).notNull(),
    name: varchar('name', { length: 80 }).notNull(),
    quoteCurrency: currency('quote_currency').notNull(),
    assetClass: assetClass('asset_class').notNull(),
    market: market('market').notNull(),
    categoryId: uuid('category_id'),
    priceMode: priceMode('price_mode').notNull().default('manual'),
    manualPrice: decimal('manual_price'),
    manualPriceAt: timestamptz('manual_price_at'),
    /** Antam over spot, e.g. 650 = 6,5% (`price_mode` computed, market `gold_antam`). */
    premiumBps: integer('premium_bps'),
    meta: jsonb('meta').$type<JsonObject>().notNull().default({}),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique('assets_user_id_id_key').on(table.userId, table.id),
    unique('assets_account_symbol_key').on(table.userId, table.accountId, table.symbol),
    index('assets_symbol_trgm_idx').using('gin', table.symbol.op('gin_trgm_ops')),
    index('assets_name_trgm_idx').using('gin', table.name.op('gin_trgm_ops')),
    foreignKey({
      name: 'assets_account_fk',
      columns: [table.userId, table.accountId],
      foreignColumns: [accounts.userId, accounts.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'assets_category_fk',
      columns: [table.userId, table.categoryId],
      foreignColumns: [assetCategories.userId, assetCategories.id],
    }),
    currencyCheck('assets_quote_currency_check', table.quoteCurrency),
    check('assets_symbol_check', sql`length(btrim(${table.symbol})) > 0`),
    check('assets_name_check', sql`length(btrim(${table.name})) > 0`),
    check(
      'assets_manual_price_check',
      sql`(${table.manualPrice} is null) = (${table.manualPriceAt} is null) and (${table.manualPrice} is null or ${table.manualPrice} > 0)`,
    ),
    check('assets_manual_mode_check', sql`${table.priceMode} <> 'manual' or ${table.manualPrice} is not null`),
    check('assets_premium_check', sql`${table.premiumBps} is null or ${table.premiumBps} > -10000`),
  ],
);

/** FR-I3 target share per asset class; the set of a user sums to exactly 100% (deferred trigger). */
export const allocationTargets = pgTable(
  'allocation_targets',
  {
    userId: ownerId(),
    assetClass: assetClass('asset_class').notNull(),
    targetBps: integer('target_bps').notNull(),
    updatedAt: updatedAt(),
  },
  (table) => [
    primaryKey({ name: 'allocation_targets_pkey', columns: [table.userId, table.assetClass] }),
    check('allocation_targets_bps_check', sql`${table.targetBps} between 0 and 10000`),
  ],
);

/**
 * FR-I2 investment transactions. The cash leg goes through the ledger: a buy, sell, or cash dividend is an
 * `investment` / `dividend` transaction on the platform account (`transaction_id`; fee and tax as their own
 * postings), a sale withdrawn to a bank adds a transfer (`transfer_transaction_id`), a cash top-up is a transfer. A
 * `pending` buy ("diproses") has paid but not received its units. The effect columns are what the trade did to the
 * holding (`@wf/domain/investments` `tradeEffect`, replayed in trade order on every change), so `holdings` sums them.
 */
export const investmentTrades = pgTable(
  'investment_trades',
  {
    id: id(),
    userId: ownerId(),
    /** Null only for a cash top-up. */
    assetId: uuid('asset_id'),
    /** The platform (investment account). */
    accountId: uuid('account_id').notNull(),
    kind: tradeKind('kind').notNull(),
    status: tradeStatus('status').notNull().default('settled'),
    occurredAt: timestamptz('occurred_at').notNull(),
    localDate: localDate('local_date').notNull(),
    /** Buy/sell: > 0; dividend: reinvested units or 0; adjust: the signed change; top-up: 0. */
    units: decimal('units').notNull(),
    price: decimal('price'),
    /** Quote-currency minor units: buy = paid excluding fee and tax, sell = gross proceeds, dividend = gross. */
    amountMinor: money('amount_minor').notNull(),
    feeMinor: money('fee_minor')
      .notNull()
      .default(sql`0`),
    taxMinor: money('tax_minor')
      .notNull()
      .default(sql`0`),
    /** 1 quote = `fx_rate` base on the trade date (`1` in the base currency). */
    fxRate: rate('fx_rate').notNull(),
    dividendMode: dividendMode('dividend_mode'),
    /** Sale withdrawn to / dividend paid into this account. */
    proceedsAccountId: uuid('proceeds_account_id'),
    transactionId: uuid('transaction_id'),
    transferTransactionId: uuid('transfer_transaction_id'),
    /** FR-G5: the goal a sale or a lower adjustment reduced. */
    reducedGoalId: uuid('reduced_goal_id'),
    description: text('description'),
    unitsDelta: decimal('units_delta').notNull(),
    costDeltaMinor: money('cost_delta_minor').notNull(),
    costBaseDeltaMinor: money('cost_base_delta_minor').notNull(),
    realizedMinor: money('realized_minor').notNull(),
    realizedBaseMinor: money('realized_base_minor').notNull(),
    dividendMinor: money('dividend_minor').notNull(),
    dividendBaseMinor: money('dividend_base_minor').notNull(),
    clientId: uuid('client_id').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique('investment_trades_user_id_id_key').on(table.userId, table.id),
    unique('investment_trades_client_key').on(table.userId, table.clientId),
    index('investment_trades_asset_idx').on(table.userId, table.assetId, table.localDate),
    index('investment_trades_transaction_idx').on(table.transactionId),
    index('investment_trades_transfer_idx').on(table.transferTransactionId),
    foreignKey({
      name: 'investment_trades_asset_fk',
      columns: [table.userId, table.assetId],
      foreignColumns: [assets.userId, assets.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'investment_trades_account_fk',
      columns: [table.userId, table.accountId],
      foreignColumns: [accounts.userId, accounts.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'investment_trades_proceeds_account_fk',
      columns: [table.userId, table.proceedsAccountId],
      foreignColumns: [accounts.userId, accounts.id],
    }),
    foreignKey({
      name: 'investment_trades_transaction_fk',
      columns: [table.userId, table.transactionId],
      foreignColumns: [transactions.userId, transactions.id],
    }),
    foreignKey({
      name: 'investment_trades_transfer_fk',
      columns: [table.userId, table.transferTransactionId],
      foreignColumns: [transactions.userId, transactions.id],
    }),
    foreignKey({
      name: 'investment_trades_goal_fk',
      columns: [table.userId, table.reducedGoalId],
      foreignColumns: [goals.userId, goals.id],
    }).onDelete('set null'),
    check('investment_trades_asset_check', sql`(${table.assetId} is null) = (${table.kind} = 'cash_topup')`),
    check(
      'investment_trades_units_check',
      sql`case ${table.kind} when 'adjust' then ${table.units} <> 0 when 'dividend' then ${table.units} >= 0 when 'cash_topup' then ${table.units} = 0 else ${table.units} > 0 end`,
    ),
    check(
      'investment_trades_amounts_check',
      sql`${table.feeMinor} >= 0 and ${table.taxMinor} >= 0 and case ${table.kind} when 'adjust' then ${table.amountMinor} = 0 when 'sell' then ${table.amountMinor} >= 0 else ${table.amountMinor} > 0 end`,
    ),
    check('investment_trades_fx_check', sql`${table.fxRate} > 0`),
    check('investment_trades_price_check', sql`${table.price} is null or ${table.price} > 0`),
    check('investment_trades_dividend_check', sql`(${table.kind} = 'dividend') = (${table.dividendMode} is not null)`),
    check('investment_trades_pending_check', sql`${table.status} = 'settled' or ${table.kind} = 'buy'`),
  ],
);

/**
 * The holding of each asset with trades, derived from `investment_trades` (a view, not a maintained table: one source
 * of truth, nothing to drift). Pending buys are reported apart. `security_invoker`: RLS of the trades applies.
 */
export const holdings = pgView('holdings', {
  userId: uuid('user_id').notNull(),
  assetId: uuid('asset_id').notNull(),
  units: decimal('units').notNull(),
  costMinor: money('cost_minor').notNull(),
  costBaseMinor: money('cost_base_minor').notNull(),
  realizedMinor: money('realized_minor').notNull(),
  realizedBaseMinor: money('realized_base_minor').notNull(),
  dividendMinor: money('dividend_minor').notNull(),
  dividendBaseMinor: money('dividend_base_minor').notNull(),
  pendingMinor: money('pending_minor').notNull(),
  pendingBaseMinor: money('pending_base_minor').notNull(),
}).existing();

/**
 * Global cache of the built-in sources only (Frankfurter, fawazahmed0, open.er-api, CoinMarketCap Basic). The worker
 * writes it; the app reads the latest row per symbol through the view `market_quotes_latest`.
 */
export const marketQuotes = pgTable(
  'market_quotes',
  {
    provider: marketProvider('provider').notNull(),
    symbol: varchar('symbol', { length: 32 }).notNull(),
    quoteCurrency: currency('quote_currency').notNull(),
    /** The fetch slot (5 minutes for crypto, a day for FX and gold). */
    bucketTs: timestamptz('bucket_ts').notNull(),
    price: decimal('price').notNull(),
    prevClose: decimal('prev_close'),
    fetchedAt: timestamptz('fetched_at').notNull().defaultNow(),
    sourceAttr: text('source_attr'),
  },
  (table) => [
    primaryKey({
      name: 'market_quotes_pkey',
      columns: [table.provider, table.symbol, table.quoteCurrency, table.bucketTs],
    }),
    currencyCheck('market_quotes_quote_currency_check', table.quoteCurrency),
    check(
      'market_quotes_price_check',
      sql`${table.price} > 0 and (${table.prevClose} is null or ${table.prevClose} > 0)`,
    ),
  ],
);

/** The latest built-in quote per provider, symbol, and currency (the app's only read path into `market_quotes`). */
export const marketQuotesLatest = pgView('market_quotes_latest', {
  provider: marketProvider('provider').notNull(),
  symbol: varchar('symbol', { length: 32 }).notNull(),
  quoteCurrency: currency('quote_currency').notNull(),
  bucketTs: timestamptz('bucket_ts').notNull(),
  price: decimal('price').notNull(),
  prevClose: decimal('prev_close'),
  fetchedAt: timestamptz('fetched_at').notNull(),
  sourceAttr: text('source_attr'),
}).existing();

/** BYOK results, per user (FR-I6: never shown to anyone else); deleted with the provider's key. */
export const userQuotes = pgTable(
  'user_quotes',
  {
    userId: ownerId(),
    provider: marketProvider('provider').notNull(),
    symbol: varchar('symbol', { length: 32 }).notNull(),
    quoteCurrency: currency('quote_currency').notNull(),
    bucketTs: timestamptz('bucket_ts').notNull(),
    price: decimal('price').notNull(),
    prevClose: decimal('prev_close'),
    fetchedAt: timestamptz('fetched_at').notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      name: 'user_quotes_pkey',
      columns: [table.userId, table.provider, table.symbol, table.quoteCurrency, table.bucketTs],
    }),
    currencyCheck('user_quotes_quote_currency_check', table.quoteCurrency),
    check(
      'user_quotes_price_check',
      sql`${table.price} > 0 and (${table.prevClose} is null or ${table.prevClose} > 0)`,
    ),
  ],
);

/**
 * A user's own market data key (FR-ST4): encrypted with the user's DEK, only the last 4 characters readable. Saving
 * one requires active 2FA (insert policy). Quota counters and `retry_after` pause it after a 429 / quota error.
 */
export const marketCredentials = pgTable(
  'market_credentials',
  {
    id: id(),
    userId: ownerId(),
    provider: marketProvider('provider').notNull(),
    apiKeyEnc: bytea('api_key_enc').notNull(),
    last4: varchar('last4', { length: 4 }).notNull(),
    active: boolean('active').notNull().default(true),
    status: credentialStatus('status').notNull().default('untested'),
    quotaUsed: integer('quota_used').notNull().default(0),
    quotaLimit: integer('quota_limit'),
    quotaResetAt: timestamptz('quota_reset_at'),
    retryAfter: timestamptz('retry_after'),
    lastTestedAt: timestamptz('last_tested_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique('market_credentials_user_id_id_key').on(table.userId, table.id),
    unique('market_credentials_provider_key').on(table.userId, table.provider),
    check(
      'market_credentials_quota_check',
      sql`${table.quotaUsed} >= 0 and (${table.quotaLimit} is null or ${table.quotaLimit} > 0)`,
    ),
  ],
);

/**
 * Market data requests (FR-I5 "Buka log API", FR-ST4; 30-day retention). `user_id` null = a built-in fetch for
 * everyone. `endpoint` never contains a key (masked by the caller).
 */
export const marketApiLogs = pgTable(
  'market_api_logs',
  {
    id: id(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    provider: marketProvider('provider').notNull(),
    endpoint: text('endpoint').notNull(),
    /** HTTP status; null when no response arrived (timeout, network). */
    httpStatus: smallint('http_status'),
    ok: boolean('ok').notNull(),
    durationMs: integer('duration_ms').notNull(),
    retry: smallint('retry').notNull().default(0),
    errorCode: text('error_code'),
    at: timestamptz('at').notNull().defaultNow(),
  },
  (table) => [
    index('market_api_logs_user_at_idx').on(table.userId, table.at.desc()),
    check('market_api_logs_duration_check', sql`${table.durationMs} >= 0 and ${table.retry} >= 0`),
  ],
);

/** What a built-in source's state can be: a key status, or no operator key configured (CoinMarketCap). */
export const PROVIDER_STATE_STATUSES = [...CREDENTIAL_STATUSES, 'unconfigured'] as const;

/**
 * The state of each built-in source (FR-ST4 "Aktif · jam", "Kuota habis s.d. …"; global, written by the worker): paused
 * after a 429 until `paused_until`, and CoinMarketCap's credits used this month (`credit_count`, 15 000 a month).
 */
export const marketProviderState = pgTable(
  'market_provider_state',
  {
    provider: marketProvider('provider').primaryKey(),
    status: varchar('status', { length: 16, enum: PROVIDER_STATE_STATUSES }).notNull(),
    pausedUntil: timestamptz('paused_until'),
    quotaUsed: integer('quota_used').notNull().default(0),
    quotaLimit: integer('quota_limit'),
    quotaResetAt: timestamptz('quota_reset_at'),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (table) => [
    check(
      'market_provider_state_status_check',
      sql.raw(`status in (${PROVIDER_STATE_STATUSES.map((status) => `'${status}'`).join(', ')})`),
    ),
    check('market_provider_state_quota_check', sql`${table.quotaUsed} >= 0`),
  ],
);

/** Portfolio value per day (the growth chart, FR-I3): daily by the worker, kept at month ends. */
export const portfolioSnapshots = pgTable(
  'portfolio_snapshots',
  {
    userId: ownerId(),
    snapshotDate: localDate('snapshot_date').notNull(),
    valueBaseMinor: money('value_base_minor').notNull(),
    costBaseMinor: money('cost_base_minor').notNull(),
    /** Money put in during the month so far ("Setoran bulan ini"). */
    contributionsBaseMinor: money('contributions_base_minor')
      .notNull()
      .default(sql`0`),
    /** Value per asset class. */
    breakdown: jsonb('breakdown').$type<JsonObject>().notNull().default({}),
    createdAt: createdAt(),
  },
  (table) => [primaryKey({ name: 'portfolio_snapshots_pkey', columns: [table.userId, table.snapshotDate] })],
);

/** A daily goal position, independent of the live goal row so deletion/renaming cannot erase historical labels. */
export interface GoalSnapshotData {
  readonly goalId: string;
  readonly name: string;
  readonly currency: string;
  readonly targetMinor: string;
  readonly savedMinor: string | null;
  readonly valuation: GoalValuation;
}

/** FR-LP1: daily positions (including an explicit empty day) for period-end goals; worker snapshots only, D14. */
export const goalSnapshots = pgTable(
  'goal_snapshots',
  {
    userId: ownerId(),
    snapshotDate: localDate('snapshot_date').notNull(),
    recordedAt: timestamptz('recorded_at').notNull(),
    goals: jsonb('goals').$type<readonly GoalSnapshotData[]>().notNull(),
  },
  (table) => [
    primaryKey({ name: 'goal_snapshots_pkey', columns: [table.userId, table.snapshotDate] }),
    check('goal_snapshots_goals_check', sql`jsonb_typeof(${table.goals}) = 'array'`),
  ],
);

export const reportKind = pgEnum('report_kind', REPORT_KINDS);
export const reportStatus = pgEnum('report_status', REPORT_STATUSES);

/**
 * FR-LP1–LP3: one row per report — a monthly report snapshots its closed period, and a quarter, year, or custom
 * range aggregates final monthly reports plus live boundary segments ("sementara"). Final monthly snapshots keep
 * their figures and names; provisional aggregates refresh on request. `sections` holds income sources, categories
 * against budgets, merchants, tags, accounts, goals, largest transactions, subscriptions, the daily series and six
 * month-end net-worth valuations. JSON amounts are decimal strings because `jsonb` has no bigint.
 */
export const reports = pgTable(
  'reports',
  {
    id: id(),
    userId: ownerId(),
    kind: reportKind('kind').notNull(),
    status: reportStatus('status').notNull(),
    /** The period a monthly report belongs to; `null` for a range. */
    periodId: uuid('period_id'),
    /** "September 2026", "Q3 2026", "2026", "1–15 Okt 2026". */
    label: text('label').notNull(),
    rangeStart: localDate('range_start').notNull(),
    rangeEnd: localDate('range_end').notNull(),
    /** The compared range ("Agustus 2026"), absent for a first report. */
    compareStart: localDate('compare_start'),
    compareEnd: localDate('compare_end'),
    compareLabel: text('compare_label'),
    txCount: integer('tx_count').notNull(),
    incomeMinor: money('income_minor').notNull(),
    expenseMinor: money('expense_minor').notNull(),
    savedMinor: money('saved_minor').notNull(),
    savingRateBps: integer('saving_rate_bps'),
    /** Cash + investments at `range_end`; null when it could not be valued. */
    netWorthMinor: money('net_worth_minor'),
    previous: jsonb('previous').$type<JsonObject>(),
    sections: jsonb('sections').$type<JsonObject>().notNull(),
    generatedAt: timestamptz('generated_at').notNull().defaultNow(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique('reports_user_id_id_key').on(table.userId, table.id),
    unique('reports_user_id_range_key').on(table.userId, table.kind, table.rangeStart, table.rangeEnd),
    index('reports_user_id_range_end_idx').on(table.userId, table.rangeEnd.desc()),
    foreignKey({
      name: 'reports_period_fk',
      columns: [table.userId, table.periodId],
      foreignColumns: [periods.userId, periods.id],
    }).onDelete('cascade'),
    check('reports_range_check', sql`${table.rangeEnd} >= ${table.rangeStart}`),
    check(
      'reports_kind_status_check',
      sql`(${table.kind} = 'monthly' and ${table.status} = 'final' and ${table.periodId} is not null) or (${table.kind} <> 'monthly' and ${table.status} = 'provisional' and ${table.periodId} is null)`,
    ),
    check(
      'reports_totals_check',
      sql`${table.incomeMinor} >= 0 and ${table.expenseMinor} >= 0 and ${table.savedMinor} = ${table.incomeMinor} - ${table.expenseMinor} and ${table.txCount} >= 0`,
    ),
    check(
      'reports_compare_check',
      sql`(${table.compareStart} is null) = (${table.compareEnd} is null) and (${table.compareStart} is null or ${table.compareStart} <= ${table.compareEnd})`,
    ),
  ],
);

/**
 * FR-LP4 / plan §4.6: one exported file of a report (PDF, XLSX, or CSV). The bytes are encrypted with the owner's DEK
 * in object storage (`reports` bucket, `u/{userId}/{uuidv7}`); the row keeps only the key and the export options, so
 * the saved list ("Laporan tersimpan") can re-download without regenerating. Re-exporting the same report and format
 * adds another row; deleting the report deletes its files.
 */
export const reportFiles = pgTable(
  'report_files',
  {
    id: uuid('id')
      .notNull()
      .default(sql`uuidv7()`),
    userId: ownerId(),
    reportId: uuid('report_id').notNull(),
    format: text('format').$type<ReportFormat>().notNull(),
    /** What the export dialog chose (design yLlRY): sections, theme, paper, account masking. */
    options: jsonb('options').$type<ReportExportOptions>().notNull(),
    /** The object-storage key the bytes were stored under. */
    fileKey: text('file_key').notNull(),
    /** Plaintext size in bytes (what the saved list shows as "1,2 MB"). */
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({ name: 'report_files_pkey', columns: [table.userId, table.id] }),
    index('report_files_user_id_created_at_idx').on(table.userId, table.createdAt.desc()),
    foreignKey({
      name: 'report_files_report_fk',
      columns: [table.userId, table.reportId],
      foreignColumns: [reports.userId, reports.id],
    }).onDelete('cascade'),
    check('report_files_format_check', sql`${table.format} in ('pdf', 'xlsx', 'csv')`),
    check('report_files_size_check', sql`${table.sizeBytes} >= 0`),
  ],
);

// ---------------------------------------------------------------------------------------------------------------
// Auto rules (M7.1, FR-AI1). Rules only suggest (D14): they never write a transaction, posting, budget, or goal.
// ---------------------------------------------------------------------------------------------------------------

/**
 * A user-owned ordered rule: conditions (AND) and actions (a category and/or tags), stored as JSON arrays typed by
 * `@wf/domain/rules`. The position is explicit, so the topmost matching rule's category is reproducible.
 */
export const autoRules = pgTable(
  'auto_rules',
  {
    id: id(),
    userId: ownerId(),
    name: text('name').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    position: integer('position').notNull(),
    conditions: jsonb('conditions').$type<readonly RuleCondition[]>().notNull(),
    actions: jsonb('actions').$type<readonly RuleAction[]>().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique('auto_rules_user_id_id_key').on(table.userId, table.id),
    index('auto_rules_user_id_position_idx').on(table.userId, table.position, table.id),
    check('auto_rules_name_check', sql`length(btrim(${table.name})) between 1 and 60`),
    check(
      'auto_rules_conditions_check',
      sql`jsonb_typeof(${table.conditions}) = 'array' and jsonb_array_length(${table.conditions}) between 1 and 8`,
    ),
    check(
      'auto_rules_actions_check',
      sql`jsonb_typeof(${table.actions}) = 'array' and jsonb_array_length(${table.actions}) between 1 and 8`,
    ),
    check('auto_rules_position_check', sql`${table.position} >= 0`),
  ],
);

/**
 * Minimal, auditable evidence of a manual category correction: the transaction, its normalized description/merchant
 * pattern, and the category it was changed from and to. Four distinct corrected transactions of one pattern suggest a
 * rule (FR-AI1). Only the manual edit path writes this table; rule backfill and seed creation never do.
 */
export const autoRuleCorrections = pgTable(
  'auto_rule_corrections',
  {
    id: id(),
    userId: ownerId(),
    transactionId: uuid('transaction_id').notNull(),
    /** Grouping key from `correctionPattern` (`kopi kenangan`). */
    pattern: text('pattern').notNull(),
    /** What the suggestion quotes (`Kopi Kenangan`). */
    label: text('label').notNull(),
    fromCategoryId: uuid('from_category_id').notNull(),
    toCategoryId: uuid('to_category_id').notNull(),
    recordedAt: timestamptz('recorded_at').notNull().defaultNow(),
  },
  (table) => [
    unique('auto_rule_corrections_transaction_key').on(
      table.userId,
      table.transactionId,
      table.fromCategoryId,
      table.toCategoryId,
    ),
    index('auto_rule_corrections_user_id_pattern_idx').on(table.userId, table.pattern, table.toCategoryId),
    foreignKey({
      name: 'auto_rule_corrections_transaction_fk',
      columns: [table.userId, table.transactionId],
      foreignColumns: [transactions.userId, transactions.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'auto_rule_corrections_from_category_fk',
      columns: [table.userId, table.fromCategoryId],
      foreignColumns: [categories.userId, categories.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'auto_rule_corrections_to_category_fk',
      columns: [table.userId, table.toCategoryId],
      foreignColumns: [categories.userId, categories.id],
    }).onDelete('cascade'),
    check('auto_rule_corrections_pattern_check', sql`length(btrim(${table.pattern})) between 3 and 120`),
    check('auto_rule_corrections_label_check', sql`length(btrim(${table.label})) between 1 and 60`),
    check('auto_rule_corrections_categories_check', sql`${table.fromCategoryId} <> ${table.toCategoryId}`),
  ],
);

/** "Abaikan" on a correction suggestion (FR-AI1): durable per user, so the same pattern is not offered again. */
export const autoRuleSuggestionDismissals = pgTable(
  'auto_rule_suggestion_dismissals',
  {
    id: id(),
    userId: ownerId(),
    /** `ruleSuggestionKey(pattern, fromCategoryId, toCategoryId)`; opaque to the UI. */
    key: text('key').notNull(),
    dismissedAt: timestamptz('dismissed_at').notNull().defaultNow(),
  },
  (table) => [
    unique('auto_rule_suggestion_dismissals_key').on(table.userId, table.key),
    check('auto_rule_suggestion_dismissals_key_check', sql`length(${table.key}) between 1 and 200`),
  ],
);

/** FR-AI2. No plaintext credential or financial prompt is stored in these tables. */
export const aiSettings = pgTable(
  'ai_settings',
  {
    userId: ownerId().primaryKey(),
    revision: uuid('revision').notNull().defaultRandom(),
    provider: varchar('provider', { length: 16, enum: AI_PROVIDERS }).notNull().default('openrouter'),
    allowReadFinancial: boolean('allow_read_financial').notNull().default(false),
    allowCreateDrafts: boolean('allow_create_drafts').notNull().default(false),
    requireConfirmation: boolean('require_confirmation').notNull().default(true),
    monthlyLimitUsd: numeric('monthly_limit_usd', { precision: 38, scale: 18 }).notNull().default('5'),
    updatedAt: updatedAt(),
  },
  (table) => [
    check('ai_settings_provider_check', sql`${table.provider} in ('openrouter','zenmux','custom')`),
    check('ai_settings_confirmation_check', sql`${table.requireConfirmation}`),
    check('ai_settings_limit_check', sql`${table.monthlyLimitUsd} >= 0`),
  ],
);

export const aiConnections = pgTable(
  'ai_connections',
  {
    userId: ownerId(),
    provider: varchar('provider', { length: 16, enum: AI_PROVIDERS }).notNull(),
    baseUrl: text('base_url').notNull(),
    apiKeyEnc: bytea('api_key_enc'),
    last4: varchar('last4', { length: 4 }),
    modelId: varchar('model_id', { length: 200 }),
    pricing: jsonb('pricing').$type<AiPricing>(),
    pricingSource: varchar('pricing_source', { length: 8, enum: ['catalog', 'manual'] }),
    status: varchar('status', { length: 16 }).$type<AiConnectionStatus>().notNull().default('not_connected'),
    addedAt: timestamptz('added_at'),
    testedAt: timestamptz('tested_at'),
    errorCode: varchar('error_code', { length: 64 }),
    httpStatus: smallint('http_status'),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.provider] }),
    check('ai_connections_provider_check', sql`${table.provider} in ('openrouter','zenmux','custom')`),
    check('ai_connections_secret_check', sql`(${table.apiKeyEnc} is null) = (${table.last4} is null)`),
    check(
      'ai_connections_status_check',
      sql`${table.status} in ('not_connected','untested','connected','invalid_key','error')`,
    ),
    check('ai_connections_pricing_check', sql`${table.pricingSource} in ('catalog','manual')`),
  ],
);

/** Outlives the 30-day activity log: purging logs must never restore this month's cost allowance. */
export const aiUsageMonths = pgTable(
  'ai_usage_months',
  {
    userId: ownerId(),
    month: char('month', { length: 7 }).notNull(),
    requests: integer('requests').notNull().default(0),
    spentUsd: numeric('spent_usd', { precision: 38, scale: 18 }).notNull().default('0'),
    estimatedUsd: numeric('estimated_usd', { precision: 38, scale: 18 }).notNull().default('0'),
    reservedUsd: numeric('reserved_usd', { precision: 38, scale: 18 }).notNull().default('0'),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.month] }),
    check('ai_usage_months_month_check', sql`${table.month} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`),
    check(
      'ai_usage_months_cost_check',
      sql`${table.requests} >= 0 and ${table.spentUsd} >= 0 and ${table.estimatedUsd} >= 0 and ${table.estimatedUsd} <= ${table.spentUsd} and ${table.reservedUsd} >= 0`,
    ),
  ],
);

/** Only metadata; prompts, responses, raw errors and tool arguments have no storage column. */
export const aiLogs = pgTable(
  'ai_logs',
  {
    userId: ownerId(),
    id: uuid('id').notNull(),
    createdAt: createdAt(),
    month: char('month', { length: 7 }).notNull(),
    revision: uuid('revision').notNull(),
    provider: varchar('provider', { length: 16, enum: AI_PROVIDERS }).notNull(),
    feature: varchar('feature', { length: 16, enum: AI_FEATURES }).notNull(),
    modelId: varchar('model_id', { length: 200 }),
    status: varchar('status', { length: 8, enum: AI_LOG_STATUSES }).notNull(),
    httpStatus: smallint('http_status'),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    costUsd: numeric('cost_usd', { precision: 38, scale: 18 }),
    reservedUsd: numeric('reserved_usd', { precision: 38, scale: 18 }).notNull(),
    costSource: varchar('cost_source', { length: 16 }).$type<AiCostSource>().notNull().default('unknown'),
    durationMs: integer('duration_ms').notNull().default(0),
    images: integer('images').notNull().default(0),
    categories: integer('categories').notNull().default(0),
    accounts: integer('accounts').notNull().default(0),
    transactions: integer('transactions').notNull().default(0),
    toolCalls: text('tool_calls')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    errorCode: varchar('error_code', { length: 64 }),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.id] }),
    index('ai_logs_user_created_idx').on(table.userId, table.createdAt.desc(), table.id),
    check('ai_logs_provider_check', sql`${table.provider} in ('openrouter','zenmux','custom')`),
    check('ai_logs_feature_check', sql`${table.feature} in ('test','chat','receipt','categorize','gmail')`),
    check('ai_logs_status_check', sql`${table.status} in ('pending','ok','error','timeout','blocked')`),
    check('ai_logs_cost_source_check', sql`${table.costSource} in ('reported','estimated','free','unknown')`),
    check(
      'ai_logs_values_check',
      sql`${table.reservedUsd} >= 0 and (${table.costUsd} is null or ${table.costUsd} >= 0) and ${table.durationMs} >= 0 and ${table.images} >= 0 and ${table.categories} >= 0 and ${table.accounts} >= 0 and ${table.transactions} >= 0 and (${table.inputTokens} is null or ${table.inputTokens} >= 0) and (${table.outputTokens} is null or ${table.outputTokens} >= 0)`,
    ),
  ],
);
