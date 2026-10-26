CREATE TABLE "receipt_uploads" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"revision" uuid NOT NULL,
	"provider" varchar(16) NOT NULL,
	"status" varchar(16) DEFAULT 'queued' NOT NULL,
	"payload_enc" "bytea" NOT NULL,
	"review_item_id" uuid,
	"transaction_id" uuid,
	"error_code" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "receipt_uploads_user_id_id_key" UNIQUE("user_id","id"),
	CONSTRAINT "receipt_uploads_status_check" CHECK ("receipt_uploads"."status" in ('queued','reading','ready','failed','cancelled','attached'))
);
--> statement-breakpoint
ALTER TABLE "receipt_uploads" ADD CONSTRAINT "receipt_uploads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_uploads" ADD CONSTRAINT "receipt_uploads_review_fk" FOREIGN KEY ("user_id","review_item_id") REFERENCES "public"."review_items"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_uploads" ADD CONSTRAINT "receipt_uploads_transaction_fk" FOREIGN KEY ("user_id","transaction_id") REFERENCES "public"."transactions"("user_id","id") ON DELETE cascade ON UPDATE no action;

--> statement-breakpoint
ALTER TABLE receipt_uploads ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE receipt_uploads FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY receipt_uploads_owner ON receipt_uploads FOR ALL TO wf_app, wf_worker
  USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON receipt_uploads TO wf_app;
--> statement-breakpoint
GRANT SELECT ON receipt_uploads TO wf_worker;
--> statement-breakpoint
GRANT UPDATE (status, payload_enc, review_item_id, error_code, updated_at) ON receipt_uploads TO wf_worker;