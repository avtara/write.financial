// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Built-in daily XAU spot (FR-I6; research market-data §2.5): fawazahmed0's `xau.min.json` (CC0, keyless) from
 * jsDelivr, or from its Cloudflare Pages mirror when jsDelivr fails. The file lists what one troy ounce is worth in
 * every currency (`xau.idr = 75442309`), dated by publication day. Asked as symbol `XAU` in each currency.
 */
import { FAWAZAHMED0_URLS } from '../fx/fawazahmed0.ts';
import {
  dateOf,
  decimalOf,
  endpointOf,
  field,
  httpFailure,
  marketGet,
  runLog,
  type AdapterFailure,
  type MarketAdapter,
  type MarketHttpOptions,
} from './http.ts';

export const GOLD_SPOT_SYMBOL = 'XAU';

export function createFawazahmed0Gold(options: MarketHttpOptions = {}): MarketAdapter {
  return {
    provider: 'fawazahmed0',
    async fetchQuotes({ requests }) {
      const log = runLog('fawazahmed0');
      const gold = requests.filter((request) => request.symbol.toUpperCase() === GOLD_SPOT_SYMBOL);
      if (gold.length === 0) return log.result(null);
      let failure: AdapterFailure | null = null;
      for (const base of FAWAZAHMED0_URLS) {
        const url = `${base}xau.min.json`;
        const response = await marketGet('fawazahmed0', url, {}, options);
        const table = field(response.body, 'xau');
        const asOf = dateOf(field(response.body, 'date'));
        failure =
          httpFailure(response) ??
          (table === undefined || asOf === null
            ? { status: 'error', retryAfter: null, quotaResetAt: null, code: 'unexpected_body' }
            : null);
        log.record(
          endpointOf(url, gold.map((request) => request.currency.toLowerCase()).join(',')),
          response,
          failure?.code ?? null,
        );
        if (failure !== null) continue;
        for (const request of gold) {
          const price = decimalOf(field(table, request.currency.toLowerCase()));
          if (price !== null) log.quotes.push({ ...request, price, prevClose: null, asOf: asOf as Date });
        }
        break;
      }
      return log.result(failure);
    },
  };
}
