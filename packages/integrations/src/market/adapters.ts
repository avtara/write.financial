// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Every market quote adapter by provider (FR-I6): the BYOK providers, CoinMarketCap (built-in with the operator's key
 * or BYOK), and fawazahmed0's daily XAU spot. FX reference rates are the `fx` job's (`../fx/rates.ts`).
 */
import type { MarketProvider } from '@wf/domain/market';
import { createAlphaVantage } from './alpha-vantage.ts';
import { createCoinGecko } from './coingecko.ts';
import { createCoinMarketCap } from './coinmarketcap.ts';
import { createEodhd } from './eodhd.ts';
import { createFawazahmed0Gold } from './fawazahmed0-gold.ts';
import { createFinnhub } from './finnhub.ts';
import { createGoldApi } from './goldapi.ts';
import type { MarketAdapter, MarketHttpOptions } from './http.ts';
import { fetchPriorClose } from './history.ts';
import { createMarketstack } from './marketstack.ts';
import { createMassive } from './massive.ts';
import { createMetalsDev } from './metals-dev.ts';
import { createTiingo } from './tiingo.ts';

/** Providers with a quote adapter (the FX sources are not quote providers). */
export type QuoteProvider = Exclude<MarketProvider, 'frankfurter' | 'open_er_api'>;

export type MarketAdapters = Readonly<Record<QuoteProvider, MarketAdapter>>;

export function createMarketAdapters(options: MarketHttpOptions = {}): MarketAdapters {
  return {
    fawazahmed0: createFawazahmed0Gold(options),
    coinmarketcap: createCoinMarketCap(options),
    tiingo: { ...createTiingo(options), fetchPriorClose: (input) => fetchPriorClose('tiingo', input, options) },
    finnhub: createFinnhub(options),
    massive: { ...createMassive(options), fetchPriorClose: (input) => fetchPriorClose('massive', input, options) },
    alpha_vantage: createAlphaVantage(options),
    eodhd: { ...createEodhd(options), fetchPriorClose: (input) => fetchPriorClose('eodhd', input, options) },
    marketstack: createMarketstack(options),
    coingecko: createCoinGecko(options),
    goldapi: createGoldApi(options),
    metals_dev: createMetalsDev(options),
  };
}
