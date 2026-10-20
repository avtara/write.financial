// SPDX-License-Identifier: AGPL-3.0-only
import { getLocale } from '@wf/i18n/runtime';
import { beforeAll, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { exampleEnv } from '../../test/env.ts';
import { fakeSession, SETTINGS } from '../../test/fixtures.ts';
import { requestMiddleware, type RequestContext } from './request-middleware.ts';
import { services } from './runtime.ts';
import type * as RuntimeModule from './runtime.ts';

interface Fake {
  defaultLocale: 'id' | 'en';
  session: unknown;
  getSession: Mock<() => Promise<unknown>>;
}

const fake = vi.hoisted((): Fake => ({
  defaultLocale: 'id',
  session: null,
  // Replaced by the runtime mock below.
  getSession: vi.fn(),
}));

vi.mock('./runtime.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof RuntimeModule>();
  fake.getSession = vi.fn(() => Promise.resolve(fake.session));
  const services = vi.fn(() =>
    Promise.resolve({
      instance: { get: () => Promise.resolve({ ...SETTINGS, defaultLocale: fake.defaultLocale }) },
      auth: { getSession: fake.getSession },
    }),
  );
  return { ...actual, services };
});

beforeAll(() => {
  // Read once, on the first request.
  for (const [key, value] of Object.entries(exampleEnv({ PUBLIC_URL: 'http://localhost:3000', LOG_LEVEL: 'silent' }))) {
    vi.stubEnv(key, value);
  }
});

beforeEach(() => {
  fake.defaultLocale = 'id';
  fake.session = null;
  vi.mocked(services).mockClear();
  fake.getSession.mockClear();
});

interface Seen {
  context: RequestContext;
  locale: string;
}

interface RunOptions {
  path?: string;
  method?: string;
  handlerType?: 'router' | 'serverFn';
  /** What the handler does with its context before answering. */
  handle?: (context: RequestContext) => void;
}

/** Runs the middleware around a handler that answers `response`, recording what the handler saw. */
async function run(headers: Record<string, string>, response: Response, options: RunOptions = {}) {
  const { path = '/', method = 'GET', handlerType = 'router', handle } = options;
  const request = new Request(`http://localhost:3000${path}`, { headers, method });
  const seen: Seen[] = [];
  const server = requestMiddleware.options.server;
  if (server === undefined) throw new Error('request middleware has no server implementation');
  const result = await server({
    request,
    pathname: path,
    context: {},
    handlerType,
    next: (next?: { context?: unknown }) => {
      const context = next?.context as RequestContext;
      seen.push({ context, locale: getLocale() });
      handle?.(context);
      return { request, pathname: path, context, response };
    },
  } as unknown as Parameters<typeof server>[0]);
  if (result instanceof Response) throw new Error('middleware must pass the handler result through');
  return { response: result.response, seen: seen[0] };
}

const html = () => new Response('<!doctype html>', { status: 200, headers: { 'content-type': 'text/html' } });
const SESSION_COOKIE = 'wf.session_token=abc';

describe('request context', () => {
  it('passes the request headers through and adds the cookies a handler sets', async () => {
    const { response, seen } = await run({ cookie: 'wf_locale=id', 'x-probe': '1' }, Response.json({}), {
      handlerType: 'serverFn',
      handle: (context) => {
        context.setCookie('wf_setup=abc; Path=/; HttpOnly');
        context.setCookie('other=1');
      },
    });
    expect(seen?.context.headers.get('x-probe')).toBe('1');
    expect(response.headers.getSetCookie()).toEqual(['wf_setup=abc; Path=/; HttpOnly', 'other=1']);
  });
});
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

  it('falls back to the instance default language from instance_settings', async () => {
    fake.defaultLocale = 'en';
    expect((await run({}, html())).seen?.context.preferences.locale).toBe('en');
  });

  it('answers the liveness probe without touching the services', async () => {
    const { seen } = await run({}, Response.json({ status: 'ok' }), { path: '/healthz' });
    expect(seen?.context.preferences.locale).toBe('id');
    expect(services).not.toHaveBeenCalled();
  });

  it('puts a signed-in user’s saved language first on pages', async () => {
    fake.session = fakeSession({ locale: 'en' });
    const { seen, response } = await run({ cookie: `${SESSION_COOKIE}; wf_locale=id` }, html());
    expect(seen?.context.preferences.locale).toBe('en');
    expect(response.headers.get('set-cookie')).toContain('wf_locale=en');
    // The page's guards reuse the same lookup.
    expect(await seen?.context.session()).toBe(fake.session);
    expect(fake.getSession).toHaveBeenCalledTimes(1);
  });

  it('ignores an unusable saved language and skips the lookup where no text is rendered', async () => {
    fake.session = fakeSession({ locale: 'fr' });
    expect((await run({ cookie: SESSION_COOKIE }, html())).seen?.context.preferences.locale).toBe('id');
    fake.session = null;
    expect((await run({ cookie: SESSION_COOKIE }, html())).seen?.context.preferences.locale).toBe('id');
    fake.getSession.mockClear();
    await run({ cookie: SESSION_COOKIE }, html(), { handlerType: 'serverFn' });
    await run({ cookie: SESSION_COOKIE }, html(), { method: 'POST' });
    await run({}, html());
    expect(fake.getSession).not.toHaveBeenCalled();
  });

  it('looks the session up lazily, once, for server functions', async () => {
    fake.session = fakeSession();
    const { seen } = await run({ cookie: SESSION_COOKIE }, Response.json({}), { handlerType: 'serverFn' });
    expect(fake.getSession).not.toHaveBeenCalled();
    await seen?.context.session();
    await seen?.context.session();
    expect(fake.getSession).toHaveBeenCalledTimes(1);
  });

  it('adds the security headers with the same nonce the handler received', async () => {
    const { response, seen } = await run({}, html());
    expect(response.headers.get('content-security-policy')).toContain(
      `script-src 'nonce-${seen?.context.nonce ?? ''}' 'strict-dynamic'`,
    );
    expect(response.headers.get('content-security-policy')).toContain("base-uri 'none'");
    expect(response.headers.get('x-frame-options')).toBe('DENY');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.has('strict-transport-security')).toBe(false);
  });

  it('applies the Bull Board CSP exceptions on its path only', async () => {
    for (const path of ['/admin/queues', '/admin/queues/api/queues']) {
      const { response } = await run({}, html(), { path });
      expect(response.headers.get('content-security-policy')).toContain("base-uri 'self'");
    }
    // The style exception is covered in security.test.ts (under Vitest, `import.meta.env.DEV` allows inline styles).
    const { response } = await run({}, html(), { path: '/admin/queuesx' });
    expect(response.headers.get('content-security-policy')).toContain("base-uri 'none'");
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

  it("keeps a handler's caching and enforces its policy next to the app's", async () => {
    const { response } = await run(
      {},
      new Response('x', {
        headers: { 'Cache-Control': 'private, max-age=31536000, immutable', 'Content-Security-Policy': 'sandbox' },
      }),
    );
    expect(response.headers.get('cache-control')).toBe('private, max-age=31536000, immutable');
    expect(response.headers.get('content-security-policy')).toMatch(/^sandbox, default-src 'self'; /);
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
