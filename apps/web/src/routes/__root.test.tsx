// SPDX-License-Identifier: AGPL-3.0-only
import { createMemoryHistory, createRoute, createRouter, isRedirect, RouterProvider } from '@tanstack/react-router';
import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { usePreferences } from '../components/preferences.tsx';
import type { Preferences } from '../lib/preferences.ts';
import type { Gate } from '../server/gate.ts';
// `vi.mock` calls are hoisted above these imports.
import { saveLocale } from '../server/fn/account.ts';
import { getGate } from '../server/fn/gate.ts';
import { Route } from './__root.tsx';

const preferences: Preferences = { locale: 'en', theme: 'light', balancesHidden: true, platform: 'other' };
const VIEWER = {
  id: 'u1',
  sessionId: 's1',
  name: 'Sari',
  email: 'sari@example.test',
  image: null,
  locale: 'en',
  timezone: 'Asia/Jakarta',
  role: 'user',
  twoFactorEnabled: true,
} as const;
const gate = (overrides: Partial<Gate> = {}): Gate => ({
  setup: 'complete',
  viewer: null,
  instanceName: 'Keuangan Keluarga',
  registrationMode: 'closed',
  googleEnabled: false,
  ...overrides,
});

vi.mock('../server/get-preferences.ts', () => ({ getPreferences: vi.fn(() => Promise.resolve(preferences)) }));
vi.mock('../server/fn/gate.ts', () => ({ getGate: vi.fn() }));
vi.mock('../server/fn/account.ts', () => ({ saveLocale: vi.fn(() => Promise.resolve({ ok: true, value: null })) }));

beforeEach(() => {
  vi.mocked(getGate).mockResolvedValue(gate());
  vi.mocked(saveLocale).mockClear();
});

async function beforeLoad(pathname: string) {
  const hook = Route.options.beforeLoad;
  if (typeof hook !== 'function') throw new Error('root beforeLoad missing');
  return hook({ location: { pathname } } as never);
}

describe('root route', () => {
  it('loads the request preferences once per document', async () => {
    const loader = Route.options.loader;
    if (typeof loader !== 'function') throw new Error('root loader missing');
    expect(await loader({} as never)).toEqual(preferences);
    expect(Route.options.staleTime).toBe(Infinity);
    expect(Route.options.shouldReload).toBe(false);
  });

  it('gives every route the gate, and sends everyone to the setup wizard until an admin exists', async () => {
    expect(await beforeLoad('/')).toEqual({ gate: gate() });
    vi.mocked(getGate).mockResolvedValue(gate({ setup: 'pending' }));
    const redirect = await beforeLoad('/sign-in').catch((error: unknown) => error);
    expect(isRedirect(redirect)).toBe(true);
    expect(redirect).toMatchObject({ options: { to: '/setup' } });
    expect(await beforeLoad('/setup')).toEqual({ gate: gate({ setup: 'pending' }) });
  });

  it('declares charset, viewport, title, stylesheet, and icon', async () => {
    const head = await Route.options.head?.({} as never);
    expect(head?.meta).toEqual([
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'write.financial' },
    ]);
    expect(head?.links).toEqual([
      { rel: 'stylesheet', href: expect.stringMatching(/styles\.css/) as unknown },
      { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' },
    ]);
  });

  it('renders the document with the loaded preferences around the page', async () => {
    const page = createRoute({ getParentRoute: () => Route, path: '/', component: () => <p>page</p> });
    const router = createRouter({
      routeTree: Route.addChildren([page]),
      history: createMemoryHistory({ initialEntries: ['/'] }),
      isServer: true,
    });
    await router.load();
    const html = renderToString(<RouterProvider router={router} />);
    expect(html).toMatch(/^<html lang="en" data-theme="light">/);
    expect(html).toContain('<title>write.financial</title>');
    expect(html).toContain('<p>page</p>');
  });

  it('renders the not-found page for unknown paths', async () => {
    const router = createRouter({
      routeTree: Route.addChildren([]),
      history: createMemoryHistory({ initialEntries: ['/nowhere'] }),
      isServer: true,
    });
    await router.load();
    const html = renderToString(<RouterProvider router={router} />);
    expect(html).toContain('404');
    expect(html).toMatch(/Halaman tidak ditemukan|Page not found/);
  });

  it('saves a signed-in user’s language switch to the account, and only then', async () => {
    function Switch() {
      const { setLocale } = usePreferences();
      return (
        <button
          type="button"
          onClick={() => {
            setLocale('id');
          }}
        >
          switch
        </button>
      );
    }
    for (const viewer of [null, VIEWER]) {
      vi.mocked(getGate).mockResolvedValue(gate({ viewer }));
      const page = createRoute({ getParentRoute: () => Route, path: '/', component: Switch });
      const router = createRouter({
        routeTree: Route.addChildren([page]),
        history: createMemoryHistory({ initialEntries: ['/'] }),
      });
      await router.load();
      const screen = await render(<RouterProvider router={router} />);
      await screen.getByRole('button', { name: 'switch' }).click();
      await screen.unmount();
    }
    expect(saveLocale).toHaveBeenCalledTimes(1);
    expect(saveLocale).toHaveBeenCalledWith({ data: { locale: 'id' } });
  });
});
