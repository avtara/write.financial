// SPDX-License-Identifier: AGPL-3.0-only
import { delay, http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as z from 'zod';
import { FX_TIMEOUT_MS, FxProviderError, getJson, toRate } from './provider.ts';

const URL_ = 'https://rates.example/v1/latest';
const schema = z.object({ rate: z.number() });
const base = { provider: 'frankfurter', hosts: ['rates.example'], schema } as const;

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
    await expect(getJson('http://rates.example/v1/latest', base)).rejects.toThrow(
      'frankfurter: egress to http://rates.example is not allowed',
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
