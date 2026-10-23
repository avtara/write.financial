// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import type { LocalDate } from './period.ts';
import {
  busiestWeek,
  combineMonths,
  dailyAverageMinor,
  previousRange,
  quarterOf,
  quarterRange,
  reportTotals,
  shareLines,
  statusOf,
  topShareBps,
  totalsDelta,
  yearRange,
} from './report.ts';

/** The design's September report (25.800.000 / 18.300.000 / +7.500.000 / 29,1% / Rp112.200.000). */
const SEPTEMBER = reportTotals({
  incomeMinor: 25_800_000n,
  expenseMinor: 18_300_000n,
  txCount: 121,
  netWorthMinor: 112_200_000n,
});

const AUGUST = reportTotals({ incomeMinor: 24_900_000n, expenseMinor: 16_900_000n, txCount: 118 });

describe('report totals', () => {
  it('derives the saved amount and the savings rate from the flows', () => {
    expect(SEPTEMBER).toEqual({
      incomeMinor: 25_800_000n,
      expenseMinor: 18_300_000n,
      savedMinor: 7_500_000n,
      savingRateBps: 2907,
      txCount: 121,
      netWorthMinor: 112_200_000n,
    });
  });

  it('has no rate and no net worth when income is zero or the range was not valued', () => {
    expect(reportTotals({ incomeMinor: 0n, expenseMinor: 500_000n, txCount: 2 })).toEqual({
      incomeMinor: 0n,
      expenseMinor: 500_000n,
      savedMinor: -500_000n,
      savingRateBps: null,
      txCount: 2,
      netWorthMinor: null,
    });
  });

  it('compares like for like: relative changes, and the savings rate in points', () => {
    expect(totalsDelta(SEPTEMBER, AUGUST)).toEqual({
      incomeBps: 361,
      expenseBps: 828,
      savedBps: -625,
      // The design shows "−3,0 poin" from its rounded 32,1% and 29,1%; the exact rates differ by 3,06 points.
      savingRatePoints: -306,
    });
  });

  it('has no comparison for a first report, and only where both rates exist', () => {
    expect(totalsDelta(SEPTEMBER, null)).toBeNull();
    const noIncome = reportTotals({ incomeMinor: 0n, expenseMinor: 1n, txCount: 1 });
    expect(totalsDelta(SEPTEMBER, noIncome)?.savingRatePoints).toBeNull();
    expect(totalsDelta(noIncome, SEPTEMBER)?.savingRatePoints).toBeNull();
  });
});

describe('rankings and daily figures', () => {
  it('shares every line of a total (rounded down)', () => {
    expect(
      shareLines(
        [
          { key: 'sewa', totalMinor: 4_500_000n },
          { key: 'online', totalMinor: 2_600_000n },
          { key: 'lain', totalMinor: 1n },
        ],
        18_300_000n,
      ),
    ).toEqual([
      { key: 'sewa', totalMinor: 4_500_000n, shareBps: 2459 },
      { key: 'online', totalMinor: 2_600_000n, shareBps: 1420 },
      { key: 'lain', totalMinor: 1n, shareBps: 0 },
    ]);
    expect(shareLines([{ key: 'a', totalMinor: 0n }], 0n)).toEqual([{ key: 'a', totalMinor: 0n, shareBps: 0 }]);
  });

  it('averages the daily spending over the days of the range', () => {
    expect(dailyAverageMinor(18_300_000n, { from: '2026-09-01' as LocalDate, to: '2026-09-30' as LocalDate })).toBe(
      610_000n,
    );
    expect(dailyAverageMinor(1n, { from: '2026-09-30' as LocalDate, to: '2026-09-01' as LocalDate })).toBe(0n);
  });

  it('finds the most expensive seven consecutive days', () => {
    const days = [
      { date: '2026-09-01' as LocalDate, outMinor: 100_000n },
      { date: '2026-09-02' as LocalDate, outMinor: 100_000n },
      { date: '2026-09-07' as LocalDate, outMinor: 5_200_000n },
      { date: '2026-09-08' as LocalDate, outMinor: 1_000_000n },
      { date: '2026-09-13' as LocalDate, outMinor: 200_000n },
      { date: '2026-09-14' as LocalDate, outMinor: 50_000n },
    ];
    expect(busiestWeek(days)).toEqual({
      from: '2026-09-07' as LocalDate,
      to: '2026-09-13' as LocalDate,
      // 07 + 08 + 13: 5.200.000 + 1.000.000 + 200.000.
      totalMinor: 6_400_000n,
    });
    expect(busiestWeek([])).toBeNull();
    expect(busiestWeek([{ date: '2026-09-01' as LocalDate, outMinor: 0n }])).toBeNull();
  });

  it('shares the largest transactions of the spending ("6 transaksi = 40%")', () => {
    const rows = [{ amountMinor: 4_500_000n }, { amountMinor: 2_600_000n }, { amountMinor: 220_000n }];
    expect(topShareBps(rows, 2, 18_300_000n)).toBe(3879);
    expect(topShareBps(rows, 6, 18_300_000n)).toBe(4000);
    expect(topShareBps(rows, 6, 0n)).toBeNull();
  });
});

describe('quarters, years, and aggregation', () => {
  it('maps a month to its calendar quarter and back', () => {
    expect(['2026-01', '2026-03', '2026-04', '2026-06', '2026-07', '2026-09', '2026-10', '2026-12'].map(quarterOf)).toEqual([
      1, 1, 2, 2, 3, 3, 4, 4,
    ]);
    expect(quarterRange(2026, 1)).toEqual({ from: '2026-01-01', to: '2026-03-31' });
    expect(quarterRange(2026, 2)).toEqual({ from: '2026-04-01', to: '2026-06-30' });
    expect(quarterRange(2026, 3)).toEqual({ from: '2026-07-01', to: '2026-09-30' });
    expect(quarterRange(2026, 4)).toEqual({ from: '2026-10-01', to: '2026-12-31' });
    expect(yearRange(2025)).toEqual({ from: '2025-01-01', to: '2025-12-31' });
  });

  it('adds the months up and recomputes the savings rate instead of averaging it', () => {
    const july = reportTotals({ incomeMinor: 10_000_000n, expenseMinor: 9_000_000n, txCount: 10, netWorthMinor: 1n });
    const august = reportTotals({ incomeMinor: 10_000_000n, expenseMinor: 1_000_000n, txCount: 5, netWorthMinor: 2n });
    expect(
      combineMonths([
        { range: { from: '2026-08-01' as LocalDate, to: '2026-08-31' as LocalDate }, totals: august },
        { range: { from: '2026-07-01' as LocalDate, to: '2026-07-31' as LocalDate }, totals: july },
      ]),
    ).toEqual({
      incomeMinor: 20_000_000n,
      expenseMinor: 10_000_000n,
      savedMinor: 10_000_000n,
      savingRateBps: 5000,
      txCount: 15,
      // The month that ends last ("per 31 Agu").
      netWorthMinor: 2n,
    });
    expect(combineMonths([])).toBeNull();
  });

  it('compares with the same number of days before the range', () => {
    expect(previousRange({ from: '2026-09-01' as LocalDate, to: '2026-09-30' as LocalDate })).toEqual({
      from: '2026-08-02',
      to: '2026-08-31',
    });
    // 31 days before March end: 29 Jan – 28 Feb.
    expect(previousRange({ from: '2026-03-01' as LocalDate, to: '2026-03-31' as LocalDate })).toEqual({
      from: '2026-01-29',
      to: '2026-02-28',
    });
  });

  it('marks a range that ended before today final and one that includes today provisional', () => {
    const today = '2026-10-15' as LocalDate;
    expect(statusOf({ from: '2026-09-01' as LocalDate, to: '2026-09-30' as LocalDate }, today)).toBe('final');
    expect(statusOf({ from: '2026-10-01' as LocalDate, to: '2026-10-31' as LocalDate }, today)).toBe('provisional');
  });
});
