// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Portfolio valuation (PRD §6.14 FR-I3, FR-G6): position and portfolio value in the base currency, cost basis,
 * unrealized gain, today's change, 12-month dividends and yield, the growth series (value vs cost basis), returns and
 * YTD benchmarks, allocation vs target with drift, the rebalancing calculator (suggestions only, it never creates a
 * transaction), and the computed price estimates of FR-I6 (Antam premium, RDPU accrual, ORI coupon). Amounts are
 * `bigint` minor units, units/prices/rates exact decimal strings, ratios basis points (10 000 = 100%).
 */
import { ratioBps } from './budget.ts';
import { DECIMAL_SCALE, divideRound, formatDecimal, parseDecimal } from './decimal.ts';
import { convert } from './fx.ts';
import { type AssetClass, type Currencies, marketValueBaseMinor, marketValueMinor } from './investments.ts';
import { splitByBps } from './money.ts';
import { countDays, type LocalDate, shiftMonth, type YearMonth } from './period.ts';

const BPS = 10_000n;

export class InvalidValuationError extends RangeError {
  override readonly name = 'InvalidValuationError';
}

/** One priced holding (or a platform's cash: price `'1'`, units = the cash, cost = the cash at its deposit rates). */
export interface PositionInput {
  readonly key: string;
  readonly assetClass: AssetClass;
  /** The asset's quote currency. */
  readonly currency: string;
  readonly units: string;
  /** Current price in the quote currency's major units; `null` when no source has one (FR-G6: valued at cost). */
  readonly price: string | null;
  /** Previous close ("Hari ini"); `null` when unknown. */
  readonly prevClose: string | null;
  /** 1 quote unit = `fxRate` base units now. */
  readonly fxRate: string;
  /** The rate at the previous close; `null` = `fxRate`. */
  readonly prevFxRate: string | null;
  readonly costMinor: bigint;
  /** Cost basis in the base currency at the trade-date rates. */
  readonly costBaseMinor: bigint;
}

export interface PositionValue {
  readonly key: string;
  readonly assetClass: AssetClass;
  /** Value in the quote currency (cost when unpriced). */
  readonly valueMinor: bigint;
  readonly valueBaseMinor: bigint;
  readonly costBaseMinor: bigint;
  /** Value − cost in the quote currency ("+US$128,44"). */
  readonly gainMinor: bigint;
  /** Value − cost in the base currency ("+Rp2.100.000"): includes the rate move since the trades. */
  readonly gainBaseMinor: bigint;
  /** Gain ÷ cost (base); `null` without cost. */
  readonly gainBps: number | null;
  /** Value now − value at the previous close (base); `null` without a previous close or price. */
  readonly todayBaseMinor: bigint | null;
  /** `false` when no price was available and the position is shown at cost. */
  readonly priced: boolean;
}

/** Value of one position (per-position rounding half up from the exact units × price × rate). */
export function positionValue(position: PositionInput, base: string): PositionValue {
  const currencies: Currencies = { quote: position.currency, base };
  const { price } = position;
  const valueMinor = price === null ? position.costMinor : marketValueMinor(position.units, price, position.currency);
  const valueBaseMinor =
    price === null ? position.costBaseMinor : marketValueBaseMinor(position.units, price, position.fxRate, currencies);
  const gainBaseMinor = valueBaseMinor - position.costBaseMinor;
  const prevValueBaseMinor =
    price === null || position.prevClose === null
      ? null
      : marketValueBaseMinor(position.units, position.prevClose, position.prevFxRate ?? position.fxRate, currencies);
  return {
    key: position.key,
    assetClass: position.assetClass,
    valueMinor,
    valueBaseMinor,
    costBaseMinor: position.costBaseMinor,
    gainMinor: valueMinor - position.costMinor,
    gainBaseMinor,
    gainBps: ratioBps(gainBaseMinor, position.costBaseMinor),
    todayBaseMinor: prevValueBaseMinor === null ? null : valueBaseMinor - prevValueBaseMinor,
    priced: price !== null,
  };
}

export interface PortfolioSummary {
  readonly positions: readonly PositionValue[];
  /** "Nilai portofolio Rp61.420.000". */
  readonly valueBaseMinor: bigint;
  /** "Modal Rp53.931.000". */
  readonly costBaseMinor: bigint;
  /** "Untung belum terealisasi +Rp7.489.000". */
  readonly gainBaseMinor: bigint;
  /** "+13,9%" (1389). */
  readonly gainBps: number | null;
  /** "Hari ini +Rp312.000": Σ of the positions with a previous close. */
  readonly todayBaseMinor: bigint;
  /** Today ÷ yesterday's value ("+0,51%" = 51). */
  readonly todayBps: number | null;
  readonly dividends12mBaseMinor: bigint;
  /** 12-month dividends ÷ value ("yield 4,3%" = 430). */
  readonly yieldBps: number | null;
  /** Positions without any price, shown at cost (FR-G6). */
  readonly unpricedCount: number;
}

/** FR-I3 KPIs of `positions` in the base currency (the USD toggle converts these totals at today's rate). */
export function portfolioSummary(
  positions: readonly PositionInput[],
  options: { readonly base: string; readonly dividends12mBaseMinor: bigint },
): PortfolioSummary {
  const values = positions.map((position) => positionValue(position, options.base));
  let valueBaseMinor = 0n;
  let costBaseMinor = 0n;
  let todayBaseMinor = 0n;
  for (const value of values) {
    valueBaseMinor += value.valueBaseMinor;
    costBaseMinor += value.costBaseMinor;
    todayBaseMinor += value.todayBaseMinor ?? 0n;
  }
  const gainBaseMinor = valueBaseMinor - costBaseMinor;
  return {
    positions: values,
    valueBaseMinor,
    costBaseMinor,
    gainBaseMinor,
    gainBps: ratioBps(gainBaseMinor, costBaseMinor),
    todayBaseMinor,
    todayBps: ratioBps(todayBaseMinor, valueBaseMinor - todayBaseMinor),
    dividends12mBaseMinor: options.dividends12mBaseMinor,
    yieldBps: ratioBps(options.dividends12mBaseMinor, valueBaseMinor),
    unpricedCount: values.filter((value) => !value.priced).length,
  };
}

/** A received dividend (net of tax, base currency) on its payment date. */
export interface DividendRecord {
  readonly on: LocalDate;
  readonly netBaseMinor: bigint;
}

export interface TrailingDividends {
  readonly totalMinor: bigint;
  /** The 12 months ending with `today`'s month, oldest first (bars N D J … S O). */
  readonly months: readonly { readonly month: YearMonth; readonly minor: bigint }[];
}

/** FR-I3 "Dividen 12 bulan": dividends paid in the 12 calendar months ending with `today`'s month. */
export function trailingDividends(records: readonly DividendRecord[], today: LocalDate): TrailingDividends {
  const current = today.slice(0, 7) as YearMonth;
  const months = Array.from({ length: 12 }, (_, index) => ({ month: shiftMonth(current, index - 11), minor: 0n }));
  for (const record of records) {
    const bucket = months.find((month) => month.month === record.on.slice(0, 7) && record.on <= today);
    if (bucket !== undefined) bucket.minor += record.netBaseMinor;
  }
  return { totalMinor: months.reduce((sum, month) => sum + month.minor, 0n), months };
}

/** A month-end portfolio snapshot (`portfolio_snapshots`). */
export interface PortfolioSnapshot {
  readonly month: YearMonth;
  readonly valueMinor: bigint;
  /** Cost basis at month end ("Modal disetor"). */
  readonly costMinor: bigint;
  /** Net contributions during the month (buys − sales withdrawn; "Setoran bulan ini"). */
  readonly contributionsMinor: bigint;
}

export interface GrowthPoint extends PortfolioSnapshot {
  /** Value − cost ("Keuntungan"). */
  readonly gainMinor: bigint;
  readonly gainBps: number | null;
  /** Value change vs the previous point ("vs Agustus +Rp4.200.000"); `null` for the first. */
  readonly changeMinor: bigint | null;
  readonly changeBps: number | null;
}

/** FR-I3 growth chart: value vs cost basis per month end (Sep: 57,7 jt vs 50,9 jt, +13,4%, vs Agustus +7,9%). */
export function growthSeries(snapshots: readonly PortfolioSnapshot[]): GrowthPoint[] {
  return snapshots.map((snapshot, index) => {
    const previous = index === 0 ? null : (snapshots[index - 1] as PortfolioSnapshot);
    const gainMinor = snapshot.valueMinor - snapshot.costMinor;
    return {
      ...snapshot,
      gainMinor,
      gainBps: ratioBps(gainMinor, snapshot.costMinor),
      changeMinor: previous === null ? null : snapshot.valueMinor - previous.valueMinor,
      changeBps: previous === null ? null : ratioBps(snapshot.valueMinor - previous.valueMinor, previous.valueMinor),
    };
  });
}

/** FR-I3 ranges 1B / 3B / YTD / 1T / Semua. */
export const GROWTH_RANGES = ['1m', '3m', 'ytd', '1y', 'all'] as const;
export type GrowthRange = (typeof GROWTH_RANGES)[number];

/**
 * First month-end shown for `range`: the month before (1B), three before (3B), December of last year (YTD: the
 * baseline), the 12 month-ends ending now (1T: Nov–Okt as in the design), or everything (`null`).
 */
export function growthRangeStart(range: GrowthRange, current: YearMonth): YearMonth | null {
  switch (range) {
    case '1m':
      return shiftMonth(current, -1);
    case '3m':
      return shiftMonth(current, -3);
    case 'ytd':
      return `${Number(current.slice(0, 4)) - 1}-12` as YearMonth;
    case '1y':
      return shiftMonth(current, -11);
    case 'all':
      return null;
  }
}

/**
 * Money-weighted return of a month-end series (Modified Dietz): (V_end − V_start − ΣC) ÷ (V_start + Σ wᵢCᵢ), each
 * month's contribution weighted by the share of the period left after mid-month. The first point is the baseline
 * (YTD: last December). `null` with fewer than 2 points or no capital at work.
 */
export function periodReturnBps(points: readonly PortfolioSnapshot[]): number | null {
  if (points.length < 2) return null;
  const first = points[0] as PortfolioSnapshot;
  const last = points[points.length - 1] as PortfolioSnapshot;
  const months = BigInt(points.length - 1);
  let contributions = 0n;
  let weighted = 0n;
  points.slice(1).forEach((point, index) => {
    contributions += point.contributionsMinor;
    // Weight (months − index − ½) ÷ months, kept integral by scaling everything by 2 × months.
    weighted += (2n * (months - BigInt(index)) - 1n) * point.contributionsMinor;
  });
  const capital = 2n * months * first.valueMinor + weighted;
  if (capital <= 0n) return null;
  return Number(divideRound((last.valueMinor - first.valueMinor - contributions) * 2n * months * BPS, capital));
}

/** YTD benchmark (SPY, IHSG): current ÷ baseline (last year's close) − 1 (690,10 / 601,13 → +14,8% = 1480). */
export function benchmarkReturnBps(baseline: string, current: string): number {
  const start = parseDecimal(baseline);
  if (start <= 0n) throw new InvalidValuationError(`Benchmark baseline must be positive: ${baseline}`);
  return Number(divideRound((parseDecimal(current) - start) * BPS, start));
}

/** A slice of the portfolio (asset class, asset or "Daftar saya" category) and its value in the base currency. */
export interface AllocationItem {
  readonly key: string;
  readonly valueMinor: bigint;
}

/** Targets in basis points per key; they must total exactly 10 000 ({@link checkTargets}). */
export type AllocationTargets = Readonly<Record<string, number>>;

export interface AllocationRow {
  readonly key: string;
  readonly valueMinor: bigint;
  /** "50,8%" = 5083. */
  readonly shareBps: number;
  readonly targetBps: number;
  /** Share − target ("+0,8" = 83); exact, then half up. */
  readonly deviationBps: number;
}

export interface Allocation {
  readonly totalMinor: bigint;
  /** Target keys first (in their order), then keys held without a target. */
  readonly rows: readonly AllocationRow[];
  /** ½ Σ |share − target| ("drift 3,1%" = 310): the share of the portfolio that would have to move. */
  readonly driftBps: number;
  /** The row furthest from its target ("Kripto 2,0 poin di atas target"); `null` when all are on target. */
  readonly largest: AllocationRow | null;
}

export type InvalidTargetsReason = 'value' | 'total';

export class InvalidTargetsError extends RangeError {
  override readonly name = 'InvalidTargetsError';
  readonly reason: InvalidTargetsReason;
  constructor(reason: InvalidTargetsReason) {
    super(`Invalid allocation targets: ${reason}`);
    this.reason = reason;
  }
}

export interface TargetsCheck {
  readonly totalBps: number;
  /** Total − 10 000 ("Total target lebih 1%" = 100). */
  readonly excessBps: number;
  readonly valid: boolean;
  /** "Ambil 1% dari Saham AS": the largest target absorbs the difference; `null` when valid or impossible. */
  readonly fix: { readonly key: string; readonly targetBps: number } | null;
}

/** FR-I3 "total validated at 100%": each target an integer 0–10 000, the total exactly 10 000. */
export function checkTargets(targets: AllocationTargets): TargetsCheck {
  const entries = Object.entries(targets);
  if (entries.some(([, bps]) => !Number.isInteger(bps) || bps < 0 || bps > 10_000)) {
    throw new InvalidTargetsError('value');
  }
  const totalBps = entries.reduce((sum, [, bps]) => sum + bps, 0);
  const excessBps = totalBps - 10_000;
  if (excessBps === 0) return { totalBps, excessBps, valid: true, fix: null };
  const largest = entries.reduce<[string, number] | null>(
    (best, entry) => (best === null || entry[1] > best[1] ? entry : best),
    null,
  );
  const fixed = largest === null ? -1 : largest[1] - excessBps;
  return {
    totalBps,
    excessBps,
    valid: false,
    fix: largest === null || fixed < 0 || fixed > 10_000 ? null : { key: largest[0], targetBps: fixed },
  };
}

const assertTargets = (targets: AllocationTargets): void => {
  if (!checkTargets(targets).valid) throw new InvalidTargetsError('total');
};

/** Items and targets merged: every target key (in order), then held keys without a target. */
function mergeItems(items: readonly AllocationItem[], targets: AllocationTargets): AllocationItem[] {
  const values = new Map<string, bigint>();
  for (const item of items) values.set(item.key, (values.get(item.key) ?? 0n) + item.valueMinor);
  const keys = [...Object.keys(targets), ...[...values.keys()].filter((key) => !(key in targets))];
  return keys.map((key) => ({ key, valueMinor: values.get(key) ?? 0n }));
}

/** FR-I3 allocation vs target and drift (targets must total 10 000; a key without a target has target 0). */
export function allocation(items: readonly AllocationItem[], targets: AllocationTargets): Allocation {
  assertTargets(targets);
  const merged = mergeItems(items, targets);
  const totalMinor = merged.reduce((sum, item) => sum + item.valueMinor, 0n);
  if (totalMinor <= 0n) throw new InvalidValuationError('Allocation needs a positive portfolio value');
  let absolute = 0n;
  const rows = merged.map((item) => {
    const targetBps = targets[item.key] ?? 0;
    const difference = item.valueMinor * BPS - BigInt(targetBps) * totalMinor;
    absolute += difference < 0n ? -difference : difference;
    return {
      key: item.key,
      valueMinor: item.valueMinor,
      shareBps: ratioBps(item.valueMinor, totalMinor) as number,
      targetBps,
      deviationBps: Number(divideRound(difference, totalMinor)),
    };
  });
  const largest = rows.reduce<AllocationRow | null>(
    (best, row) =>
      row.deviationBps !== 0 && (best === null || Math.abs(row.deviationBps) > Math.abs(best.deviationBps))
        ? row
        : best,
    null,
  );
  return { totalMinor, rows, driftBps: Number(divideRound(absolute, 2n * totalMinor)), largest };
}

/** Sums position values per asset class (FR-I3 "Alokasi aset" per class). */
export function classItems(
  positions: readonly Pick<PositionValue, 'assetClass' | 'valueBaseMinor'>[],
): AllocationItem[] {
  return mergeItems(
    positions.map((position) => ({ key: position.assetClass, valueMinor: position.valueBaseMinor })),
    {},
  );
}

/** A slice to rebalance, optionally priced in its own currency for the "+US$113,76" reference. */
export interface RebalanceItem extends AllocationItem {
  /** The slice's quote currency and the rate (1 quote = `fxRate` base), when it is not the base currency. */
  readonly quote: { readonly currency: string; readonly fxRate: string } | null;
}

export interface RebalanceTrade {
  readonly key: string;
  /** Positive = buy, negative = sell, base currency. */
  readonly amountMinor: bigint;
  /** The same in the slice's quote currency; `null` for base-currency slices. */
  readonly quoteMinor: bigint | null;
}

export interface Rebalance {
  /** Non-zero trades, buys first (largest first), then sells (largest first). */
  readonly trades: readonly RebalanceTrade[];
  /** "Beli Rp3.650.000". */
  readonly buyMinor: bigint;
  /** "jual Rp3.650.000". */
  readonly sellMinor: bigint;
}

/**
 * FR-I3 rebalancing calculator: the trades that bring every slice to its target after adding `extraMinor` ("Dana
 * tambahan", ≥ 0). Σ trades = `extraMinor` exactly (net zero without extra money; rounding remainders go to the
 * largest fractions), so the drift becomes 0. Suggestions only: nothing is recorded.
 */
export function rebalance(
  items: readonly RebalanceItem[],
  targets: AllocationTargets,
  base: string,
  extraMinor = 0n,
): Rebalance {
  assertTargets(targets);
  if (extraMinor < 0n) throw new InvalidValuationError('Extra money must not be negative');
  const quotes = new Map(items.map((item) => [item.key, item.quote]));
  const merged = mergeItems(items, targets);
  const totalMinor = merged.reduce((sum, item) => sum + item.valueMinor, 0n) + extraMinor;
  const ideals = splitByBps(
    totalMinor,
    merged.map((item) => targets[item.key] ?? 0),
  );
  const trades = merged
    .map((item, index) => {
      const amountMinor = (ideals[index] as bigint) - item.valueMinor;
      const quote = quotes.get(item.key) ?? null;
      return {
        key: item.key,
        amountMinor,
        quoteMinor:
          quote === null
            ? null
            : convert({ minor: amountMinor, currency: base }, quote.currency, {
                base: quote.currency,
                quote: base,
                rate: quote.fxRate,
              }),
      };
    })
    .filter((trade) => trade.amountMinor !== 0n)
    .sort((a, b) => {
      if (a.amountMinor > 0n !== b.amountMinor > 0n) return a.amountMinor > 0n ? -1 : 1;
      const absA = a.amountMinor < 0n ? -a.amountMinor : a.amountMinor;
      const absB = b.amountMinor < 0n ? -b.amountMinor : b.amountMinor;
      return absA === absB ? 0 : absA > absB ? -1 : 1;
    });
  const buyMinor = trades.reduce((sum, trade) => sum + (trade.amountMinor > 0n ? trade.amountMinor : 0n), 0n);
  return { trades, buyMinor, sellMinor: buyMinor - extraMinor };
}

/** FR-I6 computed prices, always labelled "estimasi". */
export const ESTIMATE_KINDS = ['antam_premium', 'rdpu_accrual', 'ori_coupon'] as const;
export type EstimateKind = (typeof ESTIMATE_KINDS)[number];

export interface EstimatedPrice {
  readonly kind: EstimateKind;
  /** Exact to 18 digits, in the currency's major units. */
  readonly price: string;
  readonly estimate: true;
}

/** Grams per troy ounce (spot XAU is quoted per troy ounce). */
export const TROY_OUNCE_GRAMS = '31.1034768';

/**
 * FR-I6 gold: Antam per gram ≈ spot per gram × (1 + the user's premium) ("harga spot (estimasi)"): XAU Rp75.442.309/oz
 * with a 6,04% premium → Rp2.572.xxx per gram.
 */
export function antamEstimate(spotPerOunce: string, premiumBps: number): EstimatedPrice {
  const spot = parseDecimal(spotPerOunce);
  if (spot <= 0n || !Number.isInteger(premiumBps) || premiumBps <= -10_000) {
    throw new InvalidValuationError('Antam estimate needs a positive spot price and a premium above −100%');
  }
  const price = divideRound(spot * DECIMAL_SCALE * (BPS + BigInt(premiumBps)), parseDecimal(TROY_OUNCE_GRAMS) * BPS);
  return { kind: 'antam_premium', price: formatDecimal(price), estimate: true };
}

/**
 * FR-I6 money market fund (RDPU): the last NAV accrued daily at the user's annual yield (simple, ÷ 365) until a new
 * NAV is entered: NAV × (1 + yield × days ÷ 365). Before or on the NAV date it is the NAV itself.
 */
export function rdpuAccrual(input: {
  readonly nav: string;
  readonly navDate: LocalDate;
  readonly annualYieldBps: number;
  readonly on: LocalDate;
}): EstimatedPrice {
  const nav = parseDecimal(input.nav);
  if (nav <= 0n || !Number.isInteger(input.annualYieldBps) || input.annualYieldBps < 0) {
    throw new InvalidValuationError('RDPU accrual needs a positive NAV and a non-negative yield');
  }
  const days = BigInt(Math.max(countDays(input.navDate, input.on) - 1, 0));
  const price = divideRound(nav * (365n * BPS + BigInt(input.annualYieldBps) * days), 365n * BPS);
  return { kind: 'rdpu_accrual', price: formatDecimal(price), estimate: true };
}

export interface OriEstimate extends EstimatedPrice {
  /** Gross monthly coupon on the par amount (ORI026 Rp1.500.000 at 6,3% → Rp7.875; 10% final tax applies). */
  readonly couponMinor: bigint;
  /** Coupon accrued since the last payment, day-proportional. */
  readonly accruedMinor: bigint;
}

/**
 * FR-I6 SBN (ORI): no market price; value = par + the fixed coupon accrued since the last monthly payment. `price` is
 * per currency unit of par (units = the par amount in major units).
 */
export function oriEstimate(input: {
  readonly parMinor: bigint;
  readonly currency: string;
  readonly couponBps: number;
  readonly lastCouponOn: LocalDate;
  readonly nextCouponOn: LocalDate;
  readonly on: LocalDate;
}): OriEstimate {
  const periodDays = countDays(input.lastCouponOn, input.nextCouponOn) - 1;
  if (input.parMinor <= 0n || !Number.isInteger(input.couponBps) || input.couponBps < 0 || periodDays < 1) {
    throw new InvalidValuationError('ORI estimate needs a positive par, a non-negative coupon and a coupon period');
  }
  const couponMinor = divideRound(input.parMinor * BigInt(input.couponBps), 12n * BPS);
  const elapsed = Math.min(Math.max(countDays(input.lastCouponOn, input.on) - 1, 0), periodDays);
  const accruedMinor = divideRound(couponMinor * BigInt(elapsed), BigInt(periodDays));
  // Price per major unit of par: (par + accrued) ÷ par.
  const price = divideRound((input.parMinor + accruedMinor) * DECIMAL_SCALE, input.parMinor);
  return { kind: 'ori_coupon', price: formatDecimal(price), estimate: true, couponMinor, accruedMinor };
}
