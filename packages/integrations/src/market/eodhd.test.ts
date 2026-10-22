// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from 'node:fs';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createEodhd, EODHD_REALTIME_URL } from './eodhd.ts';

/** Responses shaped after EODHD's documentation (research market-data §3); the token is made up. */
const fixture = (name: string): object =>
  JSON.parse(readFileSync(new URL(`fixtures/${name}`, import.meta.url), 'utf8')) as object;
const KEY = 'fake-eodhd-token';
const NOW = new Date('2026-10-15T09:20:00Z');
const requests: URL[] = [];
const server = setupServer(
  http.get(`${EODHD_REALTIME_URL}:symbol`, ({ request }) => {
    const url = new URL(request.url);
    requests.push(url);
    return HttpResponse.json(
      fixture(url.searchParams.has('s') ? 'eodhd-realtime-many.json' : 'eodhd-realtime-one.json'),
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

const eodhd = createEodhd();
const asOf = new Date('2026-10-15T09:15:00Z');

describe('EODHD real-time', () => {
  it('asks several symbols in one call and skips "NA" values', async () => {
    const result = await eodhd.fetchQuotes({
      apiKey: KEY,
      requests: [
        { symbol: 'BBCA.JK', currency: 'IDR' },
        { symbol: 'bbri.jk', currency: 'IDR' },
        { symbol: 'JKSE.INDX', currency: 'IDR' },
      ],
      now: NOW,
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.pathname).toBe('/api/real-time/BBCA.JK');
    expect(requests[0]?.searchParams.get('s')).toBe('bbri.jk,JKSE.INDX');
    expect(requests[0]?.searchParams.get('api_token')).toBe(KEY);
    expect(result.quotes).toEqual([
      { symbol: 'BBCA.JK', currency: 'IDR', price: '8750', prevClose: '8700', asOf },
      { symbol: 'bbri.jk', currency: 'IDR', price: '4230', prevClose: '4210', asOf },
    ]);
    expect(result.calls[0]?.endpoint).toBe('GET /api/real-time/BBCA.JK · BBCA.JK,bbri.jk,JKSE.INDX');
    expect(JSON.stringify(result.calls)).not.toContain(KEY);
  });

  it('reads the single-object answer of one symbol and splits batches of 20', async () => {
    const one = await eodhd.fetchQuotes({ apiKey: KEY, requests: [{ symbol: 'TLKM.JK', currency: 'IDR' }], now: NOW });
    expect(one.quotes).toEqual([{ symbol: 'TLKM.JK', currency: 'IDR', price: '2930', prevClose: '2910', asOf }]);
    requests.length = 0;
    const many = Array.from({ length: 21 }, (_, index) => ({ symbol: `S${index}.JK`, currency: 'IDR' }));
    await eodhd.fetchQuotes({ apiKey: KEY, requests: many, now: NOW });
    expect(requests).toHaveLength(2);
  });

  it('takes a 402 as the day’s calls used up', async () => {
    server.use(http.get(`${EODHD_REALTIME_URL}:symbol`, () => HttpResponse.json({}, { status: 402 })));
    const result = await eodhd.fetchQuotes({
      apiKey: null,
      requests: [{ symbol: 'BBCA.JK', currency: 'IDR' }],
      now: NOW,
    });
    expect(result.failure).toEqual({
      status: 'quota_exhausted',
      retryAfter: null,
      quotaResetAt: new Date('2026-10-16T00:00:00Z'),
      code: 'http_402',
    });
    server.use(http.get(`${EODHD_REALTIME_URL}:symbol`, () => HttpResponse.text('Unauthenticated', { status: 401 })));
    const wrong = await eodhd.fetchQuotes({
      apiKey: KEY,
      requests: [{ symbol: 'BBCA.JK', currency: 'IDR' }],
      now: NOW,
    });
    expect(wrong.failure).toMatchObject({ status: 'invalid_key', quotaResetAt: null });
  });
});
