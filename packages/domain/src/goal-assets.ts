// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Investment assets as goal funding sources (PRD FR-G2, FR-G5): a goal holds a percentage of an asset's units (or the
 * whole asset); per asset the goals total at most 100%, the rest is "Bebas dialokasikan". New DCA units follow the
 * percentages, a price move changes every goal by its share, and selling units of an asset held by two or more goals
 * needs the user to choose which goal shrinks. Percentages are basis points; units exact decimal strings; amounts
 * `bigint` minor units. Every split is exact: the parts always add up to the whole.
 */
import { divideFloor, formatDecimal, parseDecimal } from './decimal.ts';
import { splitByBps } from './money.ts';

/** FR-G2 asset sources: a percentage of the units, or the whole asset (counts as 100%). */
export const GOAL_ASSET_SOURCE_MODES = ['whole', 'percent'] as const;
export type GoalAssetSourceMode = (typeof GOAL_ASSET_SOURCE_MODES)[number];

export interface GoalAssetSource {
  readonly goalId: string;
  readonly mode: GoalAssetSourceMode;
  /** 1–10 000 for `percent`; ignored (10 000) for `whole`. */
  readonly bps: number;
}

export type InvalidGoalAssetReason = 'bps' | 'total' | 'goal' | 'units' | 'choice';

export class InvalidGoalAssetError extends RangeError {
  override readonly name = 'InvalidGoalAssetError';
  readonly reason: InvalidGoalAssetReason;
  constructor(reason: InvalidGoalAssetReason) {
    super(`Invalid goal asset allocation: ${reason}`);
    this.reason = reason;
  }
}

const FULL = 10_000;

export interface AssetAllocationCheck {
  readonly totalBps: number;
  /** "Bebas dialokasikan". */
  readonly freeBps: number;
}

/** FR-G2 Σ per asset ≤ 100%: each goal once, percent 1–10 000, whole = 10 000. */
export function checkAssetAllocations(sources: readonly GoalAssetSource[]): AssetAllocationCheck {
  const goals = new Set<string>();
  let totalBps = 0;
  for (const source of sources) {
    if (goals.has(source.goalId)) throw new InvalidGoalAssetError('goal');
    goals.add(source.goalId);
    if (source.mode === 'percent' && (!Number.isInteger(source.bps) || source.bps < 1 || source.bps > FULL)) {
      throw new InvalidGoalAssetError('bps');
    }
    totalBps += source.mode === 'whole' ? FULL : source.bps;
  }
  if (totalBps > FULL) throw new InvalidGoalAssetError('total');
  return { totalBps, freeBps: FULL - totalBps };
}

export interface GoalShare<T> {
  readonly goalId: string;
  readonly value: T;
}

export interface GoalSplit<T> {
  readonly goals: readonly GoalShare<T>[];
  readonly free: T;
}

/**
 * Each goal's part of a position value ("DP Rumah 60% · Rp8.100.000 · Dana Pensiun 40% · Rp5.400.000 · Bebas 0%"),
 * also for a change of value (adjustment +Rp203.000 → +121.800 / +81.200).
 */
export function goalShares(total: bigint, sources: readonly GoalAssetSource[]): GoalSplit<bigint> {
  const { freeBps } = checkAssetAllocations(sources);
  const parts = splitByBps(total, [...sources.map((source) => (source.mode === 'whole' ? FULL : source.bps)), freeBps]);
  return {
    goals: sources.map((source, index) => ({ goalId: source.goalId, value: parts[index] as bigint })),
    free: parts[sources.length] as bigint,
  };
}

/** Units per goal ("0,718 unit · 0,479 unit"); new DCA units split the same way ("ikut DCA"). */
export function splitUnits(units: string, sources: readonly GoalAssetSource[]): GoalSplit<string> {
  const parts = goalShares(parseDecimal(units), sources);
  return {
    goals: parts.goals.map((part) => ({ goalId: part.goalId, value: formatDecimal(part.value) })),
    free: formatDecimal(parts.free),
  };
}

export interface GoalImpact {
  readonly goalId: string;
  readonly beforeMinor: bigint;
  readonly afterMinor: bigint;
  /** "DP Rumah (proporsional 60%) −Rp318.000". */
  readonly deltaMinor: bigint;
}

/** FR-G5 impact of a price move (or a correction) on each goal holding the asset: 13.500.000 → 12.970.000. */
export function goalImpact(beforeMinor: bigint, afterMinor: bigint, sources: readonly GoalAssetSource[]): GoalImpact[] {
  const before = goalShares(beforeMinor, sources).goals;
  const after = goalShares(afterMinor, sources).goals;
  return before.map((share, index) => {
    const afterShare = (after[index] as GoalShare<bigint>).value;
    return {
      goalId: share.goalId,
      beforeMinor: share.value,
      afterMinor: afterShare,
      deltaMinor: afterShare - share.value,
    };
  });
}

/**
 * FR-G5: selling `soldUnits` needs a choice of goal when the free units do not cover it and two or more goals hold the
 * asset ("SPY dipakai 2 tujuan, jadi pilih juga tujuan mana yang berkurang").
 */
export function needsGoalChoice(units: string, sources: readonly GoalAssetSource[], soldUnits: string): boolean {
  const { free } = goalShares(parseDecimal(units), sources);
  return sources.length >= 2 && parseDecimal(soldUnits) > free;
}

export interface SaleAllocation {
  /** The sources after the sale: other goals keep their units, so their percentages grow. */
  readonly sources: readonly GoalAssetSource[];
  readonly unitsByGoal: readonly GoalShare<string>[];
  readonly freeUnits: string;
}

/**
 * Re-allocation after selling `soldUnits`: the free units go first, then the chosen goal's (`reduceGoalId`; may be
 * omitted only when one goal holds the asset). Percentages are recomputed on the remaining units, rounded down so
 * the total stays ≤ 100%; a goal left without units is dropped, a whole source stays whole. Selling everything
 * keeps the sources as they were (they apply to future units).
 */
export function sellAllocation(input: {
  readonly units: string;
  readonly sources: readonly GoalAssetSource[];
  readonly soldUnits: string;
  readonly reduceGoalId: string | null;
}): SaleAllocation {
  const held = parseDecimal(input.units);
  const sold = parseDecimal(input.soldUnits);
  if (sold <= 0n || sold > held) throw new InvalidGoalAssetError('units');
  const parts = goalShares(held, input.sources);
  const fromFree = sold < parts.free ? sold : parts.free;
  const fromGoal = sold - fromFree;
  const reduceGoalId =
    input.reduceGoalId ?? (input.sources.length === 1 ? (input.sources[0] as GoalAssetSource).goalId : null);
  const goals = parts.goals.map((part) => ({ ...part }));
  if (fromGoal > 0n) {
    const reduced = goals.find((part) => part.goalId === reduceGoalId);
    if (reduced === undefined) throw new InvalidGoalAssetError('choice');
    if (reduced.value < fromGoal) throw new InvalidGoalAssetError('units');
    reduced.value -= fromGoal;
  }
  const remaining = held - sold;
  const sources =
    remaining === 0n
      ? input.sources
      : input.sources
          .map((source, index): GoalAssetSource => {
            const goalUnits = (goals[index] as GoalShare<bigint>).value;
            return source.mode === 'whole'
              ? source
              : { ...source, bps: Number(divideFloor(goalUnits * BigInt(FULL), remaining)) };
          })
          .filter((source, index) => (goals[index] as GoalShare<bigint>).value > 0n && source.bps > 0);
  return {
    sources,
    unitsByGoal: goals.map((part) => ({ goalId: part.goalId, value: formatDecimal(part.value) })),
    freeUnits: formatDecimal(parts.free - fromFree),
  };
}
