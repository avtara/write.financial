// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Drizzle schema for M0 (plan §4.0–4.1). Source of the generated migration in `migrations/`; roles, grants,
 * Row-Level Security, triggers, and seed rows live in the hand-written security migration next to it.
 *
 * Better Auth tables (`users` … `passkeys`) follow `npx auth generate` of Better Auth 1.7.10 with the two-factor
 * and passkey plugins, `advanced.database.generateId: 'uuid'`, and these model names. Property names are Better
 * Auth's field names (the Drizzle adapter maps by property), columns are snake_case. Deviations from the generator:
 * ids default to `uuidv7()` (PostgreSQL 18) instead of `gen_random_uuid()`, timestamps are `timestamptz`, and
 * `users` has the app's own columns, which the auth module declares as Better Auth `additionalFields`.
 */
import { LOCALES } from '@wf/i18n/locale';
import type { PeriodStartDay } from '@wf/domain/period';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  char,
  check,
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uuid,
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
