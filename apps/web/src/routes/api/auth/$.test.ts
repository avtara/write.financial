// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import { Route } from './$.ts';

const handler = vi.hoisted(() => vi.fn((request: Request) => Promise.resolve(new Response(request.method))));

vi.mock('../../../server/runtime.ts', () => ({
  services: () => Promise.resolve({ auth: { basePath: '/api/auth', handler, requireFreshSession: vi.fn() } }),
}));

describe('/api/auth/$', () => {
  it('hands GET and POST to Better Auth', async () => {
    const handlers = Route.options.server?.handlers;
    if (typeof handlers !== 'object' || typeof handlers.GET !== 'function' || typeof handlers.POST !== 'function') {
      throw new Error('GET/POST handlers missing');
    }
    const get = new Request('https://uang.example/api/auth/get-session');
    expect(await ((await handlers.GET({ request: get } as never)) as Response).text()).toBe('GET');
    const post = new Request('https://uang.example/api/auth/sign-in/email', { method: 'POST' });
    expect(await ((await handlers.POST({ request: post } as never)) as Response).text()).toBe('POST');
    expect(handler).toHaveBeenCalledTimes(2);
  });
});
