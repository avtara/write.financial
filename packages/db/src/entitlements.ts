// SPDX-License-Identifier: AGPL-3.0-only
import { and, eq, sql } from 'drizzle-orm';
import { withUser, type Database } from './db.ts';
import { DEFAULT_PLAN, entitlements, userPlans, type FEATURES } from './schema.ts';

export type Feature = (typeof FEATURES)[number];

export interface Entitlements {
  /**
   * Whether the user's plan includes `feature` (D17). Users without a `user_plans` row are on the default plan,
   * which includes every feature, so self-hosted instances never restrict anything.
   */
  can: (userId: string, feature: Feature) => Promise<boolean>;
}

export function createEntitlements(db: Database): Entitlements {
  return {
    can: (userId, feature) =>
      withUser(db, userId, async (tx) => {
        const plan = sql`coalesce((select ${userPlans.planCode} from ${userPlans} where ${userPlans.userId} = ${userId}), ${DEFAULT_PLAN})`;
        const rows = await tx
          .select({ feature: entitlements.feature })
          .from(entitlements)
          .where(and(eq(entitlements.planCode, plan), eq(entitlements.feature, feature)));
        return rows.length > 0;
      }),
  };
}
