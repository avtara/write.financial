// SPDX-License-Identifier: AGPL-3.0-only
import type { LocalDate } from '@wf/domain/period';
import { describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { renderApp } from '../../../test/render.tsx';
import { DailyChart } from './daily-chart.tsx';

const day = (date: string, outMinor: bigint) => ({ date: date as LocalDate, outMinor });

const DAYS = [
  day('2026-10-01', 200_000n),
  day('2026-10-02', 0n),
  day('2026-10-03', 50_000n),
  day('2026-10-04', 400_000n),
  day('2026-10-05', 30_000n),
];

async function renderChart(days = DAYS, averageMinor = 100_000n, today = '2026-10-04') {
  const { screen } = await renderApp(
    <DailyChart days={days} averageMinor={averageMinor} currency="IDR" today={today as LocalDate} />,
  );
  return { screen, chart: screen.getByRole('list', { name: `Grafik pengeluaran harian, ${days.length} hari` }) };
}

const rectsOf = (root: Element) => [...root.querySelectorAll('rect')];

describe('DailyChart', () => {
  it('draws a bar per day, red above the dashed average, stubs for empty and future days', async () => {
    const { screen, chart } = await renderChart();
    const rects = rectsOf(chart.element());
    expect(rects.map((rect) => rect.getAttribute('class')?.split(' ')[0])).toEqual([
      'fill-red',
      'fill-surface-4',
      'fill-neutral-bar',
      'fill-red',
      'fill-surface-4',
    ]);
    // The tallest bar (Rp400.000) reaches the top; heights are relative to it, with a 3 px floor.
    expect(rects.map((rect) => Number(rect.getAttribute('height')))).toEqual([22, 3, 5.5, 44, 3]);
    expect(rects.map((rect) => Number(rect.getAttribute('y')))).toEqual([22, 41, 38.5, 0, 41]);
    expect(rects.map((rect) => rect.getAttribute('ry'))).toEqual(['2', '1', '2', '2', '1']);
    expect(rects[0]?.getAttribute('rx')).toBe('0.6');
    const line = screen.container.querySelector('line');
    expect(line?.getAttribute('y1')).toBe('33');
    expect(line?.getAttribute('stroke-dasharray')).toBe('3 3');
    expect(screen.container.querySelector('[style]')).toBeNull();
    expect(chart.element().getAttribute('class')).toContain('gap-1');
    // Days up to today are list items; the day after today is decoration only.
    expect(chart.getByRole('listitem').elements()).toHaveLength(4);
    await expect.element(chart.getByRole('listitem').nth(0)).toHaveTextContent('1 Okt 2026, Rp200.000');
    await expect.element(screen.getByText('1 Okt', { exact: true })).toBeInTheDocument();
    await expect.element(screen.getByText('3', { exact: true })).toBeInTheDocument();
    await expect.element(screen.getByText('5 Okt', { exact: true })).toBeInTheDocument();
  });

  it('shows the date and amount on hover and keyboard focus, one tab stop moved by arrows', async () => {
    const { chart } = await renderChart();
    const items = chart.getByRole('listitem');
    // The latest day so far is the tab stop.
    expect(items.elements().map((item) => item.getAttribute('tabindex'))).toEqual(['-1', '-1', '-1', '0']);
    await userEvent.hover(items.nth(0));
    await expect.element(page.getByRole('tooltip')).toHaveTextContent('Kamis, 1 OktRp200.000');
    await userEvent.keyboard('{Escape}');
    await expect.element(page.getByRole('tooltip')).not.toBeInTheDocument();

    // One tab stop: Tab lands on the latest day and opens its tooltip.
    await userEvent.tab();
    await expect.element(items.nth(3)).toHaveFocus();
    await expect.element(page.getByRole('tooltip')).toHaveTextContent('Minggu, 4 OktRp400.000');
    await userEvent.keyboard('{ArrowLeft}');
    await expect.element(items.nth(2)).toHaveFocus();
    expect(items.elements().map((item) => item.getAttribute('tabindex'))).toEqual(['-1', '-1', '0', '-1']);
    await expect.element(page.getByRole('tooltip')).toHaveTextContent('Sabtu, 3 OktRp50.000');
    await userEvent.keyboard('{Home}');
    await expect.element(items.nth(0)).toHaveFocus();
    await userEvent.keyboard('{ArrowLeft}');
    await expect.element(items.nth(0)).toHaveFocus();
    await userEvent.keyboard('{End}');
    await expect.element(items.nth(3)).toHaveFocus();
    await userEvent.keyboard('{ArrowRight}');
    await expect.element(items.nth(3)).toHaveFocus();
    await userEvent.keyboard('{ArrowUp}');
    await expect.element(items.nth(3)).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    await expect.element(page.getByRole('tooltip')).not.toBeInTheDocument();
  });

  it('scales to the average when it is above every day, and narrows the gaps for long ranges', async () => {
    const { screen, chart } = await renderChart([day('2026-10-01', 100_000n)], 200_000n, '2026-10-01');
    expect(rectsOf(chart.element())[0]?.getAttribute('height')).toBe('22');
    expect(screen.container.querySelector('line')?.getAttribute('y1')).toBe('0');
    await screen.unmount();
    for (const [count, gap] of [
      [31, 'gap-[3px]'],
      [92, 'gap-px'],
      [93, 'gap-0'],
    ] as const) {
      const days = Array.from({ length: count }, (_, index) =>
        day(new Date(Date.UTC(2026, 0, 1 + index)).toISOString().slice(0, 10), 1_000n),
      );
      const long = await renderChart(days, 1_000n, '2025-12-31');
      expect(long.chart.element().getAttribute('class')).toContain(gap);
      // Everything is still to come: no tab stop, no tooltip.
      expect(long.chart.getByRole('listitem').elements()).toHaveLength(0);
      await long.screen.unmount();
    }
  });

  it('is empty without days: no bars, no average line, no axis labels', async () => {
    const { screen, chart } = await renderChart([], 0n, '2026-10-01');
    expect(rectsOf(chart.element())).toHaveLength(0);
    expect(screen.container.querySelector('line')).toBeNull();
    expect(screen.container.querySelector('.font-mono')).toBeNull();
  });
});
