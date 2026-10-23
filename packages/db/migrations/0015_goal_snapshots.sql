CREATE TABLE "goal_snapshots" (
	"user_id" uuid NOT NULL,
	"snapshot_date" date NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"goals" jsonb NOT NULL,
	CONSTRAINT "goal_snapshots_pkey" PRIMARY KEY("user_id","snapshot_date"),
	CONSTRAINT "goal_snapshots_goals_check" CHECK (jsonb_typeof("goal_snapshots"."goals") = 'array')
);
--> statement-breakpoint
ALTER TABLE "goal_snapshots" ADD CONSTRAINT "goal_snapshots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint

-- D14: only dated observations change; no goal, funding source, transaction, posting, or budget writes.
ALTER TABLE goal_snapshots ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE goal_snapshots FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY goal_snapshots_owner ON goal_snapshots FOR ALL TO wf_app, wf_worker
  USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON goal_snapshots TO wf_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON goal_snapshots TO wf_worker;
--> statement-breakpoint