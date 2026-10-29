// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { FINAL_VIEW, PROVISIONAL_VIEW } from '../../../test/report-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import { LargestSection } from './reports-largest.tsx';

describe('LargestSection', () => {
  it('lists the largest transactions with their date, amount, and share', async () => {
    const { screen } = await renderApp(<LargestSection view={FINAL_VIEW} locale="id" />);
    const section = screen.getByRole('region', { name: 'Transaksi terbesar' });
    await expect.element(section).toMatchTextContent('Sewa Kos');
    await expect.element(section).toMatchTextContent('1 Sep');
    await expect.element(section).toMatchTextContent('4.500.000');
    await expect.element(section).toMatchTextContent('24,59%');
    await expect.element(section).toMatchTextContent('Laptop baru · Tokopedia');
    await expect.element(section).toMatchTextContent('14 Sep');
  });

  it('summarises the share of the top transactions', async () => {
    const { screen } = await renderApp(<LargestSection view={FINAL_VIEW} locale="id" />);
    await expect.element(screen.getByText('3 transaksi = 40,00% dari pengeluaran')).toBeVisible();
  });

  it('uses the English copy', async () => {
    const { screen } = await renderApp(<LargestSection view={FINAL_VIEW} locale="en" />, {
      preferences: { locale: 'en' },
    });
    await expect.element(screen.getByRole('region', { name: 'Largest transactions' })).toMatchTextContent('24.59%');
    await expect.element(screen.getByText('3 transactions = 40.00% of spending')).toBeVisible();
  });

  it('keeps a bare provisional report honest: no rows and no share line', async () => {
    const { screen } = await renderApp(<LargestSection view={PROVISIONAL_VIEW} locale="id" />);
    const section = screen.getByRole('region', { name: 'Transaksi terbesar' });
    await expect.element(section).not.toMatchTextContent('%');
    await expect.element(section).not.toMatchTextContent('transaksi');
  });
});
