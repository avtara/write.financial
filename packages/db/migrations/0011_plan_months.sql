-- Goal contribution plans get the months they send their share in (FR-B6 "6 bulan · Nov–Apr"). Existing plans sent
-- every occurrence so far, so they start in their recurrence's first month and run until changed. Plans force
-- Row-Level Security even for their owner (this migration runs as wf_migrate), so the force is lifted while the rows
-- are filled in.
ALTER TABLE "goal_contribution_plans" ADD COLUMN "start_month" date;--> statement-breakpoint
ALTER TABLE "goal_contribution_plans" ADD COLUMN "end_month" date;--> statement-breakpoint
ALTER TABLE goal_contribution_plans NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE recurrences NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
UPDATE goal_contribution_plans p SET start_month = date_trunc('month', r.start_on)::date
  FROM recurrences r WHERE r.id = p.recurrence_id;--> statement-breakpoint
ALTER TABLE recurrences FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE goal_contribution_plans FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "goal_contribution_plans" ALTER COLUMN "start_month" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "goal_contribution_plans" ADD CONSTRAINT "goal_contribution_plans_months_check" CHECK (extract(day from "goal_contribution_plans"."start_month") = 1 and ("goal_contribution_plans"."end_month" is null or (extract(day from "goal_contribution_plans"."end_month") = 1 and "goal_contribution_plans"."end_month" >= "goal_contribution_plans"."start_month")));
