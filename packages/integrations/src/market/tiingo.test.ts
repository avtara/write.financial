// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from 'node:fs';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createTiingo, TIINGO_IEX_URL } from './tiingo.ts';

/** Responses shaped after Tiingo's documentation (research market-data §3); the key is made up. */
const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`fixtures/${name}`, import.meta.url), 'utf8'));
const iex = fixture('tiingo-iex.json');
const authError = fixture('tiingo-auth-error.json');
const KEY = 'fake-tiingo-key';
const NOW = new Date('2026-10-15T02:42:00Z');
const requests: Request[] = [];
const server = setupServer(
  http.get(TIINGO_IEX_URL, ({ request }) => {
    requests.push(request);
    return HttpResponse.json(iex as object);
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

const tiingo = createTiingo();

describe('Tiingo IEX', () => {
  it('asks every USD symbol in one call with the token header and reads last + previous close', async () => {
    const result = await tiingo.fetchQuotes({
      apiKey: KEY,
      requests: [
        { symbol: 'SPY', currency: 'USD' },
        { symbol: 'QQQ', currency: 'USD' },
        { symbol: 'ZZZZ', currency: 'USD' },
        { symbol: 'BBCA', currency: 'IDR' },
      ],
      now: NOW,
    });
    expect(requests).toHaveLength(1);
    expect(new URL(requests[0]?.url ?? '').searchParams.get('tickers')).toBe('spy,qqq,zzzz');
    expect(requests[0]?.headers.get('authorization')).toBe(`Token ${KEY}`);
    expect(result.quotes).toEqual([
      {
        symbol: 'SPY',
        currency: 'USD',
        price: '690.1',
        prevClose: '685.2',
        asOf: new Date('2026-10-14T19:59:59.500Z'),
      },
      { symbol: 'QQQ', currency: 'USD', price: '603.55', prevClose: null, asOf: new Date('2026-10-14T20:00:00Z') },
    ]);
    expect(result.calls).toEqual([
      {
        provider: 'tiingo',
        endpoint: 'GET /iex/ · spy,qqq,zzzz',
        httpStatus: 200,
        ok: true,
        durationMs: expect.any(Number) as number,
        errorCode: null,
      },
    ]);
    expect(JSON.stringify(result.calls)).not.toContain(KEY);
    expect(result).toMatchObject({ failure: null, unverified: false, credits: null });
  });

  it('splits more than 100 symbols over several calls and asks nothing without USD symbols', async () => {
    const many = Array.from({ length: 101 }, (_, index) => ({ symbol: `S${index}`, currency: 'USD' }));
    await tiingo.fetchQuotes({ apiKey: KEY, requests: many, now: NOW });
    expect(requests).toHaveLength(2);
    const none = await tiingo.fetchQuotes({ apiKey: null, requests: [{ symbol: 'BBCA', currency: 'IDR' }], now: NOW });
    expect(requests).toHaveLength(2);
    expect(none).toMatchObject({ quotes: [], calls: [], failure: null });
  });

  it('reports a wrong token, whether by status or by body', async () => {
    server.use(http.get(TIINGO_IEX_URL, () => HttpResponse.json(authError as object)));
    const byBody = await tiingo.fetchQuotes({ apiKey: KEY, requests: [{ symbol: 'SPY', currency: 'USD' }], now: NOW });
    expect(byBody.failure).toEqual({
      status: 'invalid_key',
      retryAfter: null,
      quotaResetAt: null,
      code: 'tiingo_auth',
    });
    expect(byBody.calls[0]).toMatchObject({ ok: false, errorCode: 'tiingo_auth' });
    server.use(http.get(TIINGO_IEX_URL, () => HttpResponse.json(authError as object, { status: 401 })));
    const byStatus = await tiingo.fetchQuotes({
      apiKey: null,
      requests: [{ symbol: 'SPY', currency: 'USD' }],
      now: NOW,
    });
    expect(byStatus.failure).toMatchObject({ status: 'invalid_key', code: 'http_401' });
  });

  it('reports a 429 with its Retry-After', async () => {
    server.use(
      http.get(TIINGO_IEX_URL, () => HttpResponse.json({}, { status: 429, headers: { 'Retry-After': '120' } })),
    );
    const result = await tiingo.fetchQuotes({ apiKey: KEY, requests: [{ symbol: 'SPY', currency: 'USD' }], now: NOW });
    expect(result.failure).toEqual({ status: 'rate_limited', retryAfter: '120', quotaResetAt: null, code: 'http_429' });
  });
});
