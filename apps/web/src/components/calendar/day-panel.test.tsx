// SPDX-License-Identifier: AGPL-3.0-only
import type { LocalDate, YearMonth } from '@wf/domain/period';
import { describe, expect, it, vi } from 'vitest';
import { octoberInputs } from '../../../test/calendar-fixtures.ts';
import { scheduledItem } from '../../../test/dashboard-fixtures.ts';
import { ACCOUNTS, CATEGORIES } from '../../../test/ledger-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import { monthGrid, type DayDetail } from './calendar-model.ts';
import { DayPanel } from './day-panel.tsx';

const record = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock('../ledger/record-transaction.tsx', () => ({ useRecordTransaction: () => record }));

const d = (value: string) => value as LocalDate;
const TODAY = d('2026-10-15');
const october = monthGrid('2026-10' as YearMonth, octoberInputs()).flat();
const dayOf = (date: string) => october.find((detail) => detail.date === date) as DayDetail;

function renderPanel(day: DayDetail, patternMonth: YearMonth | null = null) {
  return renderApp(
    <DayPanel
      day={day}
      today={TODAY}
      averageMinor={606_000n}
      patternMonth={patternMonth}
      categories={CATEGORIES}
      accounts={ACCOUNTS}
      baseCurrency="IDR"
      timeZone="Asia/Jakarta"
      locale="id"
    />,
  );
}

describe('DayPanel', () => {
  it('golden: payday 1 Okt with its surplus, spending per category, and transactions; records on that day at 12.00', async () => {
    const { screen } = await renderPanel(dayOf('2026-10-01'));
    const panel = screen.getByRole('region', { name: 'Kamis, 1 Oktober 2026' });
    await expect.element(panel.getByText('4 transaksi')).toBeVisible();
    await expect.element(panel).toMatchTextContent(/\+Rp14\.000\.0007,4× rata-rata/);
    await expect
      .element(panel.getByRole('list', { name: 'Pengeluaran per kategori' }))
      .toMatchTextContent(/^Sewa KosRp4\.500\.000$/);
    const items = panel.getByRole('list', { name: 'Transaksi & jadwal' }).getByRole('listitem');
    await expect.element(items.nth(0)).toMatchTextContent(/^PT KinaryaGaji · BCA Tahapan · 08\.00\+Rp18\.500\.000$/);
    await expect.element(items.nth(1)).toMatchTextContent(/Sewa Kos.*#rumah−Rp4\.500\.000$/);
    await expect.element(items.nth(2)).toMatchTextContent(/^Ke Gotrade.*Rp6\.000\.000$/);
    await expect
      .element(panel.getByRole('link', { name: 'Buka di Transaksi' }))
      .toHaveAttribute('href', '/transactions?range=2026-10-01..2026-10-01');
    await panel.getByRole('button', { name: 'Catat di tanggal ini' }).click();
    expect(record.open).toHaveBeenCalledWith({ date: '2026-10-01', time: '12:00' });
  });

  it('fits the whole category · account · time · tag line beside the amount in the 340px side panel', async () => {
    const { screen } = await renderApp(
      <div style={{ width: 340 }}>
        <DayPanel
          day={dayOf('2026-10-01')}
          today={TODAY}
          averageMinor={606_000n}
          patternMonth={null}
          categories={CATEGORIES}
          accounts={ACCOUNTS}
          baseCurrency="IDR"
          timeZone="Asia/Jakarta"
          locale="id"
        />
      </div>,
    );
    const meta = screen.getByText(/· #rumah$/).element();
    expect(meta.scrollWidth).toBeLessThanOrEqual(meta.clientWidth);
  });

  it('shows a scheduled bill ahead with "Buka di Langganan", and no recording on a future day', async () => {
    const { screen } = await renderPanel(dayOf('2026-10-18'));
    const panel = screen.getByRole('region', { name: 'Minggu, 18 Oktober 2026' });
    await expect.element(panel.getByText('3 hari lagi · 1 terjadwal · akhir pekan')).toBeVisible();
    await expect
      .element(panel.getByText('Belum ada transaksi — pengeluaran baru tercatat saat kamu mencatatnya.'))
      .not.toBeInTheDocument();
    await expect.element(panel).toMatchTextContent(/NetflixLangganan · BCA Tahapan · terjadwal/);
    await expect
      .element(panel.getByRole('link', { name: 'Buka di Langganan' }))
      .toHaveAttribute('href', '/subscriptions?subscription=sub-netflix');
    await expect.element(panel.getByRole('button', { name: 'Catat di tanggal ini' })).not.toBeInTheDocument();
  });

  it('explains empty days, recurring transfers, income events, untitled and uncategorized spending', async () => {
    const quiet = await renderPanel(dayOf('2026-10-13'));
    await expect.element(quiet.screen.getByText('Belum ada transaksi')).toBeVisible();
    await expect.element(quiet.screen.getByText('Tidak ada transaksi di tanggal ini.')).toBeVisible();
    await quiet.screen.unmount();

    const future = await renderPanel({ ...dayOf('2026-10-16'), scheduled: [] });
    await expect
      .element(future.screen.getByText('Belum ada transaksi — pengeluaran baru tercatat saat kamu mencatatnya.'))
      .toBeVisible();
    await future.screen.unmount();

    const events = await renderPanel({
      ...dayOf('2026-10-25'),
      scheduled: [
        scheduledItem({
          sourceId: 'rec',
          sourceType: 'recurrence',
          dueDate: d('2026-10-25'),
          name: null,
          direction: 'transfer',
          accountId: 'gone',
        }),
        scheduledItem({
          sourceId: 'pay',
          sourceType: 'recurrence',
          dueDate: d('2026-10-25'),
          name: 'Gaji',
          direction: 'in',
        }),
      ],
    });
    const items = events.screen.getByRole('listitem');
    await expect.element(items.nth(0)).toMatchTextContent(/^TerjadwalTagihan rutin · terjadwalRp186\.000$/);
    await expect.element(items.nth(1)).toMatchTextContent(/^GajiTagihan rutin · BCA Tahapan · terjadwal\+Rp186\.000$/);
    await events.screen.unmount();

    const lunch = await renderPanel(dayOf('2026-10-11'));
    await expect
      .element(lunch.screen.getByRole('list', { name: 'Pengeluaran per kategori' }))
      .toMatchTextContent(/Tanpa kategoriRp50\.000/);
    await expect.element(lunch.screen.getByText('Tanpa catatan')).toBeVisible();
    await lunch.screen.unmount();

    const studio = dayOf('2026-10-14');
    const orphan = await renderPanel({ ...studio, rows: studio.rows.map((row) => ({ ...row, accountId: 'gone' })) });
    await expect
      .element(orphan.screen.getByRole('list', { name: 'Transaksi & jadwal' }).getByRole('listitem').first())
      .toMatchTextContent(/^Starbucks[^·]+· 10\.20−Rp48\.000$/);
  });

  it('shows a dividend’s tax and its rupiah value beside the amount', async () => {
    const studio = dayOf('2026-10-14');
    const dividend = {
      ...(studio.rows[0] as (typeof studio.rows)[number]),
      type: 'dividend' as const,
      currency: 'USD',
      amountMinor: 614n,
      amountBaseMinor: 110_734n,
      feeMinor: 92n,
      feeBaseMinor: 16_600n,
    };
    const feeInBase = {
      ...dividend,
      currency: 'IDR',
      amountMinor: 48_000n,
      amountBaseMinor: 48_000n,
      feeMinor: 16_000n,
      feeBaseMinor: 16_000n,
    };
    const { screen } = await renderPanel({ ...studio, rows: [dividend, feeInBase] });
    const items = screen.getByRole('list', { name: 'Transaksi & jadwal' }).getByRole('listitem');
    await expect.element(items.nth(0)).toMatchTextContent(/\+US\$6,14pajak & biaya −US\$0,92 · ≈ Rp94\.134$/);
    await expect.element(items.nth(1)).toMatchTextContent(/\+Rp48\.000pajak & biaya −Rp16\.000$/);
  });

  it('shows a projected payday of a month to come', async () => {
    const november = monthGrid('2026-11' as YearMonth, octoberInputs({ days: [], rows: [] }), octoberInputs()).flat();
    const first = november.find((detail) => detail.date === '2026-11-01') as DayDetail;
    const { screen } = await renderPanel(first, '2026-10' as YearMonth);
    await expect.element(screen.getByText('proyeksi')).toBeVisible();
    await expect
      .element(screen.getByText('Perkiraan dari pola Okt. Angka pasti muncul setelah kamu mencatat transaksinya.'))
      .toBeVisible();
    await expect
      .element(screen.getByRole('listitem'))
      .toMatchTextContent(/^PT KinaryaPemasukan rutin · proyeksi\+Rp18\.500\.000$/);
    await expect.element(screen.getByText('17 hari lagi · akhir pekan')).toBeVisible();
  });
});
