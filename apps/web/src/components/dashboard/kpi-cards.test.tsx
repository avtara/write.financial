// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { dashboard } from '../../../test/dashboard-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import { KpiCards } from './kpi-cards.tsx';

describe('KpiCards', () => {
  it('shows the four figures with their like-for-like change', async () => {
    const { kpis } = dashboard();
    const { screen } = await renderApp(<KpiCards kpis={kpis} comparison="vs Sep" currency="IDR" locale="id" />);
    const region = screen.getByRole('region', { name: 'Angka utama' });
    await expect
      .element(region.getByRole('group', { name: 'Pemasukan' }))
      .toMatchTextContent('Rp26.000.000+0,78%vs Sep');
    await expect
      .element(region.getByRole('group', { name: 'Pengeluaran' }))
      .toMatchTextContent('Rp16.500.000−9,84%vs Sep');
    await expect
      .element(region.getByRole('group', { name: 'Ditabung & Investasi' }))
      .toMatchTextContent('Rp9.500.000+26,67%vs Sep');
    await expect.element(region.getByRole('group', { name: 'Saving Rate' })).toMatchTextContent('36,54%Target 30,00%');
    // Less spending is good news, more is not.
    expect(region.getByText('−9,84%').element().getAttribute('class')).toContain('text-green-fg');
  });

  it('colours bad news red and leaves out unknown or flat changes', async () => {
    const { kpis } = dashboard({
      kpis: {
        ...dashboard().kpis,
        change: { incomeBps: -1200, expenseBps: 1500, savedBps: null, savingRateBps: null },
        current: { ...dashboard().kpis.current, savingRateBps: null },
      },
    });
    const { screen } = await renderApp(<KpiCards kpis={kpis} comparison="vs 2025" currency="IDR" locale="id" />);
    expect(screen.getByText('−12,00%').element().getAttribute('class')).toContain('text-red-fg');
    expect(screen.getByText('+15,00%').element().getAttribute('class')).toContain('text-red-fg');
    // Unknown change: neither a badge nor a lone "vs 2025".
    const saved = screen.getByRole('group', { name: 'Ditabung & Investasi' });
    await expect.element(saved).toMatchTextContent(/^Ditabung & InvestasiRp[\d.]+$/);
    await expect.element(screen.getByRole('group', { name: 'Pemasukan' })).toMatchTextContent(/vs 2025$/);
    const flat = { ...kpis, change: { ...kpis.change, savedBps: 0 } };
    const { screen: again } = await renderApp(<KpiCards kpis={flat} comparison="vs 2025" currency="IDR" locale="id" />);
    expect(again.getByText('0,00%').last().element().getAttribute('class')).toContain('text-muted-fg');
    await expect.element(screen.getByRole('group', { name: 'Saving Rate' }).first()).toMatchTextContent('—');
  });

  it('reads "belum ada data" without data', async () => {
    const { screen } = await renderApp(<KpiCards kpis={null} comparison="" currency="IDR" locale="id" />);
    await expect.element(screen.getByRole('group', { name: 'Pemasukan' })).toMatchTextContent('Rp0belum ada data');
    await expect.element(screen.getByRole('group', { name: 'Saving Rate' })).toMatchTextContent('Saving Rate—');
    expect(screen.getByText('Target 30%').query()).toBeNull();
  });
});
