// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { renderApp } from '../../test/render.tsx';
import { CommandPaletteProvider } from './command-palette/command-palette.tsx';
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
});
