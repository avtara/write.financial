// SPDX-License-Identifier: AGPL-3.0-only
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { BUILT_IN_CATEGORIES, type BuiltInCategoryKey, type CategoryGroup } from './categories.ts';
import {
  changeBps,
  customRanges,
  monthRanges,
  moneyFlow,
  rangeSummary,
  weekRanges,
  weekStartOf,
  yearRanges,
  type MoneyFlow,
  type MoneyFlowInput,
} from './dashboard.ts';
import { addDays, parseLocalDate as d, periodFor, periodStartDay, periodsBetween, type LocalDate } from './period.ts';
import { DESIGN_SEED } from './seed.ts';

const GROUP = new Map<BuiltInCategoryKey, CategoryGroup>(
  BUILT_IN_CATEGORIES.map((category) => [category.key, category.group]),
);
const range = (from: string, to: string) => ({ from: d(from), to: d(to) });
const utcWeekday = (date: LocalDate): number => new Date(`${date}T00:00:00Z`).getUTCDay();

describe('weekStartOf', () => {
  it('starts the week on Monday or Sunday', () => {
    expect(weekStartOf(d('2026-10-15'), 'monday')).toBe('2026-10-12');
    expect(weekStartOf(d('2026-10-15'), 'sunday')).toBe('2026-10-11');
    expect(weekStartOf(d('2026-10-12'), 'monday')).toBe('2026-10-12');
    expect(weekStartOf(d('2026-10-11'), 'monday')).toBe('2026-10-05');
    expect(weekStartOf(d('2026-10-11'), 'sunday')).toBe('2026-10-11');
    expect(weekStartOf(d('2026-10-17'), 'sunday')).toBe('2026-10-11');
    expect(weekStartOf(d('1969-12-31'), 'monday')).toBe('1969-12-29');
    expect(weekStartOf(d('1970-01-01'), 'sunday')).toBe('1969-12-28');
  });

  it('is the matching weekday at most 6 days before, before and after 1970', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -100_000, max: 100_000 }).map((offset) => addDays(d('1970-01-01'), offset)),
        fc.constantFrom('monday' as const, 'sunday' as const),
        (date, weekStart) => {
          const start = weekStartOf(date, weekStart);
          expect(utcWeekday(start)).toBe(weekStart === 'monday' ? 1 : 0);
          expect(start <= date).toBe(true);
          expect(addDays(start, 6) >= date).toBe(true);
        },
      ),
    );
  });
});

describe('weekRanges (FR-D1 Week)', () => {
  it('golden: 15 Okt (Kamis) shows 12–18 Okt, so far 12–15 Okt vs Sen–Kam lalu 5–8 Okt', () => {
    expect(weekRanges(d('2026-10-15'), 'monday')).toEqual({
      full: range('2026-10-12', '2026-10-18'),
      current: range('2026-10-12', '2026-10-15'),
      previous: range('2026-10-05', '2026-10-08'),
    });
  });

  it('starts on Sunday 11 Okt with a Sunday week start', () => {
    expect(weekRanges(d('2026-10-15'), 'sunday')).toEqual({
      full: range('2026-10-11', '2026-10-17'),
      current: range('2026-10-11', '2026-10-15'),
      previous: range('2026-10-04', '2026-10-08'),
    });
  });
});

describe('monthRanges (FR-D1 Month)', () => {
  const october = periodFor(d('2026-10-15'), periodStartDay(1));
  const september = periodFor(d('2026-09-15'), periodStartDay(1));

  it('golden: 1–15 Okt vs the whole of September 1–30 Sep', () => {
    expect(monthRanges(october, september, d('2026-10-15'))).toEqual({
      full: range('2026-10-01', '2026-10-31'),
      current: range('2026-10-01', '2026-10-15'),
      previous: range('2026-09-01', '2026-09-30'),
    });
  });

  it('stops at the period end for a past period', () => {
    expect(monthRanges(september, periodFor(d('2026-08-15'), periodStartDay(1)), d('2026-10-15'))).toEqual({
      full: range('2026-09-01', '2026-09-30'),
      current: range('2026-09-01', '2026-09-30'),
      previous: range('2026-08-01', '2026-08-31'),
    });
  });
});

describe('yearRanges (FR-D1 Year)', () => {
  it('golden: 2026 so far vs the same days of 2025', () => {
    expect(yearRanges(2026, periodStartDay(1), d('2026-10-15'))).toEqual({
      full: range('2026-01-01', '2026-12-31'),
      current: range('2026-01-01', '2026-10-15'),
      previous: range('2025-01-01', '2025-10-15'),
    });
  });

  it('starts on 25 Des 2025 with start day 25', () => {
    expect(yearRanges(2026, periodStartDay(25), d('2026-10-15'))).toEqual({
      full: range('2025-12-25', '2026-12-24'),
      current: range('2025-12-25', '2026-10-15'),
      previous: range('2024-12-25', '2025-10-15'),
    });
  });

  it('compares a past year in full and pads years before 1000', () => {
    expect(yearRanges(2025, periodStartDay(1), d('2026-10-15'))).toEqual({
      full: range('2025-01-01', '2025-12-31'),
      current: range('2025-01-01', '2025-12-31'),
      previous: range('2024-01-01', '2024-12-31'),
    });
    expect(yearRanges(999, periodStartDay(1), d('2026-10-15'))).toEqual({
      full: range('0999-01-01', '0999-12-31'),
      current: range('0999-01-01', '0999-12-31'),
      previous: range('0998-01-01', '0998-12-31'),
    });
  });

  it('compares up to the same calendar day a year earlier across leap years', () => {
    expect(yearRanges(2025, periodStartDay(1), d('2025-03-01')).previous).toEqual(range('2024-01-01', '2024-03-01'));
    expect(yearRanges(2028, periodStartDay(1), d('2028-02-29')).previous).toEqual(range('2027-01-01', '2027-02-28'));
    expect(yearRanges(2028, periodStartDay(1), d('2028-12-29')).previous).toEqual(range('2027-01-01', '2027-12-29'));
    // Start day 25: 28 Des 2025 already belongs to the year 2026.
    expect(yearRanges(2026, periodStartDay(25), d('2025-12-28')).previous).toEqual(range('2024-12-25', '2024-12-28'));
  });
});

describe('customRanges (FR-S7)', () => {
  it('golden: 14 Sep – 13 Okt vs the 30 days before, 15 Agu – 13 Sep', () => {
    const custom = range('2026-09-14', '2026-10-13');
    expect(customRanges(custom)).toEqual({
      full: custom,
      current: custom,
      previous: range('2026-08-15', '2026-09-13'),
    });
    expect(customRanges(range('2026-10-15', '2026-10-15')).previous).toEqual(range('2026-10-14', '2026-10-14'));
  });
});

describe('rangeSummary (FR-S7)', () => {
  it('golden: 14 Sep – 13 Okt is "30 hari · melintasi 2 periode"', () => {
    const custom = range('2026-09-14', '2026-10-13');
    expect(rangeSummary(custom, periodsBetween(custom.from, custom.to, periodStartDay(1)))).toEqual({
      days: 30,
      periodCount: 2,
    });
  });

  it('counts periods touching either end and ignores the rest', () => {
    const periods = [
      range('2026-08-01', '2026-09-13'),
      range('2026-08-01', '2026-09-14'),
      range('2026-10-13', '2026-10-31'),
      range('2026-10-14', '2026-10-31'),
      range('2026-09-20', '2026-09-25'),
    ].map(({ from, to }) => ({ start: from, end: to }));
    expect(rangeSummary(range('2026-09-14', '2026-10-13'), periods)).toEqual({ days: 30, periodCount: 3 });
  });
});

describe('changeBps', () => {
  it('golden: expense 16,5 jt vs 18,3 jt = −9,8%; saved 9,5 jt vs 7,5 jt = +26,7%', () => {
    expect(changeBps(16_500_000n, 18_300_000n)).toBe(-984);
    expect(changeBps(9_500_000n, 7_500_000n)).toBe(2_667);
  });

  it('golden: income 26,0 jt vs 25,8 jt = +0,8%', () => {
    // The design's dashboard shows "+4,1%", which contradicts its own "Laporan September 2026" (Rp25.800.000).
    expect(changeBps(26_000_000n, 25_800_000n)).toBe(78);
  });

  it('is null without a positive previous value', () => {
    expect(changeBps(5n, 0n)).toBeNull();
    expect(changeBps(0n, 5n)).toBe(-10_000);
  });
});

/** The October seed as money-flow input: per income category, per expense category, per transfer destination. */
function octoberFlowInput(): MoneyFlowInput {
  const incomes = new Map<string, bigint>();
  const expenses = new Map<BuiltInCategoryKey, bigint>();
  const transfers = new Map<string, bigint>();
  const add = <K>(map: Map<K, bigint>, key: K, amount: bigint) => map.set(key, (map.get(key) ?? 0n) + amount);
  for (const transaction of DESIGN_SEED.transactions) {
    if (transaction.kind === 'transfer') add(transfers, transaction.toAccountKey, transaction.sentMinor);
    else if (transaction.kind === 'income') add(incomes, transaction.categoryKey, transaction.amountMinor);
    else add(expenses, transaction.categoryKey, transaction.amountMinor);
  }
  return {
    incomes: [...incomes].map(([categoryId, amountMinor]) => ({ categoryId, amountMinor })),
    expenses: [...expenses].map(([categoryId, amountMinor]) => ({
      categoryId,
      group: GROUP.get(categoryId) ?? 'other',
      amountMinor,
    })),
    transfers: [...transfers].map(([accountId, amountMinor]) => ({ accountId, amountMinor })),
  };
}

const node = (flow: MoneyFlow, id: string) => flow.nodes.find((candidate) => candidate.id === id);
const ids = (flow: MoneyFlow) => flow.nodes.map((candidate) => candidate.id);

/** Links join existing nodes; inflow equals outflow for every node with both; values are inflows (outflows for sources). */
function expectBalanced(flow: MoneyFlow): void {
  const inflow = new Map<string, bigint>();
  const outflow = new Map<string, bigint>();
  const nodeIds = ids(flow);
  for (const link of flow.links) {
    expect(link.valueMinor).toBeGreaterThan(0n);
    expect(nodeIds).toContain(link.from);
    expect(nodeIds).toContain(link.to);
    inflow.set(link.to, (inflow.get(link.to) ?? 0n) + link.valueMinor);
    outflow.set(link.from, (outflow.get(link.from) ?? 0n) + link.valueMinor);
  }
  for (const { id, column, valueMinor } of flow.nodes) {
    expect(valueMinor).toBe((column === 0 ? outflow : inflow).get(id));
    if (column !== 0 && outflow.has(id)) expect(outflow.get(id)).toBe(inflow.get(id));
  }
  const columns = flow.nodes.map((candidate) => candidate.column);
  expect(columns).toEqual([...columns].sort());
}

describe('moneyFlow (FR-D2)', () => {
  it('golden: Oktober income 26 jt → Needs 40%, Wants 23,5%, Tabungan 36,5%; dividend (0,8%) merges into other', () => {
    const flow = moneyFlow(octoberFlowInput(), { showSmallSources: false, countTransfers: false });
    expect(flow).toMatchObject({ incomeMinor: 26_000_000n, expenseMinor: 16_500_000n, savedMinor: 9_500_000n });
    expect(node(flow, 'source:system:dividend_interest')).toBeUndefined();
    expect(node(flow, 'source:other')).toEqual({ id: 'source:other', column: 0, valueMinor: 210_000n, shareBps: 81 });
    expect(node(flow, 'source:system:sales')).toMatchObject({ valueMinor: 1_090_000n, shareBps: 419 });
    expect(node(flow, 'total')).toEqual({ id: 'total', column: 1, valueMinor: 26_000_000n, shareBps: 10_000 });
    expect(node(flow, 'group:needs')).toEqual({
      id: 'group:needs',
      column: 2,
      valueMinor: 10_400_000n,
      shareBps: 4_000,
    });
    expect(node(flow, 'group:wants')).toMatchObject({ valueMinor: 6_100_000n, shareBps: 2_346 });
    expect(node(flow, 'group:savings')).toMatchObject({ column: 2, valueMinor: 9_500_000n, shareBps: 3_654 });
    expect(node(flow, 'category:system:rent')).toMatchObject({ column: 3, valueMinor: 4_500_000n, shareBps: 1_731 });
    expect(node(flow, 'source:deficit')).toBeUndefined();
    expect(ids(flow).filter((id) => id.startsWith('account:') || id === 'unallocated')).toEqual([]);
    expectBalanced(flow);
  });

  it('golden: shows the dividend source with "Tampilkan sumber < 1%"', () => {
    const flow = moneyFlow(octoberFlowInput(), { showSmallSources: true, countTransfers: false });
    expect(node(flow, 'source:system:dividend_interest')).toMatchObject({ column: 0, valueMinor: 210_000n });
    expect(node(flow, 'source:other')).toBeUndefined();
    expectBalanced(flow);
  });

  it('golden: with transfers Tabungan splits into Gotrade 6 jt, Jago 500 rb, Bibit 3 jt, nothing unallocated', () => {
    const flow = moneyFlow(octoberFlowInput(), { showSmallSources: false, countTransfers: true });
    expect(flow.nodes.filter((candidate) => candidate.column === 3 && !candidate.id.startsWith('category:'))).toEqual([
      { id: 'account:gotrade', column: 3, valueMinor: 6_000_000n, shareBps: 2_308 },
      { id: 'account:jago', column: 3, valueMinor: 500_000n, shareBps: 192 },
      { id: 'account:bibit', column: 3, valueMinor: 3_000_000n, shareBps: 1_154 },
    ]);
    expect(node(flow, 'unallocated')).toBeUndefined();
    expectBalanced(flow);
  });

  it('caps transfers at the savings and leaves the rest unallocated', () => {
    const base = {
      incomes: [{ categoryId: 'salary', amountMinor: 1_000n }],
      expenses: [{ categoryId: 'food', group: 'needs' as const, amountMinor: 500n }],
    };
    const capped = moneyFlow(
      {
        ...base,
        transfers: [
          { accountId: 'a', amountMinor: 300n },
          { accountId: 'b', amountMinor: 400n },
          { accountId: 'c', amountMinor: 100n },
        ],
      },
      { showSmallSources: true, countTransfers: true },
    );
    expect(capped.links.filter((link) => link.from === 'group:savings')).toEqual([
      { from: 'group:savings', to: 'account:a', valueMinor: 300n },
      { from: 'group:savings', to: 'account:b', valueMinor: 200n },
    ]);
    expectBalanced(capped);
    const partial = moneyFlow(
      { ...base, transfers: [{ accountId: 'a', amountMinor: 100n }] },
      { showSmallSources: true, countTransfers: true },
    );
    expect(partial.links.filter((link) => link.from === 'group:savings')).toEqual([
      { from: 'group:savings', to: 'account:a', valueMinor: 100n },
      { from: 'group:savings', to: 'unallocated', valueMinor: 400n },
    ]);
    expect(node(partial, 'unallocated')).toEqual({ id: 'unallocated', column: 3, valueMinor: 400n, shareBps: 4_000 });
    expectBalanced(partial);
  });

  it('adds a deficit source when spending exceeds income; uncategorized amounts and equal groups accumulate', () => {
    const flow = moneyFlow(
      {
        incomes: [
          { categoryId: null, amountMinor: 600n },
          { categoryId: null, amountMinor: 400n },
        ],
        expenses: [
          { categoryId: 'food', group: 'needs', amountMinor: 900n },
          { categoryId: null, group: 'needs', amountMinor: 300n },
          { categoryId: null, group: 'wants', amountMinor: 300n },
          { categoryId: 'gifts', group: 'other', amountMinor: 0n },
        ],
        transfers: [{ accountId: 'a', amountMinor: 100n }],
      },
      { showSmallSources: false, countTransfers: true },
    );
    expect(flow).toMatchObject({ incomeMinor: 1_000n, expenseMinor: 1_500n, savedMinor: 0n });
    expect(flow.nodes).toEqual([
      { id: 'source:uncategorized', column: 0, valueMinor: 1_000n, shareBps: 6_667 },
      { id: 'source:deficit', column: 0, valueMinor: 500n, shareBps: 3_333 },
      { id: 'total', column: 1, valueMinor: 1_500n, shareBps: 10_000 },
      { id: 'group:needs', column: 2, valueMinor: 1_200n, shareBps: 8_000 },
      { id: 'group:wants', column: 2, valueMinor: 300n, shareBps: 2_000 },
      { id: 'category:food', column: 3, valueMinor: 900n, shareBps: 6_000 },
      { id: 'category:uncategorized', column: 3, valueMinor: 600n, shareBps: 4_000 },
    ]);
    expectBalanced(flow);
  });

  it('merges sources below 1% only (exactly 1% stays its own source)', () => {
    const flow = (amounts: readonly bigint[]) =>
      ids(
        moneyFlow(
          {
            incomes: amounts.map((amountMinor, index) => ({ categoryId: `i${index}`, amountMinor })),
            expenses: [],
            transfers: [],
          },
          { showSmallSources: false, countTransfers: false },
        ),
      );
    expect(flow([9_900n, 100n])).toEqual(['source:i0', 'source:i1', 'total', 'group:savings']);
    expect(flow([9_901n, 99n])).toEqual(['source:i0', 'source:other', 'total', 'group:savings']);
    expect(flow([9_901n, 50n, 49n])).toEqual(['source:i0', 'source:other', 'total', 'group:savings']);
  });

  it('is empty without amounts and has no share without a flow', () => {
    expect(
      moneyFlow({ incomes: [], expenses: [], transfers: [] }, { showSmallSources: true, countTransfers: true }),
    ).toEqual({ nodes: [], links: [], incomeMinor: 0n, expenseMinor: 0n, savedMinor: 0n });
    // A negative (refund-like) income with no flow: the deficit is shown without a share.
    const negative = moneyFlow(
      { incomes: [{ categoryId: 'x', amountMinor: -5n }], expenses: [], transfers: [] },
      { showSmallSources: true, countTransfers: false },
    );
    expect(negative.nodes).toEqual([
      { id: 'source:deficit', column: 0, valueMinor: 5n, shareBps: 0 },
      { id: 'total', column: 1, valueMinor: 5n, shareBps: 0 },
    ]);
  });

  it('every node balances inflow and outflow', () => {
    const amount = fc.bigInt({ min: 0n, max: 10n ** 10n });
    fc.assert(
      fc.property(
        fc.array(fc.record({ categoryId: fc.option(fc.constantFrom('a', 'b', 'c')), amountMinor: amount })),
        fc.array(
          fc.record({
            categoryId: fc.option(fc.constantFrom('a', 'b', 'c')),
            group: fc.constantFrom<CategoryGroup>('needs', 'wants', 'other'),
            amountMinor: amount,
          }),
        ),
        fc.array(fc.record({ accountId: fc.constantFrom('x', 'y'), amountMinor: amount })),
        fc.boolean(),
        fc.boolean(),
        (incomes, expenses, transfers, showSmallSources, countTransfers) => {
          const flow = moneyFlow({ incomes, expenses, transfers }, { showSmallSources, countTransfers });
          expectBalanced(flow);
          const total = node(flow, 'total')?.valueMinor ?? 0n;
          expect(total).toBe(flow.incomeMinor > flow.expenseMinor ? flow.incomeMinor : flow.expenseMinor);
          expect(flow.savedMinor).toBe(total - flow.expenseMinor);
        },
      ),
    );
  });
});
