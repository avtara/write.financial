// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The design persona's portfolio on 15 Okt 2026, 16.42 WIB (design 09 `bgmSP`, seed `DESIGN_SEED.investments`),
 * valued through `@wf/domain` like the repository does: 23 assets on Gotrade, Indodax, Stockbit, Pluang and Bibit at
 * their manual prices (USD Rp16.350), Gotrade's US$51,99 cash, targets 50/12/12/7/8/5/6, and the goals holding SPY
 * (DP Rumah 60%, Dana Pensiun 40%), IDX30, SCHD and RDPU. Rp61.420.000 / modal Rp53.931.000 / +Rp7.489.000, drift 3,8%.
 */
import type {
  AssetGoalView,
  AssetView,
  CategoryView,
  PlatformView,
  PortfolioView,
  TradeView,
} from '@wf/db/investments';
import type { BenchmarkView } from '@wf/db/market-data';
import { goalShares, splitUnits, type GoalAssetSource } from '@wf/domain/goal-assets';
import { averagePrice, replayTrades, type AssetClass, type TradeInput } from '@wf/domain/investments';
import type { ResolvedQuote } from '@wf/domain/market';
import type { LocalDate } from '@wf/domain/period';
import { DESIGN_SEED, seedClosingBalances } from '@wf/domain/seed';
import {
  allocation,
  classItems,
  portfolioSummary,
  positionValue,
  trailingDividends,
  type PositionInput,
} from '@wf/domain/valuation';
import type { GoalAssetOption, InvestmentsOverview } from '../src/server/fn/investments.ts';
import { DANA_DARURAT, DANA_PENSIUN, DP_RUMAH } from './goal-fixtures.ts';

const { investments, accounts } = DESIGN_SEED;
const BASE = 'IDR';
const USD_RATE = '16350';
export const PRICE_AT = new Date(investments.priceAt);
export const TODAY = '2026-10-15' as LocalDate;

const id = (index: number) => `0192a6c4-0000-7000-8000-${String(index).padStart(12, '0')}`;
const platformAccounts = accounts.filter((account) => account.type === 'investment');
/** Investment account key → id ("acc-gotrade"…). */
export const PLATFORM_IDS: Readonly<Record<string, string>> = Object.fromEntries(
  platformAccounts.map((account) => [account.key, `acc-${account.key}`]),
);
const currencyOf = (accountKey: string) => accounts.find((account) => account.key === accountKey)?.currency ?? BASE;
const rateOf = (currency: string) => (currency === BASE ? '1' : USD_RATE);
const GOAL_IDS: Readonly<Record<string, { id: string; name: string }>> = {
  'Dana Darurat': { id: DANA_DARURAT.id, name: DANA_DARURAT.name },
  'DP Rumah': { id: DP_RUMAH.id, name: DP_RUMAH.name },
  'Dana Pensiun': { id: DANA_PENSIUN.id, name: DANA_PENSIUN.name },
};

export const CATEGORY_IDS: Readonly<Record<string, string>> = Object.fromEntries(
  investments.categories.map((category, index) => [category.name, id(900 + index)]),
);

export function manualQuote(price: string, overrides: Partial<ResolvedQuote> = {}): ResolvedQuote {
  return {
    price,
    prevClose: null,
    source: 'manual',
    provider: null,
    asOf: PRICE_AT.getTime(),
    stale: false,
    label: 'manual',
    ...overrides,
  };
}

function sourcesOf(assetKey: string): { goalId: string; goalName: string; source: GoalAssetSource }[] {
  return DESIGN_SEED.goals.flatMap((goal) =>
    goal.assetSources
      .filter((source) => source.assetKey === assetKey)
      .map((source) => {
        const known = GOAL_IDS[goal.name] as { id: string; name: string };
        return {
          goalId: known.id,
          goalName: known.name,
          source: { goalId: known.id, mode: source.mode, bps: source.pctBps ?? 10_000 },
        };
      }),
  );
}

/** Asset key → id (`spy` → …0100). */
export const ASSET_IDS: Readonly<Record<string, string>> = Object.fromEntries(
  investments.assets.map((asset, index) => [asset.key, id(100 + index)]),
);

const SEED_ASSETS: readonly AssetView[] = investments.assets.map((seed): AssetView => {
  const currency = currencyOf(seed.accountKey);
  const fxRate = rateOf(currency);
  const trades: TradeInput[] = [
    ...(seed.opening === null
      ? []
      : [
          {
            kind: 'buy' as const,
            status: 'settled' as const,
            units: seed.opening.units,
            amountMinor: seed.opening.amountMinor,
            feeMinor: 0n,
            taxMinor: 0n,
            fxRate: seed.opening.fxRate,
            dividendMode: null,
          },
        ]),
    ...seed.buys.map((buy) => ({
      kind: 'buy' as const,
      status: buy.pending ? ('pending' as const) : ('settled' as const),
      units: buy.units,
      amountMinor: buy.amountMinor,
      feeMinor: 0n,
      taxMinor: 0n,
      fxRate,
      dividendMode: null,
    })),
  ];
  const holding = replayTrades(trades, { quote: currency, base: BASE });
  const pendingMinor = seed.buys.filter((buy) => buy.pending).reduce((sum, buy) => sum + buy.amountMinor, 0n);
  const value = positionValue(
    {
      key: ASSET_IDS[seed.key] as string,
      assetClass: seed.assetClass,
      currency,
      units: holding.units,
      price: seed.price,
      prevClose: null,
      fxRate,
      prevFxRate: null,
      costMinor: holding.costMinor,
      costBaseMinor: holding.costBaseMinor,
    },
    BASE,
  );
  const sources = sourcesOf(seed.key);
  const shares = goalShares(
    value.valueBaseMinor + pendingMinor,
    sources.map((part) => part.source),
  );
  const units = splitUnits(
    holding.units,
    sources.map((part) => part.source),
  );
  return {
    id: ASSET_IDS[seed.key] as string,
    accountId: PLATFORM_IDS[seed.accountKey] as string,
    platformName: platformAccounts.find((account) => account.key === seed.accountKey)?.displayName as string,
    symbol: seed.symbol,
    name: seed.name,
    quoteCurrency: currency,
    assetClass: seed.assetClass,
    market: seed.market,
    categoryId: seed.category === null ? null : (CATEGORY_IDS[seed.category] as string),
    priceMode: 'manual',
    manualPrice: seed.price,
    manualPriceAt: PRICE_AT,
    premiumBps: null,
    meta: {},
    holding,
    pendingMinor,
    pendingBaseMinor: pendingMinor,
    averagePrice: averagePrice(holding, currency),
    quote: manualQuote(seed.price),
    value,
    goals: sources.map(
      (part, index): AssetGoalView => ({
        sourceId: `src-${seed.key}-${String(index)}`,
        goalId: part.goalId,
        goalName: part.goalName,
        mode: part.source.mode,
        bps: part.source.bps,
        units: units.goals[index]?.value as string,
        valueBaseMinor: shares.goals[index]?.value as bigint,
      }),
    ),
    freeBps: 10_000 - sources.reduce((sum, part) => sum + part.source.bps, 0),
  };
});

export const SPY = SEED_ASSETS.find((asset) => asset.symbol === 'SPY') as AssetView;
export const BTC = SEED_ASSETS.find((asset) => asset.symbol === 'BTC') as AssetView;
export const BBCA = SEED_ASSETS.find((asset) => asset.symbol === 'BBCA') as AssetView;
export const RDPU = SEED_ASSETS.find((asset) => asset.symbol === 'RDPU') as AssetView;
export const SCHD = SEED_ASSETS.find((asset) => asset.symbol === 'SCHD') as AssetView;

/** A view built from the seed's assets, with `assets` replaced when given (totals recomputed). */
export function portfolioView(
  overrides: Partial<Omit<PortfolioView, 'summary' | 'allocation'>> & { readonly dividends12m?: bigint } = {},
): PortfolioView {
  const assets = overrides.assets ?? SEED_ASSETS;
  const balances = seedClosingBalances(DESIGN_SEED);
  const platforms =
    overrides.platforms ??
    platformAccounts.map((account): PlatformView => {
      const own = assets.filter((asset) => asset.accountId === PLATFORM_IDS[account.key]);
      const cashMinor = balances.get(account.key) ?? 0n;
      const cashBaseMinor = account.currency === BASE ? cashMinor : 850_037n * (cashMinor === 5_199n ? 1n : 0n);
      const holdings = own.reduce((sum, asset) => sum + (asset.value?.valueBaseMinor ?? 0n), 0n);
      return {
        accountId: PLATFORM_IDS[account.key] as string,
        name: account.displayName,
        currency: account.currency,
        cashMinor,
        cashBaseMinor,
        holdingsValueBaseMinor: holdings,
        valueBaseMinor: holdings + cashBaseMinor,
        assetCount: own.length,
      };
    });
  const positions: PositionInput[] = [
    ...assets.flatMap((asset) =>
      asset.holding.units === '0' && asset.holding.costBaseMinor === 0n
        ? []
        : [
            {
              key: asset.id,
              assetClass: asset.assetClass,
              currency: asset.quoteCurrency,
              units: asset.holding.units,
              price: asset.quote?.price ?? null,
              prevClose: asset.quote?.prevClose ?? null,
              fxRate: rateOf(asset.quoteCurrency),
              prevFxRate: null,
              costMinor: asset.holding.costMinor,
              costBaseMinor: asset.holding.costBaseMinor,
            },
          ],
    ),
    ...platforms
      .filter((platform) => platform.cashMinor !== 0n && platform.cashBaseMinor !== null)
      .map((platform) => ({
        key: `cash:${platform.accountId}`,
        assetClass: 'cash' as const,
        currency: platform.currency,
        units: platform.currency === BASE ? String(platform.cashMinor) : (Number(platform.cashMinor) / 100).toFixed(2),
        price: '1',
        prevClose: '1',
        fxRate: rateOf(platform.currency),
        prevFxRate: null,
        costMinor: platform.cashMinor,
        costBaseMinor: platform.cashBaseMinor as bigint,
      })),
  ];
  const dividends = overrides.dividends ?? trailingDividends([], TODAY);
  const summary = portfolioSummary(positions, {
    base: BASE,
    dividends12mBaseMinor: overrides.dividends12m ?? dividends.totalMinor,
  });
  const targets = overrides.targets ?? investments.targets;
  const categories =
    overrides.categories ??
    investments.categories.map(
      (category, index): CategoryView => ({
        id: CATEGORY_IDS[category.name] as string,
        name: category.name,
        assetClass: category.assetClass,
        sortOrder: index,
        assetIds: assets.filter((asset) => asset.categoryId === CATEGORY_IDS[category.name]).map((asset) => asset.id),
      }),
    );
  return {
    baseCurrency: BASE,
    today: TODAY,
    assets,
    platforms,
    categories,
    targets,
    summary,
    allocation:
      Object.keys(targets).length === 0 || summary.valueBaseMinor <= 0n
        ? null
        : allocation(classItems(summary.positions), targets as Record<AssetClass, number>),
    dividends,
    missingRates: overrides.missingRates ?? [],
  };
}

export function benchmarks(spy: number | null = 1480, ihsg: number | null = 310): BenchmarkView[] {
  const close = (price: string, at: string) => ({ price, asOf: new Date(at) });
  return [
    spy === null
      ? { key: 'spy', baseline: null, current: null, ytdBps: null }
      : {
          key: 'spy',
          baseline: close('601.13', '2025-12-31T00:00:00Z'),
          current: close('690.1', '2026-10-15T09:00:00Z'),
          ytdBps: spy,
        },
    ihsg === null
      ? { key: 'ihsg', baseline: null, current: null, ytdBps: null }
      : {
          key: 'ihsg',
          baseline: close('7079.92', '2025-12-30T00:00:00Z'),
          current: close('7299.4', '2026-10-14T00:00:00Z'),
          ytdBps: ihsg,
        },
  ];
}

export function investmentsOverview(overrides: Partial<InvestmentsOverview> = {}): InvestmentsOverview {
  return {
    portfolio: portfolioView(),
    snapshots: investments.snapshots.map((snapshot) => ({
      date: snapshot.date as LocalDate,
      valueBaseMinor: snapshot.valueMinor,
      costBaseMinor: snapshot.costMinor,
      contributionsBaseMinor: snapshot.contributionsMinor,
    })),
    benchmarks: benchmarks(),
    rates: { USD: USD_RATE },
    goals: [
      { id: DANA_DARURAT.id, name: DANA_DARURAT.name },
      { id: DP_RUMAH.id, name: DP_RUMAH.name },
      { id: DANA_PENSIUN.id, name: DANA_PENSIUN.name },
    ],
    ...overrides,
  };
}

export function tradeView(overrides: Partial<TradeView> = {}): TradeView {
  return {
    id: 'trade-1',
    assetId: SPY.id,
    accountId: SPY.accountId,
    kind: 'buy',
    status: 'settled',
    occurredAt: new Date('2026-10-01T02:00:00Z'),
    localDate: '2026-10-01' as LocalDate,
    units: '0.356',
    price: '686.2',
    amountMinor: 24_429n,
    feeMinor: 0n,
    taxMinor: 0n,
    fxRate: USD_RATE,
    dividendMode: null,
    proceedsAccountId: null,
    transactionId: 'tx-1',
    transferTransactionId: null,
    reducedGoalId: null,
    description: null,
    realizedMinor: 0n,
    realizedBaseMinor: 0n,
    dividendMinor: 0n,
    ...overrides,
  };
}

/** The goals page's view of the seed assets ({@link GoalAssetOption}). */
export function goalAssetOptions(assets: readonly AssetView[] = SEED_ASSETS): GoalAssetOption[] {
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
}

export { SEED_ASSETS };
