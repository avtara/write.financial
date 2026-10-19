// SPDX-License-Identifier: AGPL-3.0-only
/** "Baru dibuka" in ⌘K (FR-S4): the entities and pages a user opened last, at most {@link RECENT_ITEMS_KEPT}. */
import { and, asc, desc, eq, notInArray, sql } from 'drizzle-orm';
import { withUser, type Database } from './db.ts';
import { recentItems } from './schema.ts';
import type { RECENT_ITEM_KINDS } from './schema.ts';

export type RecentItemKind = (typeof RECENT_ITEM_KINDS)[number];

/** How many items are kept per user; older ones are deleted on the next touch. */
export const RECENT_ITEMS_KEPT = 20;

export interface RecentItem {
  readonly kind: RecentItemKind;
  /** An entity id or a page path (1–200 characters). */
  readonly ref: string;
  readonly openedAt: Date;
}

export interface RecentItemsRepository {
  /** Records that the user opened `ref` now, and drops everything beyond the newest {@link RECENT_ITEMS_KEPT}. */
  touch: (userId: string, kind: RecentItemKind, ref: string) => Promise<void>;
  /** The newest `limit` items (default 10), newest first. */
  list: (userId: string, limit?: number) => Promise<RecentItem[]>;
}

export function createRecentItems(
  db: Database,
  { now = () => new Date() }: { now?: () => Date } = {},
): RecentItemsRepository {
  const newestFirst = [desc(recentItems.openedAt), asc(recentItems.kind), asc(recentItems.ref)];

  return {
    touch: (userId, kind, ref) =>
      withUser(db, userId, async (tx) => {
        const openedAt = now();
        await tx
          .insert(recentItems)
          .values({ userId, kind, ref, openedAt })
          .onConflictDoUpdate({ target: [recentItems.userId, recentItems.kind, recentItems.ref], set: { openedAt } });
        const kept = tx
          .select({ kind: recentItems.kind, ref: recentItems.ref })
          .from(recentItems)
          .orderBy(...newestFirst)
          .limit(RECENT_ITEMS_KEPT);
        await tx
          .delete(recentItems)
          .where(and(eq(recentItems.userId, userId), notInArray(sql`(${recentItems.kind}, ${recentItems.ref})`, kept)));
      }),

    list: (userId, limit = 10) =>
      withUser(db, userId, (tx) =>
        tx
          .select({ kind: recentItems.kind, ref: recentItems.ref, openedAt: recentItems.openedAt })
          .from(recentItems)
          .orderBy(...newestFirst)
          .limit(limit),
      ),
  };
}
