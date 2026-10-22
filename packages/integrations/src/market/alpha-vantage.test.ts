// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from 'node:fs';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ALPHA_VANTAGE_URL, createAlphaVantage } from './alpha-vantage.ts';

/** Responses shaped after Alpha Vantage's documentation (research market-data §3); the key is made up. */
const fixture = (name: string): object =>
  JSON.parse(readFileSync(new URL(`fixtures/${name}`, import.meta.url), 'utf8')) as object;
const KEY = 'fake-av-key';
const NOW = new Date('2026-10-15T02:42:00Z');
const requests: URL[] = [];
const server = setupServer(
  http.get(ALPHA_VANTAGE_URL, ({ request }) => {
    const url = new URL(request.url);
    requests.push(url);
    return HttpResponse.json(
      fixture(
        url.searchParams.get('symbol') === 'SPY' ? 'alpha-vantage-global-quote.json' : 'alpha-vantage-empty.json',
      ),
    );
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

const alphaVantage = createAlphaVantage();

describe('Alpha Vantage GLOBAL_QUOTE', () => {
  it('reads the last close per USD symbol and marks the key as unverifiable', async () => {
    const result = await alphaVantage.fetchQuotes({
      apiKey: KEY,
      requests: [
        { symbol: 'SPY', currency: 'USD' },
        { symbol: 'NOPE', currency: 'USD' },
        { symbol: 'BBCA', currency: 'IDR' },
      ],
      now: NOW,
    });
    expect(requests.map((url) => url.searchParams.get('function'))).toEqual(['GLOBAL_QUOTE', 'GLOBAL_QUOTE']);
    expect(requests[0]?.searchParams.get('apikey')).toBe(KEY);
    expect(result.quotes).toEqual([
      { symbol: 'SPY', currency: 'USD', price: '690.1', prevClose: '685.2', asOf: new Date('2026-10-14T00:00:00Z') },
    ]);
    expect(result).toMatchObject({ failure: null, unverified: true });
    expect(result.calls[0]?.endpoint).toBe('GET /query · SPY');
  });

  it('takes the 25-a-day notice as an exhausted quota until the next UTC day', async () => {
    server.use(http.get(ALPHA_VANTAGE_URL, () => HttpResponse.json(fixture('alpha-vantage-limit.json'))));
    const result = await alphaVantage.fetchQuotes({
      apiKey: KEY,
      requests: [
        { symbol: 'SPY', currency: 'USD' },
        { symbol: 'QQQ', currency: 'USD' },
      ],
      now: NOW,
    });
    expect(result.calls).toHaveLength(1);
    expect(result.failure).toEqual({
      status: 'quota_exhausted',
      retryAfter: null,
      quotaResetAt: new Date('2026-10-16T00:00:00Z'),
      code: 'av_limit',
    });
    server.use(http.get(ALPHA_VANTAGE_URL, () => HttpResponse.json({ Note: 'Thank you for using Alpha Vantage!' })));
    const note = await alphaVantage.fetchQuotes({
      apiKey: null,
      requests: [{ symbol: 'SPY', currency: 'USD' }],
      now: NOW,
    });
    expect(note.failure?.code).toBe('av_limit');
    server.use(http.get(ALPHA_VANTAGE_URL, () => HttpResponse.json({}, { status: 500 })));
    const down = await alphaVantage.fetchQuotes({
      apiKey: KEY,
      requests: [{ symbol: 'SPY', currency: 'USD' }],
      now: NOW,
    });
    expect(down.failure).toMatchObject({ status: 'error', code: 'http_500' });
  });
});
