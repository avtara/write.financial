// SPDX-License-Identifier: AGPL-3.0-only
import { JOBS } from '@wf/jobs/queues';
import type { ProcessorDeps, ProcessorJob } from '../processors.ts';

/** Most users one scan deletes; the rest follow with the next day's run (or the retry). */
export const DELETION_SCAN_LIMIT = 100;

export interface AccountDeletionResult {
  /** Users this run handled: those the scan returned, or the one `userId` the payload named. */
  readonly users: number;
  /** User rows (with everything they own) the SECURITY DEFINER function actually deleted. */
  readonly deleted: number;
  /** Encrypted objects removed from the attachments and avatars buckets. */
  readonly objects: number;
}

/**
 * Account deletion (plan §6 `account-deletion`, FR-A11): the daily run scans for users whose 7-day grace period
 * (`deletion_requested_at` of `requestAccountDeletion`) has passed, or handles the one user a retried job names,
 * and per user first removes every object under `u/{userId}/` in both buckets, then deletes the user's row (and
 * through the foreign keys every row they own, including the wrapped DEK: the crypto-shred) with
 * `wf_account_delete_user`. Purging the blobs first keeps the order safe: a crash between the two steps is
 * repaired by the retry, which finds no blobs (or no user) and does nothing. Idempotent; the result carries
 * counts and ids only, never financial values.
 */
export function createAccountDeletionProcessor({
  db,
  now,
  objects,
}: ProcessorDeps): (job: ProcessorJob) => Promise<AccountDeletionResult> {
  return async (job) => {
    const { userId } = JOBS['account-deletion'].parse(job.data);
    const at = now();
    const targets = userId === undefined ? await db.accountDeletion.due(at, DELETION_SCAN_LIMIT) : [userId];
    let deleted = 0;
    let removed = 0;
    for (const id of targets) {
      removed += await objects.attachments.deletePrefix(id);
      removed += await objects.avatars.deletePrefix(id);
      if (await db.accountDeletion.deleteUser(id, at)) deleted += 1;
    }
    return { users: targets.length, deleted, objects: removed };
  };
}
