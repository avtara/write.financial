// SPDX-License-Identifier: AGPL-3.0-only
/**
 * metals.dev `v1/latest` (BYOK, gold spot, 100 requests a month; research market-data §2.5): one call per currency
 * answers every metal per troy ounce (`unit=toz`), the key in the `api_key` query parameter (never logged). Failures
 * come as `{ status: 'failure', error_code }`: 1101 = wrong key, 1203 = the month's quota (and grace) is used up.
 */
import { METAL_CODES } from './goldapi.ts';
import {
  dateOf,
  decimalOf,
  endpointOf,
  field,
  httpFailure,
  marketGet,
  nextUtcMonth,
  runLog,
  type AdapterFailure,
  type MarketAdapter,
  type MarketHttpOptions,
} from './http.ts';

export const METALS_DEV_URL = 'https://api.metals.dev/v1/latest';

const METAL_NAMES: Readonly<Record<(typeof METAL_CODES)[number], string>> = {
  XAU: 'gold',
  XAG: 'silver',
  XPT: 'platinum',
  XPD: 'palladium',
};

export function createMetalsDev(options: MarketHttpOptions = {}): MarketAdapter {
  return {
    provider: 'metals_dev',
    async fetchQuotes({ apiKey, requests, now }) {
      const log = runLog('metals_dev');
      const metals = requests.filter((request) =>
        (METAL_CODES as readonly string[]).includes(request.symbol.toUpperCase()),
      );
      for (const currency of [...new Set(metals.map((request) => request.currency))]) {
        const query = new URLSearchParams({ api_key: apiKey ?? '', currency, unit: 'toz' });
        const url = `${METALS_DEV_URL}?${query.toString()}`;
        const response = await marketGet('metals_dev', url, {}, options);
        const errorCode = field(response.body, 'error_code');
        let failure: AdapterFailure | null = httpFailure(response);
        if (errorCode === 1101)
          failure = { status: 'invalid_key', retryAfter: null, quotaResetAt: null, code: 'md_1101' };
        if (errorCode === 1203) {
          failure = { status: 'quota_exhausted', retryAfter: null, quotaResetAt: nextUtcMonth(now), code: 'md_1203' };
        }
        log.record(endpointOf(url, currency.toLowerCase()), response, failure?.code ?? null);
        if (failure !== null) return log.result(failure);
        const asOf = dateOf(field(field(response.body, 'timestamps'), 'metal'));
        for (const request of metals.filter((candidate) => candidate.currency === currency)) {
          const name = METAL_NAMES[request.symbol.toUpperCase() as (typeof METAL_CODES)[number]];
          const price = decimalOf(field(field(response.body, 'metals'), name));
          if (price === null || asOf === null) continue;
          log.quotes.push({ ...request, price, prevClose: null, asOf });
        }
      }
      return log.result(null);
    },
  };
}
