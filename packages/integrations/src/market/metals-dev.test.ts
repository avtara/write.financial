// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from 'node:fs';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createMetalsDev, METALS_DEV_URL } from './metals-dev.ts';

/** Responses shaped after metals.dev's documentation (research market-data §3); the key is made up. */
const fixture = (name: string): object =>
  JSON.parse(readFileSync(new URL(`fixtures/${name}`, import.meta.url), 'utf8')) as object;
const KEY = 'fake-metals-key';
const NOW = new Date('2026-10-15T09:42:00Z');
const requests: URL[] = [];
const server = setupServer(
  http.get(METALS_DEV_URL, ({ request }) => {
    requests.push(new URL(request.url));
    return HttpResponse.json(fixture('metals-dev-latest-idr.json'));
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

const metalsDev = createMetalsDev();
const asOf = new Date('2026-10-16T08:59:00Z');

describe('metals.dev latest', () => {
  it('asks once per currency for every metal, per troy ounce', async () => {
    const result = await metalsDev.fetchQuotes({
      apiKey: KEY,
      requests: [
        { symbol: 'XAU', currency: 'IDR' },
        { symbol: 'xag', currency: 'IDR' },
        { symbol: 'EMAS', currency: 'IDR' },
      ],
      now: NOW,
    });
    expect(requests).toHaveLength(1);
    expect(Object.fromEntries(requests[0]?.searchParams ?? [])).toEqual({ api_key: KEY, currency: 'IDR', unit: 'toz' });
    expect(result.quotes).toEqual([
      { symbol: 'XAU', currency: 'IDR', price: '75442309.1', prevClose: null, asOf },
      { symbol: 'xag', currency: 'IDR', price: '881234.5', prevClose: null, asOf },
    ]);
    expect(result.calls[0]?.endpoint).toBe('GET /v1/latest · idr');
  });

  it('reads the wrong-key and month-quota error codes', async () => {
    server.use(http.get(METALS_DEV_URL, () => HttpResponse.json(fixture('metals-dev-1101.json'), { status: 401 })));
    const wrong = await metalsDev.fetchQuotes({
      apiKey: null,
      requests: [{ symbol: 'XAU', currency: 'IDR' }],
      now: NOW,
    });
    expect(wrong.failure).toMatchObject({ status: 'invalid_key', code: 'md_1101' });
    server.use(http.get(METALS_DEV_URL, () => HttpResponse.json(fixture('metals-dev-1203.json'))));
    const quota = await metalsDev.fetchQuotes({
      apiKey: KEY,
      requests: [{ symbol: 'XAU', currency: 'IDR' }],
      now: NOW,
    });
    expect(quota.failure).toEqual({
      status: 'quota_exhausted',
      retryAfter: null,
      quotaResetAt: new Date('2026-11-01T00:00:00Z'),
      code: 'md_1203',
    });
    server.use(http.get(METALS_DEV_URL, () => HttpResponse.json({ status: 'success', metals: {} })));
    const empty = await metalsDev.fetchQuotes({
      apiKey: KEY,
      requests: [{ symbol: 'XAU', currency: 'USD' }],
      now: NOW,
    });
    expect(empty).toMatchObject({ quotes: [], failure: null });
  });
});
