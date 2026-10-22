// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Alpha Vantage `GLOBAL_QUOTE` (BYOK, last close; research market-data §2.2, §3): one call per symbol, the key in the
 * `apikey` query parameter (never logged). It accepts any key, so a working call only proves connectivity
 * (`unverified`: "Terhubung (key tidak dapat diverifikasi)"). The 25-a-day limit answers 200 with an `Information` or
 * `Note` instead of data: quota exhausted until the next UTC day.
 */
import {
  dateOf,
  decimalOf,
  endpointOf,
  field,
  httpFailure,
  marketGet,
  nextUtcDay,
  runLog,
  type MarketAdapter,
  type MarketHttpOptions,
} from './http.ts';

export const ALPHA_VANTAGE_URL = 'https://www.alphavantage.co/query';

export function createAlphaVantage(options: MarketHttpOptions = {}): MarketAdapter {
  return {
    provider: 'alpha_vantage',
    async fetchQuotes({ apiKey, requests, now }) {
      const log = runLog('alpha_vantage');
      for (const request of requests.filter((candidate) => candidate.currency === 'USD')) {
        const query = new URLSearchParams({ function: 'GLOBAL_QUOTE', symbol: request.symbol, apikey: apiKey ?? '' });
        const url = `${ALPHA_VANTAGE_URL}?${query.toString()}`;
        const response = await marketGet('alpha_vantage', url, {}, options);
        const limited = field(response.body, 'Information') ?? field(response.body, 'Note');
        const failure =
          httpFailure(response) ??
          (limited === undefined
            ? null
            : {
                status: 'quota_exhausted' as const,
                retryAfter: null,
                quotaResetAt: nextUtcDay(now),
                code: 'av_limit',
              });
        log.record(endpointOf(url, request.symbol), response, failure?.code ?? null);
        if (failure !== null) return log.result(failure, { unverified: true });
        const quote = field(response.body, 'Global Quote');
        const price = decimalOf(field(quote, '05. price'));
        const asOf = dateOf(field(quote, '07. latest trading day'));
        if (price === null || asOf === null) continue;
        log.quotes.push({ ...request, price, prevClose: decimalOf(field(quote, '08. previous close')), asOf });
      }
      return log.result(null, { unverified: true });
    },
  };
}
