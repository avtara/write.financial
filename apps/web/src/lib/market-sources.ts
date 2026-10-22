// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Settings › "API kurs & pasar" (FR-ST4, FR-I6; research market-data §3): the markets a sync goes through, each BYOK
 * provider's market, its "Dapatkan key gratis" page and free tier, and the symbol a connection test asks when the
 * user holds nothing in that market yet.
 */
import { BYOK_PROVIDERS, FALLBACK_ORDER, type ByokProvider, type Market, type MarketProvider } from '@wf/domain/market';

/** "Sinkronkan harga" goes through these, one source at a time ("Sinkron 2/4…"). */
export const SYNC_MARKETS = ['us_equity', 'idx_equity', 'crypto', 'gold_spot'] as const satisfies readonly Market[];
export type SyncMarket = (typeof SYNC_MARKETS)[number];

/** The market each BYOK provider prices (every one appears in exactly one market's fallback order). */
export const PROVIDER_MARKET = Object.fromEntries(
  BYOK_PROVIDERS.map((provider) => [
    provider,
    SYNC_MARKETS.find((market) =>
      FALLBACK_ORDER[market].some((step) => step.mode === 'byok' && step.provider === provider),
    ) as SyncMarket,
  ]),
) as Readonly<Record<ByokProvider, SyncMarket>>;

/** The BYOK providers of `market`, in fallback order. */
export function byokProvidersOf(market: SyncMarket): ByokProvider[] {
  return FALLBACK_ORDER[market].flatMap((step) =>
    step.mode === 'byok' && step.provider !== null ? [step.provider as ByokProvider] : [],
  );
}

/** Display names ("Massive (Polygon)" keeps the name users know). */
export const PROVIDER_NAMES: Readonly<Record<MarketProvider, string>> = {
  frankfurter: 'Frankfurter',
  fawazahmed0: 'fawazahmed0',
  open_er_api: 'open.er-api',
  coinmarketcap: 'CoinMarketCap',
  tiingo: 'Tiingo',
  finnhub: 'Finnhub',
  massive: 'Massive',
  alpha_vantage: 'Alpha Vantage',
  eodhd: 'EODHD',
  marketstack: 'Marketstack',
  coingecko: 'CoinGecko',
  goldapi: 'GoldAPI.io',
  metals_dev: 'metals.dev',
};

/** "Dapatkan key gratis" (research §3). */
export const FREE_KEY_URLS: Readonly<Record<ByokProvider, string>> = {
  tiingo: 'https://www.tiingo.com/account/api/token',
  finnhub: 'https://finnhub.io/register',
  massive: 'https://massive.com/',
  alpha_vantage: 'https://www.alphavantage.co/support/#api-key',
  eodhd: 'https://eodhd.com/register',
  marketstack: 'https://marketstack.com/signup/free',
  coinmarketcap: 'https://coinmarketcap.com/api/pricing/',
  coingecko: 'https://www.coingecko.com/en/developers/dashboard',
  goldapi: 'https://www.goldapi.io/',
  metals_dev: 'https://metals.dev/',
};

/** What a connection test asks when the user holds nothing in the market: a liquid symbol in its home currency. */
export const PROBE_SYMBOLS: Readonly<Record<SyncMarket, { readonly symbol: string; readonly currency: string }>> = {
  us_equity: { symbol: 'SPY', currency: 'USD' },
  idx_equity: { symbol: 'BBCA', currency: 'IDR' },
  crypto: { symbol: 'BTC', currency: 'IDR' },
  gold_spot: { symbol: 'XAU', currency: 'IDR' },
};

/** Connection tests per provider and hour (they use the user's free quota; plan §6 `market-test`). */
export const TESTS_PER_HOUR = 5;
/** Symbols a connection test asks at most. */
export const TEST_SYMBOLS = 3;
/** "Riwayat 30 hari". */
export const LOG_DAYS = 30;
