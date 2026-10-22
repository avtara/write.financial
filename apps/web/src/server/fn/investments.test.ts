// SPDX-License-Identifier: AGPL-3.0-only
import { LedgerError } from '@wf/db/ledger-errors';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeSession } from '../../../test/fixtures.ts';
import { call, requestContext, validatorOf } from '../../../test/server-fn.ts';
import * as fns from './investments.ts';

const fake = vi.hoisted(() => ({
  investments: {
    portfolio: vi.fn(),
    snapshots: vi.fn(),
    asset: vi.fn(),
    trades: vi.fn(),
    createAsset: vi.fn(),
    updateAsset: vi.fn(),
    removeAsset: vi.fn(),
    moveAsset: vi.fn(),
    setTargets: vi.fn(),
    recordTrade: vi.fn(),
    adjustHoldings: vi.fn(),
  },
  marketData: { benchmarks: vi.fn() },
  fxRates: { referenceRate: vi.fn() },
  goals: { list: vi.fn(), setAssetAllocations: vi.fn() },
}));

// vi.mock factories run before imports; they load the shared helper themselves.
vi.mock('@tanstack/react-start', async () => (await import('../../../test/server-fn.ts')).serverFnModule());
vi.mock('../runtime.ts', () => ({
  services: () => Promise.resolve({ ...fake, now: () => new Date('2026-10-15T02:42:00Z') }),
}));

const USER_ID = fakeSession().user.id;
const context = () => requestContext(fakeSession());
const ASSET = '0192a6c4-0000-7000-8000-000000000001';
const PLATFORM = '0192a6c4-0000-7000-8000-000000000002';
const GOAL = '0192a6c4-0000-7000-8000-000000000003';
const OTHER = '0192a6c4-0000-7000-8000-000000000004';
const CLIENT = '0192a6c4-0000-7000-8000-000000000005';
const AT = new Date('2026-10-15T12:50:00Z');

const quote = {
  price: '690.1',
  prevClose: '686.2',
  source: 'manual',
  provider: null,
  asOf: 1,
  stale: false,
  label: 'manual',
};
const spy = {
  id: ASSET,
  accountId: PLATFORM,
  platformName: 'Gotrade',
  symbol: 'SPY',
  name: 'SPDR S&P 500 ETF',
  quoteCurrency: 'USD',
  assetClass: 'us_stocks',
  market: 'us_equity',
  holding: { units: '1.197' },
  pendingBaseMinor: 0n,
  quote,
  value: { valueBaseMinor: 13_500_000n, todayBaseMinor: 75_000n },
  goals: [{ goalId: GOAL, bps: 6000 }],
  freeBps: 4000,
};

beforeEach(() => {
  vi.clearAllMocks();
  fake.investments.portfolio.mockResolvedValue({
    baseCurrency: 'IDR',
    today: '2026-10-15',
    platforms: [{ currency: 'USD' }, { currency: 'IDR' }, { currency: 'EUR' }],
    assets: [spy],
  });
  fake.investments.snapshots.mockResolvedValue(['sep']);
  fake.marketData.benchmarks.mockResolvedValue(['spy']);
  fake.fxRates.referenceRate.mockImplementation((_user: string, base: string) =>
    Promise.resolve(base === 'USD' ? { rate: '16350' } : null),
  );
  fake.goals.list.mockResolvedValue([
    { id: GOAL, name: 'DP Rumah', currency: 'IDR' },
    { id: OTHER, name: 'Dollar', currency: 'USD' },
  ]);
});

describe('reading the portfolio', () => {
  it('answers the page: portfolio, snapshots, this year’s benchmarks, current rates, and base-currency goals', async () => {
    expect(await call(fns.getInvestments, { context: context(), data: {} })).toEqual({
      ok: true,
      value: {
        portfolio: expect.objectContaining({ baseCurrency: 'IDR' }),
        snapshots: ['sep'],
        benchmarks: ['spy'],
        rates: { USD: '16350' },
        goals: [{ id: GOAL, name: 'DP Rumah' }],
      },
    });
    expect(fake.marketData.benchmarks).toHaveBeenCalledWith(USER_ID, { year: 2026 });
    expect(fake.fxRates.referenceRate.mock.calls.map((args) => args.slice(1))).toEqual([
      ['USD', 'IDR'],
      ['EUR', 'IDR'],
    ]);
    expect(fake.goals.list).toHaveBeenCalledWith(USER_ID, { status: 'active' });
  });

  it('asks for the USD rate even without a USD platform, never for the base currency', async () => {
    fake.investments.portfolio.mockResolvedValueOnce({ baseCurrency: 'USD', today: '2026-10-15', platforms: [] });
    expect(await call(fns.getInvestments, { context: context(), data: {} })).toMatchObject({
      ok: true,
      value: { rates: {} },
    });
    expect(fake.fxRates.referenceRate).not.toHaveBeenCalled();
  });

  it('lists an asset’s trades only after finding the asset (another user’s is NOT_FOUND)', async () => {
    fake.investments.trades.mockResolvedValueOnce(['buy']);
    expect(await call(fns.getAssetTrades, { context: context(), data: { assetId: ASSET } })).toEqual({
      ok: true,
      value: ['buy'],
    });
    expect(fake.investments.trades).toHaveBeenCalledWith(USER_ID, { assetId: ASSET });
    fake.investments.asset.mockRejectedValueOnce(new LedgerError('NOT_FOUND', 'no'));
    expect(await call(fns.getAssetTrades, { context: context(), data: { assetId: ASSET } })).toEqual({
      ok: false,
      code: 'NOT_FOUND',
    });
  });

  it('lists the assets for goal sources with value, today’s change, quote, goals, and the free share', async () => {
    fake.investments.portfolio.mockResolvedValueOnce({
      assets: [spy, { ...spy, id: OTHER, value: null, quote: null, pendingBaseMinor: 5n }],
    });
    expect(await call(fns.listInvestmentAssets, { context: context(), data: {} })).toEqual({
      ok: true,
      value: [
        {
          id: ASSET,
          symbol: 'SPY',
          name: 'SPDR S&P 500 ETF',
          platformName: 'Gotrade',
          assetClass: 'us_stocks',
          units: '1.197',
          valueBaseMinor: 13_500_000n,
          todayBaseMinor: 75_000n,
          quote,
          goals: [{ goalId: GOAL, bps: 6000 }],
          freeBps: 4000,
        },
        expect.objectContaining({ id: OTHER, valueBaseMinor: null, todayBaseMinor: null, quote: null }),
      ],
    });
  });

  it('refuses without a session', async () => {
    expect(await call(fns.getInvestments, { context: requestContext(null), data: {} })).toEqual({
      ok: false,
      code: 'UNAUTHENTICATED',
    });
  });
});

describe('assets, categories, and targets', () => {
  it('creates, edits, moves, and removes an asset', async () => {
    fake.investments.createAsset.mockResolvedValueOnce(spy);
    const input = {
      accountId: PLATFORM,
      symbol: 'SPY',
      name: 'SPDR S&P 500 ETF',
      assetClass: 'us_stocks',
      market: 'us_equity',
      priceMode: 'manual',
      manualPrice: '690.10',
      manualPriceAt: AT,
      categoryId: undefined,
    };
    expect(await call(fns.createInvestmentAsset, { context: context(), data: input })).toEqual({ ok: true, value: spy });
    const { categoryId: _skipped, ...sent } = input;
    expect(fake.investments.createAsset).toHaveBeenCalledWith(USER_ID, sent);
    fake.investments.updateAsset.mockResolvedValueOnce(spy);
    await call(fns.updateInvestmentAsset, {
      context: context(),
      data: { id: ASSET, patch: { assetClass: 'income', name: undefined } },
    });
    expect(fake.investments.updateAsset).toHaveBeenCalledWith(USER_ID, ASSET, { assetClass: 'income' });
    expect(
      await call(fns.moveInvestmentAsset, { context: context(), data: { assetId: ASSET, categoryId: null } }),
    ).toEqual({ ok: true, value: null });
    expect(fake.investments.moveAsset).toHaveBeenCalledWith(USER_ID, ASSET, null);
    expect(await call(fns.removeInvestmentAsset, { context: context(), data: { id: ASSET } })).toEqual({
      ok: true,
      value: null,
    });
    expect(fake.investments.removeAsset).toHaveBeenCalledWith(USER_ID, ASSET);
  });

  it('saves the allocation targets, passing a refused total on as its code', async () => {
    const targets = { us_stocks: 5000, international: 1200, indonesia: 1200, crypto: 700, cash: 800, gold: 500 };
    expect(
      await call(fns.setAllocationTargets, { context: context(), data: { targets: { ...targets, income: 600 } } }),
    ).toEqual({ ok: true, value: null });
    expect(fake.investments.setTargets).toHaveBeenCalledWith(USER_ID, { ...targets, income: 600 });
    fake.investments.setTargets.mockRejectedValueOnce(new LedgerError('INVALID_ASSET', 'total'));
    expect(await call(fns.setAllocationTargets, { context: context(), data: { targets } })).toEqual({
      ok: false,
      code: 'INVALID_ASSET',
    });
  });
});

describe('trades', () => {
  it('records a buy, a sell with its goal choice, a dividend, and a top-up', async () => {
    fake.investments.recordTrade.mockResolvedValue({ id: 'trade' });
    const buy = {
      kind: 'buy',
      clientId: CLIENT,
      occurredAt: AT,
      assetId: ASSET,
      units: '0.0725',
      price: '690.10',
      amountMinor: 5000n,
      feeMinor: 15n,
      taxMinor: 2n,
      fxRate: '16350',
      description: undefined,
    };
    expect(await call(fns.recordInvestmentTrade, { context: context(), data: buy })).toEqual({
      ok: true,
      value: { id: 'trade' },
    });
    const { description: _none, ...sentBuy } = buy;
    expect(fake.investments.recordTrade).toHaveBeenLastCalledWith(USER_ID, sentBuy);
    const sell = { ...sentBuy, kind: 'sell', units: '0.047', proceedsAccountId: OTHER, reduceGoalId: GOAL };
    await call(fns.recordInvestmentTrade, { context: context(), data: sell });
    expect(fake.investments.recordTrade).toHaveBeenLastCalledWith(USER_ID, sell);
    fake.investments.recordTrade.mockRejectedValueOnce(new LedgerError('INVALID_TRADE', 'choice'));
    expect(await call(fns.recordInvestmentTrade, { context: context(), data: sell })).toEqual({
      ok: false,
      code: 'INVALID_TRADE',
    });
  });

  it('adjusts the holdings to the platform’s units', async () => {
    fake.investments.adjustHoldings.mockResolvedValueOnce({ id: 'adjust' });
    const input = {
      clientId: CLIENT,
      assetId: ASSET,
      occurredAt: AT,
      units: '1.215',
      reason: 'unrecorded_buy',
      amountMinor: 1242n,
      price: null,
      fxRate: undefined,
    };
    expect(await call(fns.adjustInvestmentHoldings, { context: context(), data: input })).toEqual({
      ok: true,
      value: { id: 'adjust' },
    });
    const { fxRate: _rate, ...sent } = input;
    expect(fake.investments.adjustHoldings).toHaveBeenCalledWith(USER_ID, sent);
  });

  it('sets every goal’s share of an asset at once', async () => {
    expect(
      await call(fns.setAssetGoals, {
        context: context(),
        data: {
          assetId: ASSET,
          sources: [
            { goalId: GOAL, mode: 'percent', pctBps: 6000 },
            { goalId: OTHER, mode: 'whole', pctBps: undefined },
          ],
        },
      }),
    ).toEqual({ ok: true, value: null });
    expect(fake.goals.setAssetAllocations).toHaveBeenCalledWith(USER_ID, ASSET, [
      { goalId: GOAL, mode: 'percent', pctBps: 6000 },
      { goalId: OTHER, mode: 'whole' },
    ]);
  });
});

describe('validation', () => {
  it('accepts decimal units, prices and rates, and the trade kinds, refusing anything else', () => {
    const trade = validatorOf(fns.recordInvestmentTrade);
    const buy = {
      kind: 'buy',
      clientId: CLIENT,
      occurredAt: AT,
      assetId: ASSET,
      units: '0.0725',
      amountMinor: 5000n,
    };
    expect(trade.safeParse(buy).success).toBe(true);
    expect(trade.safeParse({ ...buy, units: '-1' }).success).toBe(false);
    expect(trade.safeParse({ ...buy, units: '1.0000000000000000001' }).success).toBe(false);
    expect(trade.safeParse({ ...buy, fxRate: '16350.123456789' }).success).toBe(false);
    expect(trade.safeParse({ ...buy, feeMinor: -1n }).success).toBe(false);
    expect(trade.safeParse({ ...buy, kind: 'adjust' }).success).toBe(false);
    expect(
      trade.safeParse({
        kind: 'dividend',
        clientId: CLIENT,
        occurredAt: AT,
        assetId: ASSET,
        amountMinor: 11_200n,
        taxMinor: 2_000n,
        mode: 'reinvest',
        units: '0.01',
      }).success,
    ).toBe(true);
    expect(
      trade.safeParse({
        kind: 'cash_topup',
        clientId: CLIENT,
        occurredAt: AT,
        accountId: PLATFORM,
        fromAccountId: OTHER,
        sentMinor: 0n,
      }).success,
    ).toBe(false);
    const asset = validatorOf(fns.createInvestmentAsset);
    const fields = { accountId: PLATFORM, symbol: ' SPY ', name: 'SPY', assetClass: 'us_stocks', market: 'us_equity' };
    expect(asset.parse(fields)).toMatchObject({ symbol: 'SPY' });
    expect(asset.safeParse({ ...fields, assetClass: 'bonds' }).success).toBe(false);
    expect(asset.safeParse({ ...fields, market: 'nyse' }).success).toBe(false);
    expect(asset.safeParse({ ...fields, symbol: 'X'.repeat(21) }).success).toBe(false);
    const targets = validatorOf(fns.setAllocationTargets);
    expect(targets.safeParse({ targets: { us_stocks: 10_000 } }).success).toBe(true);
    expect(targets.safeParse({ targets: { bonds: 10_000 } }).success).toBe(false);
    expect(targets.safeParse({ targets: { us_stocks: 10_001 } }).success).toBe(false);
    expect(targets.safeParse({ targets: { us_stocks: 50.5 } }).success).toBe(false);
    const goals = validatorOf(fns.setAssetGoals);
    expect(goals.safeParse({ assetId: ASSET, sources: [{ goalId: GOAL, mode: 'part' }] }).success).toBe(false);
    const adjust = validatorOf(fns.adjustInvestmentHoldings);
    expect(
      adjust.safeParse({ clientId: CLIENT, assetId: ASSET, occurredAt: AT, units: '1', reason: 'sale' }).success,
    ).toBe(false);
  });
});
