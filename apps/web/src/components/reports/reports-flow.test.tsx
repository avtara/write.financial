// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import type { ReportView } from '@wf/db/reports';
import { FINAL_VIEW, PROVISIONAL_VIEW } from '../../../test/report-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import { FlowSection } from './reports-flow.tsx';

const barCount = () => document.querySelectorAll('svg rect').length;

describe('FlowSection edge cases', () => {
  it('names an income line without a category after the uncategorized label', async () => {
    const unnamed = {
      ...FINAL_VIEW,
      sections: {
        ...FINAL_VIEW.sections,
        incomeSources: [{ categoryId: null, name: null, group: null, totalMinor: 900_000n, shareBps: 10_000 }],
      },
    } satisfies ReportView;
    const { screen } = await renderApp(<FlowSection view={unnamed} locale="id" />);
    await expect.element(screen.getByRole('region', { name: 'Arus uang' })).toMatchTextContent('Tanpa kategori');
  });
});

describe('FlowSection', () => {
  it('shows the transaction count, the net flow, the daily average, the busiest week, and the income sources', async () => {
    const { screen } = await renderApp(<FlowSection view={FINAL_VIEW} locale="id" />);
    const section = screen.getByRole('region', { name: 'Arus uang' });
    await expect.element(section).toMatchTextContent('121 transaksi');
    await expect.element(section).toMatchTextContent('+7.500.000');
    await expect.element(section).toMatchTextContent('Rata-rata Rp610.000/hari');
    await expect.element(section).toMatchTextContent('Minggu terboros 7 Sep–13 Sep · Rp5.200.000');
    const income = screen.getByRole('region', { name: 'Arus uang' }).getByRole('heading', { name: 'Pemasukan' });
    await expect.element(income).toBeVisible();
    await expect.element(section).toMatchTextContent('Gaji');
    await expect.element(section).toMatchTextContent('77,5%');
    await expect.element(section).toMatchTextContent('20.000.000');
    await expect.element(section).toMatchTextContent('5.800.000');
  });

  it('draws one bar per recorded day and highlights the busiest week', async () => {
    const { screen } = await renderApp(<FlowSection view={FINAL_VIEW} locale="id" />);
    await expect.poll(barCount).toBe(5);
    const hot = document.querySelectorAll('svg rect.fill-blue');
    expect(hot.length).toBe(3);
    await expect.element(screen.getByText('7 Sep')).toBeVisible();
  });

  it('switches the daily average and the income copy to English', async () => {
    const { screen } = await renderApp(<FlowSection view={FINAL_VIEW} locale="en" />, {
      preferences: { locale: 'en' },
    });
    const section = screen.getByRole('region', { name: 'Money flow' });
    await expect.element(section).toMatchTextContent('121 transactions');
    await expect.element(section).toMatchTextContent('Average Rp610,000/day');
    await expect.element(section).toMatchTextContent('Biggest week Sep 7–Sep 13 · Rp5,200,000');
    await expect.element(section.getByRole('heading', { name: 'Income' })).toBeVisible();
  });

  it('keeps a bare provisional report honest: no chart, no busiest week, no income table', async () => {
    const { screen } = await renderApp(<FlowSection view={PROVISIONAL_VIEW} locale="id" />);
    const section = screen.getByRole('region', { name: 'Arus uang' });
    await expect.element(section).toMatchTextContent('350 transaksi');
    await expect.element(section).toMatchTextContent('+20.000.000');
    await expect.element(section).not.toMatchTextContent('Minggu terboros');
    await expect.element(section).not.toMatchTextContent('Pemasukan');
    expect(barCount()).toBe(0);
  });
});
