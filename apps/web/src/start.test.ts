// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { requestMiddleware } from './server/request-middleware.ts';
import { csrfMiddleware, startInstance } from './start.ts';

/** Runs the CSRF middleware's server step for a request. */
async function csrf(headers: Record<string, string>, handlerType: 'serverFn' | 'router' = 'serverFn') {
  const server = csrfMiddleware.options.server;
  if (server === undefined) throw new Error('CSRF middleware has no server implementation');
  const request = new Request('https://uang.example/_serverFn/abc', { method: 'POST', headers });
  const result = await server({
    request,
    pathname: '/_serverFn/abc',
    context: {},
    handlerType,
    next: () => ({ request, pathname: '/_serverFn/abc', context: {}, response: new Response('ran') }),
  } as unknown as Parameters<typeof server>[0]);
  return result instanceof Response ? result : result.response;
}

describe('startInstance', () => {
  it('checks CSRF first, then runs the security and preferences middleware on every request', async () => {
    const options = await startInstance.getOptions();
    expect(options.requestMiddleware).toEqual([csrfMiddleware, requestMiddleware]);
  });

  it('refuses cross-site server function calls and lets same-origin ones through', async () => {
    expect((await csrf({ 'sec-fetch-site': 'cross-site' })).status).toBe(403);
    expect((await csrf({ origin: 'https://evil.example' })).status).toBe(403);
    expect(await (await csrf({ 'sec-fetch-site': 'same-origin' })).text()).toBe('ran');
    expect(await (await csrf({ origin: 'https://uang.example' })).text()).toBe('ran');
  });

  it('leaves page and server route requests to their own checks', async () => {
    expect(await (await csrf({ 'sec-fetch-site': 'cross-site' }, 'router')).text()).toBe('ran');
  });
});
