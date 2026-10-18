// SPDX-License-Identifier: AGPL-3.0-only
import { createHash } from 'node:crypto';
import { delay, http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createBreachedPasswordCheck, HIBP_RANGE_URL } from './breached.ts';

const BREACHED = ['pass', 'word', '123'].join('');
const SAFE = ['tidak', 'pernah', 'bocor', 'xq9'].join('-');
const sha1 = (text: string) => createHash('sha1').update(text).digest('hex').toUpperCase();

const requests: { prefix: string; headers: Headers }[] = [];
const server = setupServer(
  http.get(`${HIBP_RANGE_URL}:prefix`, ({ params, request }) => {
    const prefix = String(params['prefix']);
    requests.push({ prefix, headers: request.headers });
    const hit = sha1(BREACHED);
    const lines = [
      // Padding entries have a count of 0 and must not count as breaches.
      `${sha1(SAFE).slice(5)}:0`,
      '0000000000000000000000000000000000A:12',
      ...(prefix === hit.slice(0, 5) ? [`${hit.slice(5).toLowerCase()}:9545824`] : []),
    ];
    return HttpResponse.text(lines.join('\r\n'));
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

const logger = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() });

describe('createBreachedPasswordCheck', () => {
  it('flags a breached password and sends only the 5-character hash prefix, asking for padding', async () => {
    const log = logger();
    const isBreached = createBreachedPasswordCheck({ logger: log });
    expect(await isBreached(BREACHED)).toBe(true);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.prefix).toBe(sha1(BREACHED).slice(0, 5));
    expect(requests[0]?.headers.get('add-padding')).toBe('true');
    expect(requests[0]?.headers.get('user-agent')).toBe('write.financial');
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('passes a password that is absent or only present as padding', async () => {
    const isBreached = createBreachedPasswordCheck({ logger: logger() });
    expect(await isBreached(SAFE)).toBe(false);
    expect(await isBreached('belum-pernah-terlihat-sama-sekali')).toBe(false);
  });

  it('fails open with a warning when the API answers with an error', async () => {
    server.use(http.get(`${HIBP_RANGE_URL}:prefix`, () => new HttpResponse(null, { status: 503 })));
    const log = logger();
    expect(await createBreachedPasswordCheck({ logger: log })(BREACHED)).toBe(false);
    expect(log.warn).toHaveBeenCalledWith({ status: 503 }, 'Breached-password check unavailable; password accepted');
  });

  it('fails open with a warning when the API is too slow', async () => {
    server.use(
      http.get(`${HIBP_RANGE_URL}:prefix`, async () => {
        await delay(200);
        return HttpResponse.text('');
      }),
    );
    const log = logger();
    expect(await createBreachedPasswordCheck({ logger: log, timeoutMs: 20 })(BREACHED)).toBe(false);
    expect(log.warn).toHaveBeenCalledWith(
      { err: expect.objectContaining({ name: 'TimeoutError' }) as unknown },
      'Breached-password check failed; password accepted',
    );
  });

  it('fails open when the network fails', async () => {
    const log = logger();
    const offline = new TypeError('fetch failed');
    const failing = (() => Promise.reject(offline)) as unknown as typeof fetch;
    expect(await createBreachedPasswordCheck({ logger: log, fetch: failing })(BREACHED)).toBe(false);
    expect(log.warn).toHaveBeenCalledWith({ err: offline }, 'Breached-password check failed; password accepted');
  });
});
