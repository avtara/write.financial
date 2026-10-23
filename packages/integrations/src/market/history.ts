// SPDX-License-Identifier: AGPL-3.0-only
/** Last actual trading close on or before prior Dec 31; personal BYOK only (research §1.8). */
import {
  dateOf,
  decimalOf,
  endpointOf,
  field,
  httpFailure,
  marketGet,
  runLog,
  type AdapterResult,
  type FetchQuotesInput,
  type MarketHttpOptions,
} from './http.ts';
import { closedSessions, MASSIVE_GROUPED_URL } from './massive.ts';

export type HistoricalProvider = 'tiingo' | 'eodhd' | 'massive';

/** Fetches the provider's actual year-end session, never substitutes a current quote or a previous-close field. */
export async function fetchPriorClose(
  provider: HistoricalProvider,
  { apiKey, requests, now }: FetchQuotesInput,
  options: MarketHttpOptions,
): Promise<AdapterResult> {
  const log = runLog(provider);
  const year = now.getUTCFullYear() - 1;
  const end = `${String(year)}-12-31`;
  const start = `${String(year)}-12-20`;
  if (provider === 'massive') {
    // Jan 1 00:00 ET: closedSessions starts on Dec 31 and skips weekends; exchange holidays answer no rows.
    for (const day of closedSessions(new Date(`${String(year + 1)}-01-01T05:00:00Z`), 2)) {
      const url = `${MASSIVE_GROUPED_URL}${day}?${new URLSearchParams({ adjusted: 'true', apiKey: apiKey ?? '' }).toString()}`;
      const response = await marketGet(provider, url, {}, options);
      const failure = httpFailure(response);
      log.record(endpointOf(url, 'SPY year-end'), response, failure?.code ?? null);
      if (failure !== null) return log.result(failure);
      const results = field(response.body, 'results');
      if (!Array.isArray(results)) continue;
      const rows = results as unknown[];
      for (const request of requests) {
        if (request.currency !== 'USD') continue;
        const row = rows.find((candidate) => field(candidate, 'T') === request.symbol.toUpperCase());
        const price = decimalOf(field(row, 'c'));
        if (price !== null) log.quotes.push({ ...request, price, prevClose: null, asOf: new Date(`${day}T21:00:00Z`) });
      }
      if (log.quotes.length > 0) break;
    }
    return log.result(null);
  }
  for (const request of requests) {
    if (provider === 'tiingo' && request.currency !== 'USD') continue;
    const symbol = encodeURIComponent(request.symbol);
    const url =
      provider === 'tiingo'
        ? `https://api.tiingo.com/tiingo/daily/${symbol}/prices?${new URLSearchParams({ startDate: start, endDate: end }).toString()}`
        : `https://eodhd.com/api/eod/${symbol}?${new URLSearchParams({ from: start, to: end, period: 'd', fmt: 'json', api_token: apiKey ?? '' }).toString()}`;
    const response = await marketGet(
      provider,
      url,
      provider === 'tiingo' ? { Authorization: `Token ${apiKey ?? ''}` } : {},
      options,
    );
    const failure = httpFailure(response);
    log.record(endpointOf(url, `${request.symbol} year-end`), response, failure?.code ?? null);
    if (failure !== null) return log.result(failure);
    if (!Array.isArray(response.body)) continue;
    const rows = response.body
      .flatMap((row: unknown) => {
        const price = decimalOf(field(row, 'close'));
        const asOf = dateOf(field(row, 'date'));
        return price !== null &&
          asOf !== null &&
          asOf.toISOString().slice(0, 10) >= start &&
          asOf.toISOString().slice(0, 10) <= end
          ? [{ ...request, price, prevClose: null, asOf }]
          : [];
      })
      .sort((a, b) => b.asOf.getTime() - a.asOf.getTime());
    const close = rows[0];
    if (close !== undefined) log.quotes.push(close);
  }
  return log.result(null);
}
