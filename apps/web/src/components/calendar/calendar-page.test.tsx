// SPDX-License-Identifier: AGPL-3.0-only
import type { LocalDate } from '@wf/domain/period';
import { describe, expect, it, vi } from 'vitest';
import { octoberRange, OCTOBER_DAYS } from '../../../test/calendar-fixtures.ts';
import { ACCOUNTS, CATEGORIES } from '../../../test/ledger-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import { CalendarPage, type CalendarData } from './calendar-page.tsx';

const record = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock('../ledger/record-transaction.tsx', () => ({ useRecordTransaction: () => record }));

const d = (value: string) => value as LocalDate;
const TODAY = d('2026-10-15');

function renderPage(data: CalendarData, date = TODAY, safeDailyMinor: bigint | null = 140_000n) {
  return renderApp(
    <CalendarPage
      data={data}
      date={date}
      today={TODAY}
      accounts={ACCOUNTS}
      categories={CATEGORIES}
      baseCurrency="IDR"
      safeDailyMinor={safeDailyMinor}
      timeZone="Asia/Jakarta"
    />,
  );
}

describe('CalendarPage', () => {
  it('opens October on today, selects another day, and hides layers from the legend', async () => {
    const { screen } = await renderPage({ view: 'month', range: octoberRange(), pattern: null });
    await expect
      .element(screen.getByText('Pengeluaran harian, pemasukan, dan tagihan terjadwal dalam satu tampilan'))
      .toBeVisible();
    await expect.element(screen.getByRole('region', { name: 'Kamis, 15 Oktober 2026' })).toBeVisible();
    await expect.element(screen.getByRole('region', { name: 'Pola per hari' })).toBeVisible();
    await screen.getByRole('button', { name: /^Minggu, 11 Oktober/ }).click();
    await expect.element(screen.getByRole('region', { name: 'Minggu, 11 Oktober 2026' })).toBeVisible();
    const legend = screen.getByRole('list', { name: 'Tampilkan di kalender' });
    await legend.getByRole('button', { name: 'Pemasukan' }).click();
    await expect.element(legend.getByRole('button', { name: 'Pemasukan' })).toHaveAttribute('aria-pressed', 'false');
    await expect.element(screen.getByText('Pemasukan disembunyikan · hanya pengeluaran')).toBeVisible();
    await legend.getByRole('button', { name: 'Pemasukan' }).click();
    await expect.element(legend.getByRole('button', { name: 'Pemasukan' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('opens a past month on its costliest day, or its first without spending', async () => {
    const september = await renderPage(
      {
        view: 'month',
        range: octoberRange({ days: [{ date: d('2026-09-12'), inMinor: 0n, outMinor: 900_000n, count: 1 }] }),
        pattern: null,
      },
      d('2026-09-03'),
    );
    await expect.element(september.screen.getByRole('region', { name: 'Sabtu, 12 September 2026' })).toBeVisible();
    await september.screen.unmount();
    const quiet = await renderPage(
      { view: 'month', range: octoberRange({ days: [], rows: [] }), pattern: null },
      d('2026-08-20'),
    );
    await expect.element(quiet.screen.getByRole('region', { name: 'Sabtu, 1 Agustus 2026' })).toBeVisible();
  });

  it('shows November’s schedule and projection from October, without the weekday pattern', async () => {
    const { screen } = await renderPage(
      {
        view: 'month',
        range: octoberRange({ days: [], rows: [], scheduled: [] }),
        pattern: octoberRange(),
      },
      d('2026-11-10'),
    );
    await expect.element(screen.getByText('Bulan belum dimulai · yang tampil adalah jadwal & proyeksi')).toBeVisible();
    await expect.element(screen.getByRole('region', { name: 'Pola per hari' })).not.toBeInTheDocument();
    await screen.getByRole('button', { name: /^Minggu, 1 November/ }).click();
    await expect.element(screen.getByText(/Perkiraan dari pola Okt/)).toBeVisible();
    await screen.unmount();
    const noPattern = await renderPage(
      { view: 'month', range: octoberRange({ rows: [], days: [] }), pattern: null },
      d('2026-11-10'),
    );
    await expect.element(noPattern.screen.getByText('Klik tanggal untuk melihat rinciannya')).toBeVisible();
  });

  it('shows the week and the year views', async () => {
    const week = await renderPage({ view: 'week', range: octoberRange() });
    await expect.element(week.screen.getByText('4 hari berjalan, 3 hari ke depan')).toBeVisible();
    await expect.element(week.screen.getByRole('region', { name: 'Hari dalam minggu ini' })).toBeVisible();
    await week.screen.unmount();
    const year = await renderPage({ view: 'year', year: { days: OCTOBER_DAYS, hasTransactions: true } });
    await expect
      .element(year.screen.getByText('Januari – Oktober 2026 · klik bulan untuk membuka tampilan bulanan'))
      .toBeVisible();
    await year.screen.unmount();
    const past = await renderPage({ view: 'year', year: { days: [], hasTransactions: true } }, d('2025-03-01'));
    await expect
      .element(past.screen.getByText('Januari – Desember 2025 · klik bulan untuk membuka tampilan bulanan'))
      .toBeVisible();
  });

  it('starts empty for a new user, with recording and adding a subscription', async () => {
    const empty: CalendarData[] = [
      { view: 'month', range: octoberRange({ hasTransactions: false, scheduled: [] }), pattern: null },
      { view: 'year', year: { days: [], hasTransactions: false } },
    ];
    for (const data of empty) {
      const { screen } = await renderPage(data);
      await expect.element(screen.getByText('Kalender masih kosong')).toBeVisible();
      await expect
        .element(screen.getByRole('link', { name: 'Tambah langganan' }))
        .toHaveAttribute('href', '/subscriptions?new=true');
      await screen.getByRole('button', { name: 'Catat Transaksi' }).last().click();
      expect(record.open).toHaveBeenLastCalledWith();
      await screen.unmount();
    }
    const scheduledOnly = await renderPage({ view: 'week', range: octoberRange({ hasTransactions: false }) });
    await expect.element(scheduledOnly.screen.getByText('Kalender masih kosong')).not.toBeInTheDocument();
  });
});
