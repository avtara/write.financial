// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Finnhub `/quote` (BYOK, US stocks/ETFs; research market-data §2.2): one call per symbol with the key in the
 * `X-Finnhub-Token` header; `c` = current (USD), `pc` = previous close, `t` = epoch seconds. An unknown symbol answers
 * zeros. A 401 or a 429 stops the run (the rest of the symbols fall back).
 */
import {
  dateOf,
  decimalOf,
  endpointOf,
  field,
  httpFailure,
  marketGet,
  runLog,
  type MarketAdapter,
  type MarketHttpOptions,
} from './http.ts';

export const FINNHUB_QUOTE_URL = 'https://finnhub.io/api/v1/quote';

export function createFinnhub(options: MarketHttpOptions = {}): MarketAdapter {
  return {
    provider: 'finnhub',
    async fetchQuotes({ apiKey, requests }) {
      const log = runLog('finnhub');
      for (const request of requests.filter((candidate) => candidate.currency === 'USD')) {
        const url = `${FINNHUB_QUOTE_URL}?${new URLSearchParams({ symbol: request.symbol }).toString()}`;
        const response = await marketGet('finnhub', url, { 'X-Finnhub-Token': apiKey ?? '' }, options);
        const failure = httpFailure(response);
        log.record(endpointOf(url, request.symbol), response, failure?.code ?? null);
        if (failure !== null) return log.result(failure);
        const price = decimalOf(field(response.body, 'c'));
        const asOf = dateOf(field(response.body, 't'));
        if (price === null || asOf === null) continue;
        log.quotes.push({ ...request, price, prevClose: decimalOf(field(response.body, 'pc')), asOf });
      }
      return log.result(null);
    },
  };
}
