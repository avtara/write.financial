// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { renderApp } from '../../test/render.tsx';
import { NotFoundPage } from './not-found-page.tsx';

describe('NotFoundPage', () => {
  it('says the page does not exist and links home', async () => {
    const { screen } = await renderApp(<NotFoundPage />, { preferences: { locale: 'en' } });
    await expect.element(screen.getByRole('heading', { name: 'Page not found' })).toBeVisible();
    await expect.element(screen.getByRole('link', { name: 'Go home' })).toHaveAttribute('href', '/');
  });
});
