-- Account deletion (FR-A11): the worker has no privileges on `users` or any user-owned table (they hold session
-- tokens and financial data), so instead of table grants it gets EXECUTE on exactly two SECURITY DEFINER functions:
-- the due-deletions scan and the one-user purge. Both run as their owner wf_migrate. FORCE ROW LEVEL SECURITY
-- applies to the owner too, so the policies below are what let them through, and they only match users whose
-- 7-day grace period (`deletion_requested_at`, set by `requestAccountDeletion`) has fully passed by the server's
-- clock: even a bug in the functions cannot delete a user who is still in their grace period or never asked.
-- Deleting the `users` row cascades to every user-owned table (`schema.test.ts` holds the canonical list),
-- including `user_keys`: dropping the wrapped DEK crypto-shreds every `_enc` column (FR-A11, D25).

CREATE POLICY users_deletions_scan ON users FOR SELECT TO wf_migrate
  USING (
    deletion_requested_at IS NOT NULL
    AND deletion_requested_at <= pg_catalog.now() - interval '7 days'
  );
--> statement-breakpoint
CREATE POLICY users_deletion_delete ON users FOR DELETE TO wf_migrate
  USING (
    deletion_requested_at IS NOT NULL
    AND deletion_requested_at <= pg_catalog.now() - interval '7 days'
  );
--> statement-breakpoint

-- Users whose grace period has passed, for the `account-deletion` job's scan (`del.{userId}` jobs). p_now is capped
-- at the server's now(), so a caller cannot pull users forward by passing a future time.
CREATE FUNCTION wf_due_deletions(p_now timestamptz, p_limit integer) RETURNS TABLE (user_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
  SELECT id FROM public.users
  WHERE deletion_requested_at <= LEAST(p_now, pg_catalog.now()) - interval '7 days'
  ORDER BY id
  LIMIT p_limit
$$;
--> statement-breakpoint
-- Deletes one user and, through the foreign keys, every row the user owns, in the caller's transaction. Returns
-- false when the user does not exist or is still within (or never entered) the grace period, which makes the
-- worker's job idempotent and a retry harmless.
CREATE FUNCTION wf_account_delete_user(p_user_id uuid, p_now timestamptz) RETURNS boolean
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  deleted boolean;
BEGIN
  DELETE FROM public.users u
  WHERE u.id = p_user_id
    AND u.deletion_requested_at <= LEAST(p_now, pg_catalog.now()) - interval '7 days'
  RETURNING true INTO deleted;
  RETURN coalesce(deleted, false);
END
$$;
--> statement-breakpoint
-- Functions are executable by PUBLIC by default; these only by the worker.
REVOKE ALL ON FUNCTION wf_due_deletions(timestamptz, integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION wf_due_deletions(timestamptz, integer) TO wf_worker;
--> statement-breakpoint
REVOKE ALL ON FUNCTION wf_account_delete_user(uuid, timestamptz) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION wf_account_delete_user(uuid, timestamptz) TO wf_worker;
