CREATE TABLE "auto_rule_corrections" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"transaction_id" uuid NOT NULL,
	"pattern" text NOT NULL,
	"label" text NOT NULL,
	"from_category_id" uuid NOT NULL,
	"to_category_id" uuid NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auto_rule_corrections_transaction_key" UNIQUE("user_id","transaction_id","from_category_id","to_category_id"),
	CONSTRAINT "auto_rule_corrections_pattern_check" CHECK (length(btrim("auto_rule_corrections"."pattern")) between 3 and 120),
	CONSTRAINT "auto_rule_corrections_label_check" CHECK (length(btrim("auto_rule_corrections"."label")) between 1 and 60),
	CONSTRAINT "auto_rule_corrections_categories_check" CHECK ("auto_rule_corrections"."from_category_id" <> "auto_rule_corrections"."to_category_id")
);
--> statement-breakpoint
CREATE TABLE "auto_rule_suggestion_dismissals" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"key" text NOT NULL,
	"dismissed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auto_rule_suggestion_dismissals_key" UNIQUE("user_id","key"),
	CONSTRAINT "auto_rule_suggestion_dismissals_key_check" CHECK (length("auto_rule_suggestion_dismissals"."key") between 1 and 200)
);
--> statement-breakpoint
CREATE TABLE "auto_rules" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"position" integer NOT NULL,
	"conditions" jsonb NOT NULL,
	"actions" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auto_rules_user_id_id_key" UNIQUE("user_id","id"),
	CONSTRAINT "auto_rules_name_check" CHECK (length(btrim("auto_rules"."name")) between 1 and 60),
	CONSTRAINT "auto_rules_conditions_check" CHECK (jsonb_typeof("auto_rules"."conditions") = 'array' and jsonb_array_length("auto_rules"."conditions") between 1 and 8),
	CONSTRAINT "auto_rules_actions_check" CHECK (jsonb_typeof("auto_rules"."actions") = 'array' and jsonb_array_length("auto_rules"."actions") between 1 and 8),
	CONSTRAINT "auto_rules_position_check" CHECK ("auto_rules"."position" >= 0)
);
--> statement-breakpoint
ALTER TABLE "auto_rule_corrections" ADD CONSTRAINT "auto_rule_corrections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auto_rule_corrections" ADD CONSTRAINT "auto_rule_corrections_transaction_fk" FOREIGN KEY ("user_id","transaction_id") REFERENCES "public"."transactions"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auto_rule_corrections" ADD CONSTRAINT "auto_rule_corrections_from_category_fk" FOREIGN KEY ("user_id","from_category_id") REFERENCES "public"."categories"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auto_rule_corrections" ADD CONSTRAINT "auto_rule_corrections_to_category_fk" FOREIGN KEY ("user_id","to_category_id") REFERENCES "public"."categories"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auto_rule_suggestion_dismissals" ADD CONSTRAINT "auto_rule_suggestion_dismissals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auto_rules" ADD CONSTRAINT "auto_rules_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auto_rule_corrections_user_id_pattern_idx" ON "auto_rule_corrections" USING btree ("user_id","pattern","to_category_id");--> statement-breakpoint
CREATE INDEX "auto_rules_user_id_position_idx" ON "auto_rules" USING btree ("user_id","position","id");
--> statement-breakpoint

-- D14: rules are user-owned suggestions; nothing here writes a transaction, posting, budget, or goal. FORCE RLS keeps
-- even the table owner inside the policies, and the app role only ever sees its own rows.
ALTER TABLE auto_rules ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE auto_rules FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY auto_rules_owner ON auto_rules FOR ALL TO wf_app, wf_worker
  USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());
--> statement-breakpoint
ALTER TABLE auto_rule_corrections ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE auto_rule_corrections FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY auto_rule_corrections_owner ON auto_rule_corrections FOR ALL TO wf_app, wf_worker
  USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());
--> statement-breakpoint
ALTER TABLE auto_rule_suggestion_dismissals ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE auto_rule_suggestion_dismissals FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY auto_rule_suggestion_dismissals_owner ON auto_rule_suggestion_dismissals FOR ALL TO wf_app, wf_worker
  USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON auto_rules, auto_rule_corrections, auto_rule_suggestion_dismissals TO wf_app;
--> statement-breakpoint
-- The worker may evaluate rules for Gmail/OCR and build proposal-only backfill jobs, but it can never change a rule,
-- its evidence, its dismissals, or a transaction.
GRANT SELECT ON auto_rules, auto_rule_corrections, auto_rule_suggestion_dismissals TO wf_worker;