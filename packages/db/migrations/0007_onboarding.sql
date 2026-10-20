ALTER TABLE "goals" ADD COLUMN "account_id" uuid;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "extra_currencies" char(3)[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "onboarding_step" smallint DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_account_fk" FOREIGN KEY ("user_id","account_id") REFERENCES "public"."accounts"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_extra_currencies_check" CHECK (cardinality("user_preferences"."extra_currencies") <= 20 and array_to_string("user_preferences"."extra_currencies", ',') ~ '^([A-Z]{3}(,[A-Z]{3})*)?$');--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_onboarding_step_check" CHECK ("users"."onboarding_step" between 1 and 5);--> statement-breakpoint

-- FR-A4: the app moves the user through the onboarding steps (completed_at was already granted in 0001).
GRANT UPDATE (onboarding_step) ON users TO wf_app;
--> statement-breakpoint

-- FR-ST1: the fx job also fetches rates for the "Mata uang tambahan" a user picked before any account uses them. Same
-- pattern as 0004: the SECURITY DEFINER function returns only currency codes; this read policy lets its query through.
CREATE POLICY user_preferences_currencies_in_use ON user_preferences FOR SELECT TO wf_migrate USING (true);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION fx_currencies_in_use() RETURNS SETOF char(3)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
  SELECT currency FROM public.accounts
  UNION SELECT base_currency FROM public.users
  UNION SELECT unnest(extra_currencies) FROM public.user_preferences
  UNION SELECT base FROM public.fx_rates WHERE user_id IS NOT NULL
  UNION SELECT quote FROM public.fx_rates WHERE user_id IS NOT NULL
  ORDER BY 1
$$;
