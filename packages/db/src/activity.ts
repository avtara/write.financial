// SPDX-License-Identifier: AGPL-3.0-only
/** Activity timeline per entity (FR-L4 "Aktivitas"): appended by the ledger repositories in their own transaction. */
import { and, asc, eq } from 'drizzle-orm';
import { withUser, type Database, type Transaction } from './db.ts';
import type { ACTIVITY_ACTIONS, ACTIVITY_ENTITIES } from './schema.ts';
import { activityLog, type JsonObject } from './schema.ts';

export type ActivityEntity = (typeof ACTIVITY_ENTITIES)[number];
export type ActivityAction = (typeof ACTIVITY_ACTIONS)[number];

export interface ActivityEntry {
  readonly action: ActivityAction;
  /** Ids and enum values only (e.g. `{ source: 'quick' }`, `{ from: <id> }`), never amounts or notes. */
  readonly meta: JsonObject;
  readonly at: Date;
}

/** Appends entries for `entityIds` inside the caller's user transaction. */
export async function logActivity(
  tx: Transaction,
  userId: string,
  entity: ActivityEntity,
  entityIds: readonly string[],
  action: ActivityAction,
  meta: JsonObject = {},
): Promise<void> {
  if (entityIds.length === 0) return;
  await tx.insert(activityLog).values(entityIds.map((entityId) => ({ userId, entity, entityId, action, meta })));
}

export interface ActivityRepository {
  /** The entity's timeline, oldest first. */
  list: (userId: string, entity: ActivityEntity, entityId: string) => Promise<ActivityEntry[]>;
}

export function createActivity(db: Database): ActivityRepository {
  return {
    list: (userId, entity, entityId) =>
      withUser(db, userId, (tx) =>
        tx
          .select({ action: activityLog.action, meta: activityLog.meta, at: activityLog.at })
          .from(activityLog)
          .where(and(eq(activityLog.entity, entity), eq(activityLog.entityId, entityId)))
          .orderBy(asc(activityLog.at), asc(activityLog.id)),
      ),
  };
}
