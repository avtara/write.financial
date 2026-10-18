CREATE TYPE "public"."date_format" AS ENUM('medium', 'numeric', 'iso');--> statement-breakpoint
CREATE TYPE "public"."feature" AS ENUM('attachments', 'ai_assistant', 'gmail_import', 'market_byok', 'data_export');--> statement-breakpoint
CREATE TYPE "public"."locale" AS ENUM('id', 'en');--> statement-breakpoint
CREATE TYPE "public"."number_format" AS ENUM('locale', 'id', 'en');--> statement-breakpoint
CREATE TYPE "public"."period_mode" AS ENUM('fixed_day', 'follow_payday');--> statement-breakpoint
CREATE TYPE "public"."registration_mode" AS ENUM('closed', 'open', 'invite');--> statement-breakpoint
CREATE TYPE "public"."security_event_type" AS ENUM('sign_in', 'sign_out', 'session_revoked', 'password_changed', 'password_reset', 'two_factor_enabled', 'two_factor_disabled', 'backup_codes_regenerated', 'passkey_added', 'passkey_removed', 'api_key_added', 'api_key_removed', 'gmail_connected', 'gmail_disconnected', 'data_exported', 'account_deletion_requested', 'account_deletion_cancelled');--> statement-breakpoint
CREATE TYPE "public"."theme" AS ENUM('dark', 'light', 'system');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('admin', 'user');--> statement-breakpoint
CREATE TYPE "public"."week_start" AS ENUM('monday', 'sunday');--> statement-breakpoint
CREATE TABLE "accounts_auth" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entitlements" (
	"plan_code" text NOT NULL,
	"feature" "feature" NOT NULL,
	"limit" bigint,
	CONSTRAINT "entitlements_plan_code_feature_pk" PRIMARY KEY("plan_code","feature"),
	CONSTRAINT "entitlements_limit_check" CHECK ("entitlements"."limit" >= 0)
);
--> statement-breakpoint
CREATE TABLE "instance_settings" (
	"singleton" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"instance_name" text DEFAULT 'write.financial' NOT NULL,
	"public_url" text,
	"default_locale" "locale" DEFAULT 'id' NOT NULL,
	"default_timezone" text DEFAULT 'Asia/Jakarta' NOT NULL,
	"registration_mode" "registration_mode" DEFAULT 'closed' NOT NULL,
	"setup_completed_at" timestamp with time zone,
	"smtp_host" text,
	"smtp_port" integer,
	"smtp_secure" boolean DEFAULT false NOT NULL,
	"smtp_username" text,
	"smtp_password_enc" "bytea",
	"smtp_from" text,
	"instance_dek_wrapped" "bytea",
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "instance_settings_singleton_check" CHECK ("instance_settings"."singleton"),
	CONSTRAINT "instance_settings_smtp_port_check" CHECK ("instance_settings"."smtp_port" between 1 and 65535),
	CONSTRAINT "instance_settings_smtp_check" CHECK (("instance_settings"."smtp_host" is null) = ("instance_settings"."smtp_port" is null) and ("instance_settings"."smtp_host" is null) = ("instance_settings"."smtp_from" is null) and ("instance_settings"."smtp_host" is not null or ("instance_settings"."smtp_username" is null and "instance_settings"."smtp_password_enc" is null))),
	CONSTRAINT "instance_settings_smtp_password_check" CHECK ("instance_settings"."smtp_password_enc" is null or "instance_settings"."instance_dek_wrapped" is not null)
);
--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"email" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"invited_by" uuid NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitations_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "invitations_token_hash_check" CHECK ("invitations"."token_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "passkeys" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text,
	"public_key" text NOT NULL,
	"user_id" uuid NOT NULL,
	"credential_id" text NOT NULL,
	"counter" integer NOT NULL,
	"device_type" text NOT NULL,
	"backed_up" boolean NOT NULL,
	"transports" text,
	"created_at" timestamp with time zone,
	"aaguid" text
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "security_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" "security_event_type" NOT NULL,
	"ip_hash" text,
	"user_agent" text,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "security_events_ip_hash_check" CHECK ("security_events"."ip_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "security_events_user_agent_check" CHECK (length("security_events"."user_agent") <= 512),
	CONSTRAINT "security_events_meta_check" CHECK (jsonb_typeof("security_events"."meta") = 'object')
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" uuid NOT NULL,
	CONSTRAINT "sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "two_factors" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"secret" text NOT NULL,
	"backup_codes" text NOT NULL,
	"user_id" uuid NOT NULL,
	"verified" boolean DEFAULT true,
	"failed_verification_count" integer DEFAULT 0,
	"locked_until" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "user_keys" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"dek_wrapped" "bytea" NOT NULL,
	"kek_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rotated_at" timestamp with time zone,
	CONSTRAINT "user_keys_kek_version_check" CHECK ("user_keys"."kek_version" > 0)
);
--> statement-breakpoint
CREATE TABLE "user_plans" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"plan_code" text NOT NULL,
	"since" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_preferences" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"theme" "theme" DEFAULT 'dark' NOT NULL,
	"number_format" "number_format" DEFAULT 'locale' NOT NULL,
	"date_format" date_format DEFAULT 'medium' NOT NULL,
	"week_start" "week_start" DEFAULT 'monday' NOT NULL,
	"hide_balances" boolean DEFAULT false NOT NULL,
	"period_start_day" smallint DEFAULT 1 NOT NULL,
	"period_mode" "period_mode" DEFAULT 'fixed_day' NOT NULL,
	"notif" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"dashboard_layout" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"table_prefs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"cc_payment_priority" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_preferences_period_start_day_check" CHECK ("user_preferences"."period_start_day" between 1 and 28),
	CONSTRAINT "user_preferences_cc_payment_priority_check" CHECK (jsonb_typeof("user_preferences"."cc_payment_priority") = 'array')
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"two_factor_enabled" boolean DEFAULT false,
	"nickname" text,
	"timezone" text DEFAULT 'Asia/Jakarta' NOT NULL,
	"locale" "locale" DEFAULT 'id' NOT NULL,
	"base_currency" char(3) DEFAULT 'IDR' NOT NULL,
	"role" "user_role" DEFAULT 'user' NOT NULL,
	"onboarding_completed_at" timestamp with time zone,
	"deletion_requested_at" timestamp with time zone,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_base_currency_check" CHECK ("users"."base_currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
CREATE TABLE "verifications" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts_auth" ADD CONSTRAINT "accounts_auth_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_plan_code_plans_code_fk" FOREIGN KEY ("plan_code") REFERENCES "public"."plans"("code") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passkeys" ADD CONSTRAINT "passkeys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security_events" ADD CONSTRAINT "security_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "two_factors" ADD CONSTRAINT "two_factors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_keys" ADD CONSTRAINT "user_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_plans" ADD CONSTRAINT "user_plans_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_plans" ADD CONSTRAINT "user_plans_plan_code_plans_code_fk" FOREIGN KEY ("plan_code") REFERENCES "public"."plans"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounts_auth_user_id_idx" ON "accounts_auth" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "invitations_invited_by_idx" ON "invitations" USING btree ("invited_by");--> statement-breakpoint
CREATE INDEX "invitations_email_idx" ON "invitations" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "passkeys_user_id_idx" ON "passkeys" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "passkeys_credential_id_idx" ON "passkeys" USING btree ("credential_id");--> statement-breakpoint
CREATE INDEX "security_events_user_id_id_idx" ON "security_events" USING btree ("user_id","id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "two_factors_secret_idx" ON "two_factors" USING btree ("secret");--> statement-breakpoint
CREATE INDEX "two_factors_user_id_idx" ON "two_factors" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_keys_kek_version_idx" ON "user_keys" USING btree ("kek_version");--> statement-breakpoint
CREATE INDEX "verifications_identifier_idx" ON "verifications" USING btree ("identifier");