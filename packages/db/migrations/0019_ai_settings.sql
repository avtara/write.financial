CREATE TABLE "ai_connections" (
	"user_id" uuid NOT NULL,
	"provider" varchar(16) NOT NULL,
	"base_url" text NOT NULL,
	"api_key_enc" "bytea",
	"last4" varchar(4),
	"model_id" varchar(200),
	"pricing" jsonb,
	"pricing_source" varchar(8),
	"status" varchar(16) DEFAULT 'not_connected' NOT NULL,
	"added_at" timestamp with time zone,
	"tested_at" timestamp with time zone,
	"error_code" varchar(64),
	"http_status" smallint,
	CONSTRAINT "ai_connections_user_id_provider_pk" PRIMARY KEY("user_id","provider"),
	CONSTRAINT "ai_connections_provider_check" CHECK ("ai_connections"."provider" in ('openrouter','zenmux','custom')),
	CONSTRAINT "ai_connections_secret_check" CHECK (("ai_connections"."api_key_enc" is null) = ("ai_connections"."last4" is null)),
	CONSTRAINT "ai_connections_status_check" CHECK ("ai_connections"."status" in ('not_connected','untested','connected','invalid_key','error')),
	CONSTRAINT "ai_connections_pricing_check" CHECK ("ai_connections"."pricing_source" in ('catalog','manual'))
);
--> statement-breakpoint
CREATE TABLE "ai_logs" (
	"user_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"month" char(7) NOT NULL,
	"revision" uuid NOT NULL,
	"provider" varchar(16) NOT NULL,
	"feature" varchar(16) NOT NULL,
	"model_id" varchar(200),
	"status" varchar(8) NOT NULL,
	"http_status" smallint,
	"input_tokens" integer,
	"output_tokens" integer,
	"cost_usd" numeric(38, 18),
	"reserved_usd" numeric(38, 18) NOT NULL,
	"cost_source" varchar(16) DEFAULT 'unknown' NOT NULL,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"images" integer DEFAULT 0 NOT NULL,
	"categories" integer DEFAULT 0 NOT NULL,
	"accounts" integer DEFAULT 0 NOT NULL,
	"transactions" integer DEFAULT 0 NOT NULL,
	"tool_calls" text[] DEFAULT '{}'::text[] NOT NULL,
	"error_code" varchar(64),
	CONSTRAINT "ai_logs_user_id_id_pk" PRIMARY KEY("user_id","id"),
	CONSTRAINT "ai_logs_provider_check" CHECK ("ai_logs"."provider" in ('openrouter','zenmux','custom')),
	CONSTRAINT "ai_logs_feature_check" CHECK ("ai_logs"."feature" in ('test','chat','receipt','categorize','gmail')),
	CONSTRAINT "ai_logs_status_check" CHECK ("ai_logs"."status" in ('pending','ok','error','timeout','blocked')),
	CONSTRAINT "ai_logs_cost_source_check" CHECK ("ai_logs"."cost_source" in ('reported','estimated','free','unknown')),
	CONSTRAINT "ai_logs_values_check" CHECK ("ai_logs"."reserved_usd" >= 0 and ("ai_logs"."cost_usd" is null or "ai_logs"."cost_usd" >= 0) and "ai_logs"."duration_ms" >= 0 and "ai_logs"."images" >= 0 and "ai_logs"."categories" >= 0 and "ai_logs"."accounts" >= 0 and "ai_logs"."transactions" >= 0 and ("ai_logs"."input_tokens" is null or "ai_logs"."input_tokens" >= 0) and ("ai_logs"."output_tokens" is null or "ai_logs"."output_tokens" >= 0))
);
--> statement-breakpoint
CREATE TABLE "ai_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"revision" uuid DEFAULT gen_random_uuid() NOT NULL,
	"provider" varchar(16) DEFAULT 'openrouter' NOT NULL,
	"allow_read_financial" boolean DEFAULT false NOT NULL,
	"allow_create_drafts" boolean DEFAULT false NOT NULL,
	"require_confirmation" boolean DEFAULT true NOT NULL,
	"monthly_limit_usd" numeric(38, 18) DEFAULT '5' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_settings_provider_check" CHECK ("ai_settings"."provider" in ('openrouter','zenmux','custom')),
	CONSTRAINT "ai_settings_confirmation_check" CHECK ("ai_settings"."require_confirmation"),
	CONSTRAINT "ai_settings_limit_check" CHECK ("ai_settings"."monthly_limit_usd" >= 0)
);
--> statement-breakpoint
CREATE TABLE "ai_usage_months" (
	"user_id" uuid NOT NULL,
	"month" char(7) NOT NULL,
	"requests" integer DEFAULT 0 NOT NULL,
	"spent_usd" numeric(38, 18) DEFAULT '0' NOT NULL,
	"estimated_usd" numeric(38, 18) DEFAULT '0' NOT NULL,
	"reserved_usd" numeric(38, 18) DEFAULT '0' NOT NULL,
	CONSTRAINT "ai_usage_months_user_id_month_pk" PRIMARY KEY("user_id","month"),
	CONSTRAINT "ai_usage_months_month_check" CHECK ("ai_usage_months"."month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "ai_usage_months_cost_check" CHECK ("ai_usage_months"."requests" >= 0 and "ai_usage_months"."spent_usd" >= 0 and "ai_usage_months"."estimated_usd" >= 0 and "ai_usage_months"."estimated_usd" <= "ai_usage_months"."spent_usd" and "ai_usage_months"."reserved_usd" >= 0)
);
--> statement-breakpoint
ALTER TABLE "ai_connections" ADD CONSTRAINT "ai_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_logs" ADD CONSTRAINT "ai_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_settings" ADD CONSTRAINT "ai_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage_months" ADD CONSTRAINT "ai_usage_months_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_logs_user_created_idx" ON "ai_logs" USING btree ("user_id","created_at" DESC NULLS LAST,"id");
--> statement-breakpoint
ALTER TABLE ai_settings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE ai_settings FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE ai_connections ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE ai_connections FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE ai_usage_months ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE ai_usage_months FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE ai_logs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE ai_logs FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY ai_settings_owner ON ai_settings FOR ALL TO wf_app, wf_worker
  USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());
--> statement-breakpoint
CREATE POLICY ai_connections_read ON ai_connections FOR SELECT TO wf_app, wf_worker
  USING (user_id = app_user_id());
--> statement-breakpoint
CREATE POLICY ai_connections_insert ON ai_connections FOR INSERT TO wf_app
  WITH CHECK (user_id = app_user_id() AND
    (api_key_enc IS NULL OR EXISTS (SELECT 1 FROM users WHERE id = app_user_id() AND two_factor_enabled)));
--> statement-breakpoint
CREATE POLICY ai_connections_update ON ai_connections FOR UPDATE TO wf_app
  USING (user_id = app_user_id())
  WITH CHECK (user_id = app_user_id() AND
    (api_key_enc IS NULL OR EXISTS (SELECT 1 FROM users WHERE id = app_user_id() AND two_factor_enabled)));
--> statement-breakpoint
CREATE POLICY ai_connections_delete ON ai_connections FOR DELETE TO wf_app USING (user_id = app_user_id());
--> statement-breakpoint
CREATE POLICY ai_usage_months_owner ON ai_usage_months FOR ALL TO wf_app, wf_worker
  USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());
--> statement-breakpoint
CREATE POLICY ai_logs_owner ON ai_logs FOR ALL TO wf_app, wf_worker
  USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ai_settings, ai_connections TO wf_app;
--> statement-breakpoint
GRANT SELECT ON ai_settings, ai_connections TO wf_worker;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON ai_usage_months, ai_logs TO wf_app, wf_worker;
--> statement-breakpoint
-- The maintenance definer can remove only expired activity, never monthly budget accounting.
CREATE POLICY ai_logs_retention_select ON ai_logs FOR SELECT TO wf_migrate USING (true);
--> statement-breakpoint
CREATE POLICY ai_logs_retention_delete ON ai_logs FOR DELETE TO wf_migrate USING (true);
--> statement-breakpoint
CREATE FUNCTION wf_maintenance_purge_ai_logs(p_now timestamptz) RETURNS bigint
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE deleted bigint;
BEGIN
  DELETE FROM public.ai_logs WHERE created_at < LEAST(p_now, now()) - interval '30 days';
  GET DIAGNOSTICS deleted = ROW_COUNT;
  RETURN deleted;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION wf_maintenance_purge_ai_logs(timestamptz) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION wf_maintenance_purge_ai_logs(timestamptz) TO wf_worker;