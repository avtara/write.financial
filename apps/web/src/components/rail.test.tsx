// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { renderApp } from '../../test/render.tsx';
import { Rail } from './rail.tsx';

beforeEach(async () => {
  await page.viewport(1024, 768);
});

describe('Rail', () => {
  it('is a 64 px icon rail between 768 and 1279 px', async () => {
    const { screen } = await renderApp(<Rail />);
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
    const { screen } = await renderApp(<Rail />);
    await expect.element(page.getByRole('tooltip')).not.toBeInTheDocument();
    await userEvent.hover(screen.getByRole('link', { name: 'Ringkasan' }));
    await expect.element(page.getByRole('tooltip')).toHaveTextContent('Ringkasan');
  });

  it('names each icon in a tooltip on keyboard focus', async () => {
    const { screen } = await renderApp(<Rail />);
    await userEvent.tab();
    await expect.element(screen.getByRole('link', { name: 'Ringkasan' })).toHaveFocus();
    await expect.element(page.getByRole('tooltip')).toHaveTextContent('Ringkasan');
  });

  it('is hidden on desktop and on phones', async () => {
    for (const width of [1280, 767]) {
      await page.viewport(width, 800);
      const { screen } = await renderApp(<Rail />);
      await expect.element(screen.getByRole('complementary', { includeHidden: true })).not.toBeVisible();
      await screen.unmount();
    }
  });
});
