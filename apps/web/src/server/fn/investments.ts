// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Investasi" (FR-I1–I4, FR-G2/G5): the portfolio with its growth snapshots, YTD benchmarks and current rates, an
 * asset's trades, assets and their "Daftar saya" category, allocation targets, trades (buy, sell, dividend, cash
 * top-up), "Sesuaikan kepemilikan", and the goals an asset funds. Valuation, drift, and the rebalancing calculator
 * are `@wf/domain/valuation` on the page: nothing here suggests or records a rebalancing trade. Quotes come from the
 * market data cache as the worker left it (the user's own BYOK results only). The user always comes from the session.
 */
import { createServerFn } from '@tanstack/react-start';
import type { AssetView, PortfolioSnapshotInput, PortfolioView, TradeView } from '@wf/db/investments';
import type { BenchmarkView } from '@wf/db/market-data';
import { GOAL_ASSET_SOURCE_MODES } from '@wf/domain/goal-assets';
import { ASSET_CLASSES, DIVIDEND_MODES, PRICE_MODES, type AssetClass } from '@wf/domain/investments';
import { MARKETS, type ResolvedQuote } from '@wf/domain/market';
import * as z from 'zod';
import { attempt, requireSession, type Result } from '../access.ts';
import { defined } from '../inputs.ts';
import { services, type Services } from '../runtime.ts';

const id = z.uuid();
/** A non-negative decimal (units, prices): ≤ 20 integer and 18 fraction digits; the repositories refuse zero. */
const decimal = z.string().regex(/^\d{1,20}(\.\d{1,18})?$/);
/** A rate 1 quote = x base (`@wf/domain/fx`, ≤ 8 fraction digits). */
const rate = z.string().regex(/^\d{1,12}(\.\d{1,8})?$/);
const minor = z.bigint().nonnegative();
const bps = z.number().int().min(0).max(10_000);

const assetFields = {
  symbol: z.string().trim().min(1).max(20),
  name: z.string().trim().min(1).max(80),
  catalogId: z.string().trim().min(1).max(80).nullable().optional(),
  assetClass: z.enum(ASSET_CLASSES),
  market: z.enum(MARKETS),
  categoryId: id.nullable().optional(),
  priceMode: z.enum(PRICE_MODES).optional(),
  manualPrice: decimal.nullable().optional(),
  manualPriceAt: z.date().nullable().optional(),
  premiumBps: z.number().int().min(0).max(100_000).nullable().optional(),
};

const tradeCommon = {
  clientId: z.uuid(),
  occurredAt: z.date(),
  description: z.string().trim().max(200).nullable().optional(),
};
const pricedTrade = {
  ...tradeCommon,
  assetId: id,
  units: decimal,
  price: decimal.nullable().optional(),
  amountMinor: minor,
  feeMinor: minor.optional(),
  taxMinor: minor.optional(),
  fxRate: rate.optional(),
};

/** FR-I2 "Catat transaksi investasi" (Beli, Jual, Dividen, Top-up kas). */
const TRADE_INPUT = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('buy'), ...pricedTrade, pending: z.boolean().optional() }),
  z.object({
    kind: z.literal('sell'),
    ...pricedTrade,
    proceedsAccountId: id.nullable().optional(),
    reduceGoalId: id.nullable().optional(),
  }),
  z.object({
    kind: z.literal('dividend'),
    ...tradeCommon,
    assetId: id,
    amountMinor: z.bigint().positive(),
    feeMinor: minor.optional(),
    taxMinor: minor.optional(),
    fxRate: rate.optional(),
    mode: z.enum(DIVIDEND_MODES),
    units: decimal.optional(),
    accountId: id.nullable().optional(),
  }),
  z.object({
    kind: z.literal('cash_topup'),
    ...tradeCommon,
    accountId: id,
    fromAccountId: id,
    sentMinor: z.bigint().positive(),
    receivedMinor: z.bigint().positive().optional(),
  }),
]);

export interface InvestmentsOverview {
  readonly portfolio: PortfolioView;
  /** Month-end snapshots, oldest first (the growth chart; the current month is the live value). */
  readonly snapshots: PortfolioSnapshotInput[];
  /** SPY and IHSG "Return YTD" from the user's own quotes. */
  readonly benchmarks: BenchmarkView[];
  /** 1 unit of each platform currency in the base currency now ("kurs USD Rp16.350"); missing when unknown. */
  readonly rates: Readonly<Record<string, string>>;
  /** Active goals in the base currency: where an asset can be allocated ("Atur alokasi ke tujuan"). */
  readonly goals: readonly { readonly id: string; readonly name: string }[];
}

/** An asset as the goals page needs it (FR-G2 sources, FR-G5 price-move impact, FR-G6 unpriced). */
export interface GoalAssetOption {
  readonly id: string;
  readonly symbol: string;
  readonly name: string;
  readonly platformName: string;
  readonly assetClass: AssetClass;
  readonly units: string;
  /** Value now plus pending buys, base currency; `null` without a rate to it. */
  readonly valueBaseMinor: bigint | null;
  /** Change since the previous close (base); `null` without a previous close. */
  readonly todayBaseMinor: bigint | null;
  /** `null`: no price at all, valued at cost (FR-G6). */
  readonly quote: ResolvedQuote | null;
  readonly goals: AssetView['goals'];
  readonly freeBps: number;
}

function signedIn(session: Parameters<typeof requireSession>[0]): Promise<{ userId: string; all: Services }> {
  return services().then(async (all) => {
    const { user } = await requireSession(session, {}, all.now());
    return { userId: user.id, all };
  });
}

/** The "Investasi" page. */
export const getInvestments = createServerFn({ method: 'GET' })
  .validator(z.object({}))
  .handler(({ context }): Promise<Result<InvestmentsOverview>> =>
    attempt(async () => {
      const { userId, all } = await signedIn(context.session);
      const portfolio = await all.investments.portfolio(userId);
      const currencies = [...new Set(portfolio.platforms.map((platform) => platform.currency).concat('USD'))].filter(
        (currency) => currency !== portfolio.baseCurrency,
      );
      const [snapshots, benchmarks, rates, goals] = await Promise.all([
        all.investments.snapshots(userId),
        all.marketData.benchmarks(userId, { year: Number(portfolio.today.slice(0, 4)) }),
        Promise.all(
          currencies.map(async (currency) => {
            const found = await all.fxRates.referenceRate(userId, currency, portfolio.baseCurrency);
            return found === null ? [] : [[currency, found.rate] as const];
          }),
        ),
        all.goals.list(userId, { status: 'active' }),
      ]);
      return {
        portfolio,
        snapshots,
        benchmarks,
        rates: Object.fromEntries(rates.flat()),
        goals: goals
          .filter((goal) => goal.currency === portfolio.baseCurrency)
          .map((goal) => ({ id: goal.id, name: goal.name })),
      };
    }),
  );

/** "Riwayat beli" and dividends of one asset, oldest first. */
export const getAssetTrades = createServerFn({ method: 'GET' })
  .validator(z.object({ assetId: id }))
  .handler(({ context, data }): Promise<Result<TradeView[]>> =>
    attempt(async () => {
      const { userId, all } = await signedIn(context.session);
      // Refuses another user's asset (NOT_FOUND) instead of answering an empty list.
      await all.investments.asset(userId, data.assetId);
      return all.investments.trades(userId, { assetId: data.assetId });
    }),
  );

/** The user's assets for goal sources (FR-G2) and the price-move notice on the goals page (FR-G5). */
export const listInvestmentAssets = createServerFn({ method: 'GET' })
  .validator(z.object({}))
  .handler(({ context }): Promise<Result<GoalAssetOption[]>> =>
    attempt(async () => {
      const { userId, all } = await signedIn(context.session);
      const { assets } = await all.investments.portfolio(userId);
      return assets.map((asset) => ({
        id: asset.id,
        symbol: asset.symbol,
        name: asset.name,
        platformName: asset.platformName,
        assetClass: asset.assetClass,
        units: asset.holding.units,
        valueBaseMinor: asset.value === null ? null : asset.value.valueBaseMinor + asset.pendingBaseMinor,
        todayBaseMinor: asset.value?.todayBaseMinor ?? null,
        quote: asset.quote,
        goals: asset.goals,
        freeBps: asset.freeBps,
      }));
    }),
  );

/** "Tambah aset" on a platform. */
export const createInvestmentAsset = createServerFn({ method: 'POST' })
  .validator(z.object({ accountId: id, ...assetFields }))
  .handler(({ context, data }): Promise<Result<AssetView>> =>
    attempt(async () => {
      const { userId, all } = await signedIn(context.session);
      return all.investments.createAsset(userId, defined(data));
    }),
  );

/** "Ubah detail aset": ticker, name, class, market, category, price mode, manual price. */
export const updateInvestmentAsset = createServerFn({ method: 'POST' })
  .validator(z.object({ id, patch: z.object(assetFields).partial() }))
  .handler(({ context, data }): Promise<Result<AssetView>> =>
    attempt(async () => {
      const { userId, all } = await signedIn(context.session);
      return all.investments.updateAsset(userId, data.id, defined(data.patch));
    }),
  );

/** "Hapus aset": its trades and goal sources go; the cash transactions stay. */
export const removeInvestmentAsset = createServerFn({ method: 'POST' })
  .validator(z.object({ id }))
  .handler(({ context, data }): Promise<Result<null>> =>
    attempt(async () => {
      const { userId, all } = await signedIn(context.session);
      await all.investments.removeAsset(userId, data.id);
      return null;
    }),
  );

/** "Pindah ke kategori…" (`null` = single asset). */
export const moveInvestmentAsset = createServerFn({ method: 'POST' })
  .validator(z.object({ assetId: id, categoryId: id.nullable() }))
  .handler(({ context, data }): Promise<Result<null>> =>
    attempt(async () => {
      const { userId, all } = await signedIn(context.session);
      await all.investments.moveAsset(userId, data.assetId, data.categoryId);
      return null;
    }),
  );

/** "Simpan target": the targets per class must total exactly 100% (FR-I3). */
export const setAllocationTargets = createServerFn({ method: 'POST' })
  .validator(z.object({ targets: z.partialRecord(z.enum(ASSET_CLASSES), bps) }))
  .handler(({ context, data }): Promise<Result<null>> =>
    attempt(async () => {
      const { userId, all } = await signedIn(context.session);
      await all.investments.setTargets(userId, data.targets);
      return null;
    }),
  );

/** FR-I2 "Simpan beli / jual / dividen / top-up": the trade and its cash leg; idempotent per `clientId`. */
export const recordInvestmentTrade = createServerFn({ method: 'POST' })
  .validator(TRADE_INPUT)
  .handler(({ context, data }): Promise<Result<TradeView>> =>
    attempt(async () => {
      const { userId, all } = await signedIn(context.session);
      return all.investments.recordTrade(userId, defined(data));
    }),
  );

/** "Sesuaikan kepemilikan": the recorded units become the platform's. */
export const adjustInvestmentHoldings = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      clientId: z.uuid(),
      assetId: id,
      occurredAt: z.date(),
      units: decimal,
      reason: z.enum(['unrecorded_buy', 'drip', 'correction']),
      amountMinor: minor.optional(),
      price: decimal.nullable().optional(),
      fxRate: rate.optional(),
      reduceGoalId: id.nullable().optional(),
    }),
  )
  .handler(({ context, data }): Promise<Result<TradeView>> =>
    attempt(async () => {
      const { userId, all } = await signedIn(context.session);
      return all.investments.adjustHoldings(userId, defined(data));
    }),
  );

/** "Atur alokasi ke tujuan": every goal's share of the asset at once (Σ ≤ 100%, FR-G2). */
export const setAssetGoals = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      assetId: id,
      sources: z
        .array(z.object({ goalId: id, mode: z.enum(GOAL_ASSET_SOURCE_MODES), pctBps: bps.nullable().optional() }))
        .max(20),
    }),
  )
  .handler(({ context, data }): Promise<Result<null>> =>
    attempt(async () => {
      const { userId, all } = await signedIn(context.session);
      await all.goals.setAssetAllocations(
        userId,
        data.assetId,
        data.sources.map((source) => defined(source)),
      );
      return null;
    }),
  );
