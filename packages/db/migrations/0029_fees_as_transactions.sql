ALTER TABLE "transactions" ADD COLUMN "parent_transaction_id" uuid;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_parent_fk" FOREIGN KEY ("user_id","parent_transaction_id") REFERENCES "public"."transactions"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "transactions_parent_transaction_id_idx" ON "transactions" USING btree ("parent_transaction_id");--> statement-breakpoint
-- One transaction, one action: every fee or tax posting becomes its own expense transaction, linked to the one it
-- belongs to. Balances, categories, dates, and the deleted state carry over; the posting keeps its amount and account.
CREATE TEMP TABLE wf_fee_split AS
SELECT
  p.id AS posting_id,
  gen_random_uuid() AS child_id,
  p.user_id,
  p.account_id,
  p.amount_minor,
  p.currency,
  p.fx_rate_to_base,
  p.amount_base_minor,
  p.category_id,
  p.transaction_id AS parent_id,
  t.occurred_at,
  t.local_date,
  t.description,
  t.source,
  t.confirmed_by_user_at,
  t.deleted_at,
  md5(t.client_id::text || ':fee:' || row_number() OVER (PARTITION BY p.transaction_id ORDER BY p.created_at, p.id)::text)::uuid AS child_client_id
FROM postings p
JOIN transactions t ON t.id = p.transaction_id
WHERE p.role IN ('fee', 'tax');
--> statement-breakpoint
INSERT INTO transactions (id, user_id, type, occurred_at, local_date, description, category_id, source,
                          parent_transaction_id, client_id, confirmed_by_user_at, deleted_at, created_at, updated_at)
SELECT child_id, user_id, 'expense', occurred_at, local_date, description, category_id, source,
       parent_id, child_client_id, confirmed_by_user_at, deleted_at, now(), now()
FROM wf_fee_split;
--> statement-breakpoint
UPDATE postings p
SET transaction_id = f.child_id, role = 'principal', category_id = NULL
FROM wf_fee_split f
WHERE p.id = f.posting_id;
--> statement-breakpoint
DROP TABLE wf_fee_split;
