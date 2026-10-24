// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Account deletion (FR-A11): requesting it (Settings › Data), cancelling it during the 7-day grace period, finding
 * the users whose grace period has passed, and the final purge. The request and the cancel run as `wf_app` inside
 * the user's own RLS scope (`deletion_requested_at` is one of the columns `wf_app` may update); the scan and the
 * purge run as `wf_worker` through the SECURITY DEFINER functions of migration 0018 — the worker has no grants on
 * `users` or any user-owned table. Deleting the `users` row cascades to every user-owned table, including
 * `user_keys`: dropping the wrapped DEK crypto-shreds every `_enc` column (D25). The objects under `u/{userId}/` in
 * object storage are deleted by the worker's `account-deletion` processor, outside the database.
 */
import { and, eq, isNull, isNotNull, sql } from 'drizzle-orm';
import { firstRow, withUser, type Database } from './db.ts';
import { users } from './schema.ts';

/** How long the user can still cancel (and sign in to) their account after requesting deletion (FR-A11). */
export const GRACE_DAYS = 7;

export interface AccountDeletion {
  /**
   * Sets `deletion_requested_at` to `now` (an existing request is kept as it is, so re-requesting during the grace
   * period neither extends nor restarts it). Returns the moment the grace period ends.
   */
  request: (userId: string, now: Date) => Promise<Date>;
  /** Clears `deletion_requested_at` again; returns whether a request was actually pending. */
  cancel: (userId: string) => Promise<boolean>;
  /** Ids of up to `limit` users whose grace period ended before `now`, oldest request first (`wf_worker`). */
  due: (now: Date, limit: number) => Promise<string[]>;
  /**
   * Deletes one user and every row they own in the caller's transaction, through `wf_account_delete_user`
   * (`wf_worker`). False when the user does not exist or is still within the grace period as of `now`.
   */
  deleteUser: (userId: string, now: Date) => Promise<boolean>;
}

/** `requestedAt` + the grace period: the moment the account is deleted unless cancelled. */
const graceEnds = (requestedAt: Date): Date => new Date(requestedAt.getTime() + GRACE_DAYS * 24 * 60 * 60 * 1000);

export function createAccountDeletion(db: Database): AccountDeletion {
  return {
    request: async (userId, now) =>
      withUser(db, userId, async (tx) => {
        // Only a first request writes: re-requesting during the grace period neither extends nor restarts it.
        const [inserted] = await tx
          .update(users)
          .set({ deletionRequestedAt: now, updatedAt: now })
          .where(and(eq(users.id, userId), isNull(users.deletionRequestedAt)))
          .returning({ requestedAt: users.deletionRequestedAt });
        // The row we just wrote carries `now` as its request date, so the grace period ends `now` + 7 days.
        if (inserted !== undefined) return graceEnds(inserted.requestedAt as Date);
        // A pending request already exists (re-requesting keeps its date), or the user is gone (a stale caller).
        const [existing] = await tx
          .select({ requestedAt: users.deletionRequestedAt })
          .from(users)
          .where(eq(users.id, userId));
        if (existing === undefined) throw new Error(`user ${userId} not found`);
        // The update above matched every row whose `deletion_requested_at` was null, so this one carries a request.
        return graceEnds(existing.requestedAt as Date);
      }),

    cancel: async (userId) =>
      // The predicate makes it atomic: a row comes back only when a request was actually pending.
      withUser(db, userId, async (tx) => {
        const [row] = await tx
          .update(users)
          .set({ deletionRequestedAt: null })
          .where(and(eq(users.id, userId), isNotNull(users.deletionRequestedAt)))
          .returning({ id: users.id });
        return row !== undefined;
      }),

    due: async (now, limit) =>
      [
        ...(await db.execute<{ user_id: string }>(
          sql`select user_id from wf_due_deletions(${now.toISOString()}::timestamptz, ${limit})`,
        )),
      ].map((row) => row.user_id),

    deleteUser: async (userId, now) =>
      firstRow(
        await db.execute<{ deleted: boolean }>(
          sql`select wf_account_delete_user(${userId}::uuid, ${now.toISOString()}::timestamptz) as deleted`,
        ),
        'account deletion result',
      ).deleted,
  };
}
