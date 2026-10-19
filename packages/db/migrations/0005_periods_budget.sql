CREATE TYPE "public"."budget_override_reason" AS ENUM('transfer', 'rollover');--> statement-breakpoint
CREATE TYPE "public"."period_kind" AS ENUM('normal', 'transition');--> statement-breakpoint
CREATE TYPE "public"."period_status" AS ENUM('open', 'closed');--> statement-breakpoint
CREATE TABLE "budget_alert_dismissals" (
	"user_id" uuid NOT NULL,
	"period_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budget_alert_dismissals_user_id_period_id_category_id_pk" PRIMARY KEY("user_id","period_id","category_id")
);
--> statement-breakpoint
CREATE TABLE "budget_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"limit_minor" bigint NOT NULL,
	"rollover" boolean DEFAULT false NOT NULL,
	"is_fixed" boolean DEFAULT false NOT NULL,
	"alert_pct" smallint DEFAULT 85 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budget_lines_version_id_category_id_key" UNIQUE("version_id","category_id"),
	CONSTRAINT "budget_lines_limit_check" CHECK ("budget_lines"."limit_minor" >= 0),
	CONSTRAINT "budget_lines_alert_pct_check" CHECK ("budget_lines"."alert_pct" in (50, 80, 85, 100))
);
--> statement-breakpoint
CREATE TABLE "budget_period_overrides" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"period_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"delta_minor" bigint NOT NULL,
	"reason" "budget_override_reason" NOT NULL,
	"move_id" uuid,
	"review_item_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budget_period_overrides_delta_check" CHECK ("budget_period_overrides"."delta_minor" <> 0),
	CONSTRAINT "budget_period_overrides_move_check" CHECK (("budget_period_overrides"."reason" = 'transfer') = ("budget_period_overrides"."move_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "budget_versions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"effective_from" char(7) NOT NULL,
	"expected_income_minor" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budget_versions_user_id_id_key" UNIQUE("user_id","id"),
	CONSTRAINT "budget_versions_user_id_effective_from_key" UNIQUE("user_id","effective_from"),
	CONSTRAINT "budget_versions_effective_from_check" CHECK ("budget_versions"."effective_from" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "budget_versions_expected_income_check" CHECK ("budget_versions"."expected_income_minor" is null or "budget_versions"."expected_income_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "periods" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"label" char(7) NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"days" smallint NOT NULL,
	"kind" "period_kind" DEFAULT 'normal' NOT NULL,
	"status" "period_status" DEFAULT 'open' NOT NULL,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "periods_user_id_id_key" UNIQUE("user_id","id"),
	CONSTRAINT "periods_user_id_start_date_key" UNIQUE("user_id","start_date"),
	CONSTRAINT "periods_label_check" CHECK ("periods"."label" = to_char("periods"."end_date", 'YYYY-MM')),
	CONSTRAINT "periods_days_check" CHECK ("periods"."days" = "periods"."end_date" - "periods"."start_date" + 1 and "periods"."days" between 1 and 62),
	CONSTRAINT "periods_closed_check" CHECK (("periods"."status" = 'closed') = ("periods"."closed_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "budget_alert_dismissals" ADD CONSTRAINT "budget_alert_dismissals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_alert_dismissals" ADD CONSTRAINT "budget_alert_dismissals_period_fk" FOREIGN KEY ("user_id","period_id") REFERENCES "public"."periods"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_alert_dismissals" ADD CONSTRAINT "budget_alert_dismissals_category_fk" FOREIGN KEY ("user_id","category_id") REFERENCES "public"."categories"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_version_fk" FOREIGN KEY ("user_id","version_id") REFERENCES "public"."budget_versions"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_category_fk" FOREIGN KEY ("user_id","category_id") REFERENCES "public"."categories"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_period_overrides" ADD CONSTRAINT "budget_period_overrides_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_period_overrides" ADD CONSTRAINT "budget_period_overrides_period_fk" FOREIGN KEY ("user_id","period_id") REFERENCES "public"."periods"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_period_overrides" ADD CONSTRAINT "budget_period_overrides_category_fk" FOREIGN KEY ("user_id","category_id") REFERENCES "public"."categories"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_versions" ADD CONSTRAINT "budget_versions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "periods" ADD CONSTRAINT "periods_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "budget_lines_user_id_category_id_idx" ON "budget_lines" USING btree ("user_id","category_id");--> statement-breakpoint
CREATE INDEX "budget_period_overrides_user_id_period_id_idx" ON "budget_period_overrides" USING btree ("user_id","period_id");--> statement-breakpoint
CREATE INDEX "budget_period_overrides_move_id_idx" ON "budget_period_overrides" USING btree ("move_id");--> statement-breakpoint
CREATE INDEX "periods_user_id_end_date_idx" ON "periods" USING btree ("user_id","end_date");--> statement-breakpoint
ALTER TABLE "transactions" DROP COLUMN "period_id";--> statement-breakpoint

-- Row-Level Security on the period and budget tables (plan §4.0, §4.2).
ALTER TABLE periods ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE periods FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE budget_versions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE budget_versions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE budget_lines ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE budget_lines FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE budget_period_overrides ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE budget_period_overrides FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE budget_alert_dismissals ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE budget_alert_dismissals FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY periods_owner ON periods FOR ALL TO wf_app, wf_worker
  USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());
--> statement-breakpoint
CREATE POLICY budget_versions_owner ON budget_versions FOR ALL TO wf_app, wf_worker
  USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());
--> statement-breakpoint
CREATE POLICY budget_lines_owner ON budget_lines FOR ALL TO wf_app, wf_worker
  USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());
--> statement-breakpoint
CREATE POLICY budget_period_overrides_owner ON budget_period_overrides FOR ALL TO wf_app, wf_worker
  USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());
--> statement-breakpoint
CREATE POLICY budget_alert_dismissals_owner ON budget_alert_dismissals FOR ALL TO wf_app, wf_worker
  USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());
--> statement-breakpoint
-- The app materializes periods, changes the start day, and edits budgets.
GRANT SELECT, INSERT, UPDATE, DELETE ON periods, budget_versions, budget_lines, budget_period_overrides, budget_alert_dismissals TO wf_app;
--> statement-breakpoint
-- D14: the worker reads periods and budgets (alerts, period-close proposals, reports) and changes no budget row; its
-- only writes are `periods.lock` (close a period that has ended and create the next one, FR-P4).
GRANT SELECT ON periods, budget_versions, budget_lines, budget_period_overrides, budget_alert_dismissals TO wf_worker;
--> statement-breakpoint
GRANT INSERT, UPDATE (status, closed_at, updated_at) ON periods TO wf_worker;
