CREATE TYPE "public"."subscription_cancel_mode" AS ENUM('after_next_bill', 'now');--> statement-breakpoint
CREATE TYPE "public"."detected_recurring_status" AS ENUM('new', 'added', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."notification_category" AS ENUM('budget_bills', 'system');--> statement-breakpoint
CREATE TYPE "public"."notification_channel" AS ENUM('email');--> statement-breakpoint
CREATE TYPE "public"."notification_type" AS ENUM('bill_reminder', 'trial_ending', 'pause_ending', 'review_due', 'bill_overdue', 'budget_threshold', 'low_balance', 'account_unchecked', 'insufficient_balance', 'period_closed', 'subscriptions_detected', 'system');--> statement-breakpoint
CREATE TYPE "public"."occurrence_source" AS ENUM('recurrence', 'subscription', 'goal_plan', 'installment', 'cc_statement', 'receivable');--> statement-breakpoint
CREATE TYPE "public"."occurrence_status" AS ENUM('scheduled', 'due_review', 'confirmed', 'skipped', 'unconfirmed');--> statement-breakpoint
CREATE TYPE "public"."recurrence_end_type" AS ENUM('never', 'after');--> statement-breakpoint
CREATE TYPE "public"."recurrence_freq" AS ENUM('weekly', 'monthly', 'yearly');--> statement-breakpoint
CREATE TYPE "public"."recurrence_status" AS ENUM('active', 'stopped');--> statement-breakpoint
CREATE TYPE "public"."review_reason" AS ENUM('ai_suggestion', 'category_deleted', 'due_occurrence', 'import_row', 'period_close_proposal');--> statement-breakpoint
CREATE TYPE "public"."review_source" AS ENUM('gmail', 'assistant', 'receipt', 'schedule', 'period_close', 'system');--> statement-breakpoint
CREATE TYPE "public"."review_status" AS ENUM('pending', 'confirmed', 'ignored');--> statement-breakpoint
CREATE TYPE "public"."subscription_cycle" AS ENUM('weekly', 'monthly', 'yearly');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('active', 'paused', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."subscription_usage_rating" AS ENUM('often', 'sometimes', 'rarely');--> statement-breakpoint
CREATE TABLE "detected_recurring" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"merchant_key" text NOT NULL,
	"merchant" text NOT NULL,
	"day_of_month" smallint NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"occurrences" smallint NOT NULL,
	"last_seen_on" date NOT NULL,
	"account_id" uuid,
	"category_id" uuid,
	"status" "detected_recurring_status" DEFAULT 'new' NOT NULL,
	"subscription_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "detected_recurring_user_id_id_key" UNIQUE("user_id","id"),
	CONSTRAINT "detected_recurring_merchant_key" UNIQUE("user_id","merchant_key"),
	CONSTRAINT "detected_recurring_currency_check" CHECK ("detected_recurring"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "detected_recurring_day_check" CHECK ("detected_recurring"."day_of_month" between 1 and 31),
	CONSTRAINT "detected_recurring_amount_check" CHECK ("detected_recurring"."amount_minor" > 0)
);
--> statement-breakpoint
CREATE TABLE "notification_outbox" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"notification_id" uuid NOT NULL,
	"channel" "notification_channel" DEFAULT 'email' NOT NULL,
	"payload" jsonb NOT NULL,
	"send_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_outbox_user_id_id_key" UNIQUE("user_id","id"),
	CONSTRAINT "notification_outbox_notification_key" UNIQUE("notification_id","channel")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" "notification_type" NOT NULL,
	"category" "notification_category" NOT NULL,
	"title_key" text NOT NULL,
	"body_key" text NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"action" jsonb,
	"ref" text NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_user_id_id_key" UNIQUE("user_id","id"),
	CONSTRAINT "notifications_ref_key" UNIQUE("user_id","ref"),
	CONSTRAINT "notifications_params_check" CHECK (jsonb_typeof("notifications"."params") = 'object')
);
--> statement-breakpoint
CREATE TABLE "recurrences" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"template" jsonb NOT NULL,
	"freq" "recurrence_freq" NOT NULL,
	"interval" smallint DEFAULT 1 NOT NULL,
	"start_on" date NOT NULL,
	"weekday" smallint,
	"month_day" smallint,
	"end_type" "recurrence_end_type" DEFAULT 'never' NOT NULL,
	"end_count" smallint,
	"remind_offset_days" smallint,
	"status" "recurrence_status" DEFAULT 'active' NOT NULL,
	"stopped_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recurrences_user_id_id_key" UNIQUE("user_id","id"),
	CONSTRAINT "recurrences_interval_check" CHECK ("recurrences"."interval" between 1 and 99),
	CONSTRAINT "recurrences_weekday_check" CHECK (("recurrences"."freq" = 'weekly') = ("recurrences"."weekday" is not null)),
	CONSTRAINT "recurrences_weekday_range_check" CHECK ("recurrences"."weekday" is null or "recurrences"."weekday" between 1 and 7),
	CONSTRAINT "recurrences_month_day_check" CHECK (("recurrences"."freq" = 'monthly') = ("recurrences"."month_day" is not null)),
	CONSTRAINT "recurrences_month_day_range_check" CHECK ("recurrences"."month_day" is null or "recurrences"."month_day" between 1 and 31),
	CONSTRAINT "recurrences_end_check" CHECK (("recurrences"."end_type" = 'after') = ("recurrences"."end_count" is not null) and ("recurrences"."end_count" is null or "recurrences"."end_count" between 1 and 999)),
	CONSTRAINT "recurrences_remind_check" CHECK ("recurrences"."remind_offset_days" is null or "recurrences"."remind_offset_days" between 0 and 30),
	CONSTRAINT "recurrences_stopped_check" CHECK (("recurrences"."status" = 'stopped') = ("recurrences"."stopped_at" is not null)),
	CONSTRAINT "recurrences_template_check" CHECK (jsonb_typeof("recurrences"."template") = 'object')
);
--> statement-breakpoint
CREATE TABLE "review_items" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"reason" "review_reason" NOT NULL,
	"source" "review_source" NOT NULL,
	"dedupe_key" text NOT NULL,
	"occurrence_id" uuid,
	"subject_transaction_id" uuid,
	"period_id" uuid,
	"due_date" date,
	"payload_enc" "bytea" NOT NULL,
	"ai_confidence" smallint,
	"status" "review_status" DEFAULT 'pending' NOT NULL,
	"resolved_at" timestamp with time zone,
	"resulting_transaction_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_items_user_id_id_key" UNIQUE("user_id","id"),
	CONSTRAINT "review_items_dedupe_key" UNIQUE("user_id","dedupe_key"),
	CONSTRAINT "review_items_confidence_check" CHECK ("review_items"."ai_confidence" is null or "review_items"."ai_confidence" between 0 and 100),
	CONSTRAINT "review_items_resolved_check" CHECK (("review_items"."status" = 'pending') = ("review_items"."resolved_at" is null))
);
--> statement-breakpoint
CREATE TABLE "scheduled_occurrences" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"source_type" "occurrence_source" NOT NULL,
	"source_id" uuid NOT NULL,
	"due_date" date NOT NULL,
	"expected_minor" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"status" "occurrence_status" DEFAULT 'scheduled' NOT NULL,
	"transaction_id" uuid,
	"remind_at" timestamp with time zone,
	"reminded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scheduled_occurrences_user_id_id_key" UNIQUE("user_id","id"),
	CONSTRAINT "scheduled_occurrences_source_key" UNIQUE("source_type","source_id","due_date"),
	CONSTRAINT "scheduled_occurrences_currency_check" CHECK ("scheduled_occurrences"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "scheduled_occurrences_expected_check" CHECK ("scheduled_occurrences"."expected_minor" >= 0),
	CONSTRAINT "scheduled_occurrences_confirmed_check" CHECK ("scheduled_occurrences"."status" <> 'confirmed' or "scheduled_occurrences"."transaction_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" varchar(40) NOT NULL,
	"plan" varchar(40),
	"icon" text,
	"logo_key" text,
	"description" text,
	"price_minor" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"cycle" "subscription_cycle" NOT NULL,
	"next_billing_date" date NOT NULL,
	"pay_from_account_id" uuid NOT NULL,
	"category_id" uuid,
	"remind_days_before" smallint DEFAULT 3,
	"started_on" date NOT NULL,
	"trial_ends_on" date,
	"status" "subscription_status" DEFAULT 'active' NOT NULL,
	"paused_on" date,
	"paused_until" date,
	"pause_remind_days" smallint,
	"cancel_mode" "subscription_cancel_mode",
	"ends_on" date,
	"cancelled_at" timestamp with time zone,
	"usage_rating" "subscription_usage_rating",
	"rated_at" timestamp with time zone,
	"next_review_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscriptions_user_id_id_key" UNIQUE("user_id","id"),
	CONSTRAINT "subscriptions_currency_check" CHECK ("subscriptions"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "subscriptions_price_check" CHECK ("subscriptions"."price_minor" > 0),
	CONSTRAINT "subscriptions_name_check" CHECK (length(btrim("subscriptions"."name")) > 0),
	CONSTRAINT "subscriptions_remind_check" CHECK ("subscriptions"."remind_days_before" is null or "subscriptions"."remind_days_before" between 0 and 30),
	CONSTRAINT "subscriptions_paused_check" CHECK (("subscriptions"."status" = 'paused') = ("subscriptions"."paused_until" is not null and "subscriptions"."paused_on" is not null)),
	CONSTRAINT "subscriptions_cancelled_check" CHECK (("subscriptions"."status" = 'cancelled') = ("subscriptions"."ends_on" is not null and "subscriptions"."cancel_mode" is not null and "subscriptions"."cancelled_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "detected_recurring" ADD CONSTRAINT "detected_recurring_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "detected_recurring" ADD CONSTRAINT "detected_recurring_account_fk" FOREIGN KEY ("user_id","account_id") REFERENCES "public"."accounts"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "detected_recurring" ADD CONSTRAINT "detected_recurring_category_fk" FOREIGN KEY ("user_id","category_id") REFERENCES "public"."categories"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "detected_recurring" ADD CONSTRAINT "detected_recurring_subscription_fk" FOREIGN KEY ("user_id","subscription_id") REFERENCES "public"."subscriptions"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_outbox" ADD CONSTRAINT "notification_outbox_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_outbox" ADD CONSTRAINT "notification_outbox_notification_fk" FOREIGN KEY ("user_id","notification_id") REFERENCES "public"."notifications"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurrences" ADD CONSTRAINT "recurrences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_items" ADD CONSTRAINT "review_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_items" ADD CONSTRAINT "review_items_occurrence_fk" FOREIGN KEY ("user_id","occurrence_id") REFERENCES "public"."scheduled_occurrences"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_items" ADD CONSTRAINT "review_items_subject_transaction_fk" FOREIGN KEY ("user_id","subject_transaction_id") REFERENCES "public"."transactions"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_items" ADD CONSTRAINT "review_items_period_fk" FOREIGN KEY ("user_id","period_id") REFERENCES "public"."periods"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_items" ADD CONSTRAINT "review_items_resulting_transaction_fk" FOREIGN KEY ("user_id","resulting_transaction_id") REFERENCES "public"."transactions"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_occurrences" ADD CONSTRAINT "scheduled_occurrences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_occurrences" ADD CONSTRAINT "scheduled_occurrences_transaction_fk" FOREIGN KEY ("user_id","transaction_id") REFERENCES "public"."transactions"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_account_fk" FOREIGN KEY ("user_id","pay_from_account_id") REFERENCES "public"."accounts"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_category_fk" FOREIGN KEY ("user_id","category_id") REFERENCES "public"."categories"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notification_outbox_pending_idx" ON "notification_outbox" USING btree ("send_at") WHERE "notification_outbox"."sent_at" is null;--> statement-breakpoint
CREATE INDEX "notifications_user_id_created_at_idx" ON "notifications" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "recurrences_user_id_status_idx" ON "recurrences" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "review_items_user_id_status_idx" ON "review_items" USING btree ("user_id","status","reason");--> statement-breakpoint
CREATE INDEX "scheduled_occurrences_user_id_due_date_idx" ON "scheduled_occurrences" USING btree ("user_id","due_date");--> statement-breakpoint
CREATE INDEX "scheduled_occurrences_remind_at_idx" ON "scheduled_occurrences" USING btree ("remind_at") WHERE "scheduled_occurrences"."reminded_at" is null and "scheduled_occurrences"."remind_at" is not null;--> statement-breakpoint
CREATE INDEX "subscriptions_user_id_status_idx" ON "subscriptions" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "subscriptions_name_trgm_idx" ON "subscriptions" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
ALTER TABLE "budget_period_overrides" ADD CONSTRAINT "budget_period_overrides_review_item_fk" FOREIGN KEY ("user_id","review_item_id") REFERENCES "public"."review_items"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- Row-Level Security on the schedule, review, subscription, and notification tables (plan §4.0, §4.3).
ALTER TABLE recurrences ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE recurrences FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE subscriptions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE scheduled_occurrences ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE scheduled_occurrences FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE review_items ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE review_items FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE detected_recurring ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE detected_recurring FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE notifications FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE notification_outbox ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE notification_outbox FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY recurrences_owner ON recurrences FOR ALL TO wf_app, wf_worker
  USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());
--> statement-breakpoint
CREATE POLICY subscriptions_owner ON subscriptions FOR ALL TO wf_app, wf_worker
  USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());
--> statement-breakpoint
CREATE POLICY scheduled_occurrences_owner ON scheduled_occurrences FOR ALL TO wf_app, wf_worker
  USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());
--> statement-breakpoint
CREATE POLICY review_items_owner ON review_items FOR ALL TO wf_app, wf_worker
  USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());
--> statement-breakpoint
CREATE POLICY detected_recurring_owner ON detected_recurring FOR ALL TO wf_app, wf_worker
  USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());
--> statement-breakpoint
CREATE POLICY notifications_owner ON notifications FOR ALL TO wf_app, wf_worker
  USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());
--> statement-breakpoint
CREATE POLICY notification_outbox_owner ON notification_outbox FOR ALL TO wf_app, wf_worker
  USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());
--> statement-breakpoint
-- The app manages schedules and subscriptions, resolves review items (and creates the category_deleted ones), reads
-- and marks notifications, and acts on detected subscription candidates. Outbox rows are the worker's alone.
GRANT SELECT, INSERT, UPDATE, DELETE ON recurrences, subscriptions, scheduled_occurrences, review_items, detected_recurring TO wf_app;
--> statement-breakpoint
GRANT SELECT, UPDATE (read_at), DELETE ON notifications TO wf_app;
--> statement-breakpoint
-- D14: the worker reads schedules and subscriptions, materializes and advances occurrences, creates review items,
-- notifications, outbox rows, and subscription candidates, and records delivery. It cannot resolve a review item
-- (no UPDATE on review_items) and has no write on transactions, postings, budgets, or goals (0004, 0005).
GRANT SELECT ON recurrences, subscriptions TO wf_worker;
--> statement-breakpoint
GRANT SELECT, INSERT ON scheduled_occurrences, review_items, notifications TO wf_worker;
--> statement-breakpoint
GRANT UPDATE (status, remind_at, reminded_at, expected_minor, updated_at) ON scheduled_occurrences TO wf_worker;
--> statement-breakpoint
GRANT SELECT, INSERT ON notification_outbox TO wf_worker;
--> statement-breakpoint
GRANT UPDATE (sent_at, attempts, last_error) ON notification_outbox TO wf_worker;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON detected_recurring TO wf_worker;
--> statement-breakpoint

-- The dispatch scanner (plan §6) runs once for the whole instance, so it cannot set app.user_id. These SECURITY
-- DEFINER functions return only ids and time zones (no financial data); every job then works inside one user's RLS
-- scope. They run as their owner wf_migrate, for which FORCE ROW LEVEL SECURITY applies too; the policies below let
-- exactly these queries through.
CREATE POLICY scheduled_occurrences_dispatch ON scheduled_occurrences FOR SELECT TO wf_migrate USING (true);
--> statement-breakpoint
CREATE POLICY notification_outbox_dispatch ON notification_outbox FOR SELECT TO wf_migrate USING (true);
--> statement-breakpoint
CREATE POLICY notifications_retention_select ON notifications FOR SELECT TO wf_migrate USING (true);
--> statement-breakpoint
CREATE POLICY notifications_retention_delete ON notifications FOR DELETE TO wf_migrate USING (true);
--> statement-breakpoint
-- Every user the scheduled jobs serve, with the time zone their 00.05/07.00/09.00 schedules follow.
CREATE FUNCTION wf_worker_users() RETURNS TABLE (user_id uuid, time_zone text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
  SELECT id, timezone FROM public.users WHERE deletion_requested_at IS NULL ORDER BY id
$$;
--> statement-breakpoint
-- Occurrences whose reminder is due and not yet sent (`reminders` jobs, `rem.{occurrenceId}`).
CREATE FUNCTION wf_due_reminders(p_now timestamptz, p_limit integer) RETURNS TABLE (user_id uuid, occurrence_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
  SELECT user_id, id FROM public.scheduled_occurrences
  WHERE remind_at <= p_now AND reminded_at IS NULL AND status IN ('scheduled', 'due_review')
  ORDER BY remind_at, id
  LIMIT p_limit
$$;
--> statement-breakpoint
-- Outbox rows still to send (`notify` jobs, `ntf.{outboxId}`); a row stops being retried after 5 attempts.
CREATE FUNCTION wf_pending_outbox(p_now timestamptz, p_limit integer) RETURNS TABLE (user_id uuid, outbox_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
  SELECT user_id, id FROM public.notification_outbox
  WHERE sent_at IS NULL AND send_at <= p_now AND attempts < 5
  ORDER BY send_at, id
  LIMIT p_limit
$$;
--> statement-breakpoint
-- FR-S5 90-day retention, as of p_now capped at the server's now() (a caller cannot purge younger rows by passing a
-- future time); their outbox rows go with them (ON DELETE CASCADE). Returns the number of deleted notifications.
CREATE FUNCTION wf_maintenance_purge_notifications(p_now timestamptz) RETURNS bigint
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  deleted bigint;
BEGIN
  DELETE FROM public.notifications WHERE created_at < LEAST(p_now, pg_catalog.now()) - interval '90 days';
  GET DIAGNOSTICS deleted = ROW_COUNT;
  RETURN deleted;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION wf_worker_users() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION wf_due_reminders(timestamptz, integer) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION wf_pending_outbox(timestamptz, integer) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION wf_maintenance_purge_notifications(timestamptz) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION wf_worker_users() TO wf_worker;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION wf_due_reminders(timestamptz, integer) TO wf_worker;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION wf_pending_outbox(timestamptz, integer) TO wf_worker;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION wf_maintenance_purge_notifications(timestamptz) TO wf_worker;
