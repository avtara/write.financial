// SPDX-License-Identifier: AGPL-3.0-only
import { delay, http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as z from 'zod';
import { FX_TIMEOUT_MS, FxProviderError, getJson, toRate } from './provider.ts';

const URL_ = 'https://api.frankfurter.dev/v2/rates';
const schema = z.object({ rate: z.number() });
const base = { provider: 'frankfurter', schema } as const;

const requests: Request[] = [];
const server = setupServer(
  http.get(URL_, ({ request }) => {
    requests.push(request);
    return HttpResponse.json({ rate: 1.5 });
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

describe('getJson', () => {
  it('returns the validated body and identifies itself, asking for JSON', async () => {
    expect(await getJson(URL_, base)).toEqual({ rate: 1.5 });
    expect(requests[0]?.headers.get('accept')).toBe('application/json');
    expect(requests[0]?.headers.get('user-agent')).toBe('write.financial');
  });

  it('refuses redirects, which could leave the allowlist', async () => {
    const spy = vi.fn(fetch);
    await getJson(URL_, { ...base, fetch: spy });
    expect(spy).toHaveBeenCalledWith(new URL(URL_), expect.objectContaining({ redirect: 'error' }));
  });

  it('refuses hosts outside the allowlist and plain HTTP before sending anything', async () => {
    await expect(getJson('https://evil.example/v1/latest', base)).rejects.toThrow(
      new FxProviderError('frankfurter', 'egress to https://evil.example is not allowed'),
    );
    await expect(getJson('http://api.frankfurter.dev/v2/rates', base)).rejects.toThrow(
      'frankfurter: egress to http://api.frankfurter.dev is not allowed',
    );
    // Another source's host is outside this one's allowlist.
    await expect(getJson('https://open.er-api.com/v6/latest/USD', base)).rejects.toThrow(
      'frankfurter: egress to https://open.er-api.com is not allowed',
    );
    expect(requests).toHaveLength(0);
  });

  it('answers undefined for a "not covered" status and rejects other errors', async () => {
    server.use(http.get(URL_, () => HttpResponse.json({ status: 422 }, { status: 422 })));
    expect(await getJson(URL_, { ...base, notFound: [422] })).toBeUndefined();
    await expect(getJson(URL_, base)).rejects.toThrow('frankfurter: HTTP 422');
  });

  it('rejects a body that is not JSON or does not match the schema', async () => {
    server.use(http.get(URL_, () => HttpResponse.text('<html>')));
    const notJson = await getJson(URL_, base).catch((error: unknown) => error);
    expect(notJson).toBeInstanceOf(FxProviderError);
    expect(notJson).toMatchObject({ message: 'frankfurter: response is not JSON', provider: 'frankfurter' });
    expect((notJson as Error).cause).toBeInstanceOf(SyntaxError);

    server.use(http.get(URL_, () => HttpResponse.json({ rate: 'x' })));
    await expect(getJson(URL_, base)).rejects.toThrow(/^frankfurter: unexpected response: rate: /);
    server.use(http.get(URL_, () => HttpResponse.json(null)));
    await expect(getJson(URL_, base)).rejects.toThrow(/^frankfurter: unexpected response: \(body\): /);
  });

  it('times out', async () => {
    server.use(
      http.get(URL_, async () => {
        await delay(200);
        return HttpResponse.json({ rate: 1 });
      }),
    );
    const error = await getJson(URL_, { ...base, timeoutMs: 20 }).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ message: 'frankfurter: request failed', cause: { name: 'TimeoutError' } });
    expect(FX_TIMEOUT_MS).toBe(10_000);
  });

  it('wraps network failures of an injected fetch', async () => {
    const offline = new TypeError('fetch failed');
    const failing = (() => Promise.reject(offline)) as unknown as typeof fetch;
    await expect(getJson(URL_, { ...base, fetch: failing })).rejects.toMatchObject({ cause: offline });
  });

  it('reports every request it sent, with the path only, for the API log', async () => {
    const calls: unknown[] = [];
    const onCall = (call: unknown) => calls.push(call);
    await getJson(`${URL_}?base=USD`, { ...base, onCall });
    server.use(http.get(URL_, () => HttpResponse.json({}, { status: 404 })));
    await getJson(URL_, { ...base, onCall, notFound: [404] });
    server.use(http.get(URL_, () => HttpResponse.json({}, { status: 503 })));
    await getJson(URL_, { ...base, onCall }).catch(() => undefined);
    server.use(http.get(URL_, () => HttpResponse.text('<html>')));
    await getJson(URL_, { ...base, onCall }).catch(() => undefined);
    server.use(http.get(URL_, () => HttpResponse.json({ rate: 'x' })));
    await getJson(URL_, { ...base, onCall }).catch(() => undefined);
    const failing = (() => Promise.reject(new TypeError('fetch failed'))) as unknown as typeof fetch;
    await getJson(URL_, { ...base, onCall, fetch: failing }).catch(() => undefined);
    const call = (httpStatus: number | null, errorCode: string | null) => ({
      provider: 'frankfurter',
      endpoint: 'GET /v2/rates',
      httpStatus,
      ok: errorCode === null,
      durationMs: expect.any(Number) as number,
      errorCode,
    });
    expect(calls).toEqual([
      call(200, null),
      call(404, null),
      call(503, 'http_503'),
      call(200, 'not_json'),
      call(200, 'unexpected_body'),
      call(null, 'network'),
    ]);
  });
});

describe('toRate', () => {
  it('formats a usable rate with 8 fraction digits', () => {
    expect(toRate(17948)).toBe('17948.00000000');
    expect(toRate(1 / 0.000055555)).toBe('18000.18000180');
    expect(toRate(0.695)).toBe('0.69500000');
  });

  it('rejects rates that are not finite, round to zero, are negative, or overflow numeric(20,8)', () => {
    expect(toRate(Number.POSITIVE_INFINITY)).toBeUndefined();
    expect(toRate(Number.NaN)).toBeUndefined();
    expect(toRate(0.000000001)).toBeUndefined();
    expect(toRate(-1)).toBeUndefined();
    expect(toRate(1e12)).toBeUndefined();
    expect(toRate(999_999_999_999)).toBe('999999999999.00000000');
  });
});
