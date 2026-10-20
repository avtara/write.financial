// SPDX-License-Identifier: AGPL-3.0-only
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { setLocale } from '@wf/i18n/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';
import { DEFAULT_PREFERENCES, renderApp } from '../../test/render.tsx';
import { CommandPaletteProvider } from './command-palette/command-palette.tsx';
import type { NavCounts } from './nav.ts';
import { PreferencesProvider } from './preferences.tsx';
import { ShortcutProvider } from './shortcuts.tsx';
import { Sidebar } from './sidebar.tsx';

vi.mock('../server/fn/search.ts', () => ({
  listRecent: () => Promise.resolve({ ok: true, value: [] }),
  searchEverything: vi.fn(),
  touchRecent: vi.fn(),
}));

const sidebar = (
  <CommandPaletteProvider>
    <Sidebar />
  </CommandPaletteProvider>
);

/** The sidebar inside an `_app` layout whose loader gives `navCounts` (no loader at all when `undefined`). */
async function renderInApp(navCounts: NavCounts | null | undefined) {
  await setLocale('id', { reload: false });
  const root = createRootRoute({
    component: () => (
      <PreferencesProvider initial={DEFAULT_PREFERENCES}>
        <ShortcutProvider platform={DEFAULT_PREFERENCES.platform}>
          <Outlet />
        </ShortcutProvider>
      </PreferencesProvider>
    ),
  });
  const app = createRoute({
    getParentRoute: () => root,
    id: '_app',
    ...(navCounts === undefined ? {} : { loader: () => ({ navCounts }) }),
    component: () => sidebar,
  });
  const routeTree = root.addChildren([app.addChildren([createRoute({ getParentRoute: () => app, path: '/' })])]);
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: ['/'] }) });
  await router.load();
  return render(<RouterProvider router={router} />);
}

beforeEach(async () => {
  await page.viewport(1440, 900);
});

describe('Sidebar', () => {
  it('shows the wordmark, the navigation, and the user menu from 1280 px', async () => {
    const { screen } = await renderApp(sidebar);
    const aside = screen.getByRole('complementary');
    await expect.element(aside).toBeVisible();
    expect(aside.element().getBoundingClientRect().width).toBe(248);
    expect(aside.element().textContent).toMatch(/^write\.financial/);
    const nav = screen.getByRole('navigation', { name: 'Navigasi utama' });
    await expect.element(nav.getByRole('heading', { name: 'Menu' })).toBeVisible();
    await expect.element(nav.getByRole('link', { name: 'Ringkasan' })).toHaveAttribute('href', '/');
    await expect.element(screen.getByRole('button', { name: 'Menu pengguna' })).toBeVisible();
  });

  it('highlights the current page only', async () => {
    const { screen } = await renderApp(sidebar, { path: '/other' });
    const link = screen.getByRole('link', { name: 'Ringkasan' });
    await expect.element(link).not.toHaveAttribute('data-status');
    await userEvent.click(link);
    await expect.element(link).toHaveAttribute('data-status', 'active');
    await expect.element(link).toHaveAttribute('aria-current', 'page');
  });

  it('keeps the current page highlighted whatever its search params', async () => {
    const { screen } = await renderApp(sidebar, { path: '/?period=2026-10' });
    await expect.element(screen.getByRole('link', { name: 'Ringkasan' })).toHaveAttribute('data-status', 'active');
  });

  it('gives way to the rail below 1280 px', async () => {
    await page.viewport(1279, 900);
    const { screen } = await renderApp(sidebar);
    await expect.element(screen.getByRole('complementary', { includeHidden: true })).not.toBeVisible();
  });

  it('opens the command palette from its search field', async () => {
    const { screen } = await renderApp(sidebar, { preferences: { platform: 'other' } });
    const search = screen.getByRole('button', { name: 'Cari… Ctrl K' });
    await expect.element(search).toHaveAttribute('aria-keyshortcuts', 'Control+K');
    await userEvent.click(search);
    await expect.element(page.getByRole('dialog', { name: 'Cari atau jalankan perintah' })).toBeVisible();
  });

  it('shows the transaction count of the current period from the `_app` loader', async () => {
    const screen = await renderInApp({ transactions: 128 });
    const link = screen.getByRole('link', { name: /Transaksi/ });
    await expect.element(link).toHaveAttribute('href', '/transactions');
    await expect.element(link).toHaveTextContent('Transaksi128');
    await expect.element(screen.getByRole('link', { name: 'Ringkasan' })).toHaveTextContent('Ringkasan');
  });

  it('shows no count when it could not be loaded, or outside `_app`', async () => {
    for (const navCounts of [null, undefined]) {
      const screen = await renderInApp(navCounts);
      await expect.element(screen.getByRole('link', { name: /Transaksi/ })).toHaveTextContent('Transaksi');
      await screen.unmount();
    }
    const { screen } = await renderApp(sidebar);
    await expect.element(screen.getByRole('link', { name: /Transaksi/ })).toHaveTextContent('Transaksi');
  });
});
