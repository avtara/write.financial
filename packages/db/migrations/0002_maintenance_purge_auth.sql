-- Daily maintenance (plan §6 `maintenance` queue): purge expired Better Auth rows and old invitations.
-- wf_worker has no privileges on the auth tables (they hold session tokens and verification values), so instead of a
-- table grant it gets EXECUTE on exactly one SECURITY DEFINER function that can only delete rows that are already
-- dead. The function runs as its owner wf_migrate. FORCE ROW LEVEL SECURITY applies to the owner too, so the policies
-- below are what let it see and delete those rows, and they only match rows that are expired by the server's clock:
-- even a bug in the function cannot delete a live session.

CREATE POLICY sessions_maintenance_read ON sessions FOR SELECT TO wf_migrate USING (expires_at < pg_catalog.now());
--> statement-breakpoint
CREATE POLICY sessions_maintenance_delete ON sessions FOR DELETE TO wf_migrate USING (expires_at < pg_catalog.now());
--> statement-breakpoint
CREATE POLICY verifications_maintenance_read ON verifications FOR SELECT TO wf_migrate
  USING (expires_at < pg_catalog.now());
--> statement-breakpoint
CREATE POLICY verifications_maintenance_delete ON verifications FOR DELETE TO wf_migrate
  USING (expires_at < pg_catalog.now());
--> statement-breakpoint
CREATE POLICY invitations_maintenance_read ON invitations FOR SELECT TO wf_migrate
  USING (expires_at < pg_catalog.now() - interval '30 days' OR used_at < pg_catalog.now() - interval '30 days');
--> statement-breakpoint
CREATE POLICY invitations_maintenance_delete ON invitations FOR DELETE TO wf_migrate
  USING (expires_at < pg_catalog.now() - interval '30 days' OR used_at < pg_catalog.now() - interval '30 days');
--> statement-breakpoint

-- Deletes expired verifications and sessions, and invitations that expired or were used more than 30 days ago, as of
-- p_now (the job's clock), and returns the number of deleted rows per table. p_now is capped at the server's now(), so
-- a caller cannot purge rows that are still valid by passing a future time. Deleting is idempotent: a second call with
-- the same p_now deletes nothing. search_path is pinned because SECURITY DEFINER functions must not resolve names
-- through a search_path the caller controls.
CREATE FUNCTION wf_maintenance_purge_auth(p_now timestamptz) RETURNS jsonb
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  cutoff timestamptz := LEAST(p_now, pg_catalog.now());
  deleted_verifications bigint;
  deleted_sessions bigint;
  deleted_invitations bigint;
BEGIN
  DELETE FROM public.verifications WHERE expires_at < cutoff;
  GET DIAGNOSTICS deleted_verifications = ROW_COUNT;
  DELETE FROM public.sessions WHERE expires_at < cutoff;
  GET DIAGNOSTICS deleted_sessions = ROW_COUNT;
  DELETE FROM public.invitations
    WHERE expires_at < cutoff - interval '30 days' OR used_at < cutoff - interval '30 days';
  GET DIAGNOSTICS deleted_invitations = ROW_COUNT;
  RETURN pg_catalog.jsonb_build_object(
    'verifications', deleted_verifications,
    'sessions', deleted_sessions,
    'invitations', deleted_invitations
  );
END
$$;
--> statement-breakpoint
-- Functions are executable by PUBLIC by default; this one only by the worker.
REVOKE ALL ON FUNCTION wf_maintenance_purge_auth(timestamptz) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION wf_maintenance_purge_auth(timestamptz) TO wf_worker;
