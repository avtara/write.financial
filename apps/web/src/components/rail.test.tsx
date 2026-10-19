// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { renderApp } from '../../test/render.tsx';
import { CommandPaletteProvider } from './command-palette/command-palette.tsx';
import { Rail } from './rail.tsx';

vi.mock('../server/fn/search.ts', () => ({
  listRecent: () => Promise.resolve({ ok: true, value: [] }),
  searchEverything: vi.fn(),
  touchRecent: vi.fn(),
}));

const rail = (
  <CommandPaletteProvider>
    <Rail />
  </CommandPaletteProvider>
);

beforeEach(async () => {
  await page.viewport(1024, 768);
});

describe('Rail', () => {
  it('is a 64 px icon rail between 768 and 1279 px', async () => {
    const { screen } = await renderApp(rail);
    const aside = screen.getByRole('complementary');
    await expect.element(aside).toBeVisible();
    expect(aside.element().getBoundingClientRect().width).toBe(64);
    const link = screen.getByRole('link', { name: 'Ringkasan' });
    await expect.element(link).toHaveTextContent('');
    await expect.element(link).toHaveAttribute('data-status', 'active');
    expect(link.element().getBoundingClientRect().height).toBe(40);
    await expect.element(screen.getByRole('button', { name: 'Menu pengguna' })).toBeVisible();
  });

  it('names each icon in a tooltip on hover', async () => {
    const { screen } = await renderApp(rail);
    await expect.element(page.getByRole('tooltip')).not.toBeInTheDocument();
    await userEvent.hover(screen.getByRole('link', { name: 'Ringkasan' }));
    await expect.element(page.getByRole('tooltip')).toHaveTextContent('Ringkasan');
  });

  it('names each icon in a tooltip on keyboard focus', async () => {
    const { screen } = await renderApp(rail);
    await userEvent.tab();
    await expect.element(screen.getByRole('button', { name: 'Cari' })).toHaveFocus();
    await userEvent.tab();
    await expect.element(screen.getByRole('link', { name: 'Ringkasan' })).toHaveFocus();
    await expect.element(page.getByRole('tooltip')).toHaveTextContent('Ringkasan');
  });

  it('is hidden on desktop and on phones', async () => {
    for (const width of [1280, 767]) {
      await page.viewport(width, 800);
      const { screen } = await renderApp(rail);
      await expect.element(screen.getByRole('complementary', { includeHidden: true })).not.toBeVisible();
      await screen.unmount();
    }
  });

  it('opens the command palette from its search button', async () => {
    const { screen } = await renderApp(rail);
    const search = screen.getByRole('button', { name: 'Cari' });
    await expect.element(search).toHaveAttribute('aria-keyshortcuts', 'Meta+K');
    expect(search.element().getBoundingClientRect().height).toBe(40);
    await userEvent.hover(search);
    await expect.element(page.getByRole('tooltip')).toHaveTextContent('Cari⌘K');
    await userEvent.click(search);
    await expect.element(page.getByRole('dialog', { name: 'Cari atau jalankan perintah' })).toBeVisible();
  });

  it('names the Ctrl+K shortcut on other platforms', async () => {
    const { screen } = await renderApp(rail, { preferences: { platform: 'other' } });
    await expect
      .element(screen.getByRole('button', { name: 'Cari' }))
      .toHaveAttribute('aria-keyshortcuts', 'Control+K');
  });
});
