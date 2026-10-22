// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from 'node:fs';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { closedSessions, createMassive, MASSIVE_GROUPED_URL } from './massive.ts';

/** Responses shaped after Massive's documentation (research market-data §3); the key is made up. */
const fixture = (name: string): object =>
  JSON.parse(readFileSync(new URL(`fixtures/${name}`, import.meta.url), 'utf8')) as object;
const KEY = 'fake-massive-key';
// Thursday 15 Oct 2026, 09.42 WIB = Wednesday 14 Oct, 22.42 EDT: Wednesday's session has closed.
const NOW = new Date('2026-10-15T02:42:00Z');
const requests: string[] = [];
const server = setupServer(
  http.get(`${MASSIVE_GROUPED_URL}:date`, ({ params, request }) => {
    requests.push(`${String(params['date'])} ${new URL(request.url).searchParams.get('apiKey') ?? ''}`);
    return HttpResponse.json(fixture('massive-grouped.json'));
  }),
);

beforeAll(() => {
  server.listen({ onUnhandledFrame: 'error' });
});
afterEach(() => {
  server.resetHandlers();
  requests.length = 0;
});
afterAll(() => {
  server.close();
});

const massive = createMassive();

describe('closedSessions', () => {
  it('starts today after 17.00 ET on a weekday, else on the weekday before, skipping weekends', () => {
    expect(closedSessions(NOW, 3)).toEqual(['2026-10-14', '2026-10-13', '2026-10-12']);
    // Monday 19 Oct, 10.00 EDT: the last closed session is Friday's.
    expect(closedSessions(new Date('2026-10-19T14:00:00Z'), 2)).toEqual(['2026-10-16', '2026-10-15']);
    // Saturday 17 Oct, 18.00 EDT.
    expect(closedSessions(new Date('2026-10-17T22:00:00Z'), 1)).toEqual(['2026-10-16']);
  });
});

describe('Massive grouped daily', () => {
  it('reads every USD symbol from one day of closes; the key stays out of the log', async () => {
    const result = await massive.fetchQuotes({
      apiKey: KEY,
      requests: [
        { symbol: 'SPY', currency: 'USD' },
        { symbol: 'qqq', currency: 'USD' },
        { symbol: 'VEA', currency: 'USD' },
      ],
      now: NOW,
    });
    expect(requests).toEqual([`2026-10-14 ${KEY}`]);
    const asOf = new Date('2026-10-14T21:00:00Z');
    expect(result.quotes).toEqual([
      { symbol: 'SPY', currency: 'USD', price: '690.1', prevClose: null, asOf },
      { symbol: 'qqq', currency: 'USD', price: '603.55', prevClose: null, asOf },
    ]);
    expect(result.calls[0]?.endpoint).toBe('GET /v2/aggs/grouped/locale/us/market/stocks/2026-10-14 · 3 simbol');
  });

  it('steps back over holidays, at most three days', async () => {
    server.use(
      http.get(`${MASSIVE_GROUPED_URL}:date`, ({ params }) => {
        requests.push(String(params['date']));
        return HttpResponse.json(fixture('massive-grouped-holiday.json'));
      }),
    );
    const result = await massive.fetchQuotes({ apiKey: KEY, requests: [{ symbol: 'SPY', currency: 'USD' }], now: NOW });
    expect(requests).toEqual(['2026-10-14', '2026-10-13', '2026-10-12']);
    expect(result).toMatchObject({ quotes: [], failure: null });
  });

  it('asks nothing without USD symbols and reports a wrong key', async () => {
    expect(
      await massive.fetchQuotes({ apiKey: KEY, requests: [{ symbol: 'BBCA', currency: 'IDR' }], now: NOW }),
    ).toMatchObject({ calls: [], quotes: [] });
    expect(requests).toEqual([]);
    server.use(
      http.get(`${MASSIVE_GROUPED_URL}:date`, () => HttpResponse.json(fixture('massive-401.json'), { status: 401 })),
    );
    const wrong = await massive.fetchQuotes({ apiKey: null, requests: [{ symbol: 'SPY', currency: 'USD' }], now: NOW });
    expect(wrong.failure).toMatchObject({ status: 'invalid_key' });
  });
});
