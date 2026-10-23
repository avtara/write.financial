// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { FINAL_VIEW, PROVISIONAL_VIEW } from '../../../test/report-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import { SpendingSection } from './reports-spending.tsx';

describe('SpendingSection', () => {
  it('shows categories against their budget, with the over-limit note', async () => {
    const { screen } = await renderApp(<SpendingSection view={FINAL_VIEW} locale="id" />);
    const section = screen.getByRole('region', { name: 'Pengeluaran' });
    await expect.element(section).toMatchTextContent('Sewa Kos');
    await expect.element(section).toMatchTextContent('4.500.000');
    await expect.element(section).toMatchTextContent('/ 4.500.000');
    await expect.element(section).toMatchTextContent('100%');
    await expect.element(section).toMatchTextContent('Belanja Online');
    await expect.element(section).toMatchTextContent('2.600.000');
    await expect.element(section).toMatchTextContent('/ 2.000.000');
    await expect.element(section).toMatchTextContent('lewat Rp600.000');
    await expect.element(section).toMatchTextContent('130%');
  });

  it('shows the uncategorized line by its share of the spending', async () => {
    const { screen } = await renderApp(<SpendingSection view={FINAL_VIEW} locale="id" />);
    const section = screen.getByRole('region', { name: 'Pengeluaran' });
    await expect.element(section).toMatchTextContent('Tanpa kategori');
    await expect.element(section).toMatchTextContent('150.000');
    await expect.element(section).toMatchTextContent('1%');
  });

  it('ranks the merchants, lists the tag chips, and shows the accounts', async () => {
    const { screen } = await renderApp(<SpendingSection view={FINAL_VIEW} locale="id" />);
    const section = screen.getByRole('region', { name: 'Pengeluaran' });
    await expect.element(section.getByRole('heading', { name: 'Merchant' })).toBeVisible();
    await expect.element(section).toMatchTextContent('GoPay');
    await expect.element(section).toMatchTextContent('34 transaksi');
    await expect.element(section).toMatchTextContent('17%');
    await expect.element(section).toMatchTextContent('3.200.000');
    await expect.element(section.getByRole('heading', { name: 'Tag' })).toBeVisible();
    await expect.element(section).toMatchTextContent('#akhir-pekan');
    await expect.element(section).toMatchTextContent('1.200.000');
    await expect.element(section.getByRole('heading', { name: 'Rekening & tag' })).toBeVisible();
    await expect.element(section).toMatchTextContent('BCA Tahapan');
    await expect.element(section).toMatchTextContent('+25.000.000');
    await expect.element(section).toMatchTextContent('−15.000.000');
  });

  it('keeps a bare provisional report honest: no categories, merchants, tags, or accounts', async () => {
    const { screen } = await renderApp(<SpendingSection view={PROVISIONAL_VIEW} locale="id" />);
    const section = screen.getByRole('region', { name: 'Pengeluaran' });
    await expect.element(section).not.toMatchTextContent('lewat');
    await expect.element(section).not.toMatchTextContent('Merchant');
    await expect.element(section).not.toMatchTextContent('#akhir-pekan');
    await expect.element(section).not.toMatchTextContent('BCA Tahapan');
  });
});
