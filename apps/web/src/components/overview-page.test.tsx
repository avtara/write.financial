// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { renderApp } from '../../test/render.tsx';
import { OverviewPage } from './overview-page.tsx';

describe('OverviewPage', () => {
  it('greets and shows the empty state while there is no data', async () => {
    const { screen } = await renderApp(<OverviewPage />);
    await expect.element(screen.getByRole('heading', { level: 1, name: 'Selamat datang' })).toBeVisible();
    await expect
      .element(screen.getByRole('navigation', { name: 'Jejak halaman' }))
      .toHaveTextContent('KeuanganRingkasan');
    await expect.element(screen.getByText('Belum ada data')).toBeVisible();
    await expect.element(screen.getByText('Tambahkan rekening pertamamu untuk mulai.')).toBeVisible();
  });

  it('renders in English', async () => {
    const { screen } = await renderApp(<OverviewPage />, { preferences: { locale: 'en' } });
    await expect.element(screen.getByRole('heading', { level: 1, name: 'Welcome' })).toBeVisible();
    await expect.element(screen.getByText('No data yet')).toBeVisible();
  });
});
