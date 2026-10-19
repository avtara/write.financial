// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Drizzle schema (plan §4.0–4.1, M0 + the M1 ledger). Source of the generated migrations in `migrations/`; roles,
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
import { LOCALES } from '@wf/i18n/locale';
import type { LocalDate, PeriodStartDay } from '@wf/domain/period';
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
    /** Start of the 7-day deletion grace period (FR-A11). */
    deletionRequestedAt: timestamptz('deletion_requested_at'),
  },
  (table) => [check('users_base_currency_check', sql`${table.baseCurrency} ~ '^[A-Z]{3}$'`)],
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
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    check('user_preferences_period_start_day_check', sql`${table.periodStartDay} between 1 and 28`),
    check('user_preferences_cc_payment_priority_check', sql`jsonb_typeof(${table.ccPaymentPriority}) = 'array'`),
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
    periodId: uuid('period_id'),
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
