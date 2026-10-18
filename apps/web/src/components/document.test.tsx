// SPDX-License-Identifier: AGPL-3.0-only
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PREFERENCES } from '../../test/render.tsx';
import type { Preferences } from '../lib/preferences.ts';
import { Document, SYSTEM_THEME_SCRIPT } from './document.tsx';
import { PreferencesProvider } from './preferences.tsx';

/** Server-renders the document the way Start does for a request with these preferences. */
async function renderDocument(preferences: Partial<Preferences>) {
  const root = createRootRoute({
    component: () => (
      <PreferencesProvider initial={{ ...DEFAULT_PREFERENCES, ...preferences }}>
        <Document>
          <p>page</p>
        </Document>
      </PreferencesProvider>
    ),
  });
  const router = createRouter({
    routeTree: root,
    history: createMemoryHistory({ initialEntries: ['/'] }),
    isServer: true,
    ssr: { nonce: 'test-nonce' },
  });
  await router.load();
  return renderToString(<RouterProvider router={router} />);
}

describe('Document', () => {
  it('renders the locale and theme on <html>, so the first paint is right', async () => {
    const html = await renderDocument({ locale: 'en', theme: 'light' });
    expect(html).toMatch(/^<html lang="en" data-theme="light">/);
    expect(html).toContain('<body><p>page</p>');
    expect(html).not.toContain(SYSTEM_THEME_SCRIPT);
  });

  it('leaves the system theme to a nonce-carrying inline script that reads the OS setting', async () => {
    const html = await renderDocument({ theme: 'system' });
    expect(html).toMatch(/^<html lang="id">/);
    expect(html).toContain(`<script nonce="test-nonce">${SYSTEM_THEME_SCRIPT};`);
  });
});
