// SPDX-License-Identifier: AGPL-3.0-only
import { sql } from 'drizzle-orm';
import { firstRow, type Database } from './db.ts';

/** Rows deleted per table by one {@link Maintenance.purgeExpiredAuth} run. */
export interface AuthPurgeCounts {
  readonly verifications: number;
  readonly sessions: number;
  readonly invitations: number;
}

export interface Maintenance {
  /**
   * Deletes expired verifications and sessions, and invitations that expired or were used more than 30 days before
   * `now`, through the `wf_maintenance_purge_auth` SECURITY DEFINER function (the worker has no grants on these
   * tables). `now` later than the database clock counts as the database clock. Idempotent.
   */
  purgeExpiredAuth: (now: Date) => Promise<AuthPurgeCounts>;
  /**
   * FR-S5 retention: deletes every user's notifications older than 90 days before `now` (capped at the database
   * clock), with their outbox rows, through `wf_maintenance_purge_notifications`. Returns how many. Idempotent.
   */
  purgeNotifications: (now: Date) => Promise<number>;
}

/** Maintenance operations of the `maintenance` job; connect as `wf_worker`, the only role allowed to run them. */
export function createMaintenance(db: Database): Maintenance {
  return {
    purgeExpiredAuth: async (now) => {
      const rows = await db.execute<{ counts: AuthPurgeCounts }>(
        sql`select wf_maintenance_purge_auth(${now.toISOString()}::timestamptz) as counts`,
      );
      return firstRow(rows, 'maintenance result').counts;
    },

    purgeNotifications: async (now) => {
      const rows = await db.execute<{ deleted: string }>(
        sql`select wf_maintenance_purge_notifications(${now.toISOString()}::timestamptz) as deleted`,
      );
      return Number(firstRow(rows, 'maintenance result').deleted);
    },
  };
}
