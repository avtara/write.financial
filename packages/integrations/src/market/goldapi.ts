// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GoldAPI.io (BYOK, gold spot, 100 requests a month; research market-data §2.5): one `GET /api/{metal}/{currency}`
 * per metal and currency with the token in the `x-access-token` header; the price is per troy ounce, with the
 * previous close. Symbols other than the metal codes are not asked. A 429 may carry `x-ratelimit-reset` (epoch
 * seconds), taken as the quota reset.
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

export const GOLDAPI_URL = 'https://www.goldapi.io/api/';
export const METAL_CODES = ['XAU', 'XAG', 'XPT', 'XPD'] as const;

export function createGoldApi(options: MarketHttpOptions = {}): MarketAdapter {
  return {
    provider: 'goldapi',
    async fetchQuotes({ apiKey, requests }) {
      const log = runLog('goldapi');
      for (const request of requests) {
        const metal = request.symbol.toUpperCase();
        if (!(METAL_CODES as readonly string[]).includes(metal)) continue;
        const url = `${GOLDAPI_URL}${metal}/${request.currency}`;
        const response = await marketGet('goldapi', url, { 'x-access-token': apiKey ?? '' }, options);
        const http = httpFailure(response);
        const failure =
          http?.status === 'rate_limited'
            ? { ...http, quotaResetAt: dateOf(Number(response.headers.get('x-ratelimit-reset'))) }
            : http;
        log.record(endpointOf(url, ''), response, failure?.code ?? null);
        if (failure !== null) return log.result(failure);
        const price = decimalOf(field(response.body, 'price'));
        const asOf = dateOf(field(response.body, 'timestamp'));
        if (price === null || asOf === null) continue;
        log.quotes.push({ ...request, price, prevClose: decimalOf(field(response.body, 'prev_close_price')), asOf });
      }
      return log.result(null);
    },
  };
}
