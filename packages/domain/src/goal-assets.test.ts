// SPDX-License-Identifier: AGPL-3.0-only
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { formatDecimal, parseDecimal } from './decimal.ts';
import {
  GOAL_ASSET_SOURCE_MODES,
  InvalidGoalAssetError,
  checkAssetAllocations,
  goalImpact,
  goalShares,
  needsGoalChoice,
  sellAllocation,
  splitUnits,
  type AssetAllocationCheck,
  type GoalAssetSource,
} from './goal-assets.ts';

/** Design DZkbW: SPY allocated to DP Rumah 60% and Dana Pensiun 40%, "Bebas dialokasikan 0%". */
const SPY: GoalAssetSource[] = [
  { goalId: 'dp-rumah', mode: 'percent', bps: 6000 },
  { goalId: 'dana-pensiun', mode: 'percent', bps: 4000 },
];

function expectGoalAssetError(run: () => unknown, reason: string): void {
  let caught: unknown = null;
  try {
    run();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(InvalidGoalAssetError);
  expect(caught).toBeInstanceOf(RangeError);
  expect(caught).toMatchObject({
    reason,
    name: 'InvalidGoalAssetError',
    message: `Invalid goal asset allocation: ${reason}`,
  });
}

describe('checkAssetAllocations (FR-G2 Σ per asset ≤ 100%)', () => {
  it('totals percentages, a whole source counting 100%', () => {
    expect(GOAL_ASSET_SOURCE_MODES).toEqual(['whole', 'percent']);
    expect(checkAssetAllocations(SPY)).toEqual({ totalBps: 10_000, freeBps: 0 });
    expect(checkAssetAllocations([])).toEqual({ totalBps: 0, freeBps: 10_000 });
    expect(checkAssetAllocations([{ goalId: 'a', mode: 'whole', bps: 0 }])).toEqual({ totalBps: 10_000, freeBps: 0 });
    expect(checkAssetAllocations([{ goalId: 'a', mode: 'percent', bps: 1 }])).toEqual({ totalBps: 1, freeBps: 9_999 });
    expect(checkAssetAllocations([{ goalId: 'a', mode: 'percent', bps: 10_000 }])).toEqual({
      totalBps: 10_000,
      freeBps: 0,
    });
  });

  it('refuses more than 100%, duplicate goals and invalid percentages', () => {
    expectGoalAssetError(() => checkAssetAllocations([...SPY, { goalId: 'x', mode: 'percent', bps: 1 }]), 'total');
    expectGoalAssetError(
      () =>
        checkAssetAllocations([
          { goalId: 'a', mode: 'whole', bps: 0 },
          { goalId: 'b', mode: 'percent', bps: 1 },
        ]),
      'total',
    );
    expectGoalAssetError(
      () =>
        checkAssetAllocations([
          { goalId: 'a', mode: 'percent', bps: 1 },
          { goalId: 'a', mode: 'percent', bps: 1 },
        ]),
      'goal',
    );
    for (const bps of [0, 10_001, 1.5]) {
      expectGoalAssetError(() => checkAssetAllocations([{ goalId: 'a', mode: 'percent', bps }]), 'bps');
    }
  });

  it('property: accepted allocations never exceed 100%', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 10_001 }), { maxLength: 6 }), (list) => {
        const sources = list.map((bps, index): GoalAssetSource => ({ goalId: `g${index}`, mode: 'percent', bps }));
        let result: AssetAllocationCheck | null = null;
        try {
          result = checkAssetAllocations(sources);
        } catch (error) {
          expect(error).toBeInstanceOf(InvalidGoalAssetError);
        }
        if (result !== null) {
          expect(result.totalBps).toBeLessThanOrEqual(10_000);
          expect(result.totalBps + result.freeBps).toBe(10_000);
        }
      }),
    );
  });
});

describe('goal shares, units and impact (FR-G2, FR-G5)', () => {
  it('splits SPY Rp13.500.000 into DP Rumah Rp8.100.000 and Dana Pensiun Rp5.400.000', () => {
    expect(goalShares(13_500_000n, SPY)).toEqual({
      goals: [
        { goalId: 'dp-rumah', value: 8_100_000n },
        { goalId: 'dana-pensiun', value: 5_400_000n },
      ],
      free: 0n,
    });
    expect(goalShares(13_500_000n, [{ goalId: 'dp-rumah', mode: 'percent', bps: 6000 }]).free).toBe(5_400_000n);
    expect(goalShares(203_000n, SPY).goals.map((goal) => goal.value)).toEqual([121_800n, 81_200n]);
  });

  it('splits units: 1,197 → 0,718 / 0,479; a DCA buy of 0,356 follows the same 60/40', () => {
    expect(splitUnits('1.197', SPY)).toEqual({
      goals: [
        { goalId: 'dp-rumah', value: '0.7182' },
        { goalId: 'dana-pensiun', value: '0.4788' },
      ],
      free: '0',
    });
    expect(splitUnits('0.356', SPY).goals.map((goal) => goal.value)).toEqual(['0.2136', '0.1424']);
  });

  it('shows the impact of a price drop on each goal (oExkI: 13.500.000 → 12.970.000)', () => {
    expect(goalImpact(13_500_000n, 12_970_000n, SPY)).toEqual([
      { goalId: 'dp-rumah', beforeMinor: 8_100_000n, afterMinor: 7_782_000n, deltaMinor: -318_000n },
      { goalId: 'dana-pensiun', beforeMinor: 5_400_000n, afterMinor: 5_188_000n, deltaMinor: -212_000n },
    ]);
  });

  it('property: units split exactly and Σ goal percentages stay ≤ 100%', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 10n ** 24n }),
        fc.array(fc.integer({ min: 1, max: 4000 }), { maxLength: 4 }),
        (scaled, list) => {
          const sources = list.map((bps, index): GoalAssetSource => ({ goalId: `g${index}`, mode: 'percent', bps }));
          fc.pre(list.reduce((a, b) => a + b, 0) <= 10_000);
          const split = splitUnits(formatDecimal(scaled), sources);
          const total = split.goals.reduce((sum, goal) => sum + parseDecimal(goal.value), parseDecimal(split.free));
          expect(total).toBe(scaled);
          expect(checkAssetAllocations(sources).totalBps).toBeLessThanOrEqual(10_000);
        },
      ),
    );
  });
});

describe('selling an asset held by goals (FR-G5)', () => {
  it('needs a choice only when two or more goals hold it and the free units do not cover the sale', () => {
    expect(needsGoalChoice('1.197', SPY, '0.047')).toBe(true);
    expect(needsGoalChoice('1.197', SPY, '1.196999999999999999')).toBe(true);
    expect(needsGoalChoice('1.197', SPY, '1.197')).toBe(false);
    expect(needsGoalChoice('1.197', [SPY[0] as GoalAssetSource], '0.047')).toBe(false);
    expect(needsGoalChoice('1.197', [{ goalId: 'dp-rumah', mode: 'percent', bps: 10_000 }], '0.047')).toBe(false);
    const partial: GoalAssetSource[] = [
      { goalId: 'a', mode: 'percent', bps: 4000 },
      { goalId: 'b', mode: 'percent', bps: 4000 },
    ];
    expect(needsGoalChoice('10', partial, '2')).toBe(false);
    expect(needsGoalChoice('10', partial, '2.000000000000000001')).toBe(true);
  });

  it('reduces the chosen goal; the other keeps its units and its percentage grows', () => {
    expect(sellAllocation({ units: '1.197', sources: SPY, soldUnits: '0.047', reduceGoalId: 'dp-rumah' })).toEqual({
      sources: [
        { goalId: 'dp-rumah', mode: 'percent', bps: 5836 },
        { goalId: 'dana-pensiun', mode: 'percent', bps: 4163 },
      ],
      unitsByGoal: [
        { goalId: 'dp-rumah', value: '0.6712' },
        { goalId: 'dana-pensiun', value: '0.4788' },
      ],
      freeUnits: '0',
    });
  });

  it('sells free units first, then the chosen goal', () => {
    const half: GoalAssetSource[] = [{ goalId: 'a', mode: 'percent', bps: 5000 }];
    expect(sellAllocation({ units: '2', sources: half, soldUnits: '0.5', reduceGoalId: null })).toEqual({
      sources: [{ goalId: 'a', mode: 'percent', bps: 6666 }],
      unitsByGoal: [{ goalId: 'a', value: '1' }],
      freeUnits: '0.5',
    });
    // A single goal needs no choice.
    expect(sellAllocation({ units: '2', sources: half, soldUnits: '1.5', reduceGoalId: null })).toEqual({
      sources: [{ goalId: 'a', mode: 'percent', bps: 10_000 }],
      unitsByGoal: [{ goalId: 'a', value: '0.5' }],
      freeUnits: '0',
    });
  });

  it('drops a goal left without units, keeps a whole source whole, and keeps sources when everything is sold', () => {
    expect(
      sellAllocation({ units: '1.197', sources: SPY, soldUnits: '0.4788', reduceGoalId: 'dana-pensiun' }).sources,
    ).toEqual([{ goalId: 'dp-rumah', mode: 'percent', bps: 10_000 }]);
    const whole: GoalAssetSource[] = [{ goalId: 'a', mode: 'whole', bps: 0 }];
    expect(sellAllocation({ units: '3', sources: whole, soldUnits: '1', reduceGoalId: 'a' }).sources).toEqual(whole);
    expect(sellAllocation({ units: '1.197', sources: SPY, soldUnits: '1.197', reduceGoalId: null })).toEqual({
      sources: SPY,
      unitsByGoal: [
        { goalId: 'dp-rumah', value: '0' },
        { goalId: 'dana-pensiun', value: '0' },
      ],
      freeUnits: '0',
    });
    // A share too small for a basis point is dropped too (its units count as free from then on).
    const tiny: GoalAssetSource[] = [
      { goalId: 'a', mode: 'percent', bps: 9999 },
      { goalId: 'b', mode: 'percent', bps: 1 },
    ];
    expect(sellAllocation({ units: '1', sources: tiny, soldUnits: '0.0001', reduceGoalId: 'b' }).sources).toEqual([
      { goalId: 'a', mode: 'percent', bps: 10_000 },
    ]);
    expect(sellAllocation({ units: '1', sources: tiny, soldUnits: '0.00009999', reduceGoalId: 'b' }).sources).toEqual([
      { goalId: 'a', mode: 'percent', bps: 9999 },
    ]);
    expect(sellAllocation({ units: '10000', sources: tiny, soldUnits: '1', reduceGoalId: 'a' }).sources).toEqual([
      { goalId: 'a', mode: 'percent', bps: 9998 },
      { goalId: 'b', mode: 'percent', bps: 1 },
    ]);
  });

  it('needs no choice when the free units cover the sale', () => {
    const partial: GoalAssetSource[] = [
      { goalId: 'a', mode: 'percent', bps: 4000 },
      { goalId: 'b', mode: 'percent', bps: 4000 },
    ];
    expect(sellAllocation({ units: '10', sources: partial, soldUnits: '2', reduceGoalId: null })).toEqual({
      sources: [
        { goalId: 'a', mode: 'percent', bps: 5000 },
        { goalId: 'b', mode: 'percent', bps: 5000 },
      ],
      unitsByGoal: [
        { goalId: 'a', value: '4' },
        { goalId: 'b', value: '4' },
      ],
      freeUnits: '0',
    });
  });

  it('refuses a missing or unknown choice, too many units and empty sales', () => {
    expectGoalAssetError(
      () => sellAllocation({ units: '1', sources: [], soldUnits: '2', reduceGoalId: null }),
      'units',
    );
    expectGoalAssetError(
      () => sellAllocation({ units: '1.197', sources: SPY, soldUnits: '0.047', reduceGoalId: null }),
      'choice',
    );
    expectGoalAssetError(
      () => sellAllocation({ units: '1.197', sources: SPY, soldUnits: '0.047', reduceGoalId: 'liburan' }),
      'choice',
    );
    expectGoalAssetError(
      () => sellAllocation({ units: '1.197', sources: SPY, soldUnits: '0.5', reduceGoalId: 'dana-pensiun' }),
      'units',
    );
    expectGoalAssetError(
      () => sellAllocation({ units: '1.197', sources: SPY, soldUnits: '0', reduceGoalId: 'dp-rumah' }),
      'units',
    );
    expectGoalAssetError(
      () => sellAllocation({ units: '1.197', sources: SPY, soldUnits: '1.198', reduceGoalId: 'dp-rumah' }),
      'units',
    );
  });

  it('property: a sale conserves units, leaves other goals untouched and keeps Σ ≤ 100%', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 1n, max: 10n ** 22n }),
        fc.array(fc.integer({ min: 1, max: 3000 }), { minLength: 1, maxLength: 3 }),
        fc.integer({ min: 1, max: 10_000 }),
        fc.nat(),
        (held, list, soldShare, pick) => {
          const sources = list.map((bps, index): GoalAssetSource => ({ goalId: `g${index}`, mode: 'percent', bps }));
          const before = splitUnits(formatDecimal(held), sources);
          const chosen = pick % sources.length;
          const reducible = parseDecimal(before.free) + parseDecimal(before.goals[chosen]?.value ?? '0');
          const sold = (reducible * BigInt(soldShare)) / 10_000n;
          fc.pre(sold > 0n);
          const result = sellAllocation({
            units: formatDecimal(held),
            sources,
            soldUnits: formatDecimal(sold),
            reduceGoalId: `g${chosen}`,
          });
          const after = result.unitsByGoal.reduce(
            (sum, goal) => sum + parseDecimal(goal.value),
            parseDecimal(result.freeUnits),
          );
          expect(after).toBe(held - sold);
          result.unitsByGoal.forEach((goal, index) => {
            if (index !== chosen) expect(goal.value).toBe(before.goals[index]?.value);
          });
          expect(result.sources.reduce((sum, source) => sum + source.bps, 0)).toBeLessThanOrEqual(10_000);
        },
      ),
    );
  });
});
