// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from 'node:fs';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { CMC_QUOTES_URL, createCoinMarketCap } from './coinmarketcap.ts';

/** Responses shaped after CoinMarketCap's documentation (research market-data §1.4, §3); the key is made up. */
const fixture = (name: string): object =>
  JSON.parse(readFileSync(new URL(`fixtures/${name}`, import.meta.url), 'utf8')) as object;
const KEY = 'fake-cmc-key';
const NOW = new Date('2026-10-15T09:42:00Z');
const requests: Request[] = [];
const server = setupServer(
  http.get(CMC_QUOTES_URL, ({ request }) => {
    requests.push(request);
    return HttpResponse.json(fixture('coinmarketcap-quotes-idr.json'));
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

const cmc = createCoinMarketCap();
const asOf = new Date('2026-10-15T09:39:00Z');

describe('CoinMarketCap quotes/latest', () => {
  it('asks the union of symbols once per currency and counts the credits', async () => {
    const result = await cmc.fetchQuotes({
      apiKey: KEY,
      requests: [
        { symbol: 'BTC', currency: 'IDR' },
        { symbol: 'eth', currency: 'IDR' },
        { symbol: 'SOL', currency: 'IDR' },
        { symbol: 'BTC', currency: 'USD' },
      ],
      now: NOW,
    });
    const urls = requests.map((request) => new URL(request.url));
    expect(urls.map((url) => [url.searchParams.get('symbol'), url.searchParams.get('convert')])).toEqual([
      ['BTC,ETH,SOL', 'IDR'],
      ['BTC', 'USD'],
    ]);
    expect(urls[0]?.searchParams.get('skip_invalid')).toBe('true');
    expect(requests[0]?.headers.get('x-cmc_pro_api_key')).toBe(KEY);
    expect(result.quotes).toEqual([
      { symbol: 'BTC', currency: 'IDR', price: '1459802000', prevClose: '1424197073.17', asOf },
      { symbol: 'eth', currency: 'IDR', price: '61234000.5', prevClose: '61977733.2996', asOf },
    ]);
    expect(result.credits).toBe(2);
    expect(result.calls.map((call) => call.endpoint)).toEqual([
      'GET /v2/cryptocurrency/quotes/latest · BTC,ETH,SOL → idr',
      'GET /v2/cryptocurrency/quotes/latest · BTC → usd',
    ]);
  });

  it('splits more than 100 symbols', async () => {
    const many = Array.from({ length: 101 }, (_, index) => ({ symbol: `C${index}`, currency: 'IDR' }));
    await cmc.fetchQuotes({ apiKey: KEY, requests: many, now: NOW });
    expect(requests).toHaveLength(2);
  });

  it('reads the error codes: key, day, month, minute, other', async () => {
    const answer = async (body: object, status: number, headers: Record<string, string> = {}) => {
      server.use(http.get(CMC_QUOTES_URL, () => HttpResponse.json(body, { status, headers })));
      return cmc.fetchQuotes({ apiKey: null, requests: [{ symbol: 'BTC', currency: 'IDR' }], now: NOW });
    };
    expect((await answer(fixture('coinmarketcap-1001.json'), 401)).failure).toMatchObject({
      status: 'invalid_key',
      code: 'cmc_1001',
    });
    expect((await answer({ status: { error_code: 1002 } }, 401)).failure?.status).toBe('invalid_key');
    expect((await answer({ status: { error_code: 1009 } }, 429)).failure).toMatchObject({
      status: 'quota_exhausted',
      quotaResetAt: new Date('2026-10-16T00:00:00Z'),
    });
    const month = await answer(fixture('coinmarketcap-1010.json'), 429);
    expect(month.failure).toMatchObject({ status: 'quota_exhausted', quotaResetAt: new Date('2026-11-01T00:00:00Z') });
    expect(month.credits).toBe(0);
    expect((await answer({ status: { error_code: 1008 } }, 429, { 'Retry-After': '60' })).failure).toMatchObject({
      status: 'rate_limited',
      retryAfter: '60',
    });
    expect((await answer({ status: { error_code: 1011 } }, 429)).failure?.status).toBe('rate_limited');
    expect((await answer({ status: { error_code: 500 } }, 500)).failure).toMatchObject({
      status: 'error',
      code: 'cmc_500',
    });
    expect((await answer({}, 503)).failure).toMatchObject({ status: 'error', code: 'http_503' });
  });

  it('skips a price with an impossible change or no time', async () => {
    server.use(
      http.get(CMC_QUOTES_URL, () =>
        HttpResponse.json({
          status: { error_code: 0, credit_count: 1 },
          data: {
            BTC: { quote: { IDR: { price: 10, percent_change_24h: -100, last_updated: '2026-10-15T09:39:00Z' } } },
            ETH: [{ quote: { IDR: { price: 10 } } }],
          },
        }),
      ),
    );
    const result = await cmc.fetchQuotes({
      apiKey: KEY,
      requests: [
        { symbol: 'BTC', currency: 'IDR' },
        { symbol: 'ETH', currency: 'IDR' },
      ],
      now: NOW,
    });
    expect(result.quotes).toEqual([{ symbol: 'BTC', currency: 'IDR', price: '10', prevClose: null, asOf }]);
  });
});
