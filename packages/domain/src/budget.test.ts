// SPDX-License-Identifier: AGPL-3.0-only
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  ALERT_PCTS,
  DEFAULT_ALERT_PCT,
  FILL_AVERAGE_PERIODS,
  InvalidBudgetError,
  SAVING_RATE_TARGET_BPS,
  averageSpend,
  budgetTotals,
  closeProposals,
  idealBps,
  lineStatus,
  moveLeftover,
  ratioBps,
  safeDailyLimit,
  safeDailyStepMinor,
  savingRateBps,
  suggestLeftoverSources,
  weeklyBudget,
  willExceedBy,
  type BudgetContext,
  type BudgetLineInput,
  type BudgetLineStatus,
  type LeftoverLine,
} from './budget.ts';
import { BUILT_IN_CATEGORIES, type BuiltInCategoryKey, type CategoryGroup } from './categories.ts';
import { parseLocalDate as d, periodFor, periodStartDay, type Period } from './period.ts';
import { DESIGN_SEED, type SeedTransaction } from './seed.ts';

const GROUP = new Map<BuiltInCategoryKey, CategoryGroup>(
  BUILT_IN_CATEGORIES.map((category) => [category.key, category.group]),
);
/** The seed's only budget version (September onwards); its total is asserted below. */
const BUDGET_LINES = DESIGN_SEED.budgets[0]?.lines ?? [];

function spentByCategory(transactions: readonly SeedTransaction[]): Map<BuiltInCategoryKey, bigint> {
  const spent = new Map<BuiltInCategoryKey, bigint>();
  for (const transaction of transactions) {
    if (transaction.kind !== 'expense') continue;
    spent.set(transaction.categoryKey, (spent.get(transaction.categoryKey) ?? 0n) + transaction.amountMinor);
  }
  return spent;
}

const STEP = safeDailyStepMinor('IDR');
const OCTOBER = periodFor(d('2026-10-15'), periodStartDay(1));
const SEPTEMBER = periodFor(d('2026-09-15'), periodStartDay(1));
const TODAY = d('2026-10-15');
const OCTOBER_CONTEXT: BudgetContext = { period: OCTOBER, today: TODAY, stepMinor: STEP };
const SEPTEMBER_CONTEXT: BudgetContext = { period: SEPTEMBER, today: TODAY, stepMinor: STEP };

/** The budget page lines of the seed version for one period. */
function seedLines(
  transactions: readonly SeedTransaction[],
  context: BudgetContext,
): Map<BuiltInCategoryKey, BudgetLineStatus> {
  const spent = spentByCategory(transactions);
  return new Map(
    BUDGET_LINES.map((line) => [
      line.categoryKey,
      lineStatus(
        {
          limitMinor: line.limitMinor,
          spentMinor: spent.get(line.categoryKey) ?? 0n,
          isFixed: line.isFixed,
          alertPct: line.alertPct,
          scheduledMinor: 0n,
        },
        context,
      ),
    ]),
  );
}

const october = seedLines(DESIGN_SEED.transactions, OCTOBER_CONTEXT);
const september = seedLines(DESIGN_SEED.septemberTransactions, SEPTEMBER_CONTEXT);
const line = (lines: Map<BuiltInCategoryKey, BudgetLineStatus>, key: BuiltInCategoryKey): BudgetLineStatus => {
  const status = lines.get(key);
  if (status === undefined) throw new Error(`no budget line for ${key}`);
  return status;
};
const groupRatio = (lines: Map<BuiltInCategoryKey, BudgetLineStatus>, group: CategoryGroup): number | null => {
  const inGroup = [...lines].filter(([key]) => GROUP.get(key) === group).map(([, status]) => status);
  return ratioBps(
    inGroup.reduce((sum, status) => sum + status.spentMinor, 0n),
    inGroup.reduce((sum, status) => sum + status.limitMinor, 0n),
  );
};

const input = (overrides: Partial<BudgetLineInput>): BudgetLineInput => ({
  limitMinor: 1_000_000n,
  spentMinor: 0n,
  isFixed: false,
  alertPct: DEFAULT_ALERT_PCT,
  scheduledMinor: 0n,
  ...overrides,
});
/** A 3-day period 1–3 Okt; `today` 2 Okt is day 2. */
const SHORT: Pick<Period, 'start' | 'end' | 'days'> = { start: d('2026-10-01'), end: d('2026-10-03'), days: 3 };

describe('constants', () => {
  it('offers the FR-B4 alert thresholds with 85% as default, a 30% saving target, and a 3-period fill', () => {
    expect(ALERT_PCTS).toEqual([50, 80, 85, 100]);
    expect(DEFAULT_ALERT_PCT).toBe(85);
    expect(SAVING_RATE_TARGET_BPS).toBe(3_000);
    expect(FILL_AVERAGE_PERIODS).toBe(3);
  });

  it('InvalidBudgetError is a RangeError with its own name', () => {
    const error = new InvalidBudgetError('x');
    expect(error).toBeInstanceOf(RangeError);
    expect(error.name).toBe('InvalidBudgetError');
  });
});

describe('ratioBps', () => {
  it('golden: 16.500.000 / 18.750.000 = 8800 bps ("88%")', () => {
    expect(ratioBps(16_500_000n, 18_750_000n)).toBe(8_800);
  });

  it('rounds half up, also for negative ratios', () => {
    expect(ratioBps(1n, 20_000n)).toBe(1); // 0,5
    expect(ratioBps(1n, 40_000n)).toBe(0); // 0,25
    expect(ratioBps(3n, 40_000n)).toBe(1); // 0,75
    expect(ratioBps(-1n, 20_000n)).toBe(0); // −0,5
    expect(ratioBps(-3n, 20_000n)).toBe(-1); // −1,5
    expect(ratioBps(-1n, 40_000n)).toBe(0); // −0,25
    expect(ratioBps(-3n, 40_000n)).toBe(-1); // −0,75
    expect(ratioBps(-2n, 1n)).toBe(-20_000);
    expect(ratioBps(0n, 7n)).toBe(0);
  });

  it('is null without a positive whole', () => {
    expect(ratioBps(1n, 0n)).toBeNull();
    expect(ratioBps(1n, -5n)).toBeNull();
  });

  it('is the exact ratio rounded half up', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: -(10n ** 11n), max: 10n ** 11n }),
        fc.bigInt({ min: 1n, max: 10n ** 12n }),
        (part, whole) => {
          const bps = BigInt(ratioBps(part, whole) ?? Number.NaN);
          // bps − ½ ≤ part × 10000 ÷ whole < bps + ½
          expect((2n * bps - 1n) * whole).toBeLessThanOrEqual(20_000n * part);
          expect(20_000n * part).toBeLessThan((2n * bps + 1n) * whole);
        },
      ),
    );
  });
});

describe('idealBps', () => {
  it('golden: day 15 of 31 = 4839 bps ("48%")', () => {
    expect(idealBps(15, 31)).toBe(4_839);
    expect(idealBps(31, 31)).toBe(10_000);
    expect(idealBps(0, 31)).toBe(0);
  });
});

describe('safeDailyStepMinor', () => {
  it('is Rp1.000 for IDR (any case) and one major unit otherwise', () => {
    expect(safeDailyStepMinor('IDR')).toBe(1_000n);
    expect(safeDailyStepMinor('idr')).toBe(1_000n);
    expect(safeDailyStepMinor('USD')).toBe(100n);
    expect(safeDailyStepMinor('JPY')).toBe(1n);
  });
});

describe('safeDailyLimit', () => {
  it('golden: 2.250.000 over 16 days = Rp140.000 (floored to Rp1.000)', () => {
    expect(safeDailyLimit(2_250_000n, 16, STEP)).toBe(140_000n);
  });

  it('gives the whole remainder on the last day and nothing when less than a step is left or over', () => {
    expect(safeDailyLimit(1_150_500n, 0, STEP)).toBe(1_150_000n);
    expect(safeDailyLimit(1_000n, 0, STEP)).toBe(1_000n);
    expect(safeDailyLimit(999n, 0, STEP)).toBe(0n);
    expect(safeDailyLimit(0n, 5, STEP)).toBe(0n);
    expect(safeDailyLimit(-400_000n, 16, STEP)).toBe(0n);
    expect(safeDailyLimit(2_000n, 3, STEP)).toBe(0n);
  });

  it('is the largest step multiple that fits the days left', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: -(10n ** 10n), max: 10n ** 12n }),
        fc.integer({ min: 0, max: 31 }),
        fc.constantFrom(1n, 100n, 1_000n),
        (remaining, daysLeft, step) => {
          const limit = safeDailyLimit(remaining, daysLeft, step);
          const days = BigInt(Math.max(daysLeft, 1));
          const available = remaining > 0n ? remaining : 0n;
          expect(limit % step).toBe(0n);
          expect(limit * days).toBeLessThanOrEqual(available);
          expect((limit + step) * days).toBeGreaterThan(available);
        },
      ),
    );
  });
});

describe('weeklyBudget', () => {
  it('is limit × 7 ÷ days in the period, rounded half up', () => {
    expect(weeklyBudget(3_500_000n, 31)).toBe(790_323n); // 790.322,58
    expect(weeklyBudget(3_000_000n, 30)).toBe(700_000n);
    expect(weeklyBudget(1n, 14)).toBe(1n); // 0,5
    expect(weeklyBudget(1n, 15)).toBe(0n); // 0,466…
  });
});

describe('willExceedBy', () => {
  it('is spent + typed + scheduled − limit when positive, else 0', () => {
    const base = { limitMinor: 2_000_000n, spentMinor: 1_400_000n, typedMinor: 500_000n, scheduledMinor: 300_000n };
    expect(willExceedBy(base)).toBe(200_000n);
    expect(willExceedBy({ ...base, scheduledMinor: 100_000n })).toBe(0n);
    expect(willExceedBy({ ...base, scheduledMinor: 0n })).toBe(0n);
  });
});

describe('lineStatus', () => {
  it('golden: Makan & Dapur 3.200.000 / 3.500.000 = 9143 bps, warning, safe Rp18.000/day', () => {
    expect(line(october, 'system:food')).toEqual({
      limitMinor: 3_500_000n,
      spentMinor: 3_200_000n,
      remainingMinor: 300_000n,
      usedBps: 9_143,
      safeDailyMinor: 18_000n,
      weeklyMinor: 790_323n,
      projectionMinor: 6_613_333n, // 3.200.000 × 31 ÷ 15
      state: 'warning',
      willExceedByMinor: 0n,
    });
  });

  it('golden: Hiburan 2.100.000 / 2.500.000 = 8400 bps, ok, safe Rp25.000/day', () => {
    expect(line(october, 'system:entertainment')).toMatchObject({
      usedBps: 8_400,
      state: 'ok',
      safeDailyMinor: 25_000n,
    });
  });

  it('golden: Transportasi safe daily Rp37.000 (600.000 ÷ 16 = 37.500 floored; the design rounds to 38.000)', () => {
    expect(line(october, 'system:transport')).toMatchObject({ usedBps: 7_000, state: 'ok', safeDailyMinor: 37_000n });
  });

  it('golden: Sewa Kos 4.500.000 / 4.500.000 fixed is paid, without a daily rate', () => {
    expect(line(october, 'system:rent')).toMatchObject({
      usedBps: 10_000,
      state: 'paid',
      safeDailyMinor: null,
      projectionMinor: 4_500_000n,
    });
  });

  it('golden: Belanja Online 2.400.000 / 2.000.000 is over by 400.000', () => {
    expect(line(october, 'system:shopping')).toMatchObject({
      remainingMinor: -400_000n,
      usedBps: 12_000,
      state: 'over',
      safeDailyMinor: 0n,
      willExceedByMinor: 400_000n,
    });
  });

  it('golden: Kesehatan and Perawatan diri unused; fixed bills 8667 and subscriptions 9000 at the 85% alert', () => {
    expect(line(october, 'system:health')).toMatchObject({ usedBps: 0, state: 'unused' });
    expect(line(october, 'system:personal_care')).toMatchObject({ limitMinor: 250_000n, state: 'unused' });
    expect(line(october, 'system:bills')).toMatchObject({ usedBps: 8_667, state: 'warning', safeDailyMinor: null });
    expect(line(october, 'system:subscriptions')).toMatchObject({ usedBps: 9_000, state: 'warning' });
  });

  it('states: over beats paid, warning from the alert threshold, a fixed line under its limit is not paid', () => {
    const at = (overrides: Partial<BudgetLineInput>) => lineStatus(input(overrides), OCTOBER_CONTEXT).state;
    expect(at({ spentMinor: 1_000_001n, isFixed: true })).toBe('over');
    expect(at({ spentMinor: 1_000_000n })).toBe('warning');
    expect(at({ spentMinor: 1_000_000n, isFixed: true })).toBe('paid');
    expect(at({ spentMinor: 999_999n, isFixed: true, alertPct: 100 })).toBe('ok');
    expect(at({ spentMinor: 850_000n })).toBe('warning');
    expect(at({ spentMinor: 849_999n })).toBe('ok');
    expect(at({ spentMinor: 500_000n, alertPct: 50 })).toBe('warning');
    expect(at({ spentMinor: 0n, isFixed: true })).toBe('unused');
    expect(at({ limitMinor: 0n, spentMinor: 0n })).toBe('unused');
  });

  it('has no ratio without a limit', () => {
    expect(lineStatus(input({ limitMinor: 0n, spentMinor: 5n }), OCTOBER_CONTEXT)).toMatchObject({
      usedBps: null,
      state: 'over',
    });
  });

  it('projects fixed lines in full (or what was spent) plus scheduled bills', () => {
    const project = (overrides: Partial<BudgetLineInput>) =>
      lineStatus(input({ isFixed: true, ...overrides }), OCTOBER_CONTEXT).projectionMinor;
    expect(project({ spentMinor: 300_000n, scheduledMinor: 200_000n })).toBe(1_200_000n);
    expect(project({ spentMinor: 1_300_000n, scheduledMinor: 200_000n })).toBe(1_500_000n);
  });

  it('projects variable lines at the pace so far, rounded half up, plus scheduled bills', () => {
    const project = (spentMinor: bigint, scheduledMinor: bigint, today: string) =>
      lineStatus(input({ spentMinor, scheduledMinor }), { period: SHORT, today: d(today), stepMinor: 1n })
        .projectionMinor;
    expect(project(1n, 0n, '2026-10-02')).toBe(2n); // 1 × 3 ÷ 2 = 1,5
    expect(project(1n, 10n, '2026-10-02')).toBe(12n);
    expect(project(5n, 0n, '2026-10-02')).toBe(8n); // 7,5
    expect(project(4n, 0n, '2026-10-02')).toBe(6n);
    expect(project(4n, 0n, '2026-10-03')).toBe(4n);
    // Before the period starts nothing has elapsed: what is spent (already) plus scheduled.
    expect(project(4n, 10n, '2026-09-30')).toBe(14n);
  });

  it('reports willExceedBy with the scheduled bills', () => {
    const status = lineStatus(input({ spentMinor: 900_000n, scheduledMinor: 250_000n }), OCTOBER_CONTEXT);
    expect(status.willExceedByMinor).toBe(150_000n);
    expect(status.safeDailyMinor).toBe(6_000n); // 100.000 ÷ 16 floored
    expect(status.weeklyMinor).toBe(225_806n);
  });
});

describe('budgetTotals', () => {
  it('golden: Oktober 16.500.000 / 18.750.000 = 88%, ideal 48%, Rp140.000/day, ahead of plan, 1 over', () => {
    expect(budgetTotals([...october.values()], OCTOBER_CONTEXT)).toEqual({
      limitMinor: 18_750_000n,
      spentMinor: 16_500_000n,
      remainingMinor: 2_250_000n,
      usedBps: 8_800,
      day: 15,
      daysLeft: 16,
      idealBps: 4_839,
      pace: 'ahead',
      safeDailyMinor: 140_000n,
      projectionMinor: 27_253_333n,
      projectedOverMinor: 8_503_333n,
      overCount: 1,
    });
  });

  it('golden: Needs 10.400.000 / 12.000.000 = 87%, Wants 6.100.000 / 6.750.000 = 90%', () => {
    expect(groupRatio(october, 'needs')).toBe(8_667);
    expect(groupRatio(october, 'wants')).toBe(9_037);
  });

  it('golden: September (closed) 17.600.000 / 18.750.000 = 94% on day 30 with no days left', () => {
    const totals = budgetTotals([...september.values()], SEPTEMBER_CONTEXT);
    expect(totals).toMatchObject({
      spentMinor: 17_600_000n,
      usedBps: 9_387,
      day: 30,
      daysLeft: 0,
      idealBps: 10_000,
      pace: 'on_track',
      safeDailyMinor: 1_150_000n,
      overCount: 1,
    });
    // Hadiah & Donasi (700.000) has no budget line: unbudgeted spending.
    expect(september.has('system:gifts')).toBe(false);
    expect(spentByCategory(DESIGN_SEED.septemberTransactions).get('system:gifts')).toBe(700_000n);
  });

  it('is on track at or below the ideal and without a limit; no projected overrun within the limit', () => {
    const at = (spentMinor: bigint) =>
      budgetTotals([lineStatus(input({ limitMinor: 3_100n, spentMinor }), OCTOBER_CONTEXT)], OCTOBER_CONTEXT);
    // 1.500 / 3.100 = 4839 bps = ideal.
    expect(at(1_500n)).toMatchObject({ usedBps: 4_839, pace: 'on_track', projectedOverMinor: 0n });
    expect(at(100n)).toMatchObject({ projectionMinor: 207n, projectedOverMinor: 0n });
    expect(at(1_501n)).toMatchObject({ usedBps: 4_842, pace: 'ahead', projectedOverMinor: 2n }); // 3.102 − 3.100
    expect(budgetTotals([], OCTOBER_CONTEXT)).toEqual({
      limitMinor: 0n,
      spentMinor: 0n,
      remainingMinor: 0n,
      usedBps: null,
      day: 15,
      daysLeft: 16,
      idealBps: 4_839,
      pace: 'on_track',
      safeDailyMinor: 0n,
      projectionMinor: 0n,
      projectedOverMinor: 0n,
      overCount: 0,
    });
  });

  it('is on track before the period starts (ideal 0)', () => {
    const before: BudgetContext = { ...OCTOBER_CONTEXT, today: d('2026-09-20') };
    const totals = budgetTotals([lineStatus(input({}), before)], before);
    expect(totals).toMatchObject({ day: 0, daysLeft: 31, idealBps: 0, usedBps: 0, pace: 'on_track' });
  });
});

const LEFTOVERS: LeftoverLine[] = [
  { categoryId: 'shopping', remainingMinor: -400_000n, isFixed: false },
  { categoryId: 'transport', remainingMinor: 600_000n, isFixed: false },
  { categoryId: 'entertainment', remainingMinor: 400_000n, isFixed: false },
  { categoryId: 'food', remainingMinor: 300_000n, isFixed: false },
  { categoryId: 'bills', remainingMinor: 200_000n, isFixed: true },
  { categoryId: 'health', remainingMinor: 500_000n, isFixed: false },
];

describe('moveLeftover (FR-B3)', () => {
  it('moves sources into the target, keeping the total', () => {
    expect(
      moveLeftover(LEFTOVERS, 'shopping', [
        { categoryId: 'transport', amountMinor: 250_000n },
        { categoryId: 'health', amountMinor: 500_000n },
      ]),
    ).toEqual([
      { categoryId: 'shopping', deltaMinor: 750_000n },
      { categoryId: 'transport', deltaMinor: -250_000n },
      { categoryId: 'health', deltaMinor: -500_000n },
    ]);
  });

  it.each([
    [[], 'shopping', 'A move needs at least one source'],
    [[{ categoryId: 'food', amountMinor: 1n }], 'gifts', 'The target is not in the budget'],
    [[{ categoryId: 'gifts', amountMinor: 1n }], 'shopping', 'A source is not in the budget'],
    [[{ categoryId: 'shopping', amountMinor: 1n }], 'shopping', 'Sources must be distinct and differ from the target'],
    [
      [
        { categoryId: 'food', amountMinor: 1n },
        { categoryId: 'food', amountMinor: 1n },
      ],
      'shopping',
      'Sources must be distinct and differ from the target',
    ],
    [[{ categoryId: 'bills', amountMinor: 1n }], 'shopping', 'A fixed budget has no leftover to move'],
    [[{ categoryId: 'food', amountMinor: 0n }], 'shopping', 'A source can give a positive amount up to its remainder'],
    [[{ categoryId: 'food', amountMinor: -1n }], 'shopping', 'A source can give a positive amount up to its remainder'],
    [
      [{ categoryId: 'food', amountMinor: 300_001n }],
      'shopping',
      'A source can give a positive amount up to its remainder',
    ],
  ] as const)('rejects invalid move #%#', (sources, target, message) => {
    expect(() => moveLeftover(LEFTOVERS, target, sources)).toThrow(InvalidBudgetError);
    expect(() => moveLeftover(LEFTOVERS, target, sources)).toThrow(message);
  });

  it('allows a source to give exactly its remainder', () => {
    expect(moveLeftover(LEFTOVERS, 'shopping', [{ categoryId: 'food', amountMinor: 300_000n }])).toEqual([
      { categoryId: 'shopping', deltaMinor: 300_000n },
      { categoryId: 'food', deltaMinor: -300_000n },
    ]);
  });

  it('deltas always sum to zero and no source gives more than its remainder', () => {
    const movable = LEFTOVERS.filter((leftover) => !leftover.isFixed && leftover.remainingMinor > 0n);
    fc.assert(
      fc.property(
        fc.subarray(movable, { minLength: 1 }),
        fc.array(fc.double({ min: 0, max: 1, noNaN: true }), { minLength: 6, maxLength: 6 }),
        (sources, shares) => {
          const deltas = moveLeftover(
            LEFTOVERS,
            'shopping',
            sources.map((source, index) => ({
              categoryId: source.categoryId,
              amountMinor: 1n + BigInt(Math.floor((shares[index] ?? 0) * Number(source.remainingMinor - 1n))),
            })),
          );
          expect(deltas.reduce((sum, delta) => sum + delta.deltaMinor, 0n)).toBe(0n);
          expect(deltas[0]?.categoryId).toBe('shopping');
          for (const delta of deltas.slice(1)) {
            const source = LEFTOVERS.find((leftover) => leftover.categoryId === delta.categoryId);
            expect(-delta.deltaMinor).toBeLessThanOrEqual(source?.remainingMinor ?? 0n);
          }
        },
      ),
    );
  });
});

describe('suggestLeftoverSources (FR-B3)', () => {
  it('takes the largest remainders first until the need is covered', () => {
    expect(suggestLeftoverSources(LEFTOVERS, 'shopping', 400_000n)).toEqual([
      { categoryId: 'transport', amountMinor: 400_000n },
    ]);
    expect(suggestLeftoverSources(LEFTOVERS, 'shopping', 900_000n)).toEqual([
      { categoryId: 'transport', amountMinor: 600_000n },
      { categoryId: 'health', amountMinor: 300_000n },
    ]);
    // Exactly covered by the first two: nothing more is suggested.
    expect(suggestLeftoverSources(LEFTOVERS, 'shopping', 1_100_000n)).toEqual([
      { categoryId: 'transport', amountMinor: 600_000n },
      { categoryId: 'health', amountMinor: 500_000n },
    ]);
  });

  it('excludes the target, fixed budgets, and empty or negative remainders; stops when they run out', () => {
    const lines: LeftoverLine[] = [...LEFTOVERS, { categoryId: 'hobby', remainingMinor: 0n, isFixed: false }];
    expect(suggestLeftoverSources(lines, 'transport', 10_000_000n)).toEqual([
      { categoryId: 'health', amountMinor: 500_000n },
      { categoryId: 'entertainment', amountMinor: 400_000n },
      { categoryId: 'food', amountMinor: 300_000n },
    ]);
    expect(suggestLeftoverSources(lines, 'shopping', 0n)).toEqual([]);
  });

  it('keeps the budget order for equal remainders', () => {
    const tied: LeftoverLine[] = [
      { categoryId: 'a', remainingMinor: 100n, isFixed: false },
      { categoryId: 'b', remainingMinor: 300n, isFixed: false },
      { categoryId: 'c', remainingMinor: 100n, isFixed: false },
      { categoryId: 'd', remainingMinor: 300n, isFixed: false },
    ];
    expect(suggestLeftoverSources(tied, 'x', 1_000n).map((source) => source.categoryId)).toEqual(['b', 'd', 'a', 'c']);
  });
});

describe('closeProposals (FR-P4)', () => {
  const closing = (rollover: ReadonlySet<string>) =>
    [...september].map(([categoryId, status]) => ({
      categoryId,
      remainingMinor: status.remainingMinor,
      rollover: rollover.has(categoryId),
    }));

  it('golden: September leaves Rp1.150.000 to move to savings, nothing rolls over', () => {
    expect(closeProposals(closing(new Set()))).toEqual({ rollovers: [], leftoverMinor: 1_150_000n });
  });

  it('golden: an overspent rollover line rolls nothing; Hiburan rolls 700.000, leaving 450.000', () => {
    expect(closeProposals(closing(new Set(['system:shopping'])))).toEqual({
      rollovers: [],
      leftoverMinor: 1_150_000n,
    });
    expect(closeProposals(closing(new Set(['system:entertainment'])))).toEqual({
      rollovers: [{ categoryId: 'system:entertainment', deltaMinor: 700_000n }],
      leftoverMinor: 450_000n,
    });
  });

  it('rolls nothing from an exactly spent line and never proposes a negative leftover', () => {
    expect(
      closeProposals([
        { categoryId: 'a', remainingMinor: 0n, rollover: true },
        { categoryId: 'b', remainingMinor: -500n, rollover: false },
        { categoryId: 'c', remainingMinor: 200n, rollover: false },
      ]),
    ).toEqual({ rollovers: [], leftoverMinor: 0n });
    expect(closeProposals([])).toEqual({ rollovers: [], leftoverMinor: 0n });
  });
});

describe('averageSpend (FR-B1)', () => {
  it('averages the periods, rounded up to the step', () => {
    expect(averageSpend([1_000_001n, 2_000_000n, 3_000_000n], 1_000n)).toBe(2_001_000n);
    expect(averageSpend([3_000n, 3_000n, 3_000n], 1_000n)).toBe(3_000n);
    expect(averageSpend([4_000n, 2_000n], 1_000n)).toBe(3_000n);
    expect(averageSpend([7n], 1n)).toBe(7n);
    expect(averageSpend([], 1_000n)).toBe(0n);
  });
});

describe('savingRateBps', () => {
  it('golden: Oktober 26.000.000 − 16.500.000 = 36,5%, September 25.800.000 − 18.300.000 = 29,1%', () => {
    expect(savingRateBps(26_000_000n, 16_500_000n)).toBe(3_654);
    expect(savingRateBps(25_800_000n, 18_300_000n)).toBe(2_907);
  });

  it('is negative when spending exceeds income and null without income', () => {
    expect(savingRateBps(1_000n, 1_500n)).toBe(-5_000);
    expect(savingRateBps(0n, 1_500n)).toBeNull();
  });
});
