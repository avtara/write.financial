// SPDX-License-Identifier: AGPL-3.0-only
import { createMemoryHistory, createRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { Preferences } from '../lib/preferences.ts';

const preferences: Preferences = { locale: 'en', theme: 'light', balancesHidden: true, platform: 'other' };
vi.mock('../server/get-preferences.ts', () => ({ getPreferences: vi.fn(() => Promise.resolve(preferences)) }));

const { Route } = await import('./__root.tsx');

describe('root route', () => {
  it('loads the request preferences once per document', async () => {
    const loader = Route.options.loader;
    if (typeof loader !== 'function') throw new Error('root loader missing');
    expect(await loader({} as never)).toEqual(preferences);
    expect(Route.options.staleTime).toBe(Infinity);
    expect(Route.options.shouldReload).toBe(false);
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
});
