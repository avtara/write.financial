// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { renderApp } from '../../test/render.tsx';
import { AppShell } from './app-shell.tsx';
import { CommandPaletteProvider } from './command-palette/command-palette.tsx';

const shell = (
  <CommandPaletteProvider>
    <AppShell>
      <p>page content</p>
    </AppShell>
  </CommandPaletteProvider>
);

describe('AppShell', () => {
  it('lays out sidebar and main content on desktop', async () => {
    await page.viewport(1440, 900);
    const { screen } = await renderApp(shell);
    await expect.element(screen.getByRole('main')).toHaveTextContent('page content');
    await expect.element(screen.getByRole('navigation', { name: 'Navigasi utama' })).toBeVisible();
    await expect
      .element(screen.getByRole('heading', { name: 'Gunakan tablet atau desktop', includeHidden: true }))
      .not.toBeVisible();
  });

  it('replaces the app with the unsupported-screen page on phones', async () => {
    await page.viewport(600, 900);
    const { screen } = await renderApp(shell);
    await expect.element(screen.getByRole('heading', { name: 'Gunakan tablet atau desktop' })).toBeVisible();
    await expect.element(screen.getByRole('main', { includeHidden: true })).not.toBeVisible();
  });

  it('offers a skip link to the main content as the first tab stop', async () => {
    await page.viewport(1440, 900);
    const { screen } = await renderApp(shell);
    await userEvent.tab();
    const skip = screen.getByRole('link', { name: 'Lewati ke konten' });
    await expect.element(skip).toHaveFocus();
    await expect.element(skip).toHaveAttribute('href', '#main');
    await expect.element(skip).toBeVisible();
  });

  it('navigates with the G-letter shortcuts', async () => {
    await page.viewport(1440, 900);
    const { router } = await renderApp(shell, { path: '/other' });
    // Freeze the sequence clock (`performance.now()`) so slow key delivery cannot break `G R` apart.
    vi.useFakeTimers({ toFake: ['performance'] });
    try {
      await userEvent.keyboard('gr');
    } finally {
      vi.useRealTimers();
    }
    await expect.poll(() => router.state.location.pathname).toBe('/');
  });
});
