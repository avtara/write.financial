// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from 'node:fs';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { FAWAZAHMED0_URLS } from '../fx/fawazahmed0.ts';
import { createFawazahmed0Gold, GOLD_SPOT_SYMBOL } from './fawazahmed0-gold.ts';

/** Shaped after `xau.min.json` as tested on 17 Oct 2026 (research market-data §1.5). */
const XAU = JSON.parse(readFileSync(new URL('fixtures/fawazahmed0-xau.json', import.meta.url), 'utf8')) as object;
const [JSDELIVR, PAGES] = FAWAZAHMED0_URLS;
const NOW = new Date('2026-10-16T02:00:00Z');
const requests: string[] = [];
const server = setupServer(
  http.get(`${JSDELIVR}xau.min.json`, () => {
    requests.push('jsdelivr');
    return HttpResponse.json(XAU);
  }),
  http.get(`${PAGES}xau.min.json`, () => {
    requests.push('pages');
    return HttpResponse.json(XAU);
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

const gold = createFawazahmed0Gold();
const asOf = new Date('2026-10-16T00:00:00Z');

describe('fawazahmed0 XAU spot', () => {
  it('reads XAU per troy ounce in each asked currency from one file', async () => {
    const result = await gold.fetchQuotes({
      apiKey: null,
      requests: [
        { symbol: GOLD_SPOT_SYMBOL, currency: 'IDR' },
        { symbol: 'xau', currency: 'USD' },
        { symbol: 'XAU', currency: 'EUR' },
        { symbol: 'BTC', currency: 'IDR' },
      ],
      now: NOW,
    });
    expect(requests).toEqual(['jsdelivr']);
    expect(result.quotes).toEqual([
      { symbol: 'XAU', currency: 'IDR', price: '75442309.11', prevClose: null, asOf },
      { symbol: 'xau', currency: 'USD', price: '4182.94', prevClose: null, asOf },
    ]);
    expect(result.calls[0]?.endpoint).toBe(
      'GET /npm/@fawazahmed0/currency-api@latest/v1/currencies/xau.min.json · idr,usd,eur',
    );
    expect(result.failure).toBeNull();
  });

  it('falls back to the Pages mirror, and reports when both fail', async () => {
    server.use(http.get(`${JSDELIVR}xau.min.json`, () => HttpResponse.json({}, { status: 503 })));
    const mirrored = await gold.fetchQuotes({ apiKey: null, requests: [{ symbol: 'XAU', currency: 'IDR' }], now: NOW });
    expect(requests).toEqual(['pages']);
    expect(mirrored.calls.map((call) => call.errorCode)).toEqual(['http_503', null]);
    expect(mirrored).toMatchObject({ failure: null, quotes: [{ price: '75442309.11' }] });
    server.use(http.get(`${PAGES}xau.min.json`, () => HttpResponse.json({ date: 'soon' })));
    const failed = await gold.fetchQuotes({ apiKey: null, requests: [{ symbol: 'XAU', currency: 'IDR' }], now: NOW });
    expect(failed.failure).toEqual({ status: 'error', retryAfter: null, quotaResetAt: null, code: 'unexpected_body' });
  });

  it('asks nothing without XAU', async () => {
    expect(await gold.fetchQuotes({ apiKey: null, requests: [], now: NOW })).toMatchObject({ calls: [], quotes: [] });
    expect(requests).toEqual([]);
  });
});
