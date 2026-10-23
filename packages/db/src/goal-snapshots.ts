// SPDX-License-Identifier: AGPL-3.0-only
/** FR-LP1: dated goal positions for reports, never current allocations masquerading as a historical position. */
import type { GoalValuation } from '@wf/domain/goals';
import type { LocalDate } from '@wf/domain/period';
import { and, desc, eq, isNull, lte } from 'drizzle-orm';
import { withUser, type Database, type Transaction } from './db.ts';
import { goalViewsIn } from './goals.ts';
import { localDateOf, userContextIn } from './ledger-core.ts';
import { goals, goalSnapshots, type GoalSnapshotData } from './schema.ts';

export interface GoalSnapshotEntry {
  readonly goalId: string;
  readonly name: string;
  readonly currency: string;
  readonly targetMinor: bigint;
  /** Null when a source cannot be valued, not a fabricated zero or partial sum. */
  readonly savedMinor: bigint | null;
  readonly valuation: GoalValuation;
}

export interface GoalSnapshot {
  readonly date: LocalDate;
  readonly recordedAt: Date;
  readonly goals: readonly GoalSnapshotEntry[];
}

/** Latest actual observation on/before the cutoff, under the caller's RLS context. Empty days remain distinguishable from missing history. */
export async function goalSnapshotIn(tx: Transaction, userId: string, to: LocalDate): Promise<GoalSnapshot | null> {
  const [row] = await tx
    .select()
    .from(goalSnapshots)
    .where(and(eq(goalSnapshots.userId, userId), lte(goalSnapshots.snapshotDate, to)))
    .orderBy(desc(goalSnapshots.snapshotDate))
    .limit(1);
  return row === undefined
    ? null
    : {
        date: row.snapshotDate,
        recordedAt: row.recordedAt,
        goals: row.goals.map((goal) => ({
          ...goal,
          targetMinor: BigInt(goal.targetMinor),
          savedMinor: goal.savedMinor === null ? null : BigInt(goal.savedMinor),
        })),
      };
}

export interface GoalSnapshots {
  /** Snapshot current values for this local date, even when there are no goals. A rerun replaces that day only. */
  readonly record: (userId: string, at: Date) => Promise<void>;
}

export function createGoalSnapshots(db: Database): GoalSnapshots {
  return {
    record: (userId, at) =>
      withUser(db, userId, async (tx) => {
        const { timezone } = await userContextIn(tx, userId);
        const snapshotDate = localDateOf(at, timezone);
        const views = await goalViewsIn(tx, userId, at, isNull(goals.archivedAt));
        const data: GoalSnapshotData[] = views.map((goal) => {
          let valuation: GoalValuation = goal.assetSources.length === 0 ? 'cash' : 'market';
          for (const source of goal.assetSources) {
            if (source.valuation === 'unavailable') {
              valuation = 'unavailable';
              break;
            }
            if (source.valuation === 'cost') valuation = 'cost';
          }
          return {
            goalId: goal.id,
            name: goal.name,
            currency: goal.currency,
            targetMinor: goal.targetMinor.toString(),
            savedMinor: valuation === 'unavailable' ? null : goal.savedMinor.toString(),
            valuation,
          };
        });
        await tx
          .insert(goalSnapshots)
          .values({ userId, snapshotDate, recordedAt: at, goals: data })
          .onConflictDoUpdate({
            target: [goalSnapshots.userId, goalSnapshots.snapshotDate],
            set: { recordedAt: at, goals: data },
          });
      }),
  };
}
