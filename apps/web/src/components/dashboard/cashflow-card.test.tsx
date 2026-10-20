// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { dashboard, weekDashboard, yearDashboard } from '../../../test/dashboard-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import { CashflowCard } from './cashflow-card.tsx';

describe('CashflowCard', () => {
  it('compares six periods with the net, the biggest spending, and the average', async () => {
    const { screen } = await renderApp(
      <div className="w-[700px]">
        <CashflowCard dashboard={dashboard()} locale="id" />
      </div>,
    );
    const region = screen.getByRole('region', { name: 'Pemasukan vs Pengeluaran' });
    await expect.element(region).toMatchTextContent('6 bulan terakhir · rata-rata menabung Rp2.833.333/bulan');
    await expect.element(region).toMatchTextContent('Net cashflow Okt+9.500.000');
    await expect.element(region).toMatchTextContent('Pengeluaran terbesarSep · Rp18.300.000');
    // Fewer than six periods with spending: the average instead of the trend.
    await expect.element(region).toMatchTextContent('Rata-rata keluarRp5.800.000/bulan');
    const september = region.getByRole('img', { name: /^September 2026: Pemasukan Rp25\.800\.000/ });
    await userEvent.hover(september);
    const tip = screen.getByRole('tooltip');
    await expect.element(tip).toMatchTextContent('September 2026selisih +7.500.000');
    await expect.element(tip).toMatchTextContent('Rasio tabung29%');
    await userEvent.hover(region.getByRole('heading', { name: 'Pemasukan vs Pengeluaran' }));
    expect(screen.getByRole('tooltip').query()).toBeNull();
    // Keyboard: the focused column shows its card too, with the change against the month before.
    await userEvent.tab();
    await userEvent.tab();
    await expect.element(screen.getByRole('tooltip')).toBeVisible();
    region
      .getByRole('img', { name: /^Oktober 2026/ })
      .element()
      .dispatchEvent(new FocusEvent('focus'));
    (region.getByRole('img', { name: /^Oktober 2026/ }).element() as SVGGElement).focus();
    await expect.element(screen.getByRole('tooltip')).toMatchTextContent('vs September 2026 −9,8% belanja');
    (region.getByRole('img', { name: /^Oktober 2026/ }).element() as SVGGElement).blur();
    await expect.element(screen.getByRole('tooltip')).not.toBeInTheDocument();
  });

  it('shows the trend once six periods have spending', async () => {
    const base = dashboard();
    const periods = base.trend.periods.map((period, index) => ({
      ...period,
      incomeMinor: 10_000_000n,
      expenseMinor: index < 3 ? 10_000_000n : 9_000_000n,
    }));
    const { screen } = await renderApp(
      <CashflowCard dashboard={dashboard({ trend: { ...base.trend, periods } })} locale="id" />,
    );
    await expect.element(screen.getByText('−10% / 3 bulan')).toBeVisible();
    expect(screen.getByText('−10% / 3 bulan').element().getAttribute('class')).toContain('text-green-fg');
    const rising = periods.map((period, index) => ({ ...period, expenseMinor: index < 3 ? 1n : 9n }));
    const { screen: second } = await renderApp(
      <CashflowCard dashboard={dashboard({ trend: { ...base.trend, periods: rising } })} locale="id" />,
    );
    expect(
      second
        .getByText(/\/ 3 bulan$/)
        .last()
        .element()
        .getAttribute('class'),
    ).toContain('text-red-fg');
  });

  it('shows the week by day and the year by month', async () => {
    const { screen } = await renderApp(
      <>
        <CashflowCard dashboard={weekDashboard()} locale="id" />
        <CashflowCard dashboard={yearDashboard()} locale="id" />
      </>,
    );
    await expect.element(screen.getByText('Per hari, 12–18 Okt')).toBeVisible();
    await expect.element(screen.getByText('Hari terboros')).toBeVisible();
    await expect.element(screen.getByText('Rp177.750/hari')).toBeVisible();
    await expect.element(screen.getByText('Per bulan, Januari–Desember 2026')).toBeVisible();
    await expect.element(screen.getByText('Net 2026')).toBeVisible();
    await expect.element(screen.getByText('Bulan terboros')).toBeVisible();
    await expect
      .element(screen.getByRole('img', { name: 'Rabu, 14 Oktober: Pemasukan Rp6.200.000, Pengeluaran Rp711.000' }))
      .toBeInTheDocument();
    await expect.element(screen.getByRole('img', { name: 'Minggu, 18 Oktober' })).toBeInTheDocument();
  });

  it('has no biggest spending without any', async () => {
    const base = dashboard();
    const empty = base.trend.periods.map((period) => ({ ...period, incomeMinor: 0n, expenseMinor: 0n }));
    const { screen } = await renderApp(
      <CashflowCard dashboard={dashboard({ trend: { ...base.trend, periods: empty } })} locale="id" />,
    );
    await expect.element(screen.getByRole('region')).toMatchTextContent('Pengeluaran terbesar—');
  });
});
