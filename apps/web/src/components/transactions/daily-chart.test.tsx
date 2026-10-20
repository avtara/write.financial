// SPDX-License-Identifier: AGPL-3.0-only
import type { LocalDate } from '@wf/domain/period';
import { describe, expect, it } from 'vitest';
import { renderApp } from '../../../test/render.tsx';
import { DailyChart } from './daily-chart.tsx';

const day = (date: string, outMinor: bigint) => ({ date: date as LocalDate, outMinor });

describe('DailyChart', () => {
  it('draws a bar per day with spending up to today, red above the dashed average', async () => {
    const days = [
      day('2026-10-01', 200_000n),
      day('2026-10-02', 0n),
      day('2026-10-03', 50_000n),
      day('2026-10-04', 400_000n),
      day('2026-10-05', 30_000n),
    ];
    const { screen } = await renderApp(
      <DailyChart days={days} averageMinor={100_000n} currency="IDR" today={'2026-10-04' as LocalDate} />,
    );
    const chart = screen.getByRole('img', { name: 'Grafik pengeluaran harian, 5 hari' });
    await expect.element(chart).toBeInTheDocument();
    const bars = [...chart.element().querySelectorAll('rect')];
    // No bar for the day without spending, nor for the day after today.
    expect(bars.map((bar) => bar.getAttribute('class'))).toEqual(['fill-red', 'fill-subtle', 'fill-red']);
    // The tallest bar (Rp400.000) reaches the top; heights are relative to it.
    expect(bars.map((bar) => Number(bar.getAttribute('height')))).toEqual([22, 5.5, 44]);
    expect(bars.map((bar) => Number(bar.getAttribute('x')))).toEqual([0.75, 96.75, 144.75]);
    expect(bars[0]?.getAttribute('width')).toBe('46.5');
    const line = chart.element().querySelector('line');
    expect(line?.getAttribute('y1')).toBe('33');
    expect(line?.getAttribute('stroke-dasharray')).toBe('3 3');
    expect(chart.element().getAttribute('style')).toBeNull();
    await expect.element(screen.getByText('1 Okt')).toBeInTheDocument();
    await expect.element(screen.getByText('3', { exact: true })).toBeInTheDocument();
    await expect.element(screen.getByText('5 Okt')).toBeInTheDocument();
    const table = screen.getByRole('table', { name: 'Pengeluaran per hari' });
    await expect.element(table.getByRole('rowheader', { name: '1 Okt 2026' })).toBeInTheDocument();
    await expect.element(table.getByText('Rp400.000')).toBeInTheDocument();
  });

  it('scales to the average when it is above every day', async () => {
    const { screen } = await renderApp(
      <DailyChart
        days={[day('2026-10-01', 100_000n)]}
        averageMinor={200_000n}
        currency="IDR"
        today={'2026-10-01' as LocalDate}
      />,
    );
    const chart = screen.getByRole('img', { name: 'Grafik pengeluaran harian, 1 hari' });
    await expect.element(chart).toBeInTheDocument();
    expect(chart.element().querySelector('rect')?.getAttribute('height')).toBe('22');
    expect(chart.element().querySelector('line')?.getAttribute('y1')).toBe('0');
  });

  it('is empty without days: no bars, no average line, no axis labels', async () => {
    const { screen } = await renderApp(
      <DailyChart days={[]} averageMinor={0n} currency="IDR" today={'2026-10-01' as LocalDate} />,
    );
    const chart = screen.getByRole('img', { name: 'Grafik pengeluaran harian, 0 hari' });
    await expect.element(chart).toBeInTheDocument();
    expect(chart.element().querySelectorAll('rect, line')).toHaveLength(0);
    expect(screen.container.querySelector('figcaption')).toBeNull();
  });
});
