CREATE TYPE "public"."asset_class" AS ENUM('us_stocks', 'international', 'indonesia', 'crypto', 'cash', 'gold', 'income');--> statement-breakpoint
CREATE TYPE "public"."market_credential_status" AS ENUM('untested', 'connected', 'unverified', 'invalid_key', 'quota_exhausted', 'rate_limited', 'error');--> statement-breakpoint
CREATE TYPE "public"."dividend_mode" AS ENUM('reinvest', 'cash', 'account');--> statement-breakpoint
CREATE TYPE "public"."market" AS ENUM('fx', 'us_equity', 'idx_equity', 'crypto', 'gold_spot', 'gold_antam', 'mutual_fund', 'sbn');--> statement-breakpoint
CREATE TYPE "public"."market_provider" AS ENUM('frankfurter', 'fawazahmed0', 'open_er_api', 'coinmarketcap', 'tiingo', 'finnhub', 'massive', 'alpha_vantage', 'eodhd', 'marketstack', 'coingecko', 'goldapi', 'metals_dev');--> statement-breakpoint
CREATE TYPE "public"."price_mode" AS ENUM('server', 'byok', 'manual', 'computed');--> statement-breakpoint
CREATE TYPE "public"."trade_kind" AS ENUM('buy', 'sell', 'dividend', 'cash_topup', 'adjust');--> statement-breakpoint
CREATE TYPE "public"."trade_status" AS ENUM('settled', 'pending');--> statement-breakpoint
ALTER TYPE "public"."goal_source_mode" ADD VALUE 'percent';--> statement-breakpoint
CREATE TABLE "allocation_targets" (
	"user_id" uuid NOT NULL,
	"asset_class" "asset_class" NOT NULL,
	"target_bps" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "allocation_targets_pkey" PRIMARY KEY("user_id","asset_class"),
	CONSTRAINT "allocation_targets_bps_check" CHECK ("allocation_targets"."target_bps" between 0 and 10000)
);
--> statement-breakpoint
CREATE TABLE "asset_categories" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" varchar(40) NOT NULL,
	"asset_class" "asset_class" NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "asset_categories_user_id_id_key" UNIQUE("user_id","id"),
	CONSTRAINT "asset_categories_name_check" CHECK (length(btrim("asset_categories"."name")) > 0)
);
--> statement-breakpoint
CREATE TABLE "assets" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"symbol" varchar(20) NOT NULL,
	"name" varchar(80) NOT NULL,
	"quote_currency" char(3) NOT NULL,
	"asset_class" "asset_class" NOT NULL,
	"market" "market" NOT NULL,
	"category_id" uuid,
	"price_mode" "price_mode" DEFAULT 'manual' NOT NULL,
	"manual_price" numeric(38, 18),
	"manual_price_at" timestamp with time zone,
	"premium_bps" integer,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assets_user_id_id_key" UNIQUE("user_id","id"),
	CONSTRAINT "assets_account_symbol_key" UNIQUE("user_id","account_id","symbol"),
	CONSTRAINT "assets_quote_currency_check" CHECK ("assets"."quote_currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "assets_symbol_check" CHECK (length(btrim("assets"."symbol")) > 0),
	CONSTRAINT "assets_name_check" CHECK (length(btrim("assets"."name")) > 0),
	CONSTRAINT "assets_manual_price_check" CHECK (("assets"."manual_price" is null) = ("assets"."manual_price_at" is null) and ("assets"."manual_price" is null or "assets"."manual_price" > 0)),
	CONSTRAINT "assets_manual_mode_check" CHECK ("assets"."price_mode" <> 'manual' or "assets"."manual_price" is not null),
	CONSTRAINT "assets_premium_check" CHECK ("assets"."premium_bps" is null or "assets"."premium_bps" > -10000)
);
--> statement-breakpoint
CREATE TABLE "investment_trades" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"asset_id" uuid,
	"account_id" uuid NOT NULL,
	"kind" "trade_kind" NOT NULL,
	"status" "trade_status" DEFAULT 'settled' NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"local_date" date NOT NULL,
	"units" numeric(38, 18) NOT NULL,
	"price" numeric(38, 18),
	"amount_minor" bigint NOT NULL,
	"fee_minor" bigint DEFAULT 0 NOT NULL,
	"tax_minor" bigint DEFAULT 0 NOT NULL,
	"fx_rate" numeric(20, 8) NOT NULL,
	"dividend_mode" "dividend_mode",
	"proceeds_account_id" uuid,
	"transaction_id" uuid,
	"transfer_transaction_id" uuid,
	"reduced_goal_id" uuid,
	"description" text,
	"units_delta" numeric(38, 18) NOT NULL,
	"cost_delta_minor" bigint NOT NULL,
	"cost_base_delta_minor" bigint NOT NULL,
	"realized_minor" bigint NOT NULL,
	"realized_base_minor" bigint NOT NULL,
	"dividend_minor" bigint NOT NULL,
	"dividend_base_minor" bigint NOT NULL,
	"client_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "investment_trades_user_id_id_key" UNIQUE("user_id","id"),
	CONSTRAINT "investment_trades_client_key" UNIQUE("user_id","client_id"),
	CONSTRAINT "investment_trades_asset_check" CHECK (("investment_trades"."asset_id" is null) = ("investment_trades"."kind" = 'cash_topup')),
	CONSTRAINT "investment_trades_units_check" CHECK (case "investment_trades"."kind" when 'adjust' then "investment_trades"."units" <> 0 when 'dividend' then "investment_trades"."units" >= 0 when 'cash_topup' then "investment_trades"."units" = 0 else "investment_trades"."units" > 0 end),
	CONSTRAINT "investment_trades_amounts_check" CHECK ("investment_trades"."fee_minor" >= 0 and "investment_trades"."tax_minor" >= 0 and case "investment_trades"."kind" when 'adjust' then "investment_trades"."amount_minor" = 0 when 'sell' then "investment_trades"."amount_minor" >= 0 else "investment_trades"."amount_minor" > 0 end),
	CONSTRAINT "investment_trades_fx_check" CHECK ("investment_trades"."fx_rate" > 0),
	CONSTRAINT "investment_trades_price_check" CHECK ("investment_trades"."price" is null or "investment_trades"."price" > 0),
	CONSTRAINT "investment_trades_dividend_check" CHECK (("investment_trades"."kind" = 'dividend') = ("investment_trades"."dividend_mode" is not null)),
	CONSTRAINT "investment_trades_pending_check" CHECK ("investment_trades"."status" = 'settled' or "investment_trades"."kind" = 'buy')
);
--> statement-breakpoint
CREATE TABLE "market_api_logs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid,
	"provider" "market_provider" NOT NULL,
	"endpoint" text NOT NULL,
	"http_status" smallint,
	"ok" boolean NOT NULL,
	"duration_ms" integer NOT NULL,
	"retry" smallint DEFAULT 0 NOT NULL,
	"error_code" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "market_api_logs_duration_check" CHECK ("market_api_logs"."duration_ms" >= 0 and "market_api_logs"."retry" >= 0)
);
--> statement-breakpoint
CREATE TABLE "market_credentials" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" "market_provider" NOT NULL,
	"api_key_enc" "bytea" NOT NULL,
	"last4" varchar(4) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"status" "market_credential_status" DEFAULT 'untested' NOT NULL,
	"quota_used" integer DEFAULT 0 NOT NULL,
	"quota_limit" integer,
	"quota_reset_at" timestamp with time zone,
	"retry_after" timestamp with time zone,
	"last_tested_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "market_credentials_user_id_id_key" UNIQUE("user_id","id"),
	CONSTRAINT "market_credentials_provider_key" UNIQUE("user_id","provider"),
	CONSTRAINT "market_credentials_quota_check" CHECK ("market_credentials"."quota_used" >= 0 and ("market_credentials"."quota_limit" is null or "market_credentials"."quota_limit" > 0))
);
--> statement-breakpoint
CREATE TABLE "market_quotes" (
	"provider" "market_provider" NOT NULL,
	"symbol" varchar(32) NOT NULL,
	"quote_currency" char(3) NOT NULL,
	"bucket_ts" timestamp with time zone NOT NULL,
	"price" numeric(38, 18) NOT NULL,
	"prev_close" numeric(38, 18),
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source_attr" text,
	CONSTRAINT "market_quotes_pkey" PRIMARY KEY("provider","symbol","quote_currency","bucket_ts"),
	CONSTRAINT "market_quotes_quote_currency_check" CHECK ("market_quotes"."quote_currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "market_quotes_price_check" CHECK ("market_quotes"."price" > 0 and ("market_quotes"."prev_close" is null or "market_quotes"."prev_close" > 0))
);
--> statement-breakpoint
CREATE TABLE "portfolio_snapshots" (
	"user_id" uuid NOT NULL,
	"snapshot_date" date NOT NULL,
	"value_base_minor" bigint NOT NULL,
	"cost_base_minor" bigint NOT NULL,
	"contributions_base_minor" bigint DEFAULT 0 NOT NULL,
	"breakdown" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "portfolio_snapshots_pkey" PRIMARY KEY("user_id","snapshot_date")
);
--> statement-breakpoint
CREATE TABLE "user_quotes" (
	"user_id" uuid NOT NULL,
	"provider" "market_provider" NOT NULL,
	"symbol" varchar(32) NOT NULL,
	"quote_currency" char(3) NOT NULL,
	"bucket_ts" timestamp with time zone NOT NULL,
	"price" numeric(38, 18) NOT NULL,
	"prev_close" numeric(38, 18),
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_quotes_pkey" PRIMARY KEY("user_id","provider","symbol","quote_currency","bucket_ts"),
	CONSTRAINT "user_quotes_quote_currency_check" CHECK ("user_quotes"."quote_currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "user_quotes_price_check" CHECK ("user_quotes"."price" > 0 and ("user_quotes"."prev_close" is null or "user_quotes"."prev_close" > 0))
);
--> statement-breakpoint
ALTER TABLE "goal_funding_sources" ALTER COLUMN "account_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "goal_funding_sources" ADD COLUMN "asset_id" uuid;--> statement-breakpoint
ALTER TABLE "goal_funding_sources" ADD COLUMN "pct_bps" integer;--> statement-breakpoint
ALTER TABLE "allocation_targets" ADD CONSTRAINT "allocation_targets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_categories" ADD CONSTRAINT "asset_categories_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_account_fk" FOREIGN KEY ("user_id","account_id") REFERENCES "public"."accounts"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_category_fk" FOREIGN KEY ("user_id","category_id") REFERENCES "public"."asset_categories"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_trades" ADD CONSTRAINT "investment_trades_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_trades" ADD CONSTRAINT "investment_trades_asset_fk" FOREIGN KEY ("user_id","asset_id") REFERENCES "public"."assets"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_trades" ADD CONSTRAINT "investment_trades_account_fk" FOREIGN KEY ("user_id","account_id") REFERENCES "public"."accounts"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_trades" ADD CONSTRAINT "investment_trades_proceeds_account_fk" FOREIGN KEY ("user_id","proceeds_account_id") REFERENCES "public"."accounts"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_trades" ADD CONSTRAINT "investment_trades_transaction_fk" FOREIGN KEY ("user_id","transaction_id") REFERENCES "public"."transactions"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_trades" ADD CONSTRAINT "investment_trades_transfer_fk" FOREIGN KEY ("user_id","transfer_transaction_id") REFERENCES "public"."transactions"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_trades" ADD CONSTRAINT "investment_trades_goal_fk" FOREIGN KEY ("user_id","reduced_goal_id") REFERENCES "public"."goals"("user_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_api_logs" ADD CONSTRAINT "market_api_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_credentials" ADD CONSTRAINT "market_credentials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_snapshots" ADD CONSTRAINT "portfolio_snapshots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_quotes" ADD CONSTRAINT "user_quotes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assets_symbol_trgm_idx" ON "assets" USING gin ("symbol" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "assets_name_trgm_idx" ON "assets" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "investment_trades_asset_idx" ON "investment_trades" USING btree ("user_id","asset_id","local_date");--> statement-breakpoint
CREATE INDEX "investment_trades_transaction_idx" ON "investment_trades" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "investment_trades_transfer_idx" ON "investment_trades" USING btree ("transfer_transaction_id");--> statement-breakpoint
CREATE INDEX "market_api_logs_user_at_idx" ON "market_api_logs" USING btree ("user_id","at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "goal_funding_sources" ADD CONSTRAINT "goal_funding_sources_asset_fk" FOREIGN KEY ("user_id","asset_id") REFERENCES "public"."assets"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "goal_funding_sources_asset_idx" ON "goal_funding_sources" USING btree ("user_id","asset_id");--> statement-breakpoint
ALTER TABLE "goal_funding_sources" ADD CONSTRAINT "goal_funding_sources_goal_asset_key" UNIQUE("goal_id","asset_id");--> statement-breakpoint
ALTER TABLE "goal_funding_sources" ADD CONSTRAINT "goal_funding_sources_target_check" CHECK (num_nonnulls("goal_funding_sources"."account_id", "goal_funding_sources"."asset_id") = 1);--> statement-breakpoint
ALTER TABLE "goal_funding_sources" ADD CONSTRAINT "goal_funding_sources_mode_check" CHECK (("goal_funding_sources"."account_id" is null or "goal_funding_sources"."mode" in ('whole', 'fixed')) and ("goal_funding_sources"."asset_id" is null or "goal_funding_sources"."mode" <> 'fixed'));--> statement-breakpoint
ALTER TABLE "goal_funding_sources" ADD CONSTRAINT "goal_funding_sources_pct_check" CHECK (("goal_funding_sources"."pct_bps" is not null) = ("goal_funding_sources"."asset_id" is not null and "goal_funding_sources"."mode" <> 'whole') and ("goal_funding_sources"."pct_bps" is null or "goal_funding_sources"."pct_bps" between 1 and 10000));
-- Holdings are derived from the trades (one source of truth): Σ of each trade's effect on its asset, which the
-- investments repository replays in trade order on every change. Pending buys ("diproses") are reported apart.
-- security_invoker: the trades' Row-Level Security applies to whoever reads the view.
CREATE VIEW holdings WITH (security_invoker = true) AS
  SELECT user_id, asset_id,
    coalesce(sum(units_delta) FILTER (WHERE status = 'settled'), 0)::numeric(38,18) AS units,
    coalesce(sum(cost_delta_minor), 0)::bigint AS cost_minor,
    coalesce(sum(cost_base_delta_minor), 0)::bigint AS cost_base_minor,
    coalesce(sum(realized_minor), 0)::bigint AS realized_minor,
    coalesce(sum(realized_base_minor), 0)::bigint AS realized_base_minor,
    coalesce(sum(dividend_minor), 0)::bigint AS dividend_minor,
    coalesce(sum(dividend_base_minor), 0)::bigint AS dividend_base_minor,
    coalesce(sum(amount_minor) FILTER (WHERE status = 'pending'), 0)::bigint AS pending_minor,
    coalesce(round(sum(amount_minor * fx_rate) FILTER (WHERE status = 'pending')), 0)::bigint AS pending_base_minor
  FROM investment_trades
  WHERE asset_id IS NOT NULL
  GROUP BY user_id, asset_id;
--> statement-breakpoint
GRANT SELECT ON holdings TO wf_app, wf_worker;
--> statement-breakpoint

-- The global quote cache holds built-in sources only; the app reads it through this view (owned by wf_migrate, which
-- the policy below lets read it), never the table, and BYOK results never enter it.
CREATE VIEW market_quotes_latest AS
  SELECT DISTINCT ON (provider, symbol, quote_currency)
    provider, symbol, quote_currency, bucket_ts, price, prev_close, fetched_at, source_attr
  FROM market_quotes
  ORDER BY provider, symbol, quote_currency, bucket_ts DESC;
--> statement-breakpoint
GRANT SELECT ON market_quotes_latest TO wf_app, wf_worker;
--> statement-breakpoint

-- Row-Level Security on every M5 table (plan §4.0, §4.5).
ALTER TABLE asset_categories ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE asset_categories FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE assets ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE assets FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE allocation_targets ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE allocation_targets FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE investment_trades ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE investment_trades FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE market_quotes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE market_quotes FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE user_quotes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE user_quotes FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE market_credentials ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE market_credentials FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE market_api_logs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE market_api_logs FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE portfolio_snapshots ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE portfolio_snapshots FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY asset_categories_owner ON asset_categories FOR ALL TO wf_app, wf_worker
  USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());
--> statement-breakpoint
CREATE POLICY assets_owner ON assets FOR ALL TO wf_app, wf_worker
  USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());
--> statement-breakpoint
CREATE POLICY allocation_targets_owner ON allocation_targets FOR ALL TO wf_app, wf_worker
  USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());
--> statement-breakpoint
CREATE POLICY investment_trades_owner ON investment_trades FOR ALL TO wf_app, wf_worker
  USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());
--> statement-breakpoint
CREATE POLICY user_quotes_owner ON user_quotes FOR ALL TO wf_app, wf_worker
  USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());
--> statement-breakpoint
CREATE POLICY portfolio_snapshots_owner ON portfolio_snapshots FOR ALL TO wf_app, wf_worker
  USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());
--> statement-breakpoint
-- FR-ST4: a key can be saved only with active 2FA; reading, updating, and deleting are the owner's.
CREATE POLICY market_credentials_owner ON market_credentials FOR SELECT TO wf_app, wf_worker
  USING (user_id = app_user_id());
--> statement-breakpoint
CREATE POLICY market_credentials_insert ON market_credentials FOR INSERT TO wf_app
  WITH CHECK (user_id = app_user_id()
    AND coalesce((SELECT two_factor_enabled FROM users WHERE id = app_user_id()), false));
--> statement-breakpoint
CREATE POLICY market_credentials_update ON market_credentials FOR UPDATE TO wf_app, wf_worker
  USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());
--> statement-breakpoint
CREATE POLICY market_credentials_delete ON market_credentials FOR DELETE TO wf_app USING (user_id = app_user_id());
--> statement-breakpoint
-- Built-in quotes: global, written by the worker only; read by the app through market_quotes_latest (owner wf_migrate).
CREATE POLICY market_quotes_worker ON market_quotes FOR ALL TO wf_worker USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY market_quotes_view ON market_quotes FOR SELECT TO wf_migrate USING (true);
--> statement-breakpoint
-- Request log: the user's own requests and the built-in fetches (no user data in them).
CREATE POLICY market_api_logs_read ON market_api_logs FOR SELECT TO wf_app, wf_worker
  USING (user_id IS NULL OR user_id = app_user_id());
--> statement-breakpoint
CREATE POLICY market_api_logs_insert ON market_api_logs FOR INSERT TO wf_app, wf_worker
  WITH CHECK (user_id IS NULL OR user_id = app_user_id());
--> statement-breakpoint

-- The app manages the user's portfolio and keys; D14: the worker only reads them, apart from the market data it
-- fetches (quotes, request log, key status and quota) and the daily portfolio snapshot.
GRANT SELECT, INSERT, UPDATE, DELETE ON asset_categories, assets, allocation_targets, investment_trades, market_credentials TO wf_app;
--> statement-breakpoint
GRANT SELECT, DELETE ON user_quotes TO wf_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON market_api_logs TO wf_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON portfolio_snapshots TO wf_app;
--> statement-breakpoint
GRANT SELECT ON asset_categories, assets, allocation_targets, investment_trades TO wf_worker;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON market_quotes TO wf_worker;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON user_quotes TO wf_worker;
--> statement-breakpoint
GRANT SELECT, UPDATE (status, quota_used, quota_limit, quota_reset_at, retry_after, last_tested_at, updated_at) ON market_credentials TO wf_worker;
--> statement-breakpoint
GRANT SELECT, INSERT ON market_api_logs TO wf_worker;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON portfolio_snapshots TO wf_worker;
--> statement-breakpoint

-- FR-G2: Σ percentages of an asset across goals ≤ 100%, a whole asset counting 100%, whatever writes them. The asset
-- row is locked first, so two concurrent writes cannot both pass. Runs as the invoker (RLS: own rows only).
CREATE FUNCTION goal_funding_sources_asset_within_100() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public
AS $$
DECLARE
  v_total bigint;
BEGIN
  IF NEW.asset_id IS NULL THEN
    RETURN NEW;
  END IF;
  PERFORM 1 FROM assets WHERE id = NEW.asset_id FOR UPDATE;
  SELECT coalesce(sum(coalesce(pct_bps, 10000)), 0) INTO v_total
    FROM goal_funding_sources WHERE asset_id = NEW.asset_id AND id <> NEW.id;
  IF v_total + coalesce(NEW.pct_bps, 10000) > 10000 THEN
    RAISE EXCEPTION 'goal allocations of an asset exceed 100%%' USING ERRCODE = 'check_violation',
      CONSTRAINT = 'goal_funding_sources_asset_within_100';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER goal_funding_sources_asset_within_100 BEFORE INSERT OR UPDATE OF asset_id, mode, pct_bps
  ON goal_funding_sources FOR EACH ROW EXECUTE FUNCTION goal_funding_sources_asset_within_100();
--> statement-breakpoint

-- FR-I3: a user's allocation targets sum to exactly 100% (or there are none), checked at commit so a whole set can be
-- replaced row by row.
CREATE FUNCTION allocation_targets_sum_100() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user uuid := coalesce(NEW.user_id, OLD.user_id);
  v_total bigint;
BEGIN
  SELECT sum(target_bps) INTO v_total FROM allocation_targets WHERE user_id = v_user;
  IF v_total IS NOT NULL AND v_total <> 10000 THEN
    RAISE EXCEPTION 'allocation targets must total 100%%' USING ERRCODE = 'check_violation',
      CONSTRAINT = 'allocation_targets_sum_100';
  END IF;
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER allocation_targets_sum_100 AFTER INSERT OR UPDATE OR DELETE ON allocation_targets
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION allocation_targets_sum_100();
