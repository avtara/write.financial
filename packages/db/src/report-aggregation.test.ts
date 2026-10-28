// SPDX-License-Identifier: AGPL-3.0-only
import type { DateRange } from '@wf/domain/dashboard';
import type { LocalDate } from '@wf/domain/period';
import { reportTotals } from '@wf/domain/report';
import { describe, expect, it } from 'vitest';
import { aggregateReports, type ReportSegment } from './report-aggregation.ts';
import type { ReportNetWorth, ReportSections } from './reports.ts';

const august: DateRange = { from: '2026-08-01' as LocalDate, to: '2026-08-31' as LocalDate };
const september: DateRange = { from: '2026-09-01' as LocalDate, to: '2026-09-30' as LocalDate };
const range: DateRange = { from: august.from, to: september.to };
const worth = (valueMinor: bigint): ReportNetWorth => ({
  valueMinor,
  cashMinor: valueMinor,
  investmentsMinor: 0n,
  debtMinor: 0n,
  missingPortfolio: false,
  unvaluedCurrencies: [],
  asOf: september.to,
});
function segment(
  range: DateRange,
  incomeMinor: bigint,
  expenseMinor: bigint,
  override: Partial<ReportSections> = {},
): ReportSegment {
  return {
    range,
    totals: reportTotals({
      incomeMinor,
      expenseMinor,
      txCount: 1,
      netWorthMinor: override.netWorth?.valueMinor ?? null,
    }),
    sections: {
      categories: [],
      incomeSources: [],
      merchants: [],
      tags: [],
      accounts: [],
      goals: [],
      goalsAsOf: null,
      largest: [],
      largestShareBps: null,
      subscriptions: { active: 0, monthlyMinor: 0n, yearlyMinor: 0n, shareBps: null, unconverted: 0 },
      days: [{ date: range.from, outMinor: expenseMinor }],
      averageDailyMinor: 0n,
      busiestWeek: null,
      netWorth: null,
      netWorthHistory: [],
      ...override,
    },
  };
}

describe('monthly snapshot aggregation', () => {
  it('recomputes rates, budget usage and rankings from sums, but carries only the latest stock values', () => {
    const first = segment(august, 200n, 100n, {
      incomeSources: [{ categoryId: 'salary', name: 'Salary', group: 'active', totalMinor: 200n, shareBps: 10_000 }],
      categories: [
        {
          categoryId: 'food',
          name: 'Food',
          group: 'needs',
          isFixed: false,
          spentMinor: 100n,
          limitMinor: 200n,
          shareBps: 10_000,
          usedBps: 5_000,
          overMinor: 0n,
        },
      ],
      merchants: [
        { merchant: 'Shared', totalMinor: 10n, count: 1, shareBps: 1_000 },
        { merchant: 'August', totalMinor: 90n, count: 2, shareBps: 9_000 },
      ],
      tags: [{ tagId: 'food', name: 'food', totalMinor: 100n, count: 3 }],
      accounts: [{ accountId: 'bank', name: 'Bank', type: 'bank', inMinor: 200n, outMinor: 100n }],
      goals: [
        {
          goalId: 'reserve',
          name: 'Reserve',
          currency: 'IDR',
          valuation: 'cash',
          openingMinor: 100n,
          savedMinor: 250n,
          targetMinor: 1_000n,
          progressBps: 2_500,
        },
      ],
      netWorth: worth(10_000n),
    });
    const second = segment(september, 600n, 400n, {
      incomeSources: [
        { categoryId: 'salary', name: 'Salary', group: 'active', totalMinor: 400n, shareBps: 6_666 },
        { categoryId: 'freelance', name: 'Freelance', group: 'active', totalMinor: 200n, shareBps: 3_333 },
      ],
      categories: [
        {
          categoryId: 'food',
          name: 'Food',
          group: 'needs',
          isFixed: false,
          spentMinor: 400n,
          limitMinor: 300n,
          shareBps: 10_000,
          usedBps: 13_333,
          overMinor: 100n,
        },
      ],
      merchants: [
        { merchant: 'Shared', totalMinor: 250n, count: 4, shareBps: 6_250 },
        { merchant: 'September', totalMinor: 150n, count: 1, shareBps: 3_750 },
      ],
      tags: [{ tagId: 'food', name: 'food', totalMinor: 400n, count: 4 }],
      accounts: [{ accountId: 'bank', name: 'Bank', type: 'bank', inMinor: 600n, outMinor: 400n }],
      goals: [
        {
          goalId: 'reserve',
          name: 'Reserve',
          currency: 'IDR',
          valuation: 'cash',
          openingMinor: 250n,
          savedMinor: 300n,
          targetMinor: 1_000n,
          progressBps: 3_000,
        },
      ],
      netWorth: worth(12_000n),
    });
    const result = aggregateReports([first, second], range);
    expect(result.totals).toMatchObject({
      incomeMinor: 800n,
      expenseMinor: 500n,
      savedMinor: 300n,
      savingRateBps: 3_750,
      netWorthMinor: 12_000n,
    });
    expect(result.sections.categories).toEqual([
      {
        categoryId: 'food',
        name: 'Food',
        group: 'needs',
        isFixed: false,
        spentMinor: 500n,
        limitMinor: 500n,
        shareBps: 10_000,
        usedBps: 10_000,
        overMinor: 0n,
      },
    ]);
    expect(result.sections.incomeSources.map(({ totalMinor, shareBps }) => ({ totalMinor, shareBps }))).toEqual([
      { totalMinor: 600n, shareBps: 7_500 },
      { totalMinor: 200n, shareBps: 2_500 },
    ]);
    expect(
      result.sections.merchants.map(({ totalMinor, count, shareBps }) => ({ totalMinor, count, shareBps })),
    ).toEqual([
      { totalMinor: 260n, count: 5, shareBps: 5_200 },
      { totalMinor: 150n, count: 1, shareBps: 3_000 },
      { totalMinor: 90n, count: 2, shareBps: 1_800 },
    ]);
    expect(result.sections.tags).toEqual([{ tagId: 'food', name: 'food', totalMinor: 500n, count: 7 }]);
    expect(result.sections.accounts).toEqual([
      { accountId: 'bank', name: 'Bank', type: 'bank', inMinor: 800n, outMinor: 500n },
    ]);
    expect(result.sections.goals[0]?.savedMinor).toBe(300n);
    expect(result.sections.goals[0]?.openingMinor).toBe(100n);
    expect(result.sections.averageDailyMinor).toBe(8n);
    expect(result.sections.busiestWeek).toEqual({ from: '2026-08-26', to: '2026-09-01', totalMinor: 400n });
  });

  it('selects the global six largest transactions, not six from each month', () => {
    const items = (start: number, date: LocalDate) =>
      Array.from({ length: 6 }, (_, index) => ({
        transactionId: `${start + index}`,
        date,
        description: 'Expense',
        merchant: null,
        amountMinor: BigInt(start + index),
        shareBps: 0,
      }));
    const result = aggregateReports(
      [
        segment(august, 100n, 21n, { largest: items(1, august.from) }),
        segment(september, 100n, 57n, { largest: items(7, september.from) }),
      ],
      range,
    );
    expect(result.sections.largest.map(({ amountMinor }) => amountMinor)).toEqual([12n, 11n, 10n, 9n, 8n, 7n]);
    expect(result.sections.largestShareBps).toBe(7_307);
  });

  it('does not turn missing budget data into a zero limit or divide by zero without spending', () => {
    const line = {
      categoryId: null,
      name: null,
      group: null,
      isFixed: null,
      spentMinor: 0n,
      limitMinor: 0n,
      shareBps: 0,
      usedBps: null,
      overMinor: 0n,
    };
    const result = aggregateReports(
      [
        segment(august, 0n, 0n, { categories: [line] }),
        segment(september, 0n, 0n, { categories: [{ ...line, limitMinor: null }] }),
      ],
      range,
    );
    expect(result.sections.categories).toEqual([{ ...line, limitMinor: null }]);
    expect(result.totals.savingRateBps).toBeNull();
    expect(result.sections.largestShareBps).toBeNull();
    expect(result.sections.busiestWeek).toBeNull();
    expect(result.sections.subscriptions.shareBps).toBeNull();
  });

  it('keeps tied rankings deterministic and never carries a goal opening across a currency change', () => {
    const ids = ['b', 'z', 'a', null, 'c'];
    const amounts = [2n, 1n, 3n, 2n, 2n];
    const categories = ids.map((categoryId, index) => ({
      categoryId,
      name: categoryId,
      group: null,
      isFixed: null,
      spentMinor: amounts[index] as bigint,
      limitMinor: null,
      shareBps: 0,
      usedBps: null,
      overMinor: 0n,
    }));
    const goal = {
      goalId: 'reserve',
      name: 'Reserve',
      currency: 'IDR',
      valuation: 'cash' as const,
      openingMinor: 100n,
      savedMinor: 200n,
      targetMinor: 1000n,
      progressBps: 2000,
    };
    const result = aggregateReports(
      [
        segment(august, 0n, 0n, { goals: [goal] }),
        segment(september, 0n, 10n, {
          categories,
          incomeSources: categories.map((row) => ({
            categoryId: row.categoryId,
            name: row.name,
            group: null,
            totalMinor: row.spentMinor,
            shareBps: 0,
          })),
          tags: categories
            .filter((row) => row.categoryId !== null)
            .map((row) => ({
              tagId: row.categoryId as string,
              name: row.name as string,
              totalMinor: row.spentMinor,
              count: 1,
            })),
          accounts: [
            { accountId: 'z', name: 'Bank', type: 'bank', inMinor: 0n, outMinor: 1n },
            { accountId: 'a', name: 'Bank', type: 'bank', inMinor: 0n, outMinor: 2n },
          ],
          goals: [
            { ...goal, currency: 'USD' },
            { ...goal, goalId: 'new' },
          ],
        }),
      ],
      range,
    );
    expect(result.sections.categories.map((row) => row.categoryId)).toEqual(['a', null, 'b', 'c', 'z']);
    expect(result.sections.incomeSources.map((row) => [row.categoryId, row.shareBps])).toEqual([
      ['a', 0],
      [null, 0],
      ['b', 0],
      ['c', 0],
      ['z', 0],
    ]);
    expect(result.sections.tags.map((row) => row.tagId)).toEqual(['a', 'b', 'c', 'z']);
    expect(result.sections.accounts.map((row) => row.accountId)).toEqual(['a', 'z']);
    expect(result.sections.goals.map((row) => row.openingMinor)).toEqual([null, null]);
  });

  it('ranks an uncategorized line first on a tie, whichever segment order produced it', () => {
    const line = (categoryId: string | null) => ({
      categoryId,
      name: categoryId,
      group: null,
      isFixed: null,
      spentMinor: 5n,
      limitMinor: null,
      shareBps: 0,
      usedBps: null,
      overMinor: 0n,
    });
    for (const ids of [
      ['food', null],
      [null, 'food'],
    ]) {
      const categories = ids.map(line);
      const incomeSources = ids.map((categoryId) => ({
        categoryId,
        name: categoryId,
        group: null,
        totalMinor: 5n,
        shareBps: 0,
      }));
      const result = aggregateReports([segment(september, 10n, 10n, { categories, incomeSources })], september);
      expect(result.sections.categories.map((row) => row.categoryId)).toEqual([null, 'food']);
      expect(result.sections.incomeSources.map((row) => row.categoryId)).toEqual([null, 'food']);
    }
  });

  it('refuses an aggregate without any covered segment', () => {
    expect(() => aggregateReports([], range)).toThrow(RangeError);
  });
});
