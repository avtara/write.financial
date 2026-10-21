// SPDX-License-Identifier: AGPL-3.0-only
import type { LocalDate, YearMonth } from '@wf/domain/period';
import { describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { octoberInputs } from '../../../test/calendar-fixtures.ts';
import { scheduledItem } from '../../../test/dashboard-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import { transactionRow } from '../../../test/transaction-fixtures.ts';
import { CALENDAR_LAYERS, monthGrid, monthStats, type CalendarLayer } from './calendar-model.ts';
import { MonthGrid, MonthKpis, WeekdayPattern } from './month-view.tsx';

const d = (value: string) => value as LocalDate;
const TODAY = d('2026-10-15');
const OCTOBER = '2026-10' as YearMonth;
const grid = monthGrid(OCTOBER, octoberInputs());
const stats = monthStats(grid, TODAY);

describe('MonthKpis', () => {
  it('shows the daily average, the costliest day, frugal days, and the weekend ratio', async () => {
    const { screen } = await renderApp(
      <MonthKpis stats={stats} grid={grid} weekendRatio={2.8} future={false} baseCurrency="IDR" locale="id" />,
    );
    const kpis = screen.getByRole('region', { name: 'Ringkasan kalender' });
    await expect.element(kpis).toMatchTextContent(/Rata-rata harianRp606\.00015 hari berjalan/);
    await expect.element(kpis).toMatchTextContent(/Hari termahalRp2\.200\.000Minggu, 11 Okt · 3,6× rata-rata/);
    await expect.element(kpis).toMatchTextContent(/Hari hemat10 haridi bawah Rp100\.000/);
    await expect.element(kpis).toMatchTextContent(/Akhir pekan2,8×lebih boros dari hari kerja/);
  });

  it('shows dashes without spending, and the schedule and payday of a month to come', async () => {
    const empty = monthStats(monthGrid(OCTOBER, octoberInputs({ days: [], rows: [] })), TODAY);
    const first = await renderApp(
      <MonthKpis stats={empty} grid={grid} weekendRatio={null} future={false} baseCurrency="IDR" locale="id" />,
    );
    await expect
      .element(first.screen.getByRole('region'))
      .toMatchTextContent(/Rata-rata harianRp0.*Hari termahal—.*Akhir pekan—$/);
    await first.screen.unmount();

    const november = monthGrid(
      '2026-11' as YearMonth,
      octoberInputs({
        days: [],
        rows: [],
        scheduled: [
          scheduledItem({ sourceId: 'rent', dueDate: d('2026-11-01'), name: 'Sewa Kos', expectedMinor: 4_500_000n }),
          scheduledItem({ sourceId: 'nf', dueDate: d('2026-11-18') }),
          scheduledItem({
            sourceId: 'fund',
            dueDate: d('2026-11-25'),
            direction: 'transfer',
            expectedMinor: 1_150_000n,
          }),
        ],
      }),
      octoberInputs(),
    );
    const future = await renderApp(
      <MonthKpis stats={stats} grid={november} weekendRatio={null} future baseCurrency="IDR" locale="id" />,
    );
    const kpis = future.screen.getByRole('region');
    await expect.element(kpis).toMatchTextContent(/Rata-rata harian—belum ada transaksi/);
    await expect.element(kpis).toMatchTextContent(/Tagihan terbesarRp4\.500\.000Sewa Kos · 1 Nov/);
    await expect.element(kpis).toMatchTextContent(/Terjadwal2 tagihanRp4\.686\.000 \+ transfer Rp1\.150\.000/);
    await expect.element(kpis).toMatchTextContent(/Gajian1 Novdiperkirakan Rp18\.500\.000/);
    await future.screen.unmount();

    const elapsedNone = await renderApp(
      <MonthKpis
        stats={{ ...stats, elapsed: 0, averageMinor: 0n }}
        grid={grid}
        weekendRatio={null}
        future={false}
        baseCurrency="IDR"
        locale="id"
      />,
    );
    await expect
      .element(elapsedNone.screen.getByRole('region'))
      .toMatchTextContent(/^Rata-rata harian—.*Hari termahalRp2\.200\.000Minggu, 11 Okt · 0× rata-rata/);
    await elapsedNone.screen.unmount();

    const bare = monthGrid(
      '2026-11' as YearMonth,
      octoberInputs({
        days: [],
        rows: [],
        scheduled: [scheduledItem({ sourceId: 'unnamed', dueDate: d('2026-11-05'), name: null })],
      }),
    );
    const nothing = await renderApp(
      <MonthKpis stats={stats} grid={bare} weekendRatio={null} future baseCurrency="IDR" locale="en" />,
      { preferences: { locale: 'en' } },
    );
    await expect
      .element(nothing.screen.getByRole('region'))
      .toMatchTextContent(/Largest billRp186,000Scheduled · Nov 5Scheduled1 billRp186,000Payday—$/);
    await nothing.screen.unmount();

    const unscheduled = monthGrid('2026-11' as YearMonth, octoberInputs({ days: [], rows: [], scheduled: [] }));
    const none = await renderApp(
      <MonthKpis stats={stats} grid={unscheduled} weekendRatio={null} future baseCurrency="IDR" locale="id" />,
    );
    await expect
      .element(none.screen.getByRole('region'))
      .toMatchTextContent(/Tagihan terbesar—Terjadwal0 tagihanRp0Gajian—$/);
  });
});

describe('MonthGrid', () => {
  function renderGrid(patch: Partial<Parameters<typeof MonthGrid>[0]> = {}) {
    const onSelect = vi.fn();
    const onToggleLayer = vi.fn();
    return renderApp(
      <MonthGrid
        month={OCTOBER}
        grid={grid}
        stats={stats}
        today={TODAY}
        future={false}
        patternMonth={null}
        selected={d('2026-10-11')}
        onSelect={onSelect}
        layers={CALENDAR_LAYERS}
        onToggleLayer={onToggleLayer}
        baseCurrency="IDR"
        locale="id"
        {...patch}
      />,
    ).then((rendered) => ({ ...rendered, onSelect, onToggleLayer }));
  }

  it('golden: heat, payday surplus, savings, needs/wants bars, scheduled events, week totals', async () => {
    const { screen, onSelect, onToggleLayer } = await renderGrid();
    const month = screen.getByRole('region', { name: 'Oktober 2026' });
    await expect.element(month.getByText('Klik tanggal untuk melihat rinciannya')).toBeVisible();
    const payday = month.getByRole('button', { name: /^Kamis, 1 Oktober 2026/ });
    await expect.element(payday).toHaveAttribute('data-surplus', 'true');
    await expect.element(payday).toMatchTextContent(/^16\.000\.00018\.500\.000\+14\.000\.000$/);
    const sunday = month.getByRole('button', { name: 'Minggu, 11 Oktober 2026, ada pengeluaran' });
    await expect.element(sunday).toHaveAttribute('aria-pressed', 'true');
    expect(sunday.element().querySelectorAll('rect')).toHaveLength(2);
    await expect
      .element(month.getByRole('button', { name: 'Kamis, 15 Oktober 2026, Hari ini, ada pengeluaran' }))
      .toBeVisible();
    await expect.element(month.getByRole('button', { name: /^Minggu, 18 Oktober/ })).toMatchTextContent(/Netflix/);
    await expect.element(month.getByRole('button', { name: /^Minggu, 25 Oktober/ })).toMatchTextContent(/Terjadwal/);
    const rows = month.getByRole('row');
    await expect.element(rows.nth(1)).toMatchTextContent(/M14\.500\.000\+14\.000\.000$/);
    await expect.element(rows.nth(3)).toMatchTextContent(/M3200\.000\+6\.050\.000\+Rp186\.000 terjadwal$/);
    await sunday.click();
    expect(onSelect).toHaveBeenCalledWith('2026-10-11');
    const legend = month.getByRole('list', { name: 'Tampilkan di kalender' });
    await legend.getByRole('button', { name: 'Pemasukan' }).click();
    expect(onToggleLayer).toHaveBeenCalledWith('income');
    await userEvent.hover(month.getByRole('button', { name: /^Jumat, 9 Oktober/ }));
    const tip = screen.getByRole('tooltip');
    await expect.element(tip).toMatchTextContent(/Jumat, 9 Oktober 2026/);
    await expect.element(tip).toMatchTextContent(/1,55× rata-rata/);
    await expect.element(tip).toMatchTextContent(/Keluar−940\.000/);
    await expect.element(tip).toMatchTextContent(/1 transaksiKlik untuk rincian/);
  });

  it('shows the needs/wants split and largest in tooltips, and future days as not yet', async () => {
    const { screen } = await renderGrid();
    await userEvent.hover(screen.getByRole('button', { name: /^Kamis, 1 Oktober/ }));
    await expect.element(screen.getByRole('tooltip')).toMatchTextContent(/Kebutuhan4\.500\.000/);
    await expect.element(screen.getByRole('tooltip')).toMatchTextContent(/4 transaksi · terbesar Sewa Kos/);
    await userEvent.unhover(screen.getByRole('button', { name: /^Kamis, 1 Oktober/ }));
    await userEvent.hover(screen.getByRole('button', { name: /^Minggu, 11 Oktober/ }));
    await expect.element(screen.getByRole('tooltip')).toMatchTextContent(/Keinginan2\.150\.000/);
    await userEvent.unhover(screen.getByRole('button', { name: /^Minggu, 11 Oktober/ }));
    await userEvent.hover(screen.getByRole('button', { name: /^Senin, 12 Oktober/ }));
    await expect.element(screen.getByRole('tooltip')).toMatchTextContent(/0 transaksiKlik/);
    await userEvent.unhover(screen.getByRole('button', { name: /^Senin, 12 Oktober/ }));
    await userEvent.hover(screen.getByRole('button', { name: /^Jumat, 16 Oktober/ }));
    await expect.element(screen.getByRole('tooltip')).toMatchTextContent(/Belum terjadiKlik untuk rincian/);
  });

  it('names the largest spend by its description, or a dash; no ratio without an average', async () => {
    const rows = [
      transactionRow('pulsa', {
        localDate: d('2026-10-02'),
        merchant: null,
        description: 'Pulsa',
        amountBaseMinor: -10_000n,
      }),
      transactionRow('blank', {
        localDate: d('2026-10-03'),
        merchant: null,
        description: null,
        amountBaseMinor: -5_000n,
      }),
    ];
    const plain = monthGrid(OCTOBER, octoberInputs({ rows, days: [] }));
    const { screen } = await renderGrid({ grid: plain, stats: { ...stats, averageMinor: 0n } });
    await userEvent.hover(screen.getByRole('button', { name: /^Jumat, 2 Oktober/ }));
    await expect
      .element(screen.getByRole('tooltip'))
      .toMatchTextContent(/^Jumat, 2 Oktober 2026Keluar.*terbesar Pulsa/);
    await userEvent.unhover(screen.getByRole('button', { name: /^Jumat, 2 Oktober/ }));
    await userEvent.hover(screen.getByRole('button', { name: /^Sabtu, 3 Oktober/ }));
    await expect.element(screen.getByRole('tooltip')).toMatchTextContent(/terbesar —/);
  });

  it('hides layers and explains it; shows the projection of a month to come', async () => {
    const hidden: CalendarLayer[] = [];
    const bare = await renderGrid({ layers: hidden });
    await expect.element(bare.screen.getByText('Pemasukan disembunyikan · hanya pengeluaran')).toBeVisible();
    await expect.element(bare.screen.getByRole('button', { name: /^Kamis, 1 Oktober/ })).toMatchTextContent(/^1$/);
    await expect.element(bare.screen.getByRole('button', { name: /^Minggu, 18 Oktober/ })).toMatchTextContent(/^18$/);
    await bare.screen.unmount();

    const novemberGrid = monthGrid('2026-11' as YearMonth, octoberInputs({ days: [], rows: [] }), octoberInputs());
    const november = await renderGrid({
      month: '2026-11' as YearMonth,
      grid: novemberGrid,
      future: true,
      patternMonth: OCTOBER,
      stats: { ...stats, averageMinor: 0n },
    });
    await expect
      .element(november.screen.getByText('Bulan belum dimulai · yang tampil adalah jadwal & proyeksi'))
      .toBeVisible();
    await expect
      .element(november.screen.getByRole('button', { name: /^Minggu, 1 November/ }))
      .toMatchTextContent(/PT Kinarya/);
    await expect.element(november.screen.getByRole('row').nth(1)).toMatchTextContent(/M1\+18\.500\.000 proyeksi$/);
  });
});

describe('WeekdayPattern', () => {
  it('shows the average per weekday with the costliest visible and the weekend note', async () => {
    const { screen } = await renderApp(
      <WeekdayPattern stats={stats} weekendRatio={2.8} baseCurrency="IDR" locale="id" />,
    );
    const pattern = screen.getByRole('region', { name: 'Pola per hari' });
    expect(pattern.getByRole('listitem').elements()).toHaveLength(7);
    await expect.element(pattern.getByRole('listitem').nth(3)).toMatchTextContent(/^Rp1\.550\.666Kam$/);
    await expect
      .element(pattern.getByText(/^Akhir pekan rata-rata Rp550\.000\/hari, 2,8× hari kerja\.$/))
      .toBeVisible();
    await screen.unmount();
    const flat = await renderApp(
      <WeekdayPattern stats={{ ...stats, weekdays: [] }} weekendRatio={null} baseCurrency="IDR" locale="id" />,
    );
    await expect.element(flat.screen.getByText(/Akhir pekan rata-rata/)).not.toBeInTheDocument();
  });
});
