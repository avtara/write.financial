// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The instance-wide scans of the `dispatch` job (plan §6), through the SECURITY DEFINER functions of migration 0006:
 * they run once for every user, so they cannot set `app.user_id`, and return only ids and time zones. Every job they
 * lead to then works inside one user's RLS scope. Executable by `wf_worker` only.
 */
import { sql } from 'drizzle-orm';
import type { Database } from './db.ts';

export interface WorkerUser {
  readonly userId: string;
  /** IANA time zone the user's 00.05/07.00/09.00 jobs follow. */
  readonly timeZone: string;
}

export interface DueReminder {
  readonly userId: string;
  readonly occurrenceId: string;
}

export interface PendingOutbox {
  readonly userId: string;
  readonly outboxId: string;
}

export interface Dispatch {
  /** Every user not scheduled for deletion, by id. */
  users: () => Promise<WorkerUser[]>;
  /** Up to `limit` occurrences whose reminder time has come and that were not reminded yet, oldest first. */
  dueReminders: (now: Date, limit: number) => Promise<DueReminder[]>;
  /** Up to `limit` unsent outbox rows due at `now` with fewer than 5 attempts, oldest first. */
  pendingOutbox: (now: Date, limit: number) => Promise<PendingOutbox[]>;
}

export function createDispatch(db: Database): Dispatch {
  return {
    users: async () =>
      [
        ...(await db.execute<{ user_id: string; time_zone: string }>(
          sql`select user_id, time_zone from wf_worker_users()`,
        )),
      ].map((row) => ({ userId: row.user_id, timeZone: row.time_zone })),

    dueReminders: async (now, limit) =>
      [
        ...(await db.execute<{ user_id: string; occurrence_id: string }>(
          sql`select user_id, occurrence_id from wf_due_reminders(${now.toISOString()}::timestamptz, ${limit})`,
        )),
      ].map((row) => ({ userId: row.user_id, occurrenceId: row.occurrence_id })),

    pendingOutbox: async (now, limit) =>
      [
        ...(await db.execute<{ user_id: string; outbox_id: string }>(
          sql`select user_id, outbox_id from wf_pending_outbox(${now.toISOString()}::timestamptz, ${limit})`,
        )),
      ].map((row) => ({ userId: row.user_id, outboxId: row.outbox_id })),
  };
}
