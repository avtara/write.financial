// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from 'node:fs';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createGoldApi, GOLDAPI_URL } from './goldapi.ts';

/** Responses shaped after GoldAPI.io's documentation (research market-data §3); the token is made up. */
const fixture = (name: string): object =>
  JSON.parse(readFileSync(new URL(`fixtures/${name}`, import.meta.url), 'utf8')) as object;
const KEY = 'fake-goldapi-token';
const NOW = new Date('2026-10-15T09:42:00Z');
const requests: Request[] = [];
const server = setupServer(
  http.get(`${GOLDAPI_URL}:metal/:currency`, ({ request }) => {
    requests.push(request);
    return HttpResponse.json(fixture('goldapi-xau-idr.json'));
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

const goldapi = createGoldApi();

describe('GoldAPI.io', () => {
  it('asks each metal and currency with the token header; other symbols are not asked', async () => {
    const result = await goldapi.fetchQuotes({
      apiKey: KEY,
      requests: [
        { symbol: 'xau', currency: 'IDR' },
        { symbol: 'EMAS', currency: 'IDR' },
      ],
      now: NOW,
    });
    expect(requests.map((request) => new URL(request.url).pathname)).toEqual(['/api/XAU/IDR']);
    expect(requests[0]?.headers.get('x-access-token')).toBe(KEY);
    expect(result.quotes).toEqual([
      {
        symbol: 'xau',
        currency: 'IDR',
        price: '75442309.12',
        prevClose: '75000000.12',
        asOf: new Date('2026-10-15T09:00:00Z'),
      },
    ]);
    expect(result.calls[0]?.endpoint).toBe('GET /api/XAU/IDR');
  });

  it('reports a wrong token, a 429 with its reset, and skips a body without a price', async () => {
    server.use(
      http.get(`${GOLDAPI_URL}:metal/:currency`, () => HttpResponse.json(fixture('goldapi-403.json'), { status: 403 })),
    );
    const wrong = await goldapi.fetchQuotes({ apiKey: null, requests: [{ symbol: 'XAU', currency: 'IDR' }], now: NOW });
    expect(wrong.failure).toMatchObject({ status: 'invalid_key', code: 'http_403' });
    server.use(
      http.get(`${GOLDAPI_URL}:metal/:currency`, () =>
        HttpResponse.json({}, { status: 429, headers: { 'x-ratelimit-reset': '1793491200' } }),
      ),
    );
    const limited = await goldapi.fetchQuotes({
      apiKey: KEY,
      requests: [{ symbol: 'XAU', currency: 'IDR' }],
      now: NOW,
    });
    expect(limited.failure).toEqual({
      status: 'rate_limited',
      retryAfter: null,
      quotaResetAt: new Date('2026-11-01T00:00:00Z'),
      code: 'http_429',
    });
    server.use(http.get(`${GOLDAPI_URL}:metal/:currency`, () => HttpResponse.json({ error: 'busy' })));
    const empty = await goldapi.fetchQuotes({ apiKey: KEY, requests: [{ symbol: 'XAU', currency: 'USD' }], now: NOW });
    expect(empty).toMatchObject({ quotes: [], failure: null });
  });
});
