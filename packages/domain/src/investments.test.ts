// SPDX-License-Identifier: AGPL-3.0-only
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { formatDecimal, parseDecimal, roundDecimal } from './decimal.ts';
import {
  ASSET_CLASSES,
  DIVIDEND_MODES,
  EMPTY_HOLDING,
  InvalidTradeError,
  PRICE_MODES,
  SELL_PROCEEDS,
  TRADE_KINDS,
  TRADE_STATUSES,
  adjustmentPreview,
  applyEffect,
  averagePrice,
  buyPreview,
  marketValueBaseMinor,
  marketValueMinor,
  replayTrades,
  sellPreview,
  toBase,
  tradeEffect,
  type Holding,
  type TradeInput,
} from './investments.ts';

const USD_IDR = { quote: 'USD', base: 'IDR' } as const;
const IDR = { quote: 'IDR', base: 'IDR' } as const;

const trade = (overrides: Partial<TradeInput>): TradeInput => ({
  kind: 'buy',
  status: 'settled',
  units: '1',
  amountMinor: 100n,
  feeMinor: 0n,
  taxMinor: 0n,
  fxRate: '1',
  dividendMode: null,
  ...overrides,
});

function expectTradeError(run: () => unknown, reason: string): void {
  let caught: unknown = null;
  try {
    run();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(InvalidTradeError);
  expect(caught).toBeInstanceOf(RangeError);
  expect((caught as InvalidTradeError).reason).toBe(reason);
  expect((caught as InvalidTradeError).name).toBe('InvalidTradeError');
  expect((caught as InvalidTradeError).message).toBe(`Invalid trade: ${reason}`);
}

/**
 * Design CtiSh (Detail aset SPY): Jan–Agu 2026 0,565 unit "6 pembelian · Rp4.400.000" (one lot here), 1 Sep DCA 0,276
 * unit @ US$664,80 = Rp3.000.000, 1 Okt DCA 0,356 unit @ US$686,20 = Rp4.000.000. The trade-date rates are the ones
 * that make those rupiah amounts.
 */
const SPY_TRADES: TradeInput[] = [
  trade({ units: '0.565', amountMinor: 26_942n, fxRate: '16331.37851681' }),
  trade({ units: '0.276', amountMinor: 18_348n, fxRate: '16350.5559189' }),
  trade({ units: '0.356', amountMinor: 24_429n, fxRate: '16373.98174301' }),
];

/** Design BTC (Indodax): value Rp5.500.000, cost Rp3.886.667 (+Rp1.610.000 · +41,5%). */
const BTC: Holding = { ...EMPTY_HOLDING, units: '0.003767123', costMinor: 3_886_667n, costBaseMinor: 3_886_667n };
const BTC_QUOTE = { price: '1460000000', feeMinor: 3_500n, taxMinor: 1_200n, fxRate: '1' };

describe('enums', () => {
  it('match the schema literals agreed with M5Data', () => {
    expect(ASSET_CLASSES).toEqual(['us_stocks', 'international', 'indonesia', 'crypto', 'cash', 'gold', 'income']);
    expect(PRICE_MODES).toEqual(['server', 'byok', 'manual', 'computed']);
    expect(TRADE_KINDS).toEqual(['buy', 'sell', 'dividend', 'cash_topup', 'adjust']);
    expect(TRADE_STATUSES).toEqual(['settled', 'pending']);
    expect(DIVIDEND_MODES).toEqual(['reinvest', 'cash', 'account']);
    expect(SELL_PROCEEDS).toEqual(['cash', 'account']);
  });
});

describe('market values', () => {
  it('converts with the trade rate, rounding half away from zero', () => {
    expect(toBase(5_017n, '16350', USD_IDR)).toBe(820_280n);
    expect(toBase(1_200_000n, '1', IDR)).toBe(1_200_000n);
  });

  it('values units × price exactly before rounding once', () => {
    expect(marketValueMinor('1.197', '690.10', 'USD')).toBe(82_605n);
    expect(marketValueMinor('-0.047', '690.10', 'USD')).toBe(-3_243n);
    expect(marketValueBaseMinor('1.196476', '690.10', '16350', USD_IDR)).toBe(13_500_000n);
    expect(marketValueBaseMinor('0.003767123', '1460000000', '999', IDR)).toBe(5_500_000n);
    // Into a base with cents: 1.000 × Rp16.350 × 0,00006116 = US$999,966.
    expect(marketValueBaseMinor('1000', '16350', '0.00006116', { quote: 'IDR', base: 'USD' })).toBe(99_997n);
  });
});

describe('tradeEffect / replayTrades (average cost, FR-I2)', () => {
  it('builds the SPY holding of the design: 1,197 units, Rp11.400.000, average US$582,45', () => {
    const spy = replayTrades(SPY_TRADES, USD_IDR);
    expect(spy).toEqual({
      ...EMPTY_HOLDING,
      units: '1.197',
      costMinor: 69_719n,
      costBaseMinor: 11_400_000n,
    });
    const average = averagePrice(spy, 'USD') as string;
    expect(formatDecimal(roundDecimal(parseDecimal(average), 2))).toBe('582.45');
    expect(average).toBe('582.447786131996658312');
  });

  it('ignores pending trades and cash top-ups', () => {
    expect(tradeEffect(EMPTY_HOLDING, trade({ status: 'pending' }), IDR)).toEqual({
      ...EMPTY_HOLDING,
      unitsDelta: '0',
    });
    expect(tradeEffect(EMPTY_HOLDING, trade({ kind: 'cash_topup', units: '0' }), IDR)).toEqual({
      ...EMPTY_HOLDING,
      unitsDelta: '0',
    });
  });

  it('keeps fees and taxes out of the cost basis', () => {
    const effect = tradeEffect(
      EMPTY_HOLDING,
      trade({ amountMinor: 5_000n, feeMinor: 15n, taxMinor: 2n, fxRate: '16350' }),
      USD_IDR,
    );
    expect(effect).toEqual({ ...EMPTY_HOLDING, unitsDelta: '1', costMinor: 5_000n, costBaseMinor: 817_500n });
  });

  it('realizes gross proceeds − average cost on a sale (design JejMv BTC +Rp352.000)', () => {
    const effect = tradeEffect(
      BTC,
      trade({
        kind: 'sell',
        units: '0.000821917808219178',
        amountMinor: 1_200_000n,
        feeMinor: 3_500n,
        taxMinor: 1_200n,
      }),
      IDR,
    );
    expect(effect).toEqual({
      ...EMPTY_HOLDING,
      unitsDelta: '-0.000821917808219178',
      costMinor: -848_000n,
      costBaseMinor: -848_000n,
      realizedMinor: 352_000n,
      realizedBaseMinor: 352_000n,
    });
    expect(applyEffect(BTC, effect)).toEqual({
      ...EMPTY_HOLDING,
      units: '0.002945205191780822',
      costMinor: 3_038_667n,
      costBaseMinor: 3_038_667n,
      realizedMinor: 352_000n,
      realizedBaseMinor: 352_000n,
    });
  });

  it('realizes in the base currency at both trade-date rates', () => {
    const bought = replayTrades([trade({ units: '2', amountMinor: 10_000n, fxRate: '15000' })], USD_IDR);
    const effect = tradeEffect(
      bought,
      trade({ kind: 'sell', units: '1', amountMinor: 6_000n, fxRate: '16000' }),
      USD_IDR,
    );
    expect(effect.realizedMinor).toBe(1_000n);
    expect(effect.realizedBaseMinor).toBe(960_000n - 750_000n);
  });

  it('removes every unit of cost when the whole position is sold', () => {
    const holding = replayTrades(
      [trade({ units: '3', amountMinor: 100n }), trade({ kind: 'sell', units: '1', amountMinor: 50n })],
      IDR,
    );
    expect(holding.costMinor).toBe(67n);
    const all = applyEffect(holding, tradeEffect(holding, trade({ kind: 'sell', units: '2', amountMinor: 0n }), IDR));
    expect(all).toEqual({ ...EMPTY_HOLDING, realizedMinor: 50n - 33n - 67n, realizedBaseMinor: 50n - 33n - 67n });
  });

  it('records dividends net of tax and fee; DRIP units add no cost ("modal tidak bertambah")', () => {
    const spy = replayTrades(SPY_TRADES, USD_IDR);
    const drip = tradeEffect(
      spy,
      trade({
        kind: 'dividend',
        units: '0.0074',
        amountMinor: 510n,
        taxMinor: 77n,
        feeMinor: 3n,
        fxRate: '16350',
        dividendMode: 'reinvest',
      }),
      USD_IDR,
    );
    expect(drip).toEqual({ ...EMPTY_HOLDING, unitsDelta: '0.0074', dividendMinor: 430n, dividendBaseMinor: 70_305n });
    const cash = tradeEffect(
      spy,
      trade({ kind: 'dividend', units: '0', amountMinor: 132_000n, taxMinor: 20_000n, dividendMode: 'account' }),
      IDR,
    );
    expect(cash).toEqual({ ...EMPTY_HOLDING, unitsDelta: '0', dividendMinor: 112_000n, dividendBaseMinor: 112_000n });
    const twice = replayTrades(
      [
        trade({ units: '1', amountMinor: 1_000n }),
        trade({ kind: 'dividend', units: '0', amountMinor: 30n, dividendMode: 'cash' }),
        trade({ kind: 'dividend', units: '0.1', amountMinor: 50n, taxMinor: 5n, dividendMode: 'reinvest' }),
      ],
      IDR,
    );
    expect(twice).toEqual({
      ...EMPTY_HOLDING,
      units: '1.1',
      costMinor: 1_000n,
      costBaseMinor: 1_000n,
      dividendMinor: 75n,
      dividendBaseMinor: 75n,
    });
    const zeroNet = tradeEffect(
      spy,
      trade({ kind: 'dividend', units: '0', amountMinor: 10n, taxMinor: 10n, dividendMode: 'cash' }),
      IDR,
    );
    expect(zeroNet.dividendMinor).toBe(0n);
  });

  it('adjusts units without cash: more units cost nothing, fewer reduce the cost proportionally', () => {
    const spy = replayTrades(SPY_TRADES, USD_IDR);
    expect(tradeEffect(spy, trade({ kind: 'adjust', units: '0.018', amountMinor: 0n }), USD_IDR)).toEqual({
      ...EMPTY_HOLDING,
      unitsDelta: '0.018',
    });
    const fewer = tradeEffect(spy, trade({ kind: 'adjust', units: '-0.047', amountMinor: 0n }), USD_IDR);
    expect(fewer).toEqual({ ...EMPTY_HOLDING, unitsDelta: '-0.047', costMinor: -2_738n, costBaseMinor: -447_619n });
  });

  it('refuses invalid trades', () => {
    expectTradeError(() => tradeEffect(EMPTY_HOLDING, trade({ feeMinor: -1n }), IDR), 'fee');
    expectTradeError(() => tradeEffect(EMPTY_HOLDING, trade({ taxMinor: -1n, status: 'pending' }), IDR), 'fee');
    expectTradeError(() => tradeEffect(EMPTY_HOLDING, trade({ units: '0' }), IDR), 'units');
    expectTradeError(() => tradeEffect(EMPTY_HOLDING, trade({ units: '-1' }), IDR), 'units');
    expectTradeError(() => tradeEffect(EMPTY_HOLDING, trade({ amountMinor: 0n }), IDR), 'amount');
    expectTradeError(() => tradeEffect(BTC, trade({ kind: 'sell', amountMinor: -1n, units: '0.001' }), IDR), 'amount');
    expectTradeError(() => tradeEffect(BTC, trade({ kind: 'sell', units: '0' }), IDR), 'units');
    expectTradeError(() => tradeEffect(BTC, trade({ kind: 'sell', units: '0.003767124' }), IDR), 'oversell');
    const dividend = { kind: 'dividend', units: '0', dividendMode: 'cash' } as const;
    expectTradeError(() => tradeEffect(BTC, trade({ ...dividend, amountMinor: 0n }), IDR), 'amount');
    expectTradeError(() => tradeEffect(BTC, trade({ ...dividend, dividendMode: null }), IDR), 'dividend');
    expectTradeError(() => tradeEffect(BTC, trade({ ...dividend, amountMinor: 10n, taxMinor: 11n }), IDR), 'dividend');
    expectTradeError(() => tradeEffect(BTC, trade({ ...dividend, units: '1' }), IDR), 'dividend');
    expectTradeError(() => tradeEffect(BTC, trade({ ...dividend, units: '-1' }), IDR), 'dividend');
    expectTradeError(() => tradeEffect(BTC, trade({ ...dividend, dividendMode: 'reinvest' }), IDR), 'dividend');
    expectTradeError(
      () => tradeEffect(BTC, trade({ ...dividend, dividendMode: 'reinvest', units: '-1' }), IDR),
      'dividend',
    );
    expectTradeError(() => tradeEffect(BTC, trade({ kind: 'adjust', units: '1', amountMinor: 1n }), IDR), 'amount');
    expectTradeError(() => tradeEffect(BTC, trade({ kind: 'adjust', units: '0', amountMinor: 0n }), IDR), 'units');
    expectTradeError(() => tradeEffect(BTC, trade({ kind: 'adjust', units: '-1', amountMinor: 0n }), IDR), 'oversell');
    expectTradeError(() => replayTrades([trade({ kind: 'sell' })], IDR), 'oversell');
  });

  it('has no average price without units', () => {
    expect(averagePrice(EMPTY_HOLDING, 'USD')).toBeNull();
    expect(averagePrice({ units: '4', costMinor: 1_000n }, 'IDR')).toBe('250');
  });

  it('property: units and cost are conserved over any trade sequence', () => {
    const step = fc.record({
      kind: fc.constantFrom('buy', 'sell', 'adjust', 'dividend', 'cash_topup'),
      pending: fc.boolean(),
      units: fc.bigInt({ min: 1n, max: 10n ** 21n }),
      amountMinor: fc.bigInt({ min: 1n, max: 10n ** 12n }),
      share: fc.integer({ min: 1, max: 10_000 }),
      up: fc.boolean(),
      fx: fc.integer({ min: 1, max: 20_000 }),
    });
    fc.assert(
      fc.property(fc.array(step, { maxLength: 30 }), (steps) => {
        let holding = EMPTY_HOLDING;
        let units = 0n;
        let costIn = 0n;
        let costOut = 0n;
        let realized = 0n;
        let proceeds = 0n;
        for (const s of steps) {
          const held = parseDecimal(holding.units);
          const take = (held * BigInt(s.share)) / 10_000n;
          let input: TradeInput;
          if (s.kind === 'sell' || (s.kind === 'adjust' && !s.up)) {
            if (take === 0n) continue;
            input = trade({
              kind: s.kind,
              units: formatDecimal(s.kind === 'sell' ? take : -take),
              amountMinor: s.kind === 'sell' ? s.amountMinor : 0n,
            });
          } else if (s.kind === 'adjust') {
            input = trade({ kind: 'adjust', units: formatDecimal(s.units), amountMinor: 0n });
          } else if (s.kind === 'dividend') {
            input = trade({
              kind: 'dividend',
              units: s.up ? formatDecimal(s.units) : '0',
              amountMinor: s.amountMinor,
              dividendMode: s.up ? 'reinvest' : 'cash',
            });
          } else {
            input = trade({ kind: s.kind, units: formatDecimal(s.units), amountMinor: s.amountMinor });
          }
          input = { ...input, status: s.pending ? 'pending' : 'settled', fxRate: String(s.fx) };
          const effect = tradeEffect(holding, input, USD_IDR);
          holding = applyEffect(holding, effect);
          units += parseDecimal(effect.unitsDelta);
          if (effect.costMinor > 0n) costIn += effect.costMinor;
          else costOut -= effect.costMinor;
          realized += effect.realizedMinor;
          if (input.kind === 'sell' && !s.pending) proceeds += input.amountMinor;
          expect(parseDecimal(holding.units)).toBeGreaterThanOrEqual(0n);
          expect(holding.costMinor).toBeGreaterThanOrEqual(0n);
          expect(holding.costBaseMinor).toBeGreaterThanOrEqual(0n);
          if (holding.units === '0') expect([holding.costMinor, holding.costBaseMinor]).toEqual([0n, 0n]);
        }
        expect(parseDecimal(holding.units)).toBe(units);
        expect(holding.costMinor).toBe(costIn - costOut);
        expect(holding.realizedMinor).toBe(realized);
        // Realized + removed cost of sales = proceeds (adjustments remove cost without proceeds).
        expect(realized).toBeLessThanOrEqual(proceeds);
      }),
    );
  });
});

describe('buyPreview (FR-I2 Beli, design KDF13)', () => {
  const quote = { price: '690.10', feeMinor: 15n, taxMinor: 2n, fxRate: '16350' };

  it('by amount: US$50 → 0,0725 unit, total US$50,17 ≈ Rp820.280', () => {
    const preview = buyPreview({ by: 'amount', amountMinor: 5_000n }, quote, USD_IDR);
    expect(preview).toEqual({
      units: '0.07245326764237067',
      amountMinor: 5_000n,
      totalMinor: 5_017n,
      totalBaseMinor: 820_280n,
    });
    expect(formatDecimal(roundDecimal(parseDecimal(preview.units), 4))).toBe('0.0725');
  });

  it('by units: the amount is units × price, half up', () => {
    expect(buyPreview({ by: 'units', units: '0.0725' }, quote, USD_IDR)).toEqual({
      units: '0.0725',
      amountMinor: 5_003n,
      totalMinor: 5_020n,
      totalBaseMinor: 820_770n,
    });
  });

  it('accepts a buy without fee or tax', () => {
    expect(
      buyPreview({ by: 'units', units: '2' }, { price: '10', feeMinor: 0n, taxMinor: 0n, fxRate: '1' }, IDR),
    ).toEqual({
      units: '2',
      amountMinor: 20n,
      totalMinor: 20n,
      totalBaseMinor: 20n,
    });
  });

  it('refuses empty orders, a missing price and negative fees', () => {
    expectTradeError(() => buyPreview({ by: 'amount', amountMinor: 0n }, quote, USD_IDR), 'amount');
    expectTradeError(
      () => buyPreview({ by: 'amount', amountMinor: 1n }, { ...quote, price: '1000000000000000000' }, USD_IDR),
      'units',
    );
    expectTradeError(() => buyPreview({ by: 'units', units: '0' }, quote, USD_IDR), 'units');
    expectTradeError(() => buyPreview({ by: 'units', units: '1' }, { ...quote, price: '0' }, USD_IDR), 'amount');
    expectTradeError(() => buyPreview({ by: 'units', units: '1' }, { ...quote, feeMinor: -1n }, USD_IDR), 'fee');
    expectTradeError(() => buyPreview({ by: 'units', units: '1' }, { ...quote, taxMinor: -1n }, USD_IDR), 'fee');
  });
});

describe('sellPreview (FR-I2 Jual, design JejMv)', () => {
  it('by value: Jual senilai Rp1.200.000 = 21,8% posisi, diterima Rp1.195.300, untung +Rp352.000', () => {
    expect(sellPreview(BTC, { by: 'value', amountMinor: 1_200_000n }, BTC_QUOTE, IDR)).toEqual({
      units: '0.000821917808219178',
      grossMinor: 1_200_000n,
      netMinor: 1_195_300n,
      positionBps: 2182,
      realizedMinor: 352_000n,
      realizedBaseMinor: 352_000n,
      all: false,
    });
  });

  it('by value: the whole position value sells every unit; more is refused', () => {
    const all = sellPreview(BTC, { by: 'value', amountMinor: 5_500_000n }, BTC_QUOTE, IDR);
    expect(all).toMatchObject({ units: '0.003767123', positionBps: 10_000, realizedMinor: 1_613_333n, all: true });
    expectTradeError(() => sellPreview(BTC, { by: 'value', amountMinor: 5_500_001n }, BTC_QUOTE, IDR), 'oversell');
    expectTradeError(() => sellPreview(BTC, { by: 'value', amountMinor: 0n }, BTC_QUOTE, IDR), 'amount');
  });

  it('by percent: chips 25% / 50% / 100%', () => {
    expect(sellPreview(BTC, { by: 'percent', bps: 2500 }, BTC_QUOTE, IDR)).toEqual({
      units: '0.00094178075',
      grossMinor: 1_375_000n,
      netMinor: 1_370_300n,
      positionBps: 2500,
      realizedMinor: 403_333n,
      realizedBaseMinor: 403_333n,
      all: false,
    });
    expect(sellPreview(BTC, { by: 'percent', bps: 1 }, BTC_QUOTE, IDR)).toMatchObject({
      units: '0.0000003767123',
      grossMinor: 550n,
      positionBps: 1,
    });
    expect(sellPreview(BTC, { by: 'percent', bps: 10_000 }, BTC_QUOTE, IDR)).toMatchObject({
      all: true,
      grossMinor: 5_500_000n,
    });
    for (const bps of [0, 10_001, 12.5]) {
      expectTradeError(() => sellPreview(BTC, { by: 'percent', bps }, BTC_QUOTE, IDR), 'percent');
    }
    expectTradeError(() => sellPreview(BTC, { by: 'percent', bps: 1 }, { ...BTC_QUOTE, price: '0' }, IDR), 'amount');
    expectTradeError(() => sellPreview(EMPTY_HOLDING, { by: 'percent', bps: 5000 }, BTC_QUOTE, IDR), 'units');
  });
});

describe('adjustmentPreview (Sesuaikan kepemilikan, j2SH8r / oExkI)', () => {
  const quote = { price: '690.10', fxRate: '16350' };

  it('values the difference with the platform at the current price', () => {
    expect(adjustmentPreview({ units: '1.197' }, '1.215', quote, USD_IDR)).toEqual({
      unitsDelta: '0.018',
      valueMinor: 1_242n,
      valueBaseMinor: 203_096n,
    });
    expect(adjustmentPreview({ units: '1.197' }, '1.150', quote, USD_IDR)).toEqual({
      unitsDelta: '-0.047',
      valueMinor: -3_243n,
      valueBaseMinor: -530_307n,
    });
  });

  it('values selling everything on the platform', () => {
    expect(adjustmentPreview({ units: '1.197' }, '0', quote, USD_IDR)).toMatchObject({
      unitsDelta: '-1.197',
      valueMinor: -82_605n,
    });
  });

  it('refuses negative platform units', () => {
    expectTradeError(() => adjustmentPreview({ units: '1' }, '-1', quote, USD_IDR), 'units');
  });
});
