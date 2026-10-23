CREATE TYPE "public"."report_kind" AS ENUM('monthly', 'quarterly', 'yearly', 'custom');--> statement-breakpoint
CREATE TYPE "public"."report_status" AS ENUM('final', 'provisional');--> statement-breakpoint
CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "report_kind" NOT NULL,
	"status" "report_status" NOT NULL,
	"period_id" uuid,
	"label" text NOT NULL,
	"range_start" date NOT NULL,
	"range_end" date NOT NULL,
	"compare_start" date,
	"compare_end" date,
	"compare_label" text,
	"tx_count" integer NOT NULL,
	"income_minor" bigint NOT NULL,
	"expense_minor" bigint NOT NULL,
	"saved_minor" bigint NOT NULL,
	"saving_rate_bps" integer,
	"net_worth_minor" bigint,
	"previous" jsonb,
	"sections" jsonb NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reports_user_id_id_key" UNIQUE("user_id","id"),
	CONSTRAINT "reports_user_id_range_key" UNIQUE("user_id","kind","range_start","range_end"),
	CONSTRAINT "reports_range_check" CHECK ("reports"."range_end" >= "reports"."range_start"),
	CONSTRAINT "reports_kind_status_check" CHECK (("kind" = 'monthly' AND "status" = 'final' AND "period_id" IS NOT NULL) OR ("kind" <> 'monthly' AND "status" = 'provisional' AND "period_id" IS NULL)),
	CONSTRAINT "reports_totals_check" CHECK ("reports"."income_minor" >= 0 and "reports"."expense_minor" >= 0 and "reports"."saved_minor" = "reports"."income_minor" - "reports"."expense_minor" and "reports"."tx_count" >= 0),
	CONSTRAINT "reports_compare_check" CHECK (("reports"."compare_start" is null) = ("reports"."compare_end" is null) and ("reports"."compare_start" is null or "reports"."compare_start" <= "reports"."compare_end"))
);
--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_period_fk" FOREIGN KEY ("user_id","period_id") REFERENCES "public"."periods"("user_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reports_user_id_range_end_idx" ON "reports" USING btree ("user_id","range_end" DESC NULLS LAST);--> statement-breakpoint

-- FR-LP1–LP5 / D10: only monthly reports are final. App aggregates may refresh, but final snapshots cannot update.
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE reports FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY reports_owner ON reports FOR SELECT TO wf_app, wf_worker
  USING (user_id = app_user_id());
--> statement-breakpoint
CREATE POLICY reports_insert ON reports FOR INSERT TO wf_app, wf_worker
  WITH CHECK (user_id = app_user_id());
--> statement-breakpoint
CREATE POLICY reports_update_provisional ON reports FOR UPDATE TO wf_app
  USING (user_id = app_user_id() AND kind <> 'monthly' AND status = 'provisional')
  WITH CHECK (user_id = app_user_id() AND kind <> 'monthly' AND status = 'provisional');
--> statement-breakpoint
-- FR-ST5/A11: deleting the user's data removes reports, including final snapshots.
CREATE POLICY reports_delete ON reports FOR DELETE TO wf_app
  USING (user_id = app_user_id());
--> statement-breakpoint

-- The app reads the reports; the worker generates them after a period closes and never edits the ledger for it.
GRANT SELECT, INSERT, UPDATE, DELETE ON reports TO wf_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON reports TO wf_worker;
--> statement-breakpoint
