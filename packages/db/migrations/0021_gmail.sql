CREATE TABLE "email_ingest_logs" (
	"id" uuid DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"message_id" text NOT NULL,
	"from_addr" text NOT NULL,
	"subject" text NOT NULL,
	"quote_enc" "bytea" NOT NULL,
	"filter_result" text NOT NULL,
	"extraction_enc" "bytea",
	"confidence" integer,
	"outcome" text NOT NULL,
	"review_item_id" uuid,
	"processing" text DEFAULT 'queued' NOT NULL,
	"error_code" text,
	"extraction_started_at" timestamp with time zone,
	"received_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_ingest_logs_user_id_id_pk" PRIMARY KEY("user_id","id")
);
--> statement-breakpoint
CREATE TABLE "gmail_connections" (
	"user_id" uuid NOT NULL,
	"email" text NOT NULL,
	"tokens_enc" "bytea",
	"grant_id" uuid DEFAULT uuidv7() NOT NULL,
	"watch_renewed_at" timestamp with time zone,
	"history_id" text,
	"watch_expires_at" timestamp with time zone,
	"status" text DEFAULT 'connected' NOT NULL,
	"filters" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gmail_connections_user_id_pk" PRIMARY KEY("user_id")
);
--> statement-breakpoint
CREATE TABLE "gmail_message_keys" (
	"user_id" uuid NOT NULL,
	"message_id" text NOT NULL,
	CONSTRAINT "gmail_message_keys_user_id_message_id_pk" PRIMARY KEY("user_id","message_id")
);
--> statement-breakpoint
CREATE TABLE "gmail_oauth_states" (
	"user_id" uuid NOT NULL,
	"state_hash" text PRIMARY KEY NOT NULL,
	"session_hash" text NOT NULL,
	"grant_id" uuid,
	"verifier_enc" "bytea" NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "email_ingest_logs" ADD CONSTRAINT "email_ingest_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gmail_connections" ADD CONSTRAINT "gmail_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gmail_message_keys" ADD CONSTRAINT "gmail_message_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gmail_oauth_states" ADD CONSTRAINT "gmail_oauth_states_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "email_ingest_logs_message_key" ON "email_ingest_logs" USING btree ("user_id","message_id");--> statement-breakpoint
CREATE INDEX "email_ingest_logs_user_id_created_at_idx" ON "email_ingest_logs" USING btree ("user_id","created_at" desc);

ALTER TABLE gmail_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE gmail_connections FORCE ROW LEVEL SECURITY;
CREATE POLICY gmail_connections_owner ON gmail_connections FOR ALL TO wf_app, wf_worker
  USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON gmail_connections TO wf_app;
GRANT SELECT, UPDATE ON gmail_connections TO wf_worker;
ALTER TABLE email_ingest_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_ingest_logs FORCE ROW LEVEL SECURITY;
CREATE POLICY email_ingest_logs_owner ON email_ingest_logs FOR ALL TO wf_app, wf_worker
  USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON email_ingest_logs TO wf_app;
GRANT SELECT, INSERT, UPDATE ON email_ingest_logs TO wf_worker;
ALTER TABLE gmail_message_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE gmail_message_keys FORCE ROW LEVEL SECURITY;
CREATE POLICY gmail_message_keys_owner ON gmail_message_keys FOR ALL TO wf_app, wf_worker
  USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());
GRANT SELECT, INSERT ON gmail_message_keys TO wf_app, wf_worker;
ALTER TABLE gmail_oauth_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE gmail_oauth_states FORCE ROW LEVEL SECURITY;
CREATE POLICY gmail_oauth_states_owner ON gmail_oauth_states FOR ALL TO wf_app
  USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());
GRANT SELECT, INSERT, DELETE ON gmail_oauth_states TO wf_app;

-- Authenticated push and the existing dispatch scanner need only tenant IDs, never tokens or mailbox contents.
CREATE POLICY gmail_connections_dispatch ON gmail_connections FOR SELECT TO wf_migrate USING (true);
CREATE FUNCTION wf_gmail_targets(p_email text) RETURNS TABLE(user_id uuid)
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT user_id FROM gmail_connections
  WHERE status = 'connected' AND tokens_enc IS NOT NULL AND (p_email IS NULL OR email = lower(p_email));
$$;
REVOKE ALL ON FUNCTION wf_gmail_targets(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION wf_gmail_targets(text) TO wf_app, wf_worker;

CREATE POLICY email_ingest_logs_retention_select ON email_ingest_logs FOR SELECT TO wf_migrate USING (true);
CREATE POLICY email_ingest_logs_retention_delete ON email_ingest_logs FOR DELETE TO wf_migrate USING (true);
CREATE POLICY gmail_oauth_states_retention_select ON gmail_oauth_states FOR SELECT TO wf_migrate USING (true);
CREATE POLICY gmail_oauth_states_retention_delete ON gmail_oauth_states FOR DELETE TO wf_migrate USING (true);
CREATE POLICY review_items_gmail_retention_select ON review_items FOR SELECT TO wf_migrate USING (source = 'gmail');
CREATE POLICY review_items_gmail_retention_delete ON review_items FOR DELETE TO wf_migrate USING (source = 'gmail');

-- Evidence expires, including encrypted Review copies. Non-sensitive message-ID tombstones remain replay-safe.
CREATE FUNCTION wf_gmail_purge(p_before timestamptz) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE deleted integer;
BEGIN
  DELETE FROM gmail_oauth_states WHERE expires_at < now();
  DELETE FROM review_items WHERE source = 'gmail' AND created_at < p_before;
  DELETE FROM email_ingest_logs WHERE created_at < p_before;
  GET DIAGNOSTICS deleted = ROW_COUNT;
  RETURN deleted;
END;
$$;
REVOKE ALL ON FUNCTION wf_gmail_purge(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION wf_gmail_purge(timestamptz) TO wf_worker;