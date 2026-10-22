// SPDX-License-Identifier: AGPL-3.0-only
/**
 * EODHD real-time (BYOK, IDX stocks + IHSG, 15-minute delayed; research market-data §2.3): one
 * `GET /api/real-time/{first}?s=rest,…` (each symbol counts as one call of the 20 a day), the token in the
 * `api_token` query parameter (never logged). One symbol answers an object, several an array; unknown values are
 * `"NA"`. 402 = the daily calls are used up (until the next UTC day).
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
  symbolSummary,
  type MarketAdapter,
  type MarketHttpOptions,
} from './http.ts';

export const EODHD_REALTIME_URL = 'https://eodhd.com/api/real-time/';
const BATCH = 20;

export function createEodhd(options: MarketHttpOptions = {}): MarketAdapter {
  return {
    provider: 'eodhd',
    async fetchQuotes({ apiKey, requests, now }) {
      const log = runLog('eodhd');
      for (let start = 0; start < requests.length; start += BATCH) {
        const batch = requests.slice(start, start + BATCH);
        const [first, ...rest] = batch.map((request) => request.symbol);
        const query = new URLSearchParams({ api_token: apiKey ?? '', fmt: 'json' });
        if (rest.length > 0) query.set('s', rest.join(','));
        const url = `${EODHD_REALTIME_URL}${encodeURIComponent(first as string)}?${query.toString()}`;
        const response = await marketGet('eodhd', url, {}, options);
        const http = httpFailure(response);
        const failure = http?.status === 'quota_exhausted' ? { ...http, quotaResetAt: nextUtcDay(now) } : http;
        log.record(
          endpointOf(url, symbolSummary(batch.map((request) => request.symbol))),
          response,
          failure?.code ?? null,
        );
        if (failure !== null) return log.result(failure);
        const rows: unknown[] = Array.isArray(response.body) ? response.body : [response.body];
        for (const row of rows) {
          const code = field(row, 'code');
          const request = batch.find(
            (candidate) => typeof code === 'string' && candidate.symbol.toUpperCase() === code.toUpperCase(),
          );
          const price = decimalOf(field(row, 'close'));
          const asOf = dateOf(field(row, 'timestamp'));
          if (request === undefined || price === null || asOf === null) continue;
          log.quotes.push({ ...request, price, prevClose: decimalOf(field(row, 'previousClose')), asOf });
        }
      }
      return log.result(null);
    },
  };
}
