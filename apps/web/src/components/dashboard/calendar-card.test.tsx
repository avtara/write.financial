// SPDX-License-Identifier: AGPL-3.0-only
import type { LocalDate, YearMonth } from '@wf/domain/period';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import {
  dashboard,
  FOOD_ID,
  scheduledItem,
  weekDashboard,
  yearDashboard,
  day,
} from '../../../test/dashboard-fixtures.ts';
import { CATEGORIES } from '../../../test/ledger-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import { transactionRow } from '../../../test/transaction-fixtures.ts';
import { CalendarCard, type CalendarCardProps } from './calendar-card.tsx';

const fns = vi.hoisted(() => ({ listTransactionRows: vi.fn() }));
vi.mock('../../server/fn/transactions.ts', () => fns);

const NAVIGATION = { label: 'Okt 2026', previous: { period: '2026-09' as YearMonth }, next: null };

function renderCalendar(props: Partial<CalendarCardProps> = {}) {
  return renderApp(
    <CalendarCard
      dashboard={dashboard()}
      categories={CATEGORIES}
      scheduled={[
        scheduledItem({ sourceId: 'netflix', dueDate: '2026-10-18' as LocalDate }),
        scheduledItem({ sourceId: 'spotify', dueDate: '2026-10-18' as LocalDate, name: null }),
        scheduledItem({ sourceId: 'salary', dueDate: '2026-10-25' as LocalDate, direction: 'in' }),
        scheduledItem({ sourceId: 'past', dueDate: '2026-10-03' as LocalDate }),
        scheduledItem({ sourceId: 'chatgpt', dueDate: '2026-10-28' as LocalDate, name: null }),
      ]}
      periodLabels={['2026-10', '2026-09'] as YearMonth[]}
      navigation={NAVIGATION}
      locale="id"
      timeZone="Asia/Jakarta"
      {...props}
    />,
  );
}

beforeEach(async () => {
  await page.viewport(1440, 900);
  fns.listTransactionRows.mockResolvedValue({ ok: true, value: { rows: [], total: 0, balances: null } });
});

afterEach(() => {
  vi.resetAllMocks();
});

describe('CalendarCard', () => {
  it('opens on the costliest day with its transactions', async () => {
    fns.listTransactionRows.mockResolvedValue({
      ok: true,
      value: {
        rows: [
          transactionRow('t1', {
            merchant: 'Erafone',
            description: 'Headphone',
            categoryId: FOOD_ID,
            tags: ['gadget'],
            amountBaseMinor: -2_150_000n,
            occurredAt: new Date('2026-10-01T07:12:00Z'),
          }),
          transactionRow('t2', {
            type: 'transfer',
            merchant: null,
            description: null,
            categoryId: null,
            amountBaseMinor: -500_000n,
          }),
          transactionRow('t3', { merchant: null, description: '', categoryId: null, type: 'expense' }),
          transactionRow('t4', { merchant: null, description: null, categoryId: FOOD_ID, type: 'expense' }),
        ],
        total: 3,
        balances: null,
      },
    });
    const { screen } = await renderCalendar();
    const region = screen.getByRole('region', { name: 'Kalender Pengeluaran' });
    await expect.element(region).toMatchTextContent('Total harian · rata-rata Rp1.100.000/hari');
    await expect.element(region.getByRole('heading', { name: 'Kamis, 1 Oktober' })).toBeVisible();
    await expect.element(region.getByText('terboros bulan ini')).toBeVisible();
    await expect.element(region.getByRole('link', { name: /Erafone — Headphone/ })).toMatchTextContent('#gadget');
    await expect.element(region.getByRole('link', { name: /Erafone/ })).toMatchTextContent('14.12');
    await expect.element(region.getByRole('link', { name: /Transfer/ })).toBeVisible();
    await expect.element(region.getByRole('link', { name: /Tanpa kategori/ }).last()).toBeVisible();
    expect(fns.listTransactionRows).toHaveBeenCalledWith({ data: { range: '2026-10-01..2026-10-01', offset: 0 } });
    await expect.element(region.getByRole('link', { name: 'Sebelumnya' })).toHaveAttribute('href', '/?period=2026-09');
    await expect.element(region.getByRole('link', { name: 'Berikutnya' })).toHaveAttribute('aria-disabled', 'true');
  });

  it('moves through the days with the keyboard and shows another day, the bills ahead, or a failure', async () => {
    fns.listTransactionRows.mockResolvedValueOnce({ ok: true, value: { rows: [], total: 0, balances: null } });
    fns.listTransactionRows.mockResolvedValueOnce({ ok: false, code: 'INTERNAL' });
    fns.listTransactionRows.mockRejectedValueOnce(new TypeError('offline'));
    const { screen } = await renderCalendar();
    const first = screen.getByRole('button', { name: /^Kamis, 1 Oktober/ });
    await expect.element(first).toHaveAttribute('tabindex', '0');
    await expect.element(screen.getByText('Tidak ada transaksi di hari ini.')).toBeVisible();
    (first.element() as HTMLButtonElement).focus();
    await userEvent.keyboard('{ArrowRight}');
    await expect.element(screen.getByRole('button', { name: /^Jumat, 2 Oktober/ })).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}{ArrowLeft}{ArrowUp}{End}{Home}{ArrowRight}{Enter}');
    await expect.element(screen.getByText('Transaksi hari ini tidak bisa dimuat.')).toBeVisible();
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}{ArrowRight}{ArrowRight}{ArrowRight}');
    await userEvent.keyboard('a');
    await userEvent.click(screen.getByRole('button', { name: /^Minggu, 11 Oktober/ }));
    await expect.element(screen.getByText('Transaksi hari ini tidak bisa dimuat.')).toBeVisible();
    await expect.element(screen.getByText('3× rata-rata')).toBeVisible();
    // The days ahead show their bills.
    await expect.element(screen.getByRole('button', { name: /^Minggu, 18 Oktober/ })).toMatchTextContent('Netflix +1');
    await userEvent.click(screen.getByRole('button', { name: /^Minggu, 18 Oktober/ }));
    await expect.element(screen.getByText('Tagihan', { exact: true }).last()).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: /^Kamis, 22 Oktober/ }));
    await expect.element(screen.getByText('Tidak ada tagihan terjadwal.')).toBeVisible();
    await expect.element(screen.getByRole('button', { name: /^Kamis, 15 Oktober/ })).toMatchTextContent('Hari ini');
    await expect.element(screen.getByRole('button', { name: /^Rabu, 14 Oktober/ })).toMatchTextContent('+5.489.000');
  });

  it('shows a week in one taller row, nothing to pick without spending', async () => {
    fns.listTransactionRows.mockResolvedValue({ ok: true, value: { rows: [], total: 0, balances: null } });
    const quiet = weekDashboard({ calendar: { days: [day('2026-10-13', 0n, 5n)], averageDailySpendMinor: 0n } });
    const { screen } = await renderCalendar({ dashboard: quiet, scheduled: null });
    expect(screen.getByRole('row').elements()).toHaveLength(2);
    await expect.element(screen.getByText('Pilih tanggal untuk melihat rincian transaksinya')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: /^Senin, 12 Oktober/ }));
    await expect.element(screen.getByRole('heading', { name: 'Senin, 12 Oktober' })).toBeVisible();
    await expect.element(screen.getByText('0 transaksi')).toBeVisible();
  });

  it('calls the costliest day of a week so, and names a nameless single bill', async () => {
    const { screen } = await renderCalendar({
      dashboard: weekDashboard({ calendar: { days: [day('2026-10-13', 290_000n)], averageDailySpendMinor: 72_500n } }),
    });
    await expect.element(screen.getByText('terboros minggu ini')).toBeVisible();
    const { screen: month } = await renderCalendar();
    await expect
      .element(month.getByRole('button', { name: /^Rabu, 28 Oktober/ }).last())
      .toMatchTextContent('28Tagihan');
  });

  it('shows a year as mini months with its insights', async () => {
    const year = yearDashboard({
      calendar: {
        days: [day('2026-09-09', 1_650_000n), day('2026-10-11', 3_380_000n), day('2026-10-01', 0n, 9_000_000n)],
        averageDailySpendMinor: 17_000n,
      },
    });
    const { screen } = await renderCalendar({ dashboard: year });
    await expect.element(screen.getByRole('heading', { name: 'Kalender 2026' })).toBeVisible();
    await expect.element(screen.getByRole('link', { name: /^Sep/ })).toHaveAttribute('href', '/?period=2026-09');
    expect(screen.getByRole('link', { name: /^Agu/ }).query()).toBeNull();
    await expect.element(screen.getByRole('listitem').filter({ hasText: 'Nov' })).toMatchTextContent('—');
    await expect.element(screen.getByText(/Minggu, 11 Oktober · /)).toBeVisible();
    await expect.element(screen.getByText(/September · /)).toBeVisible();
    await expect.element(screen.getByText(/× lebih boros dari hari kerja/)).toBeVisible();
    expect(fns.listTransactionRows).not.toHaveBeenCalled();
    const empty = yearDashboard({ calendar: { days: [], averageDailySpendMinor: 0n } });
    const { screen: second } = await renderCalendar({ dashboard: empty });
    expect(second.getByText('—').elements().length).toBeGreaterThanOrEqual(3);
    expect(page).toBeDefined();
  });
});
