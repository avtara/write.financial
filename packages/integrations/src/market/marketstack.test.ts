// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from 'node:fs';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createMarketstack, MARKETSTACK_EOD_URL } from './marketstack.ts';

/** Responses shaped after Marketstack's documentation (research market-data §3); the key is made up. */
const fixture = (name: string): object =>
  JSON.parse(readFileSync(new URL(`fixtures/${name}`, import.meta.url), 'utf8')) as object;
const KEY = 'fake-marketstack-key';
const NOW = new Date('2026-10-15T09:42:00Z');
const requests: URL[] = [];
const server = setupServer(
  http.get(MARKETSTACK_EOD_URL, ({ request }) => {
    requests.push(new URL(request.url));
    return HttpResponse.json(fixture('marketstack-eod-latest.json'));
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

const marketstack = createMarketstack();

describe('Marketstack eod/latest', () => {
  it('reads the latest close of every symbol of one call', async () => {
    const result = await marketstack.fetchQuotes({
      apiKey: KEY,
      requests: [
        { symbol: 'BBCA.XIDX', currency: 'IDR' },
        { symbol: 'BBRI.XIDX', currency: 'IDR' },
        { symbol: 'TLKM.XIDX', currency: 'IDR' },
      ],
      now: NOW,
    });
    expect(requests[0]?.searchParams.get('symbols')).toBe('BBCA.XIDX,BBRI.XIDX,TLKM.XIDX');
    expect(requests[0]?.searchParams.get('access_key')).toBe(KEY);
    const asOf = new Date('2026-10-14T00:00:00Z');
    expect(result.quotes).toEqual([
      { symbol: 'BBCA.XIDX', currency: 'IDR', price: '8750', prevClose: null, asOf },
      { symbol: 'BBRI.XIDX', currency: 'IDR', price: '4230', prevClose: null, asOf },
    ]);
    expect(result.calls[0]?.endpoint).toBe('GET /v2/eod/latest · BBCA.XIDX,BBRI.XIDX,TLKM.XIDX');
  });

  it('reads the month limit and a wrong key from the error body', async () => {
    server.use(http.get(MARKETSTACK_EOD_URL, () => HttpResponse.json(fixture('marketstack-usage-limit.json'))));
    const limit = await marketstack.fetchQuotes({
      apiKey: KEY,
      requests: [{ symbol: 'A', currency: 'IDR' }],
      now: NOW,
    });
    expect(limit.failure).toEqual({
      status: 'quota_exhausted',
      retryAfter: null,
      quotaResetAt: new Date('2026-11-01T00:00:00Z'),
      code: 'usage_limit_reached',
    });
    server.use(
      http.get(MARKETSTACK_EOD_URL, () => HttpResponse.json(fixture('marketstack-invalid-key.json'), { status: 401 })),
    );
    const wrong = await marketstack.fetchQuotes({
      apiKey: null,
      requests: [{ symbol: 'A', currency: 'IDR' }],
      now: NOW,
    });
    expect(wrong.failure).toMatchObject({ status: 'invalid_key', code: 'invalid_access_key' });
    server.use(
      http.get(MARKETSTACK_EOD_URL, () =>
        HttpResponse.json({ error: { code: 'missing_access_key' } }, { status: 401 }),
      ),
    );
    const missing = await marketstack.fetchQuotes({
      apiKey: null,
      requests: [{ symbol: 'A', currency: 'IDR' }],
      now: NOW,
    });
    expect(missing.failure?.code).toBe('missing_access_key');
  });

  it('splits more than 100 symbols and tolerates a body without data', async () => {
    server.use(
      http.get(MARKETSTACK_EOD_URL, ({ request }) => {
        requests.push(new URL(request.url));
        // The first call answers without data, the second with a symbol nobody asked.
        return HttpResponse.json(
          requests.length === 1 ? {} : { data: [{ symbol: 'OTHER', close: 1, date: '2026-10-14T00:00:00+0000' }] },
        );
      }),
    );
    const many = Array.from({ length: 101 }, (_, index) => ({ symbol: `S${index}`, currency: 'IDR' }));
    const result = await marketstack.fetchQuotes({ apiKey: KEY, requests: many, now: NOW });
    expect(requests).toHaveLength(2);
    expect(result).toMatchObject({ quotes: [], failure: null });
  });
});
