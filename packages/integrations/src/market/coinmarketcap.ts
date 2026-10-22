// SPDX-License-Identifier: AGPL-3.0-only
/**
 * CoinMarketCap `v2/cryptocurrency/quotes/latest` (research market-data §2.4): the built-in crypto source with the
 * operator's Basic key (`CMC_API_KEY`, commercial use allowed, one product ≤ 100k users) and a BYOK option with the
 * user's own key. One call per quote currency (Basic allows one `convert` per call) for up to 100 symbols — 1 credit;
 * `status.credit_count` is reported back so the caller can watch the 15 000 a month. The previous close is derived
 * from `percent_change_24h`. Error codes in `status.error_code`: 1001/1002 key, 1008/1011 per minute/IP, 1009 day,
 * 1010 month.
 */
import {
  dateOf,
  decimalOf,
  endpointOf,
  field,
  httpFailure,
  marketGet,
  prevCloseFromChange,
  nextUtcDay,
  nextUtcMonth,
  runLog,
  symbolSummary,
  type AdapterFailure,
  type MarketAdapter,
  type MarketHttpOptions,
} from './http.ts';

export const CMC_QUOTES_URL = 'https://pro-api.coinmarketcap.com/v2/cryptocurrency/quotes/latest';
const BATCH = 100;

/** The failure a CMC `status.error_code` means, or `null` for 0 / none. */
function cmcFailure(errorCode: unknown, retryAfter: string | null, now: Date): AdapterFailure | null {
  if (typeof errorCode !== 'number' || errorCode === 0) return null;
  const code = `cmc_${errorCode}`;
  if (errorCode === 1001 || errorCode === 1002)
    return { status: 'invalid_key', retryAfter: null, quotaResetAt: null, code };
  if (errorCode === 1009) return { status: 'quota_exhausted', retryAfter: null, quotaResetAt: nextUtcDay(now), code };
  if (errorCode === 1010) return { status: 'quota_exhausted', retryAfter: null, quotaResetAt: nextUtcMonth(now), code };
  if (errorCode === 1008 || errorCode === 1011) return { status: 'rate_limited', retryAfter, quotaResetAt: null, code };
  return { status: 'error', retryAfter: null, quotaResetAt: null, code };
}

export function createCoinMarketCap(options: MarketHttpOptions = {}): MarketAdapter {
  return {
    provider: 'coinmarketcap',
    async fetchQuotes({ apiKey, requests, now }) {
      const log = runLog('coinmarketcap');
      let credits = 0;
      for (const currency of [...new Set(requests.map((request) => request.currency))]) {
        const ofCurrency = requests.filter((request) => request.currency === currency);
        for (let start = 0; start < ofCurrency.length; start += BATCH) {
          const batch = ofCurrency.slice(start, start + BATCH);
          const symbols = batch.map((request) => request.symbol.toUpperCase());
          const query = new URLSearchParams({ symbol: symbols.join(','), convert: currency, skip_invalid: 'true' });
          const url = `${CMC_QUOTES_URL}?${query.toString()}`;
          const response = await marketGet('coinmarketcap', url, { 'X-CMC_PRO_API_KEY': apiKey ?? '' }, options);
          const status = field(response.body, 'status');
          const failure =
            cmcFailure(field(status, 'error_code'), response.headers.get('retry-after'), now) ?? httpFailure(response);
          const used = field(status, 'credit_count');
          if (typeof used === 'number') credits += used;
          log.record(
            endpointOf(url, `${symbolSummary(symbols)} → ${currency.toLowerCase()}`),
            response,
            failure?.code ?? null,
          );
          if (failure !== null) return log.result(failure, { credits });
          for (const request of batch) {
            const entries = field(field(response.body, 'data'), request.symbol.toUpperCase());
            const quote = field(field(Array.isArray(entries) ? entries[0] : entries, 'quote'), currency);
            const price = decimalOf(field(quote, 'price'));
            const asOf = dateOf(field(quote, 'last_updated'));
            if (price === null || asOf === null) continue;
            const prevClose = prevCloseFromChange(price, field(quote, 'percent_change_24h'));
            log.quotes.push({ ...request, price, prevClose, asOf });
          }
        }
      }
      return log.result(null, { credits });
    },
  };
}
