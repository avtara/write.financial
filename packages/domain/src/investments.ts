// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Investment holdings (PRD §6.14 FR-I1, FR-I2): asset classes, trades and the average-cost holding they build. Units
 * and prices are exact decimal strings (`./decimal.ts`); amounts are `bigint` minor units of the asset's quote
 * currency; `…BaseMinor` is the base currency (IDR) converted with the **trade-date** rate, so the cost basis in IDR
 * never moves with today's rate. Fees and taxes are ledger expenses ("Biaya keuangan") and never part of the cost
 * basis; realized gain = gross proceeds − the average cost of the units sold. Nothing here writes anything.
 */
import { ratioBps } from './budget.ts';
import { DECIMAL_SCALE, divideFloor, divideRound, formatDecimal, parseDecimal } from './decimal.ts';
import { convert, parseRate, RATE_DIGITS } from './fx.ts';
import { currencyInfo } from './money.ts';

/** FR-I1 asset classes in design order: Saham AS, Internasional, Indonesia, Kripto, Kas & SGOV, Emas, Income. */
export const ASSET_CLASSES = ['us_stocks', 'international', 'indonesia', 'crypto', 'cash', 'gold', 'income'] as const;
export type AssetClass = (typeof ASSET_CLASSES)[number];

/** Where an asset's price comes from (FR-I6): built-in server source, the user's own key, typed in, or computed. */
export const PRICE_MODES = ['server', 'byok', 'manual', 'computed'] as const;
export type PriceMode = (typeof PRICE_MODES)[number];

/** FR-I2: Beli, Jual, Dividen, Top-up kas, Sesuaikan kepemilikan (a correction without cash). */
export const TRADE_KINDS = ['buy', 'sell', 'dividend', 'cash_topup', 'adjust'] as const;
export type TradeKind = (typeof TRADE_KINDS)[number];

/** `pending`: paid, units not allotted yet (a mutual fund order waiting for its NAV); it moves no units or cost. */
export const TRADE_STATUSES = ['settled', 'pending'] as const;
export type TradeStatus = (typeof TRADE_STATUSES)[number];

/** FR-I2 dividend: reinvested (DRIP, new units), kept in the platform's cash, or paid into another account. */
export const DIVIDEND_MODES = ['reinvest', 'cash', 'account'] as const;
export type DividendMode = (typeof DIVIDEND_MODES)[number];

/** FR-I2 sale proceeds: to the platform's cash ("Saldo IDR Indodax") or withdrawn to an account ("Tarik ke BCA"). */
export const SELL_PROCEEDS = ['cash', 'account'] as const;
export type SellProceeds = (typeof SELL_PROCEEDS)[number];

export type InvalidTradeReason = 'units' | 'amount' | 'fee' | 'oversell' | 'dividend' | 'percent';

export class InvalidTradeError extends RangeError {
  override readonly name = 'InvalidTradeError';
  readonly reason: InvalidTradeReason;
  constructor(reason: InvalidTradeReason) {
    super(`Invalid trade: ${reason}`);
    this.reason = reason;
  }
}

/** The asset's quote currency and the user's base currency. */
export interface Currencies {
  readonly quote: string;
  readonly base: string;
}

/** A stored investment trade (`investment_trades`). */
export interface TradeInput {
  readonly kind: TradeKind;
  readonly status: TradeStatus;
  /**
   * Buy/sell: units traded (> 0). Dividend: units bought by a reinvested dividend (> 0), `'0'` otherwise. Adjust: the
   * signed change (≠ 0). Top-up: `'0'`.
   */
  readonly units: string;
  /**
   * Quote-currency minor units. Buy: price paid without fee/tax (> 0). Sell: gross proceeds (≥ 0). Dividend: gross
   * amount (> 0). Adjust: 0. Top-up: the cash added (no effect on a holding).
   */
  readonly amountMinor: bigint;
  readonly feeMinor: bigint;
  readonly taxMinor: bigint;
  /** 1 unit of the quote currency = `fxRate` base units on the trade date (`'1'` when they are the same). */
  readonly fxRate: string;
  readonly dividendMode: DividendMode | null;
}

/** An average-cost holding: what a sequence of trades leaves. */
export interface Holding {
  readonly units: string;
  /** Cost basis of the units held, quote currency. */
  readonly costMinor: bigint;
  /** Cost basis in the base currency at the trade-date rates ("Modal"). */
  readonly costBaseMinor: bigint;
  readonly realizedMinor: bigint;
  readonly realizedBaseMinor: bigint;
  /** Dividends received, net of tax and fee. */
  readonly dividendMinor: bigint;
  readonly dividendBaseMinor: bigint;
}

export const EMPTY_HOLDING: Holding = {
  units: '0',
  costMinor: 0n,
  costBaseMinor: 0n,
  realizedMinor: 0n,
  realizedBaseMinor: 0n,
  dividendMinor: 0n,
  dividendBaseMinor: 0n,
};

/** What one trade changes; every field is a signed delta (stored next to the trade). */
export interface TradeEffect {
  readonly unitsDelta: string;
  readonly costMinor: bigint;
  readonly costBaseMinor: bigint;
  readonly realizedMinor: bigint;
  readonly realizedBaseMinor: bigint;
  readonly dividendMinor: bigint;
  readonly dividendBaseMinor: bigint;
}

const NO_EFFECT: TradeEffect = { ...EMPTY_HOLDING, unitsDelta: '0' };

const minorFactor = (currency: string): bigint => 10n ** BigInt(currencyInfo(currency).minorDigits);
const RATE_SCALE = 10n ** BigInt(RATE_DIGITS);

/** A quote-currency amount in the base currency at `fxRate`. */
export function toBase(amountMinor: bigint, fxRate: string, currencies: Currencies): bigint {
  return convert({ minor: amountMinor, currency: currencies.quote }, currencies.base, {
    base: currencies.quote,
    quote: currencies.base,
    rate: fxRate,
  });
}

/** `units × price` in `currency`'s minor units, rounded half away from zero (units may be negative). */
export function marketValueMinor(units: string, price: string, currency: string): bigint {
  return divideRound(parseDecimal(units) * parseDecimal(price) * minorFactor(currency), DECIMAL_SCALE * DECIMAL_SCALE);
}

/**
 * `units × price × fxRate` in the base currency's minor units, rounded once from the exact product (SPY 1,19647849 ×
 * US$690,10 × 16.350 → Rp13.500.000).
 */
export function marketValueBaseMinor(units: string, price: string, fxRate: string, currencies: Currencies): bigint {
  if (currencies.quote === currencies.base) return marketValueMinor(units, price, currencies.base);
  return divideRound(
    parseDecimal(units) * parseDecimal(price) * parseRate(fxRate) * minorFactor(currencies.base),
    DECIMAL_SCALE * DECIMAL_SCALE * RATE_SCALE,
  );
}

const positive = (value: bigint, reason: InvalidTradeReason): bigint => {
  if (value <= 0n) throw new InvalidTradeError(reason);
  return value;
};

/** The share `part / whole` of `amount` (0 < part ≤ whole), all of it when `part` is everything. */
const shareOf = (amount: bigint, part: bigint, whole: bigint): bigint =>
  part === whole ? amount : divideRound(amount * part, whole);

function removeUnits(holding: Holding, units: bigint): Pick<TradeEffect, 'unitsDelta' | 'costMinor' | 'costBaseMinor'> {
  const held = parseDecimal(holding.units);
  if (units > held) throw new InvalidTradeError('oversell');
  return {
    unitsDelta: formatDecimal(-units),
    costMinor: -shareOf(holding.costMinor, units, held),
    costBaseMinor: -shareOf(holding.costBaseMinor, units, held),
  };
}

/**
 * The effect of `trade` on `holding` (average cost, FR-I2). Pending trades and cash top-ups have none.
 * - buy: + units, + amount to the cost basis (base at the trade-date rate);
 * - sell: − units, − their average cost; realized = gross proceeds − that cost (BTC 1.200.000 of 5.500.000 at cost
 *   3.886.667 → +Rp352.000);
 * - dividend: net (amount − tax − fee) received; reinvested units add no cost ("modal tidak bertambah");
 * - adjust: units up without cost ("Koreksi tanpa modal"), or down with the cost reduced proportionally and nothing
 *   realized ("modal dikurangi proporsional").
 */
export function tradeEffect(holding: Holding, trade: TradeInput, currencies: Currencies): TradeEffect {
  if (trade.feeMinor < 0n || trade.taxMinor < 0n) throw new InvalidTradeError('fee');
  if (trade.status === 'pending' || trade.kind === 'cash_topup') return NO_EFFECT;
  const units = parseDecimal(trade.units);
  switch (trade.kind) {
    case 'buy':
      return {
        ...NO_EFFECT,
        unitsDelta: formatDecimal(positive(units, 'units')),
        costMinor: positive(trade.amountMinor, 'amount'),
        costBaseMinor: toBase(trade.amountMinor, trade.fxRate, currencies),
      };
    case 'sell': {
      if (trade.amountMinor < 0n) throw new InvalidTradeError('amount');
      const removed = removeUnits(holding, positive(units, 'units'));
      return {
        ...NO_EFFECT,
        ...removed,
        realizedMinor: trade.amountMinor + removed.costMinor,
        realizedBaseMinor: toBase(trade.amountMinor, trade.fxRate, currencies) + removed.costBaseMinor,
      };
    }
    case 'dividend': {
      const net = positive(trade.amountMinor, 'amount') - trade.feeMinor - trade.taxMinor;
      const reinvest = trade.dividendMode === 'reinvest';
      if (trade.dividendMode === null || net < 0n || reinvest !== units > 0n || units < 0n) {
        throw new InvalidTradeError('dividend');
      }
      return {
        ...NO_EFFECT,
        unitsDelta: formatDecimal(units),
        dividendMinor: net,
        dividendBaseMinor: toBase(net, trade.fxRate, currencies),
      };
    }
    case 'adjust':
      if (trade.amountMinor !== 0n) throw new InvalidTradeError('amount');
      if (units === 0n) throw new InvalidTradeError('units');
      return units > 0n
        ? { ...NO_EFFECT, unitsDelta: formatDecimal(units) }
        : { ...NO_EFFECT, ...removeUnits(holding, -units) };
  }
}

/** `holding` after `effect`. */
export function applyEffect(holding: Holding, effect: TradeEffect): Holding {
  return {
    units: formatDecimal(parseDecimal(holding.units) + parseDecimal(effect.unitsDelta)),
    costMinor: holding.costMinor + effect.costMinor,
    costBaseMinor: holding.costBaseMinor + effect.costBaseMinor,
    realizedMinor: holding.realizedMinor + effect.realizedMinor,
    realizedBaseMinor: holding.realizedBaseMinor + effect.realizedBaseMinor,
    dividendMinor: holding.dividendMinor + effect.dividendMinor,
    dividendBaseMinor: holding.dividendBaseMinor + effect.dividendBaseMinor,
  };
}

/** The holding built by `trades` in order (throws {@link InvalidTradeError} on the first invalid one). */
export function replayTrades(trades: readonly TradeInput[], currencies: Currencies): Holding {
  return trades.reduce(
    (holding, trade) => applyEffect(holding, tradeEffect(holding, trade, currencies)),
    EMPTY_HOLDING,
  );
}

/**
 * Average price per unit in the quote currency's major units ("Harga rata-rata US$582,45"), exact to 18 digits;
 * `null` without units.
 */
export function averagePrice(holding: Pick<Holding, 'units' | 'costMinor'>, quoteCurrency: string): string | null {
  const units = parseDecimal(holding.units);
  if (units === 0n) return null;
  return formatDecimal(
    divideRound(holding.costMinor * DECIMAL_SCALE * DECIMAL_SCALE, minorFactor(quoteCurrency) * units),
  );
}

/** Market inputs of a buy/sell form: the price (quote major), fee, tax and the rate to the base currency. */
export interface TradeQuote {
  readonly price: string;
  readonly feeMinor: bigint;
  readonly taxMinor: bigint;
  readonly fxRate: string;
}

export type BuyOrder =
  { readonly by: 'amount'; readonly amountMinor: bigint } | { readonly by: 'units'; readonly units: string };

export interface BuyPreview {
  readonly units: string;
  readonly amountMinor: bigint;
  /** Amount + fee + tax: what leaves the cash ("Total keluar US$50,17"). */
  readonly totalMinor: bigint;
  /** "≈ Rp820.280". */
  readonly totalBaseMinor: bigint;
}

const checkQuote = (quote: TradeQuote): bigint => {
  if (quote.feeMinor < 0n || quote.taxMinor < 0n) throw new InvalidTradeError('fee');
  return positive(parseDecimal(quote.price), 'amount');
};

/**
 * FR-I2 Beli by amount (units = amount ÷ price, rounded down to 18 digits: US$50 at US$690,10 → 0,0725…) or by units
 * (amount = units × price, half up).
 */
export function buyPreview(order: BuyOrder, quote: TradeQuote, currencies: Currencies): BuyPreview {
  const price = checkQuote(quote);
  const factor = minorFactor(currencies.quote);
  const units =
    order.by === 'amount'
      ? divideFloor(positive(order.amountMinor, 'amount') * DECIMAL_SCALE * DECIMAL_SCALE, factor * price)
      : positive(parseDecimal(order.units), 'units');
  const amountMinor =
    order.by === 'amount' ? order.amountMinor : marketValueMinor(order.units, quote.price, currencies.quote);
  const totalMinor = amountMinor + quote.feeMinor + quote.taxMinor;
  return {
    units: formatDecimal(positive(units, 'units')),
    amountMinor,
    totalMinor,
    totalBaseMinor: toBase(totalMinor, quote.fxRate, currencies),
  };
}

export type SellOrder =
  { readonly by: 'value'; readonly amountMinor: bigint } | { readonly by: 'percent'; readonly bps: number };

export interface SellPreview {
  readonly units: string;
  readonly grossMinor: bigint;
  /** Gross − fee − tax ("Diterima Rp1.195.300"). */
  readonly netMinor: bigint;
  /** Gross ÷ position value ("21,8% posisi"). */
  readonly positionBps: number;
  readonly realizedMinor: bigint;
  readonly realizedBaseMinor: bigint;
  /** The whole position is sold. */
  readonly all: boolean;
}

/**
 * FR-I2 Jual by value ("Jual senilai", units rounded down; the full position value sells every unit) or by percent of
 * the units (chips 25%/50%; 10 000 bps = all), with the realized gain of {@link tradeEffect}.
 */
export function sellPreview(
  holding: Holding,
  order: SellOrder,
  quote: TradeQuote,
  currencies: Currencies,
): SellPreview {
  const price = checkQuote(quote);
  const held = parseDecimal(holding.units);
  const positionMinor = marketValueMinor(holding.units, quote.price, currencies.quote);
  let units: bigint;
  let grossMinor: bigint;
  if (order.by === 'value') {
    grossMinor = positive(order.amountMinor, 'amount');
    if (grossMinor > positionMinor) throw new InvalidTradeError('oversell');
    const factor = minorFactor(currencies.quote);
    units =
      grossMinor === positionMinor ? held : divideFloor(grossMinor * DECIMAL_SCALE * DECIMAL_SCALE, factor * price);
  } else {
    if (!Number.isInteger(order.bps) || order.bps < 1 || order.bps > 10_000) throw new InvalidTradeError('percent');
    units = divideFloor(held * BigInt(order.bps), 10_000n);
    grossMinor = marketValueMinor(formatDecimal(units), quote.price, currencies.quote);
  }
  const effect = tradeEffect(
    holding,
    {
      kind: 'sell',
      status: 'settled',
      units: formatDecimal(units),
      amountMinor: grossMinor,
      feeMinor: quote.feeMinor,
      taxMinor: quote.taxMinor,
      fxRate: quote.fxRate,
      dividendMode: null,
    },
    currencies,
  );
  return {
    units: formatDecimal(units),
    grossMinor,
    netMinor: grossMinor - quote.feeMinor - quote.taxMinor,
    positionBps: ratioBps(grossMinor, positionMinor) as number,
    realizedMinor: effect.realizedMinor,
    realizedBaseMinor: effect.realizedBaseMinor,
    all: units === held,
  };
}

export interface AdjustmentPreview {
  /** Platform units − recorded units ("Selisih +0,018 unit"). */
  readonly unitsDelta: string;
  readonly valueMinor: bigint;
  /** "≈ Rp203.000" / "≈ −Rp530.000". */
  readonly valueBaseMinor: bigint;
}

/**
 * FR-I2 "Sesuaikan kepemilikan": the difference between the units on the platform and the recorded ones, valued at
 * the current price. More units → an unrecorded buy, a DRIP dividend or a correction; fewer → a sale or a correction.
 */
export function adjustmentPreview(
  holding: Pick<Holding, 'units'>,
  platformUnits: string,
  quote: Pick<TradeQuote, 'price' | 'fxRate'>,
  currencies: Currencies,
): AdjustmentPreview {
  const platform = parseDecimal(platformUnits);
  if (platform < 0n) throw new InvalidTradeError('units');
  const unitsDelta = formatDecimal(platform - parseDecimal(holding.units));
  return {
    unitsDelta,
    valueMinor: marketValueMinor(unitsDelta, quote.price, currencies.quote),
    valueBaseMinor: marketValueBaseMinor(unitsDelta, quote.price, quote.fxRate, currencies),
  };
}
