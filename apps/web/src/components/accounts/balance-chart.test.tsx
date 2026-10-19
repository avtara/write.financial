// SPDX-License-Identifier: AGPL-3.0-only
import type { AccountSeriesPoint } from '@wf/db/accounts';
import type { YearMonth } from '@wf/domain/period';
import { describe, expect, it } from 'vitest';
import { renderApp } from '../../../test/render.tsx';
import { BalanceChart } from './balance-chart.tsx';

const point = (month: string, closingBalanceMinor: bigint): AccountSeriesPoint => ({
  month: month as YearMonth,
  closingBalanceMinor,
  inflowMinor: 0n,
  outflowMinor: 0n,
});

describe('BalanceChart', () => {
  it('draws a bar per month with month labels, highlighting the last month', async () => {
    const series = [point('2026-09', 41_610_000n), point('2026-10', 42_810_000n)];
    const { screen } = await renderApp(
      <BalanceChart series={series} startMinor={30_000_000n} locale="id" label="Saldo 6 bulan" />,
    );
    const chart = screen.getByRole('img', { name: 'Saldo 6 bulan' });
    await expect.element(chart.getByText('Sep')).toBeInTheDocument();
    await expect.element(chart.getByText('Okt')).toBeInTheDocument();
    const fills = [...chart.element().querySelectorAll('.recharts-bar-rectangle path')].map((bar) =>
      bar.getAttribute('fill'),
    );
    expect(fills).toEqual(['var(--surface-4)', 'var(--blue)']);
  });
});
