// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Massive (formerly Polygon) Stocks Basic (BYOK, end of day; research market-data §2.2): one
 * `GET /v2/aggs/grouped/locale/us/market/stocks/{date}` answers the close of every US ticker for a trading day. The
 * day is the latest weekday whose session has closed in New York (17.00 ET); a holiday answers no results, so up to
 * {@link MAX_DAYS} earlier weekdays are tried. The key goes in the `apiKey` query parameter (never logged).
 */
import {
  decimalOf,
  endpointOf,
  field,
  httpFailure,
  marketGet,
  runLog,
  type MarketAdapter,
  type MarketHttpOptions,
} from './http.ts';

export const MASSIVE_GROUPED_URL = 'https://api.massive.com/v2/aggs/grouped/locale/us/market/stocks/';
const MAX_DAYS = 3;
const DAY_MS = 86_400_000;

const NEW_YORK = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  hourCycle: 'h23',
  weekday: 'short',
});

/** The New York trading days to try, newest first: today after 17.00 ET on a weekday, else the weekdays before. */
export function closedSessions(now: Date, count: number): string[] {
  const parts = Object.fromEntries(NEW_YORK.formatToParts(now).map(({ type, value }) => [type, value]));
  let day = Date.UTC(Number(parts['year']), Number(parts['month']) - 1, Number(parts['day']));
  if (Number(parts['hour']) < 17) day -= DAY_MS;
  const days: string[] = [];
  while (days.length < count) {
    const weekday = new Date(day).getUTCDay();
    if (weekday !== 0 && weekday !== 6) days.push(new Date(day).toISOString().slice(0, 10));
    day -= DAY_MS;
  }
  return days;
}

export function createMassive(options: MarketHttpOptions = {}): MarketAdapter {
  return {
    provider: 'massive',
    async fetchQuotes({ apiKey, requests, now }) {
      const log = runLog('massive');
      const usd = requests.filter((request) => request.currency === 'USD');
      if (usd.length === 0) return log.result(null);
      for (const date of closedSessions(now, MAX_DAYS)) {
        const url = `${MASSIVE_GROUPED_URL}${date}?${new URLSearchParams({ adjusted: 'true', apiKey: apiKey ?? '' }).toString()}`;
        const response = await marketGet('massive', url, {}, options);
        const failure = httpFailure(response);
        log.record(endpointOf(url, `${usd.length} simbol`), response, failure?.code ?? null);
        if (failure !== null) return log.result(failure);
        const results = field(response.body, 'results');
        if (!Array.isArray(results) || results.length === 0) continue;
        const asOf = new Date(`${date}T21:00:00Z`);
        for (const request of usd) {
          const row = (results as unknown[]).find(
            (candidate) => field(candidate, 'T') === request.symbol.toUpperCase(),
          );
          const price = decimalOf(field(row, 'c'));
          if (price !== null) log.quotes.push({ ...request, price, prevClose: null, asOf });
        }
        break;
      }
      return log.result(null);
    },
  };
}
