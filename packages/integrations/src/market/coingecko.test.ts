// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from 'node:fs';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { COINGECKO_PRICE_URL, createCoinGecko } from './coingecko.ts';

/** Responses shaped after CoinGecko's documentation (research market-data §3); the key is made up. */
const fixture = (name: string): object =>
  JSON.parse(readFileSync(new URL(`fixtures/${name}`, import.meta.url), 'utf8')) as object;
const KEY = 'fake-coingecko-key';
const NOW = new Date('2026-10-15T09:42:00Z');
const requests: Request[] = [];
const server = setupServer(
  http.get(COINGECKO_PRICE_URL, ({ request }) => {
    requests.push(request);
    return HttpResponse.json(fixture('coingecko-simple-price.json'));
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

const coingecko = createCoinGecko();
const asOf = new Date('2026-10-15T09:39:00Z');

describe('CoinGecko simple/price', () => {
  it('asks every symbol in every currency at once, with the demo key header', async () => {
    const result = await coingecko.fetchQuotes({
      apiKey: KEY,
      requests: [
        { symbol: 'BTC', currency: 'IDR' },
        { symbol: 'ETH', currency: 'USD' },
        { symbol: 'SOL', currency: 'IDR' },
      ],
      now: NOW,
    });
    const url = new URL(requests[0]?.url ?? '');
    expect(url.searchParams.get('symbols')).toBe('btc,eth,sol');
    expect(url.searchParams.get('vs_currencies')).toBe('idr,usd');
    expect(requests[0]?.headers.get('x-cg-demo-api-key')).toBe(KEY);
    expect(result.quotes).toEqual([
      { symbol: 'BTC', currency: 'IDR', price: '1459802000', prevClose: '1424197073.17', asOf },
      { symbol: 'ETH', currency: 'USD', price: '3745.2', prevClose: '3794.52887538', asOf },
    ]);
    expect(result.calls[0]?.endpoint).toBe('GET /api/v3/simple/price · btc,eth,sol → idr,usd');
  });

  it('splits batches of 100 and skips a coin without a change or a time', async () => {
    server.use(
      http.get(COINGECKO_PRICE_URL, ({ request }) => {
        requests.push(request);
        return HttpResponse.json({ c0: { idr: 5, idr_24h_change: -100, last_updated_at: 1792057140 }, c1: { idr: 5 } });
      }),
    );
    const many = Array.from({ length: 101 }, (_, index) => ({ symbol: `C${index}`, currency: 'IDR' }));
    const result = await coingecko.fetchQuotes({ apiKey: KEY, requests: many, now: NOW });
    expect(requests).toHaveLength(2);
    expect(result.quotes).toEqual([{ symbol: 'C0', currency: 'IDR', price: '5', prevClose: null, asOf }]);
  });

  it('reports a 429 with its Retry-After', async () => {
    server.use(
      http.get(COINGECKO_PRICE_URL, () =>
        HttpResponse.json(fixture('coingecko-429.json'), { status: 429, headers: { 'Retry-After': '30' } }),
      ),
    );
    const result = await coingecko.fetchQuotes({
      apiKey: null,
      requests: [{ symbol: 'BTC', currency: 'IDR' }],
      now: NOW,
    });
    expect(result.failure).toEqual({ status: 'rate_limited', retryAfter: '30', quotaResetAt: null, code: 'http_429' });
  });
});
