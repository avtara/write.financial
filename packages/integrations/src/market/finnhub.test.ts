// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from 'node:fs';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createFinnhub, FINNHUB_QUOTE_URL } from './finnhub.ts';

/** Responses shaped after Finnhub's documentation (research market-data §3); the key is made up. */
const fixture = (name: string): object =>
  JSON.parse(readFileSync(new URL(`fixtures/${name}`, import.meta.url), 'utf8')) as object;
const KEY = 'fake-finnhub-key';
const NOW = new Date('2026-10-15T02:42:00Z');
const requests: Request[] = [];
const server = setupServer(
  http.get(FINNHUB_QUOTE_URL, ({ request }) => {
    requests.push(request);
    const symbol = new URL(request.url).searchParams.get('symbol');
    return HttpResponse.json(fixture(symbol === 'SPY' ? 'finnhub-quote-spy.json' : 'finnhub-quote-unknown.json'));
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

const finnhub = createFinnhub();

describe('Finnhub quote', () => {
  it('asks each USD symbol with the key header and skips unknown symbols (zeros)', async () => {
    const result = await finnhub.fetchQuotes({
      apiKey: KEY,
      requests: [
        { symbol: 'SPY', currency: 'USD' },
        { symbol: 'NOPE', currency: 'USD' },
        { symbol: 'BBCA', currency: 'IDR' },
      ],
      now: NOW,
    });
    expect(requests.map((request) => new URL(request.url).searchParams.get('symbol'))).toEqual(['SPY', 'NOPE']);
    expect(requests[0]?.headers.get('x-finnhub-token')).toBe(KEY);
    expect(result.quotes).toEqual([
      { symbol: 'SPY', currency: 'USD', price: '690.1', prevClose: '685.2', asOf: new Date('2026-10-14T20:00:00Z') },
    ]);
    expect(result.calls.map((call) => call.endpoint)).toEqual(['GET /api/v1/quote · SPY', 'GET /api/v1/quote · NOPE']);
    expect(result.failure).toBeNull();
  });

  it('stops at a wrong key or a 429', async () => {
    server.use(http.get(FINNHUB_QUOTE_URL, () => HttpResponse.json(fixture('finnhub-401.json'), { status: 401 })));
    const wrong = await finnhub.fetchQuotes({
      apiKey: null,
      requests: [
        { symbol: 'SPY', currency: 'USD' },
        { symbol: 'QQQ', currency: 'USD' },
      ],
      now: NOW,
    });
    expect(wrong.calls).toHaveLength(1);
    expect(wrong.failure).toMatchObject({ status: 'invalid_key', code: 'http_401' });
    server.use(http.get(FINNHUB_QUOTE_URL, () => HttpResponse.json({ error: 'limit' }, { status: 429 })));
    const limited = await finnhub.fetchQuotes({
      apiKey: KEY,
      requests: [{ symbol: 'SPY', currency: 'USD' }],
      now: NOW,
    });
    expect(limited.failure).toMatchObject({ status: 'rate_limited', retryAfter: null });
  });
});
