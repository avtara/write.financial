// SPDX-License-Identifier: AGPL-3.0-only
import { getLocale } from '@wf/i18n/runtime';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { exampleEnv } from '../../test/env.ts';
import { requestMiddleware, type RequestContext } from './request-middleware.ts';

beforeAll(() => {
  // Read once, on the first request.
  for (const [key, value] of Object.entries(exampleEnv({ PUBLIC_URL: 'http://localhost:3000', LOG_LEVEL: 'silent' }))) {
    vi.stubEnv(key, value);
  }
});

interface Seen {
  context: RequestContext;
  locale: string;
}

/** Runs the middleware around a handler that answers `response`, recording what the handler saw. */
async function run(headers: Record<string, string>, response: Response) {
  const request = new Request('http://localhost:3000/', { headers });
  const seen: Seen[] = [];
  const server = requestMiddleware.options.server;
  if (server === undefined) throw new Error('request middleware has no server implementation');
  const result = await server({
    request,
    pathname: '/',
    context: {},
    handlerType: 'router',
    next: (options?: { context?: unknown }) => {
      const context = options?.context as RequestContext;
      seen.push({ context, locale: getLocale() });
      return { request, pathname: '/', context, response };
    },
  } as unknown as Parameters<typeof server>[0]);
  if (result instanceof Response) throw new Error('middleware must pass the handler result through');
  return { response: result.response, seen: seen[0] };
}

const html = () => new Response('<!doctype html>', { status: 200, headers: { 'content-type': 'text/html' } });

describe('requestMiddleware', () => {
  it('hands the handler a fresh nonce and the resolved preferences, and renders in that locale', async () => {
    const first = await run({ 'accept-language': 'en' }, html());
    const second = await run({ 'accept-language': 'en' }, html());
    expect(first.seen?.context.preferences).toEqual({
      locale: 'en',
      theme: 'dark',
      balancesHidden: false,
      platform: 'other',
    });
    expect(first.seen?.locale).toBe('en');
    expect(first.seen?.context.nonce).not.toBe(second.seen?.context.nonce);
  });

  it('adds the security headers with the same nonce the handler received', async () => {
    const { response, seen } = await run({}, html());
    expect(response.headers.get('content-security-policy')).toContain(
      `script-src 'nonce-${seen?.context.nonce ?? ''}' 'strict-dynamic'`,
    );
    expect(response.headers.get('x-frame-options')).toBe('DENY');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.has('strict-transport-security')).toBe(false);
  });

  it('keeps status, body, and the handler headers', async () => {
    const { response } = await run(
      {},
      new Response('{"status":"ok"}', { status: 201, statusText: 'Created', headers: { 'x-handler': 'kept' } }),
    );
    expect(response.status).toBe(201);
    expect(response.statusText).toBe('Created');
    expect(response.headers.get('x-handler')).toBe('kept');
    expect(await response.text()).toBe('{"status":"ok"}');
  });

  it('sets the locale cookie on pages whose request cookie disagrees with the rendered locale', async () => {
    const { response } = await run({ 'accept-language': 'en' }, html());
    expect(response.headers.get('set-cookie')).toBe('wf_locale=en; Path=/; Max-Age=34560000; SameSite=Lax');
  });

  it('leaves the locale cookie alone when it already matches, and on non-HTML responses', async () => {
    expect((await run({ cookie: 'wf_locale=en' }, html())).response.headers.has('set-cookie')).toBe(false);
    expect((await run({}, Response.json({ status: 'ok' }))).response.headers.has('set-cookie')).toBe(false);
    expect((await run({}, new Response(null))).response.headers.has('set-cookie')).toBe(false);
  });
});
