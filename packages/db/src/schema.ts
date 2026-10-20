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
import { ACCOUNT_TYPES } from '@wf/domain/ledger';
import { CATEGORY_GROUPS, CATEGORY_KINDS } from '@wf/domain/categories';
import { POSTING_ROLES, TRANSACTION_SOURCES, TRANSACTION_TYPES } from '@wf/domain/transactions';
import { RECURRENCE_END_TYPES, RECURRENCE_FREQS } from '@wf/domain/recurrence';
import { CANCEL_MODES, SUBSCRIPTION_CYCLES, SUBSCRIPTION_STATUSES, USAGE_RATINGS } from '@wf/domain/subscriptions';
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
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

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
    /** Account ids in payment order. */
    ccPaymentPriority: jsonb('cc_payment_priority').$type<readonly string[]>().notNull().default([]),
    /**
     * FR-ST1 "Mata uang tambahan" (onboarding step 1): currencies besides the base one the user wants rates for,
     * even before an account uses them. ISO 4217 codes, at most 20.
     */
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
  (table) => [
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

export const RECENT_ITEM_KINDS = ['transaction', 'account', 'category', 'tag', 'goal', 'page'] as const;
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

/** Savings goals, minimal for onboarding step 4 (FR-A4); M4 adds funding sources and plans. */
export const goals = pgTable(
  'goals',
  {
    id: id(),
    userId: ownerId(),
    name: varchar('name', { length: 40 }).notNull(),
    icon: text('icon').notNull(),
    color: text('color').notNull(),
    targetMinor: money('target_minor').notNull(),
    currency: currency('currency').notNull(),
    /** First day of the deadline month. */
    deadlineMonth: localDate('deadline_month'),
    tagId: uuid('tag_id'),
    /** "Simpan di" (onboarding step 4): the account the goal's money is kept in; M4 adds mixed funding sources. */
    accountId: uuid('account_id'),
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
