-- Row-Level Security, grants, the append-only trigger, and seed rows (plan §4.0, PRD §9.1).
-- Runs as wf_migrate, the owner of every table. The roles exist beforehand (`wf-db bootstrap`, src/roles.ts).
--
-- Grants decide which commands a role may run on a table; policies decide which rows. Every table except the global
-- catalog tables (plans, entitlements) has ENABLE + FORCE ROW LEVEL SECURITY, so not even the owner sees a row
-- without a matching policy. app_user_id() is NULL unless the current transaction ran
-- set_config('app.user_id', <uuid>, true) (withUser), so a query without a user context matches no user-owned row.
-- The role/grant matrix is documented in packages/db/README.md; keep both in sync.

CREATE FUNCTION app_user_id() RETURNS uuid LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT nullif(pg_catalog.current_setting('app.user_id', true), '')::uuid $$;
--> statement-breakpoint
-- Invoker rights: under wf_app's users policy the subquery only sees the caller's own row.
CREATE FUNCTION app_is_admin() RETURNS boolean LANGUAGE sql STABLE
  AS $$ SELECT EXISTS (SELECT 1 FROM public.users WHERE id = public.app_user_id() AND role = 'admin') $$;
--> statement-breakpoint
CREATE FUNCTION security_events_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Deleting a user reaches this table through the foreign key's cascade, which fires this trigger one level deep
  -- (trigger depth 2). That is the only way events disappear (account deletion, FR-A11).
  IF TG_OP = 'DELETE' AND pg_catalog.pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'security_events is append-only: % is not allowed', TG_OP USING ERRCODE = 'insufficient_privilege';
END
$$;
--> statement-breakpoint
CREATE TRIGGER security_events_append_only BEFORE UPDATE OR DELETE ON security_events
  FOR EACH ROW EXECUTE FUNCTION security_events_append_only();
--> statement-breakpoint
CREATE TRIGGER security_events_no_truncate BEFORE TRUNCATE ON security_events
  FOR EACH STATEMENT EXECUTE FUNCTION security_events_append_only();
--> statement-breakpoint

-- Seed rows (inserted before FORCE ROW LEVEL SECURITY applies to the owner).
INSERT INTO instance_settings DEFAULT VALUES;
--> statement-breakpoint
INSERT INTO plans (code, name) VALUES ('personal', 'Personal');
--> statement-breakpoint
-- v1: the personal plan includes every feature without a quota (D17).
INSERT INTO entitlements (plan_code, feature, "limit")
  SELECT 'personal', f, NULL FROM unnest(enum_range(NULL::feature)) AS f;
--> statement-breakpoint

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE users FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE sessions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE accounts_auth ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE accounts_auth FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE verifications ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE verifications FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE two_factors ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE two_factors FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE passkeys ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE passkeys FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE user_preferences FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE user_keys ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE user_keys FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE security_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE security_events FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE user_plans ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE user_plans FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE instance_settings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE instance_settings FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE invitations FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Better Auth tables: only the auth module's role, which must find sessions/verifications before a user is known.
CREATE POLICY users_auth ON users FOR ALL TO wf_auth USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY users_self ON users FOR ALL TO wf_app, wf_worker USING (id = app_user_id()) WITH CHECK (id = app_user_id());
--> statement-breakpoint
CREATE POLICY sessions_auth ON sessions FOR ALL TO wf_auth USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY accounts_auth_auth ON accounts_auth FOR ALL TO wf_auth USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY verifications_auth ON verifications FOR ALL TO wf_auth USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY two_factors_auth ON two_factors FOR ALL TO wf_auth USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY passkeys_auth ON passkeys FOR ALL TO wf_auth USING (true) WITH CHECK (true);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON users, sessions, accounts_auth, verifications, two_factors, passkeys TO wf_auth;
--> statement-breakpoint
GRANT SELECT ON users TO wf_app, wf_worker;
--> statement-breakpoint
-- Not role, email, email_verified, two_factor_enabled: those change only through the auth module.
GRANT UPDATE (name, image, nickname, timezone, locale, base_currency, onboarding_completed_at, deletion_requested_at, updated_at)
  ON users TO wf_app;
--> statement-breakpoint

-- User-owned tables: the row's user_id must be the transaction's app.user_id.
CREATE POLICY user_preferences_owner ON user_preferences FOR ALL TO wf_app, wf_worker
  USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON user_preferences TO wf_app;
--> statement-breakpoint
GRANT SELECT ON user_preferences TO wf_worker;
--> statement-breakpoint
CREATE POLICY user_keys_owner ON user_keys FOR ALL TO wf_app, wf_worker
  USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());
--> statement-breakpoint
-- KEK rotation (`wf-db rewrap-keys`) re-wraps every user's DEK. wf_migrate owns the table and could lift FORCE
-- itself, so this policy grants it nothing new; it only lets the rotation run without changing the table.
CREATE POLICY user_keys_rotation ON user_keys FOR ALL TO wf_migrate USING (true) WITH CHECK (true);
--> statement-breakpoint
GRANT SELECT, INSERT ON user_keys TO wf_app, wf_worker;
--> statement-breakpoint
CREATE POLICY security_events_owner ON security_events FOR ALL TO wf_app, wf_worker, wf_auth
  USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());
--> statement-breakpoint
CREATE POLICY security_events_audit ON security_events FOR SELECT TO wf_readonly_ops USING (true);
--> statement-breakpoint
GRANT SELECT, INSERT ON security_events TO wf_app, wf_worker, wf_auth;
--> statement-breakpoint
GRANT SELECT ON security_events TO wf_readonly_ops;
--> statement-breakpoint
CREATE POLICY user_plans_owner ON user_plans FOR ALL TO wf_app, wf_worker
  USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());
--> statement-breakpoint
CREATE POLICY user_plans_ops ON user_plans FOR SELECT TO wf_readonly_ops USING (true);
--> statement-breakpoint
GRANT SELECT ON user_plans TO wf_app, wf_worker, wf_readonly_ops;
--> statement-breakpoint

-- Global catalog: read-only for everyone, changed only by migrations.
GRANT SELECT ON plans, entitlements TO wf_app, wf_worker, wf_readonly_ops;
--> statement-breakpoint

-- Instance settings: readable without a user (sign-in page, mailer); the setup wizard updates them as an admin.
CREATE POLICY instance_settings_read ON instance_settings FOR SELECT TO wf_app, wf_worker, wf_auth, wf_readonly_ops
  USING (true);
--> statement-breakpoint
CREATE POLICY instance_settings_admin ON instance_settings FOR UPDATE TO wf_app
  USING (app_is_admin()) WITH CHECK (app_is_admin());
--> statement-breakpoint
-- KEK rotation re-wraps the instance DEK (see user_keys_rotation).
CREATE POLICY instance_settings_rotation ON instance_settings FOR ALL TO wf_migrate USING (true) WITH CHECK (true);
--> statement-breakpoint
GRANT SELECT ON instance_settings TO wf_app, wf_worker, wf_auth;
--> statement-breakpoint
GRANT UPDATE (instance_name, public_url, default_locale, default_timezone, registration_mode, setup_completed_at,
  smtp_host, smtp_port, smtp_secure, smtp_username, smtp_password_enc, smtp_from, instance_dek_wrapped, updated_at)
  ON instance_settings TO wf_app;
--> statement-breakpoint
-- Operators see the configuration but not the encrypted SMTP password or the wrapped instance DEK.
GRANT SELECT (singleton, instance_name, public_url, default_locale, default_timezone, registration_mode,
  setup_completed_at, smtp_host, smtp_port, smtp_secure, smtp_username, smtp_from, updated_at)
  ON instance_settings TO wf_readonly_ops;
--> statement-breakpoint

-- Invitations: admins manage them; the auth module looks a token up and marks it used at sign-up.
CREATE POLICY invitations_admin ON invitations FOR ALL TO wf_app USING (app_is_admin()) WITH CHECK (app_is_admin());
--> statement-breakpoint
CREATE POLICY invitations_auth ON invitations FOR ALL TO wf_auth USING (true) WITH CHECK (true);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON invitations TO wf_app;
--> statement-breakpoint
GRANT SELECT, UPDATE (used_at) ON invitations TO wf_auth;
