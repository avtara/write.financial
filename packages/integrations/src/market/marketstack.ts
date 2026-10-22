// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Marketstack `eod/latest` (BYOK, end of day, 100 requests a month; research market-data §2.3): one call per 100
 * symbols, the key in the `access_key` query parameter (never logged). Errors come as `{ error: { code } }`:
 * `usage_limit_reached` = the month's requests are used up (until the next month), `invalid_access_key` = wrong key.
 */
import {
  dateOf,
  decimalOf,
  endpointOf,
  field,
  httpFailure,
  marketGet,
  nextUtcMonth,
  runLog,
  symbolSummary,
  type AdapterFailure,
  type MarketAdapter,
  type MarketHttpOptions,
} from './http.ts';

export const MARKETSTACK_EOD_URL = 'https://api.marketstack.com/v2/eod/latest';
const BATCH = 100;

export function createMarketstack(options: MarketHttpOptions = {}): MarketAdapter {
  return {
    provider: 'marketstack',
    async fetchQuotes({ apiKey, requests, now }) {
      const log = runLog('marketstack');
      for (let start = 0; start < requests.length; start += BATCH) {
        const batch = requests.slice(start, start + BATCH);
        const symbols = batch.map((request) => request.symbol);
        const url = `${MARKETSTACK_EOD_URL}?${new URLSearchParams({ access_key: apiKey ?? '', symbols: symbols.join(',') }).toString()}`;
        const response = await marketGet('marketstack', url, {}, options);
        const code = field(field(response.body, 'error'), 'code');
        let failure: AdapterFailure | null = httpFailure(response);
        if (code === 'usage_limit_reached') {
          failure = { status: 'quota_exhausted', retryAfter: null, quotaResetAt: nextUtcMonth(now), code };
        } else if (code === 'invalid_access_key' || code === 'missing_access_key') {
          failure = { status: 'invalid_key', retryAfter: null, quotaResetAt: null, code };
        }
        log.record(endpointOf(url, symbolSummary(symbols)), response, failure?.code ?? null);
        if (failure !== null) return log.result(failure);
        const rows = field(response.body, 'data');
        for (const row of Array.isArray(rows) ? rows : []) {
          const symbol = field(row, 'symbol');
          const request = batch.find((candidate) => candidate.symbol === symbol);
          const price = decimalOf(field(row, 'close'));
          const asOf = dateOf(field(row, 'date'));
          if (request === undefined || price === null || asOf === null) continue;
          log.quotes.push({ ...request, price, prevClose: null, asOf });
        }
      }
      return log.result(null);
    },
  };
}
