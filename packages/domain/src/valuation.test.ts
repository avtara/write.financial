// SPDX-License-Identifier: AGPL-3.0-only
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { convert } from './fx.ts';
import type { AssetClass } from './investments.ts';
import { parseLocalDate, type YearMonth } from './period.ts';
import {
  ESTIMATE_KINDS,
  GROWTH_RANGES,
  InvalidTargetsError,
  InvalidValuationError,
  TROY_OUNCE_GRAMS,
  allocation,
  antamEstimate,
  benchmarkReturnBps,
  checkTargets,
  classItems,
  growthRangeStart,
  growthSeries,
  oriEstimate,
  periodReturnBps,
  portfolioSummary,
  positionValue,
  rdpuAccrual,
  rebalance,
  trailingDividends,
  type PositionInput,
  type RebalanceItem,
} from './valuation.ts';

const d = parseLocalDate;
const ym = (value: string): YearMonth => value as YearMonth;

/**
 * Design 09 bgmSP holdings (kurs USD Rp16.350): every row value of the table ("≈ Rp13.500.000", …, US$51,99 cash in
 * Gotrade), the category rows split into their assets (Indonesia, YieldMax, US individual), unit counts solved so
 * that units × price × rate rounds to the row value, cost bases so that the gains are the table's (QQQ absorbs the
 * trade-date rate difference that makes Σ gains +Rp7.489.000 instead of the rows' +Rp7.494.000; BTC's cost is the
 * one of the JejMv sale). Previous closes give "Hari ini" +Rp312.000 (the rows' day changes scaled to the KPI).
 */
type Row = [string, AssetClass, string, string, string, string | null, bigint, bigint];
const ROWS: Row[] = [
  ['SPY', 'us_stocks', 'USD', '1.196476', '690.1', '687.4371', 69_725n, 11_400_000n],
  ['QQQ', 'us_stocks', 'USD', '0.7390584', '612.4', '608.866', 36_497n, 5_967_333n],
  ['VEA', 'international', 'USD', '4.293828', '61.25', '61.13147', 24_086n, 3_938_000n],
  ['SCHD', 'us_stocks', 'USD', '10.64633', '28.15', '28.113646', 28_061n, 4_588_000n],
  ['VWO', 'international', 'USD', '2.895932', '52.8', '52.86845', 14_691n, 2_402_000n],
  ['SGOV', 'cash', 'USD', '2.099989', '100.48', '100.48', 20_434n, 3_340_963n],
  ['MSTY', 'income', 'USD', '3.642407', '20.15', '19.88187', 8_636n, 1_412_000n],
  ['NVDY', 'income', 'USD', '3.59777', '15.3', '15.23118', 5_676n, 928_000n],
  ['TSLY', 'income', 'USD', '3.72561', '9.85', '9.9274', 4_055n, 663_000n],
  ['CONY', 'income', 'USD', '3.44575', '7.1', '7.03658', 2_550n, 417_000n],
  ['NVDA', 'us_stocks', 'USD', '0.5508593', '183.2', '181.9104', 6_300n, 1_030_000n],
  ['MSFT', 'us_stocks', 'USD', '0.1432647', '512.3', '508.6938', 6_055n, 990_000n],
  ['AAPL', 'us_stocks', 'USD', '0.2552472', '251.6', '249.829', 5_321n, 870_000n],
  ['GOOGL', 'us_stocks', 'USD', '0.2042888', '245.5', '243.6166', 3_976n, 650_000n],
  ['AMZN', 'us_stocks', 'USD', '0.193376', '221.4', '219.8417', 3_609n, 590_000n],
  ['BTC', 'crypto', 'IDR', '0.003767123', '1460000000', '1443298241', 3_886_667n, 3_886_667n],
  ['XAU', 'gold', 'IDR', '1.525773', '2425000', '2431301.4', 3_025_000n, 3_025_000n],
  ['BBCA', 'indonesia', 'IDR', '250', '9600', '9439.66', 2_305_000n, 2_305_000n],
  ['BBRI', 'indonesia', 'IDR', '325', '4000', '3924.625', 1_486_000n, 1_486_000n],
  ['TLKM', 'indonesia', 'IDR', '200', '3000', null, 732_000n, 732_000n],
  ['IDX30', 'indonesia', 'IDR', '800', '1250', null, 978_000n, 978_000n],
  ['ORI', 'indonesia', 'IDR', '1500000', '1', '0.9797567', 1_482_000n, 1_482_000n],
  ['USD cash', 'cash', 'USD', '51.99', '1', '1', 5_199n, 850_037n],
];
const POSITIONS: PositionInput[] = ROWS.map(
  ([key, assetClass, currency, units, price, prevClose, costMinor, costBaseMinor]) => ({
    key,
    assetClass,
    currency,
    units,
    price,
    prevClose,
    fxRate: currency === 'USD' ? '16350' : '1',
    prevFxRate: null,
    costMinor,
    costBaseMinor,
  }),
);

/** Main frame allocation targets (w1jn3J: 50/12/12/7/8/5/6). */
const CLASS_TARGETS = {
  us_stocks: 5000,
  international: 1200,
  indonesia: 1200,
  crypto: 700,
  cash: 800,
  gold: 500,
  income: 600,
};

describe('positionValue / portfolioSummary (FR-I3 KPIs, design bgmSP)', () => {
  it('values SPY at Rp13.500.000, +Rp2.100.000 (+18,4%)', () => {
    expect(positionValue(POSITIONS[0] as PositionInput, 'IDR')).toEqual({
      key: 'SPY',
      assetClass: 'us_stocks',
      valueMinor: 82_569n,
      valueBaseMinor: 13_500_000n,
      costBaseMinor: 11_400_000n,
      gainMinor: 12_844n,
      gainBaseMinor: 2_100_000n,
      gainBps: 1842,
      todayBaseMinor: 52_092n,
      priced: true,
    });
  });

  it('adds up to Rp61.420.000 / modal Rp53.931.000 / +Rp7.489.000 (+13,9%) / hari ini +Rp312.000 (+0,51%)', () => {
    const summary = portfolioSummary(POSITIONS, { base: 'IDR', dividends12mBaseMinor: 2_640_000n });
    expect(summary).toMatchObject({
      valueBaseMinor: 61_420_000n,
      costBaseMinor: 53_931_000n,
      gainBaseMinor: 7_489_000n,
      gainBps: 1389,
      todayBaseMinor: 312_000n,
      todayBps: 51,
      dividends12mBaseMinor: 2_640_000n,
      yieldBps: 430,
      unpricedCount: 0,
    });
    expect(summary.positions).toHaveLength(ROWS.length);
    // USD mode converts the totals at today's rate: US$3.756,57 (≈ US$3.757), modal US$3.299.
    const toUsd = (minor: bigint): bigint =>
      convert({ minor, currency: 'IDR' }, 'USD', { base: 'USD', quote: 'IDR', rate: '16350' });
    expect(toUsd(summary.valueBaseMinor)).toBe(375_657n);
    expect(toUsd(summary.costBaseMinor)).toBe(329_853n);
    expect(toUsd(summary.gainBaseMinor)).toBe(45_804n);
  });

  it('shows a position without any price at cost (FR-G6) and uses the previous close rate when given', () => {
    const unpriced = positionValue({ ...(POSITIONS[0] as PositionInput), price: null }, 'IDR');
    expect(unpriced).toMatchObject({
      valueMinor: 69_725n,
      valueBaseMinor: 11_400_000n,
      gainBaseMinor: 0n,
      todayBaseMinor: null,
      priced: false,
    });
    const fxMove = positionValue(
      { ...(POSITIONS[0] as PositionInput), prevClose: '690.1', prevFxRate: '16300' },
      'IDR',
    );
    expect(fxMove.todayBaseMinor).toBe(13_500_000n - 13_458_716n);
    const empty = portfolioSummary(
      [{ ...(POSITIONS[0] as PositionInput), price: null, costMinor: 0n, costBaseMinor: 0n }],
      {
        base: 'IDR',
        dividends12mBaseMinor: 0n,
      },
    );
    expect(empty).toMatchObject({
      valueBaseMinor: 0n,
      gainBps: null,
      todayBps: null,
      yieldBps: null,
      unpricedCount: 1,
    });
    // Today relative to yesterday's value: 110 now, 100 yesterday → +10%.
    const small = portfolioSummary(
      [
        {
          key: 'x',
          assetClass: 'cash',
          currency: 'IDR',
          units: '1',
          price: '110',
          prevClose: '100',
          fxRate: '1',
          prevFxRate: null,
          costMinor: 100n,
          costBaseMinor: 100n,
        },
      ],
      { base: 'IDR', dividends12mBaseMinor: 11n },
    );
    expect(small).toMatchObject({ todayBaseMinor: 10n, todayBps: 1000, yieldBps: 1000, gainBps: 1000 });
  });
});

describe('trailingDividends (Dividen 12 bulan)', () => {
  it('sums the 12 calendar months ending this month, oldest first', () => {
    const result = trailingDividends(
      [
        { on: d('2026-10-08'), netBaseMinor: 112_000n },
        { on: d('2026-09-25'), netBaseMinor: 98_000n },
        { on: d('2026-09-29'), netBaseMinor: 35_000n },
        { on: d('2025-11-01'), netBaseMinor: 1n },
        { on: d('2025-10-31'), netBaseMinor: 1_000n },
        { on: d('2026-10-20'), netBaseMinor: 5n },
        { on: d('2026-10-15'), netBaseMinor: 7n },
      ],
      d('2026-10-15'),
    );
    expect(result.months.map((month) => month.month)).toEqual([
      '2025-11',
      '2025-12',
      '2026-01',
      '2026-02',
      '2026-03',
      '2026-04',
      '2026-05',
      '2026-06',
      '2026-07',
      '2026-08',
      '2026-09',
      '2026-10',
    ]);
    expect(result.months[0]?.minor).toBe(1n);
    expect(result.months[10]?.minor).toBe(133_000n);
    expect(result.months[11]?.minor).toBe(112_007n);
    expect(result.totalMinor).toBe(245_008n);
  });
});

describe('growth series and returns (FR-I3)', () => {
  it('hover Sep: Rp57.700.000 vs modal Rp50.900.000, +Rp6.800.000 (+13,4%), setoran +Rp3.000.000, vs Agustus +Rp4.200.000 (+7,9%)', () => {
    const points = growthSeries([
      { month: ym('2026-08'), valueMinor: 53_500_000n, costMinor: 47_900_000n, contributionsMinor: 3_000_000n },
      { month: ym('2026-09'), valueMinor: 57_700_000n, costMinor: 50_900_000n, contributionsMinor: 3_000_000n },
    ]);
    expect(points[0]).toMatchObject({ gainMinor: 5_600_000n, changeMinor: null, changeBps: null });
    expect(points[1]).toEqual({
      month: '2026-09',
      valueMinor: 57_700_000n,
      costMinor: 50_900_000n,
      contributionsMinor: 3_000_000n,
      gainMinor: 6_800_000n,
      gainBps: 1336,
      changeMinor: 4_200_000n,
      changeBps: 785,
    });
  });

  it('starts each range at its baseline month-end', () => {
    expect(GROWTH_RANGES).toEqual(['1m', '3m', 'ytd', '1y', 'all']);
    const october = ym('2026-10');
    expect(growthRangeStart('1m', october)).toBe('2026-09');
    expect(growthRangeStart('3m', october)).toBe('2026-07');
    expect(growthRangeStart('ytd', october)).toBe('2025-12');
    expect(growthRangeStart('ytd', ym('2027-01'))).toBe('2026-12');
    expect(growthRangeStart('1y', october)).toBe('2025-11');
    expect(growthRangeStart('all', october)).toBeNull();
  });

  it('periodReturnBps is the Modified Dietz return with mid-month contributions', () => {
    const point = (valueMinor: bigint, contributionsMinor: bigint) => ({
      month: ym('2026-01'),
      valueMinor,
      costMinor: 0n,
      contributionsMinor,
    });
    // (121 − 100 − 10) ÷ (100 + ¾ × 10) = 10,23%.
    expect(periodReturnBps([point(100n, 0n), point(110n, 10n), point(121n, 0n)])).toBe(1023);
    // A late contribution weighs less: (121 − 100 − 10) ÷ (100 + ¼ × 10) = 10,73%.
    expect(periodReturnBps([point(100n, 0n), point(105n, 0n), point(121n, 10n)])).toBe(1073);
    expect(periodReturnBps([point(100n, 0n), point(90n, 0n)])).toBe(-1000);
    expect(periodReturnBps([point(100n, 0n)])).toBeNull();
    expect(periodReturnBps([])).toBeNull();
    expect(periodReturnBps([point(0n, 0n), point(10n, 0n)])).toBeNull();
    expect(periodReturnBps([point(0n, 0n), point(10n, 10n)])).toBe(0);
  });

  it('YTD benchmarks: SPY +14,8%, IHSG +3,1% from last year’s close', () => {
    expect(benchmarkReturnBps('601.13', '690.10')).toBe(1480);
    expect(benchmarkReturnBps('7079.92', '7299.40')).toBe(310);
    expect(benchmarkReturnBps('100', '99.995')).toBe(-1);
    expect(() => benchmarkReturnBps('0', '1')).toThrow(InvalidValuationError);
    expect(() => benchmarkReturnBps('0', '1')).toThrow('Benchmark baseline must be positive: 0');
    let caught: unknown = null;
    try {
      benchmarkReturnBps('0', '1');
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({ name: 'InvalidValuationError' });
  });
});

describe('allocation and drift (FR-I3)', () => {
  it('golden: the allocation panel (50,8/11,0/11,4/9,0/7,6/5,3/4,9 vs 50/12/12/7/8/5/6) → drift 3,1%, Kripto +2,0', () => {
    const shares = {
      us_stocks: 5080n,
      international: 1100n,
      indonesia: 1140n,
      crypto: 900n,
      cash: 760n,
      gold: 530n,
      income: 490n,
    };
    const result = allocation(
      Object.entries(shares).map(([key, bps]) => ({ key, valueMinor: bps * 6_142n })),
      CLASS_TARGETS,
    );
    expect(result.driftBps).toBe(310);
    expect(result.rows.map((row) => [row.key, row.shareBps, row.deviationBps])).toEqual([
      ['us_stocks', 5080, 80],
      ['international', 1100, -100],
      ['indonesia', 1140, -60],
      ['crypto', 900, 200],
      ['cash', 760, -40],
      ['gold', 530, 30],
      ['income', 490, -110],
    ]);
    expect(result.largest).toMatchObject({ key: 'crypto', deviationBps: 200 });
  });

  it('seed holdings (the design table) give drift 3,8% with the same targets — design mismatch, reported', () => {
    const summary = portfolioSummary(POSITIONS, { base: 'IDR', dividends12mBaseMinor: 0n });
    const items = classItems(summary.positions);
    expect(items).toEqual([
      { key: 'us_stocks', valueMinor: 31_220_000n },
      { key: 'international', valueMinor: 6_800_000n },
      { key: 'cash', valueMinor: 4_300_000n },
      { key: 'income', valueMinor: 3_100_000n },
      { key: 'crypto', valueMinor: 5_500_000n },
      { key: 'gold', valueMinor: 3_700_000n },
      { key: 'indonesia', valueMinor: 6_800_000n },
    ]);
    const result = allocation(items, CLASS_TARGETS);
    expect(result.totalMinor).toBe(61_420_000n);
    expect(result.driftBps).toBe(381);
    expect(result.rows.map((row) => [row.key, row.shareBps, row.targetBps, row.deviationBps])).toEqual([
      ['us_stocks', 5083, 5000, 83],
      ['international', 1107, 1200, -93],
      ['indonesia', 1107, 1200, -93],
      ['crypto', 895, 700, 195],
      ['cash', 700, 800, -100],
      ['gold', 602, 500, 102],
      ['income', 505, 600, -95],
    ]);
    // With the class sums of the per-asset targets of the rebalancing card (51/12/12/7/8/5/5, as n6Wcnt shows): 3,0%.
    expect(allocation(items, { ...CLASS_TARGETS, us_stocks: 5100, income: 500 }).driftBps).toBe(303);
  });

  it('keeps target keys without holdings and holdings without a target', () => {
    const result = allocation(
      [
        { key: 'a', valueMinor: 100n },
        { key: 'x', valueMinor: 100n },
        { key: 'a', valueMinor: 100n },
      ],
      {
        a: 5000,
        b: 5000,
      },
    );
    expect(result.rows).toEqual([
      { key: 'a', valueMinor: 200n, shareBps: 6667, targetBps: 5000, deviationBps: 1667 },
      { key: 'b', valueMinor: 0n, shareBps: 0, targetBps: 5000, deviationBps: -5000 },
      { key: 'x', valueMinor: 100n, shareBps: 3333, targetBps: 0, deviationBps: 3333 },
    ]);
    expect(result.driftBps).toBe(5000);
    expect(result.largest?.key).toBe('b');
    expect(allocation([{ key: 'a', valueMinor: 1n }], { a: 10_000 }).largest).toBeNull();
    // Equal deviations: the first row stays the largest.
    const tie = allocation(
      [
        { key: 'a', valueMinor: 60n },
        { key: 'b', valueMinor: 40n },
      ],
      { a: 5000, b: 5000 },
    );
    expect(tie.largest?.key).toBe('a');
  });

  it('refuses targets that do not total 100% and an empty portfolio', () => {
    expect(() => allocation([{ key: 'a', valueMinor: 1n }], { a: 9_900 })).toThrow(InvalidTargetsError);
    expect(() => allocation([{ key: 'a', valueMinor: 1n }], { a: 9_900 })).toThrow('Invalid allocation targets: total');
    expect(() => allocation([], { a: 10_000 })).toThrow(InvalidValuationError);
    expect(() => allocation([], { a: 10_000 })).toThrow('Allocation needs a positive portfolio value');
  });

  it('checkTargets: Total 101% → "Ambil 1% dari Saham AS" (w1jn3J)', () => {
    expect(checkTargets(CLASS_TARGETS)).toEqual({ totalBps: 10_000, excessBps: 0, valid: true, fix: null });
    expect(checkTargets({ ...CLASS_TARGETS, crypto: 800 })).toEqual({
      totalBps: 10_100,
      excessBps: 100,
      valid: false,
      fix: { key: 'us_stocks', targetBps: 4900 },
    });
    expect(checkTargets({ a: 3000, b: 4000 })).toEqual({
      totalBps: 7000,
      excessBps: -3000,
      valid: false,
      fix: { key: 'b', targetBps: 7000 },
    });
    expect(checkTargets({ a: 6000, b: 6000, c: 6000 }).fix).toBeNull();
    expect(checkTargets({ a: 5000, b: 5000, c: 5000 }).fix).toEqual({ key: 'a', targetBps: 0 });
    expect(checkTargets({ a: 6000, b: 6000 }).fix).toEqual({ key: 'a', targetBps: 4000 });
    expect(checkTargets({})).toEqual({ totalBps: 0, excessBps: -10_000, valid: false, fix: null });
    for (const bad of [-1, 10_001, 1.5]) {
      let caught: unknown = null;
      try {
        checkTargets({ a: bad });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(InvalidTargetsError);
      expect(caught).toMatchObject({
        reason: 'value',
        name: 'InvalidTargetsError',
        message: 'Invalid allocation targets: value',
      });
    }
    expect(checkTargets({ a: 0, b: 10_000 }).valid).toBe(true);
  });
});

describe('rebalance (Kalkulator rebalancing, suggestions only)', () => {
  const usd = { currency: 'USD', fxRate: '16350' };
  /** The table rows and the per-asset targets the design's suggestions imply (SPY "target 25%", …). */
  const ITEMS: RebalanceItem[] = [
    { key: 'SPY', valueMinor: 13_500_000n, quote: usd },
    { key: 'QQQ', valueMinor: 7_400_000n, quote: usd },
    { key: 'VEA', valueMinor: 4_300_000n, quote: usd },
    { key: 'SCHD', valueMinor: 4_900_000n, quote: usd },
    { key: 'VWO', valueMinor: 2_500_000n, quote: usd },
    { key: 'SGOV', valueMinor: 4_300_000n, quote: usd },
    { key: 'BTC', valueMinor: 5_500_000n, quote: null },
    { key: 'XAU', valueMinor: 3_700_000n, quote: null },
    { key: 'Indonesia', valueMinor: 6_800_000n, quote: null },
    { key: 'YieldMax', valueMinor: 3_100_000n, quote: usd },
    { key: 'US individual', valueMinor: 5_420_000n, quote: usd },
  ];
  const TARGETS = {
    SPY: 2500,
    QQQ: 1000,
    VEA: 800,
    SCHD: 800,
    VWO: 400,
    SGOV: 800,
    BTC: 700,
    XAU: 500,
    Indonesia: 1200,
    YieldMax: 500,
    'US individual': 800,
  };

  it('golden: buy SPY ≈ Rp1.860.000 (US$113,46), VEA/SGOV ≈ Rp610.000, Indonesia +Rp570.000; sell QQQ, BTC, XAU, …', () => {
    const result = rebalance(ITEMS, TARGETS, 'IDR');
    expect(result.trades).toEqual([
      { key: 'SPY', amountMinor: 1_855_000n, quoteMinor: 11_346n },
      { key: 'VEA', amountMinor: 613_600n, quoteMinor: 3_753n },
      { key: 'SGOV', amountMinor: 613_600n, quoteMinor: 3_753n },
      { key: 'Indonesia', amountMinor: 570_400n, quoteMinor: null },
      { key: 'SCHD', amountMinor: 13_600n, quoteMinor: 83n },
      { key: 'QQQ', amountMinor: -1_258_000n, quoteMinor: -7_694n },
      { key: 'BTC', amountMinor: -1_200_600n, quoteMinor: null },
      { key: 'XAU', amountMinor: -629_000n, quoteMinor: null },
      { key: 'US individual', amountMinor: -506_400n, quoteMinor: -3_097n },
      { key: 'VWO', amountMinor: -43_200n, quoteMinor: -264n },
      { key: 'YieldMax', amountMinor: -29_000n, quoteMinor: -177n },
    ]);
    expect(result.buyMinor).toBe(3_666_200n);
    expect(result.sellMinor).toBe(3_666_200n);
  });

  it('invests extra money ("Dana tambahan") so the trades sum to it', () => {
    const result = rebalance(ITEMS, TARGETS, 'IDR', 1_000_000n);
    expect(result.trades.reduce((sum, trade) => sum + trade.amountMinor, 0n)).toBe(1_000_000n);
    expect(result.buyMinor - result.sellMinor).toBe(1_000_000n);
    expect(rebalance([{ key: 'a', valueMinor: 5n, quote: null }], { a: 10_000 }, 'IDR').trades).toEqual([]);
    // A holding without a target is sold off into the targeted ones.
    expect(
      rebalance(
        [
          { key: 'a', valueMinor: 5n, quote: null },
          { key: 'z', valueMinor: 5n, quote: null },
        ],
        { a: 10_000 },
        'IDR',
      ).trades,
    ).toEqual([
      { key: 'a', amountMinor: 5n, quoteMinor: null },
      { key: 'z', amountMinor: -5n, quoteMinor: null },
    ]);
  });

  it('refuses invalid targets and negative extra money', () => {
    expect(() => rebalance(ITEMS, { SPY: 100 }, 'IDR')).toThrow(InvalidTargetsError);
    expect(() => rebalance(ITEMS, { SPY: 100 }, 'IDR')).toThrow('Invalid allocation targets: total');
    expect(() => rebalance(ITEMS, TARGETS, 'IDR', -1n)).toThrow('Extra money must not be negative');
  });

  it('property: trades net to the extra money and leave every slice within one unit of its target', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({ value: fc.bigInt({ min: 0n, max: 10n ** 12n }), weight: fc.integer({ min: 0, max: 100 }) }),
          {
            minLength: 1,
            maxLength: 10,
          },
        ),
        fc.bigInt({ min: 0n, max: 10n ** 10n }),
        (slices, extra) => {
          const weightSum = slices.reduce((sum, slice) => sum + slice.weight, 0);
          fc.pre(weightSum > 0);
          const targets: Record<string, number> = {};
          slices.forEach((slice, index) => {
            targets[`k${index}`] = Math.floor((slice.weight * 10_000) / weightSum);
          });
          targets.k0 = (targets.k0 as number) + 10_000 - Object.values(targets).reduce((a, b) => a + b, 0);
          const items = slices.map((slice, index) => ({ key: `k${index}`, valueMinor: slice.value, quote: null }));
          const result = rebalance(items, targets, 'IDR', extra);
          expect(result.trades.reduce((sum, trade) => sum + trade.amountMinor, 0n)).toBe(extra);
          expect(result.buyMinor - result.sellMinor).toBe(extra);
          const total = items.reduce((sum, item) => sum + item.valueMinor, 0n) + extra;
          for (const item of items) {
            const after = item.valueMinor + (result.trades.find((trade) => trade.key === item.key)?.amountMinor ?? 0n);
            const difference = after * 10_000n - BigInt(targets[item.key] as number) * total;
            expect(difference < 0n ? -difference : difference).toBeLessThan(10_000n);
          }
        },
      ),
    );
  });
});

describe('estimates (FR-I6)', () => {
  it('labels every computed price as an estimate', () => {
    expect(ESTIMATE_KINDS).toEqual(['antam_premium', 'rdpu_accrual', 'ori_coupon']);
    expect(TROY_OUNCE_GRAMS).toBe('31.1034768');
  });

  it('Antam = spot per gram × (1 + premium): XAU Rp75.442.309/oz + 6,04% ≈ Rp2.572.028/gram', () => {
    expect(antamEstimate('75442309', 604)).toEqual({
      kind: 'antam_premium',
      price: '2572028.36126667357007497',
      estimate: true,
    });
    expect(antamEstimate('31.1034768', 0).price).toBe('1');
    expect(antamEstimate('31.1034768', -5000).price).toBe('0.5');
    for (const [spot, premium] of [
      ['0', 0],
      ['1', -10_000],
      ['1', 1.5],
    ] as const) {
      expect(() => antamEstimate(spot, premium)).toThrow(InvalidValuationError);
      expect(() => antamEstimate(spot, premium)).toThrow(
        'Antam estimate needs a positive spot price and a premium above −100%',
      );
    }
  });

  it('RDPU accrues the last NAV daily at the annual yield', () => {
    const input = { nav: '1523.4567', navDate: d('2026-10-15'), annualYieldBps: 450, on: d('2026-10-22') };
    expect(rdpuAccrual(input)).toEqual({ kind: 'rdpu_accrual', price: '1524.771464001369863014', estimate: true });
    expect(rdpuAccrual({ ...input, on: d('2026-10-15') }).price).toBe('1523.4567');
    expect(rdpuAccrual({ ...input, on: d('2026-10-01') }).price).toBe('1523.4567');
    expect(rdpuAccrual({ ...input, annualYieldBps: 0 }).price).toBe('1523.4567');
    expect(rdpuAccrual({ ...input, nav: '1', annualYieldBps: 3650, on: d('2026-10-16') }).price).toBe('1.001');
    for (const bad of [{ nav: '0' }, { annualYieldBps: -1 }, { annualYieldBps: 1.5 }]) {
      expect(() => rdpuAccrual({ ...input, ...bad })).toThrow(
        'RDPU accrual needs a positive NAV and a non-negative yield',
      );
    }
  });

  it('ORI = par + the fixed coupon accrued since the last payment (ORI026 Rp1.500.000, kupon 6,3%)', () => {
    const input = {
      parMinor: 1_500_000n,
      currency: 'IDR',
      couponBps: 630,
      lastCouponOn: d('2026-10-15'),
      nextCouponOn: d('2026-11-15'),
      on: d('2026-10-22'),
    };
    expect(oriEstimate(input)).toEqual({
      kind: 'ori_coupon',
      price: '1.001185333333333333',
      estimate: true,
      couponMinor: 7_875n,
      accruedMinor: 1_778n,
    });
    expect(oriEstimate({ ...input, on: d('2026-12-01') })).toMatchObject({ accruedMinor: 7_875n, price: '1.00525' });
    expect(oriEstimate({ ...input, on: d('2026-10-01') })).toMatchObject({ accruedMinor: 0n, price: '1' });
    expect(oriEstimate({ ...input, on: d('2026-10-15') }).accruedMinor).toBe(0n);
    expect(oriEstimate({ ...input, couponBps: 0 }).couponMinor).toBe(0n);
    expect(oriEstimate({ ...input, nextCouponOn: d('2026-10-16') }).accruedMinor).toBe(7_875n);
    for (const bad of [{ parMinor: 0n }, { couponBps: -1 }, { couponBps: 0.5 }, { nextCouponOn: d('2026-10-15') }]) {
      expect(() => oriEstimate({ ...input, ...bad })).toThrow(InvalidValuationError);
      expect(() => oriEstimate({ ...input, ...bad })).toThrow(
        'ORI estimate needs a positive par, a non-negative coupon and a coupon period',
      );
    }
  });
});
