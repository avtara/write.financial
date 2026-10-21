CREATE TYPE "public"."card_payment_bucket" AS ENUM('installments', 'spending', 'credit');--> statement-breakpoint
CREATE TYPE "public"."debt_kind" AS ENUM('card_installment', 'paylater', 'zero_percent', 'mortgage', 'personal_loan');--> statement-breakpoint
CREATE TYPE "public"."debt_status" AS ENUM('active', 'paid_off');--> statement-breakpoint
CREATE TYPE "public"."goal_kind" AS ENUM('savings', 'sinking');--> statement-breakpoint
CREATE TYPE "public"."goal_source_mode" AS ENUM('whole', 'fixed');--> statement-breakpoint
CREATE TYPE "public"."goal_status" AS ENUM('active', 'completed', 'used');--> statement-breakpoint
CREATE TYPE "public"."goal_target_mode" AS ENUM('fixed', 'monthly_expenses');--> statement-breakpoint
CREATE TYPE "public"."installment_status" AS ENUM('scheduled', 'paid');--> statement-breakpoint
CREATE TYPE "public"."interest_method" AS ENUM('flat', 'annuity');--> statement-breakpoint
CREATE TYPE "public"."recalc_mode" AS ENUM('reduce_amount', 'shorten_tenor');--> statement-breakpoint
CREATE TYPE "public"."receivable_source" AS ENUM('split_bill', 'loan');--> statement-breakpoint
CREATE TYPE "public"."receivable_status" AS ENUM('open', 'partial', 'settled', 'written_off');--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'receivable_due';--> statement-breakpoint
CREATE TABLE "card_payment_allocations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"transaction_id" uuid NOT NULL,
	"bucket" "card_payment_bucket" NOT NULL,
	"debt_id" uuid,
	"amount_minor" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "card_payment_allocations_key" UNIQUE NULLS NOT DISTINCT("transaction_id","bucket","debt_id"),
	CONSTRAINT "card_payment_allocations_amount_check" CHECK ("card_payment_allocations"."amount_minor" > 0),
	CONSTRAINT "card_payment_allocations_debt_check" CHECK (("card_payment_allocations"."bucket" = 'installments') = ("card_payment_allocations"."debt_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "debt_installments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"debt_id" uuid NOT NULL,
	"seq" smallint NOT NULL,
	"due_date" date NOT NULL,
	"principal_minor" bigint NOT NULL,
	"interest_minor" bigint DEFAULT 0 NOT NULL,
	"fee_minor" bigint DEFAULT 0 NOT NULL,
	"status" "installment_status" DEFAULT 'scheduled' NOT NULL,
	"paid_at" timestamp with time zone,
	"transaction_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "debt_installments_user_id_id_key" UNIQUE("user_id","id"),
	CONSTRAINT "debt_installments_debt_seq_key" UNIQUE("debt_id","seq"),
	CONSTRAINT "debt_installments_seq_check" CHECK ("debt_installments"."seq" between 1 and 360),
	CONSTRAINT "debt_installments_amounts_check" CHECK ("debt_installments"."principal_minor" >= 0 and "debt_installments"."interest_minor" >= 0 and "debt_installments"."fee_minor" >= 0 and "debt_installments"."principal_minor" + "debt_installments"."interest_minor" + "debt_installments"."fee_minor" > 0),
	CONSTRAINT "debt_installments_paid_check" CHECK (("debt_installments"."status" = 'paid') = ("debt_installments"."paid_at" is not null)),
	CONSTRAINT "debt_installments_transaction_check" CHECK ("debt_installments"."transaction_id" is null or "debt_installments"."status" = 'paid')
);
--> statement-breakpoint
CREATE TABLE "debts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "debt_kind" NOT NULL,
	"name" varchar(60) NOT NULL,
	"provider" varchar(40),
	"card_account_id" uuid,
	"pay_from_account_id" uuid,
	"source_transaction_id" uuid,
	"category_id" uuid,
	"principal_minor" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"interest_method" "interest_method" DEFAULT 'flat' NOT NULL,
	"monthly_rate_bps" integer DEFAULT 0 NOT NULL,
	"admin_fee_minor" bigint DEFAULT 0 NOT NULL,
	"tenor_months" smallint NOT NULL,
	"first_due_date" date NOT NULL,
	"recalc_mode" "recalc_mode",
	"recalculated_at" timestamp with time zone,
	"status" "debt_status" DEFAULT 'active' NOT NULL,
	"paid_off_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "debts_user_id_id_key" UNIQUE("user_id","id"),
	CONSTRAINT "debts_currency_check" CHECK ("debts"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "debts_name_check" CHECK (length(btrim("debts"."name")) > 0),
	CONSTRAINT "debts_principal_check" CHECK ("debts"."principal_minor" > 0),
	CONSTRAINT "debts_rate_check" CHECK ("debts"."monthly_rate_bps" between 0 and 10000),
	CONSTRAINT "debts_admin_fee_check" CHECK ("debts"."admin_fee_minor" >= 0),
	CONSTRAINT "debts_tenor_check" CHECK ("debts"."tenor_months" between 1 and 360),
	CONSTRAINT "debts_accounts_check" CHECK (("debts"."kind" = 'card_installment') = ("debts"."card_account_id" is not null) and ("debts"."kind" = 'card_installment') = ("debts"."pay_from_account_id" is null)),
	CONSTRAINT "debts_source_transaction_check" CHECK ("debts"."source_transaction_id" is null or "debts"."kind" = 'card_installment'),
	CONSTRAINT "debts_recalc_check" CHECK (("debts"."recalc_mode" is null) = ("debts"."recalculated_at" is null)),
	CONSTRAINT "debts_paid_off_check" CHECK (("debts"."status" = 'paid_off') = ("debts"."paid_off_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "goal_contribution_plans" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"goal_id" uuid NOT NULL,
	"recurrence_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "goal_contribution_plans_user_id_id_key" UNIQUE("user_id","id"),
	CONSTRAINT "goal_contribution_plans_recurrence_goal_key" UNIQUE("recurrence_id","goal_id"),
	CONSTRAINT "goal_contribution_plans_amount_check" CHECK ("goal_contribution_plans"."amount_minor" > 0)
);
--> statement-breakpoint
CREATE TABLE "goal_funding_sources" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"goal_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"mode" "goal_source_mode" NOT NULL,
	"amount_minor" bigint,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "goal_funding_sources_user_id_id_key" UNIQUE("user_id","id"),
	CONSTRAINT "goal_funding_sources_goal_account_key" UNIQUE("goal_id","account_id"),
	CONSTRAINT "goal_funding_sources_amount_check" CHECK (("goal_funding_sources"."mode" = 'fixed') = ("goal_funding_sources"."amount_minor" is not null) and ("goal_funding_sources"."amount_minor" is null or "goal_funding_sources"."amount_minor" > 0))
);
--> statement-breakpoint
CREATE TABLE "receivable_payments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"receivable_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"received_on" date NOT NULL,
	"transaction_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "receivable_payments_user_id_id_key" UNIQUE("user_id","id"),
	CONSTRAINT "receivable_payments_amount_check" CHECK ("receivable_payments"."amount_minor" > 0)
);
--> statement-breakpoint
CREATE TABLE "receivables" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"counterparty_enc" "bytea" NOT NULL,
	"description" text,
	"note_enc" "bytea",
	"principal_minor" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"from_account_id" uuid NOT NULL,
	"source" "receivable_source" NOT NULL,
	"source_transaction_id" uuid,
	"transaction_id" uuid,
	"lent_on" date NOT NULL,
	"due_date" date,
	"remind" boolean DEFAULT false NOT NULL,
	"status" "receivable_status" DEFAULT 'open' NOT NULL,
	"settled_at" timestamp with time zone,
	"written_off_at" timestamp with time zone,
	"writeoff_transaction_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "receivables_user_id_id_key" UNIQUE("user_id","id"),
	CONSTRAINT "receivables_currency_check" CHECK ("receivables"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "receivables_principal_check" CHECK ("receivables"."principal_minor" > 0),
	CONSTRAINT "receivables_due_check" CHECK ("receivables"."due_date" is null or "receivables"."due_date" >= "receivables"."lent_on"),
	CONSTRAINT "receivables_remind_check" CHECK (not "receivables"."remind" or "receivables"."due_date" is not null),
	CONSTRAINT "receivables_settled_check" CHECK (("receivables"."status" = 'settled') = ("receivables"."settled_at" is not null)),
	CONSTRAINT "receivables_written_off_check" CHECK (("receivables"."status" = 'written_off') = ("receivables"."written_off_at" is not null) and ("receivables"."writeoff_transaction_id" is null or "receivables"."status" = 'written_off'))
);
--> statement-breakpoint
ALTER TABLE "goals" ADD COLUMN "kind" "goal_kind" DEFAULT 'savings' NOT NULL;--> statement-breakpoint
ALTER TABLE "goals" ADD COLUMN "target_mode" "goal_target_mode" DEFAULT 'fixed' NOT NULL;--> statement-breakpoint
ALTER TABLE "goals" ADD COLUMN "target_months" smallint;--> statement-breakpoint
ALTER TABLE "goals" ADD COLUMN "status" "goal_status" DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "goals" ADD COLUMN "completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "card_payment_allocations" ADD CONSTRAINT "card_payment_allocations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_payment_allocations" ADD CONSTRAINT "card_payment_allocations_transaction_fk" FOREIGN KEY ("user_id","transaction_id") REFERENCES "public"."transactions"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_payment_allocations" ADD CONSTRAINT "card_payment_allocations_debt_fk" FOREIGN KEY ("user_id","debt_id") REFERENCES "public"."debts"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "debt_installments" ADD CONSTRAINT "debt_installments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "debt_installments" ADD CONSTRAINT "debt_installments_debt_fk" FOREIGN KEY ("user_id","debt_id") REFERENCES "public"."debts"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "debt_installments" ADD CONSTRAINT "debt_installments_transaction_fk" FOREIGN KEY ("user_id","transaction_id") REFERENCES "public"."transactions"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "debts" ADD CONSTRAINT "debts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "debts" ADD CONSTRAINT "debts_card_account_fk" FOREIGN KEY ("user_id","card_account_id") REFERENCES "public"."accounts"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "debts" ADD CONSTRAINT "debts_pay_from_account_fk" FOREIGN KEY ("user_id","pay_from_account_id") REFERENCES "public"."accounts"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "debts" ADD CONSTRAINT "debts_source_transaction_fk" FOREIGN KEY ("user_id","source_transaction_id") REFERENCES "public"."transactions"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "debts" ADD CONSTRAINT "debts_category_fk" FOREIGN KEY ("user_id","category_id") REFERENCES "public"."categories"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_contribution_plans" ADD CONSTRAINT "goal_contribution_plans_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_contribution_plans" ADD CONSTRAINT "goal_contribution_plans_goal_fk" FOREIGN KEY ("user_id","goal_id") REFERENCES "public"."goals"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_contribution_plans" ADD CONSTRAINT "goal_contribution_plans_recurrence_fk" FOREIGN KEY ("user_id","recurrence_id") REFERENCES "public"."recurrences"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_funding_sources" ADD CONSTRAINT "goal_funding_sources_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_funding_sources" ADD CONSTRAINT "goal_funding_sources_goal_fk" FOREIGN KEY ("user_id","goal_id") REFERENCES "public"."goals"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_funding_sources" ADD CONSTRAINT "goal_funding_sources_account_fk" FOREIGN KEY ("user_id","account_id") REFERENCES "public"."accounts"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receivable_payments" ADD CONSTRAINT "receivable_payments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receivable_payments" ADD CONSTRAINT "receivable_payments_receivable_fk" FOREIGN KEY ("user_id","receivable_id") REFERENCES "public"."receivables"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receivable_payments" ADD CONSTRAINT "receivable_payments_account_fk" FOREIGN KEY ("user_id","account_id") REFERENCES "public"."accounts"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receivable_payments" ADD CONSTRAINT "receivable_payments_transaction_fk" FOREIGN KEY ("user_id","transaction_id") REFERENCES "public"."transactions"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receivables" ADD CONSTRAINT "receivables_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receivables" ADD CONSTRAINT "receivables_from_account_fk" FOREIGN KEY ("user_id","from_account_id") REFERENCES "public"."accounts"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receivables" ADD CONSTRAINT "receivables_source_transaction_fk" FOREIGN KEY ("user_id","source_transaction_id") REFERENCES "public"."transactions"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receivables" ADD CONSTRAINT "receivables_transaction_fk" FOREIGN KEY ("user_id","transaction_id") REFERENCES "public"."transactions"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receivables" ADD CONSTRAINT "receivables_writeoff_transaction_fk" FOREIGN KEY ("user_id","writeoff_transaction_id") REFERENCES "public"."transactions"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "card_payment_allocations_debt_idx" ON "card_payment_allocations" USING btree ("user_id","debt_id");--> statement-breakpoint
CREATE INDEX "debt_installments_user_id_due_date_idx" ON "debt_installments" USING btree ("user_id","due_date");--> statement-breakpoint
CREATE INDEX "debts_user_id_status_idx" ON "debts" USING btree ("user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "debts_source_transaction_key" ON "debts" USING btree ("user_id","source_transaction_id") WHERE "debts"."source_transaction_id" is not null;--> statement-breakpoint
CREATE INDEX "goal_contribution_plans_goal_idx" ON "goal_contribution_plans" USING btree ("user_id","goal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "goal_funding_sources_whole_key" ON "goal_funding_sources" USING btree ("user_id","account_id") WHERE "goal_funding_sources"."mode" = 'whole';--> statement-breakpoint
CREATE INDEX "goal_funding_sources_account_idx" ON "goal_funding_sources" USING btree ("user_id","account_id");--> statement-breakpoint
CREATE INDEX "receivable_payments_receivable_idx" ON "receivable_payments" USING btree ("user_id","receivable_id");--> statement-breakpoint
CREATE INDEX "receivables_user_id_status_idx" ON "receivables" USING btree ("user_id","status");--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_paid_from_goal_fk" FOREIGN KEY ("user_id","paid_from_goal_id") REFERENCES "public"."goals"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_receivable_fk" FOREIGN KEY ("user_id","receivable_id") REFERENCES "public"."receivables"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "transactions_receivable_id_idx" ON "transactions" USING btree ("user_id","receivable_id");--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_target_months_check" CHECK (("goals"."target_mode" = 'monthly_expenses') = ("goals"."target_months" is not null) and ("goals"."target_months" is null or "goals"."target_months" between 1 and 24));--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_completed_check" CHECK (("goals"."status" = 'active') = ("goals"."completed_at" is null));--> statement-breakpoint

-- Recurring goal contributions were a jsonb list in the recurrence template (M3); they become plan rows. Recurrences
-- force Row-Level Security even for their owner (this migration runs as wf_migrate), so the force is lifted while
-- the rows move; the new table is not protected yet.
ALTER TABLE recurrences NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
INSERT INTO goal_contribution_plans (user_id, goal_id, recurrence_id, amount_minor)
  SELECT r.user_id, (part->>'goalId')::uuid, r.id, (part->>'amountMinor')::bigint
  FROM recurrences r, jsonb_array_elements(coalesce(r.template->'allocations', '[]'::jsonb)) AS part;
--> statement-breakpoint
UPDATE recurrences SET template = template - 'allocations' WHERE template ? 'allocations';
--> statement-breakpoint
ALTER TABLE recurrences FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Row-Level Security on the goal, debt, card payment, and receivable tables (plan §4.0, §4.4).
ALTER TABLE goal_funding_sources ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE goal_funding_sources FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE goal_contribution_plans ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE goal_contribution_plans FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE debts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE debts FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE debt_installments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE debt_installments FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE card_payment_allocations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE card_payment_allocations FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE receivables ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE receivables FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE receivable_payments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE receivable_payments FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY goal_funding_sources_owner ON goal_funding_sources FOR ALL TO wf_app, wf_worker
  USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());
--> statement-breakpoint
CREATE POLICY goal_contribution_plans_owner ON goal_contribution_plans FOR ALL TO wf_app, wf_worker
  USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());
--> statement-breakpoint
CREATE POLICY debts_owner ON debts FOR ALL TO wf_app, wf_worker
  USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());
--> statement-breakpoint
CREATE POLICY debt_installments_owner ON debt_installments FOR ALL TO wf_app, wf_worker
  USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());
--> statement-breakpoint
CREATE POLICY card_payment_allocations_owner ON card_payment_allocations FOR ALL TO wf_app, wf_worker
  USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());
--> statement-breakpoint
CREATE POLICY receivables_owner ON receivables FOR ALL TO wf_app, wf_worker
  USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());
--> statement-breakpoint
CREATE POLICY receivable_payments_owner ON receivable_payments FOR ALL TO wf_app, wf_worker
  USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());
--> statement-breakpoint
-- The app manages all of them. D14: the worker only reads them (installment occurrences, receivable and installment
-- reminders); a payment, deposit, or allocation is always a user action.
GRANT SELECT, INSERT, UPDATE, DELETE ON goal_funding_sources, goal_contribution_plans, debts, debt_installments, card_payment_allocations, receivables, receivable_payments TO wf_app;
--> statement-breakpoint
GRANT SELECT ON goal_funding_sources, goal_contribution_plans, debts, debt_installments, card_payment_allocations, receivables, receivable_payments TO wf_worker;
--> statement-breakpoint

-- FR-U7: Σ payments ≤ principal, whatever writes them. The receivable row is locked first, so two concurrent payments
-- cannot both pass. Runs as the invoker: under RLS it only sees the user's own rows, which are all there is to see.
CREATE FUNCTION receivable_payments_within_principal() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public
AS $$
DECLARE
  v_principal bigint;
  v_paid bigint;
BEGIN
  SELECT principal_minor INTO v_principal FROM receivables WHERE id = NEW.receivable_id FOR UPDATE;
  SELECT coalesce(sum(amount_minor), 0) INTO v_paid
    FROM receivable_payments WHERE receivable_id = NEW.receivable_id AND id <> NEW.id;
  IF v_paid + NEW.amount_minor > v_principal THEN
    RAISE EXCEPTION 'receivable payments exceed the principal' USING ERRCODE = 'check_violation',
      CONSTRAINT = 'receivable_payments_within_principal';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER receivable_payments_within_principal BEFORE INSERT OR UPDATE OF amount_minor, receivable_id
  ON receivable_payments FOR EACH ROW EXECUTE FUNCTION receivable_payments_within_principal();
--> statement-breakpoint
CREATE FUNCTION receivables_principal_covers_payments() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public
AS $$
BEGIN
  IF (SELECT coalesce(sum(amount_minor), 0) FROM receivable_payments WHERE receivable_id = NEW.id) > NEW.principal_minor THEN
    RAISE EXCEPTION 'receivable payments exceed the principal' USING ERRCODE = 'check_violation',
      CONSTRAINT = 'receivable_payments_within_principal';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER receivables_principal_covers_payments BEFORE UPDATE OF principal_minor
  ON receivables FOR EACH ROW EXECUTE FUNCTION receivables_principal_covers_payments();
