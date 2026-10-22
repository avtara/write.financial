// SPDX-License-Identifier: AGPL-3.0-only
import { delay, http as mock, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  dateOf,
  decimalOf,
  EgressDeniedError,
  endpointOf,
  field,
  httpFailure,
  MARKET_TIMEOUT_MS,
  marketGet,
  nextUtcDay,
  nextUtcMonth,
  prevCloseFromChange,
  runLog,
  symbolSummary,
  type MarketResponse,
} from './http.ts';

const URL_ = 'https://finnhub.io/api/v1/quote';
const requests: Request[] = [];
const server = setupServer(
  mock.get(URL_, ({ request }) => {
    requests.push(request);
    return HttpResponse.json({ c: 1 });
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

const response = (status: number | null, headers: Record<string, string> = {}): MarketResponse => ({
  status,
  headers: new Headers(headers),
  body: undefined,
  durationMs: 3,
  transportError: status === null ? 'timeout' : null,
});

describe('marketGet', () => {
  it('sends the provider headers, asks for JSON, identifies itself, and refuses redirects', async () => {
    const spy = vi.fn(fetch);
    const answer = await marketGet('finnhub', `${URL_}?symbol=SPY`, { 'X-Finnhub-Token': 'fake-key' }, { fetch: spy });
    expect(answer).toMatchObject({ status: 200, body: { c: 1 }, transportError: null });
    expect(answer.durationMs).toBeGreaterThanOrEqual(0);
    expect(requests[0]?.headers.get('x-finnhub-token')).toBe('fake-key');
    expect(requests[0]?.headers.get('accept')).toBe('application/json');
    expect(requests[0]?.headers.get('user-agent')).toBe('write.financial');
    expect(spy).toHaveBeenCalledWith(`${URL_}?symbol=SPY`, expect.objectContaining({ redirect: 'error' }));
  });

  it('refuses a host outside the provider allowlist before sending anything (M5 exit)', async () => {
    await expect(marketGet('finnhub', 'https://api.tiingo.com/iex/', {})).rejects.toThrow(
      new EgressDeniedError('finnhub', 'https://api.tiingo.com/iex/'),
    );
    await expect(marketGet('finnhub', 'http://finnhub.io/api/v1/quote', {})).rejects.toThrow(
      'finnhub: egress to http://finnhub.io is not allowed',
    );
    await expect(marketGet('finnhub', 'not a url', {})).rejects.toMatchObject({
      message: 'finnhub: egress to an invalid URL is not allowed',
      provider: 'finnhub',
    });
    expect(requests).toHaveLength(0);
  });

  it('answers a body that is not JSON as undefined', async () => {
    server.use(mock.get(URL_, () => HttpResponse.text('<html>', { status: 502 })));
    expect(await marketGet('finnhub', URL_, {})).toMatchObject({ status: 502, body: undefined });
  });

  it('answers a timeout or a network failure without a status', async () => {
    server.use(
      mock.get(URL_, async () => {
        await delay(200);
        return HttpResponse.json({});
      }),
    );
    expect(await marketGet('finnhub', URL_, {}, { timeoutMs: 20 })).toMatchObject({
      status: null,
      transportError: 'timeout',
    });
    const failing = (() => Promise.reject(new TypeError('fetch failed'))) as unknown as typeof fetch;
    expect(await marketGet('finnhub', URL_, {}, { fetch: failing })).toMatchObject({
      status: null,
      transportError: 'network',
    });
    expect(MARKET_TIMEOUT_MS).toBe(10_000);
  });
});

describe('the API log shape', () => {
  it('logs the path and a summary, never the query string', () => {
    expect(endpointOf('https://eodhd.com/api/real-time/BBCA.JK?api_token=fake-key&fmt=json', 'BBCA.JK')).toBe(
      'GET /api/real-time/BBCA.JK · BBCA.JK',
    );
    expect(endpointOf('https://www.goldapi.io/api/XAU/IDR', '')).toBe('GET /api/XAU/IDR');
    expect(symbolSummary(['A', 'B', 'C'])).toBe('A,B,C');
    expect(symbolSummary(['A', 'B', 'C', 'D', 'E', 'F', 'G'])).toBe('A,B,C,D,E +2');
  });

  it('collects calls and quotes into a result', () => {
    const log = runLog('tiingo');
    log.record('GET /iex', response(200), null);
    log.record('GET /iex', response(429), 'http_429');
    expect(log.result(null)).toEqual({
      quotes: [],
      calls: [
        { provider: 'tiingo', endpoint: 'GET /iex', httpStatus: 200, ok: true, durationMs: 3, errorCode: null },
        { provider: 'tiingo', endpoint: 'GET /iex', httpStatus: 429, ok: false, durationMs: 3, errorCode: 'http_429' },
      ],
      failure: null,
      unverified: false,
      credits: null,
    });
    expect(log.result(null, { unverified: true, credits: 2 })).toMatchObject({ unverified: true, credits: 2 });
  });
});

describe('httpFailure', () => {
  it('maps statuses to the FR-ST4 key states', () => {
    expect(httpFailure(response(200))).toBeNull();
    expect(httpFailure(response(null))).toEqual({
      status: 'error',
      retryAfter: null,
      quotaResetAt: null,
      code: 'timeout',
    });
    expect(httpFailure({ ...response(null), transportError: null })?.code).toBe('network');
    expect(httpFailure(response(401))).toMatchObject({ status: 'invalid_key', code: 'http_401' });
    expect(httpFailure(response(403))).toMatchObject({ status: 'invalid_key', code: 'http_403' });
    expect(httpFailure(response(402))).toMatchObject({ status: 'quota_exhausted', code: 'http_402' });
    expect(httpFailure(response(429, { 'retry-after': '30' }))).toEqual({
      status: 'rate_limited',
      retryAfter: '30',
      quotaResetAt: null,
      code: 'http_429',
    });
    expect(httpFailure(response(503))).toMatchObject({ status: 'error', code: 'http_503' });
    expect(httpFailure(response(302))).toMatchObject({ status: 'error', code: 'http_302' });
  });

  it('knows when daily and monthly quotas reset (UTC)', () => {
    const now = new Date('2026-12-31T23:30:00Z');
    expect(nextUtcDay(now)).toEqual(new Date('2027-01-01T00:00:00Z'));
    expect(nextUtcMonth(now)).toEqual(new Date('2027-01-01T00:00:00Z'));
    expect(nextUtcMonth(new Date('2026-10-15T09:42:00Z'))).toEqual(new Date('2026-11-01T00:00:00Z'));
  });
});

describe('decimalOf', () => {
  it('reads numbers and numeric strings as exact decimals', () => {
    expect(decimalOf(690.1)).toBe('690.1');
    expect(decimalOf('690.1000')).toBe('690.1');
    expect(decimalOf(75442309)).toBe('75442309');
    expect(decimalOf(1.5e-7)).toBe('0.00000015');
    expect(decimalOf('0.1234567890123456789')).toBe('0.123456789012345678');
  });

  it('refuses anything that is not a positive price', () => {
    for (const value of [
      0,
      -1,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      1e25,
      'NA',
      '',
      '-5',
      '1e5',
      null,
      undefined,
      {},
    ]) {
      expect(decimalOf(value)).toBeNull();
    }
    expect(decimalOf('0.0000000000000000001')).toBeNull();
  });
});

describe('prevCloseFromChange', () => {
  it('derives the previous close from a 24-hour change, without float noise', () => {
    expect(prevCloseFromChange('1459802000', 2.5)).toBe('1424197073.17');
    expect(prevCloseFromChange('0.0000125', 25)).toBe('0.00001');
    expect(prevCloseFromChange('10', -100)).toBeNull();
    expect(prevCloseFromChange('10', Number.NaN)).toBeNull();
    expect(prevCloseFromChange('10', '2.5')).toBeNull();
    expect(prevCloseFromChange('10', null)).toBeNull();
  });
});

describe('dateOf and field', () => {
  it('reads epoch seconds, epoch milliseconds, ISO times, and dates', () => {
    expect(dateOf(1792008000)).toEqual(new Date('2026-10-14T20:00:00Z'));
    expect(dateOf(1792008000000)).toEqual(new Date('2026-10-14T20:00:00Z'));
    expect(dateOf('2026-10-14T20:00:00+00:00')).toEqual(new Date('2026-10-14T20:00:00Z'));
    expect(dateOf('2026-10-14')).toEqual(new Date('2026-10-14T00:00:00Z'));
    expect(dateOf(0)).toBeNull();
    expect(dateOf('NA')).toBeNull();
    expect(dateOf(null)).toBeNull();
  });

  it('reads own properties of plain objects only', () => {
    expect(field({ a: 1 }, 'a')).toBe(1);
    expect(field([1], '0')).toBeUndefined();
    expect(field(null, 'a')).toBeUndefined();
    expect(field('text', 'length')).toBeUndefined();
  });
});
