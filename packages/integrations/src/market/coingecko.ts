// SPDX-License-Identifier: AGPL-3.0-only
/**
 * CoinGecko Demo `simple/price` (BYOK, crypto; research market-data §2.4): one call for up to 100 symbols in every
 * quote currency asked (`vs_currencies=idr,usd`), the key in the `x-cg-demo-api-key` header. The answer is keyed by
 * the lower-case symbol: `{ btc: { idr, idr_24h_change, last_updated_at } }`. Showing CoinGecko prices requires the
 * attribution "Powered by CoinGecko" (the settings row carries it).
 */
import {
  dateOf,
  decimalOf,
  endpointOf,
  field,
  httpFailure,
  marketGet,
  prevCloseFromChange,
  runLog,
  symbolSummary,
  type MarketAdapter,
  type MarketHttpOptions,
} from './http.ts';

export const COINGECKO_PRICE_URL = 'https://api.coingecko.com/api/v3/simple/price';
const BATCH = 100;

export function createCoinGecko(options: MarketHttpOptions = {}): MarketAdapter {
  return {
    provider: 'coingecko',
    async fetchQuotes({ apiKey, requests }) {
      const log = runLog('coingecko');
      const symbols = [...new Set(requests.map((request) => request.symbol.toLowerCase()))];
      const currencies = [...new Set(requests.map((request) => request.currency.toLowerCase()))];
      for (let start = 0; start < symbols.length; start += BATCH) {
        const batch = symbols.slice(start, start + BATCH);
        const query = new URLSearchParams({
          symbols: batch.join(','),
          vs_currencies: currencies.join(','),
          include_24hr_change: 'true',
          include_last_updated_at: 'true',
        });
        const url = `${COINGECKO_PRICE_URL}?${query.toString()}`;
        const response = await marketGet('coingecko', url, { 'x-cg-demo-api-key': apiKey ?? '' }, options);
        const failure = httpFailure(response);
        log.record(
          endpointOf(url, `${symbolSummary(batch)} → ${currencies.join(',')}`),
          response,
          failure?.code ?? null,
        );
        if (failure !== null) return log.result(failure);
        for (const request of requests.filter((candidate) => batch.includes(candidate.symbol.toLowerCase()))) {
          const coin = field(response.body, request.symbol.toLowerCase());
          const currency = request.currency.toLowerCase();
          const price = decimalOf(field(coin, currency));
          const asOf = dateOf(field(coin, 'last_updated_at'));
          if (price === null || asOf === null) continue;
          const prevClose = prevCloseFromChange(price, field(coin, `${currency}_24h_change`));
          log.quotes.push({ ...request, price, prevClose, asOf });
        }
      }
      return log.result(null);
    },
  };
}
