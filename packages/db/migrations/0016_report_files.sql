CREATE TABLE "report_files" (
	"id" uuid DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"report_id" uuid NOT NULL,
	"format" text NOT NULL,
	"options" jsonb NOT NULL,
	"file_key" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "report_files_pkey" PRIMARY KEY("user_id","id"),
	CONSTRAINT "report_files_format_check" CHECK ("report_files"."format" in ('pdf', 'xlsx', 'csv')),
	CONSTRAINT "report_files_size_check" CHECK ("report_files"."size_bytes" >= 0)
);
--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "report_auto_send" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "report_files" ADD CONSTRAINT "report_files_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_files" ADD CONSTRAINT "report_files_report_fk" FOREIGN KEY ("user_id","report_id") REFERENCES "public"."reports"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "report_files_user_id_created_at_idx" ON "report_files" USING btree ("user_id","created_at" DESC NULLS LAST);
-- FR-LP4: the saved list and the worker both act on the owner's own exports; masking is a rendering option, not RLS.
ALTER TABLE report_files ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE report_files FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY report_files_owner ON report_files FOR ALL TO wf_app, wf_worker
  USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON report_files TO wf_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON report_files TO wf_worker;
--> statement-breakpoint
