// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Tiingo IEX (BYOK, US stocks/ETFs; research market-data §2.2): one `GET /iex/?tickers=a,b,…` per 100 symbols with
 * the user's token in the `Authorization` header. Prices are USD; IEX last sale (`tngoLast`, else `last`) with the
 * previous close. A wrong token answers 401/403 or a body with a message instead of the list.
 */
import {
  dateOf,
  decimalOf,
  endpointOf,
  field,
  httpFailure,
  marketGet,
  runLog,
  symbolSummary,
  type MarketAdapter,
  type MarketHttpOptions,
} from './http.ts';

export const TIINGO_IEX_URL = 'https://api.tiingo.com/iex/';
const BATCH = 100;

export function createTiingo(options: MarketHttpOptions = {}): MarketAdapter {
  return {
    provider: 'tiingo',
    async fetchQuotes({ apiKey, requests }) {
      const log = runLog('tiingo');
      const usd = requests.filter((request) => request.currency === 'USD');
      for (let start = 0; start < usd.length; start += BATCH) {
        const batch = usd.slice(start, start + BATCH);
        const tickers = batch.map((request) => request.symbol.toLowerCase());
        const url = `${TIINGO_IEX_URL}?${new URLSearchParams({ tickers: tickers.join(',') }).toString()}`;
        const response = await marketGet('tiingo', url, { Authorization: `Token ${apiKey ?? ''}` }, options);
        const endpoint = endpointOf(url, symbolSummary(tickers));
        const failure =
          httpFailure(response) ??
          (Array.isArray(response.body)
            ? null
            : { status: 'invalid_key' as const, retryAfter: null, quotaResetAt: null, code: 'tiingo_auth' });
        log.record(endpoint, response, failure?.code ?? null);
        if (failure !== null) return log.result(failure);
        for (const row of response.body as unknown[]) {
          const ticker = field(row, 'ticker');
          const request = batch.find(
            (candidate) => typeof ticker === 'string' && candidate.symbol.toLowerCase() === ticker.toLowerCase(),
          );
          const price = decimalOf(field(row, 'tngoLast')) ?? decimalOf(field(row, 'last'));
          const asOf = dateOf(field(row, 'lastSaleTimestamp')) ?? dateOf(field(row, 'timestamp'));
          if (request === undefined || price === null || asOf === null) continue;
          log.quotes.push({ ...request, price, prevClose: decimalOf(field(row, 'prevClose')), asOf });
        }
      }
      return log.result(null);
    },
  };
}
