// SPDX-License-Identifier: AGPL-3.0-only
import type { ComponentType } from 'react';
import { describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { renderApp } from '../../test/render.tsx';
import { Route } from './_app.tsx';

describe('/_app layout', () => {
  it('wraps its pages in the app shell', async () => {
    await page.viewport(1440, 900);
    const Layout = Route.options.component as ComponentType;
    const { screen } = await renderApp(<Layout />);
    await expect.element(screen.getByRole('main')).toBeInTheDocument();
    await expect.element(screen.getByRole('navigation', { name: 'Navigasi utama' })).toBeVisible();
  });
});
