// SPDX-License-Identifier: AGPL-3.0-only
import type { LocalDate } from '@wf/domain/period';
import { describe, expect, it } from 'vitest';
import { renderApp } from '../../../test/render.tsx';
import { transactionsView } from '../../../test/transaction-fixtures.ts';
import { TransactionSummary } from './summary.tsx';

const day = (date: string, outMinor: bigint) => ({ date: date as LocalDate, outMinor });

describe('TransactionSummary', () => {
  it('shows Masuk, Keluar, Transfer (not counted), and the average per day so far', async () => {
    const view = transactionsView([], {
      today: '2026-10-02' as LocalDate,
      summary: {
        inMinor: 18_500_000n,
        outMinor: 16_500_000n,
        transferMinor: 3_000_000n,
        inCount: 2,
        outCount: 41,
        transferCount: 3,
        // The day after today does not lower the average.
        dailySpend: [day('2026-10-01', 1_000_000n), day('2026-10-02', 1_200_000n), day('2026-10-03', 0n)],
        averageDailySpendMinor: 0n,
      },
    });
    const { screen } = await renderApp(<TransactionSummary view={view} currency="IDR" />);
    const summary = screen.getByRole('region', { name: 'Ringkasan transaksi' });
    await expect.element(summary.getByRole('heading', { name: 'Masuk' })).toBeVisible();
    await expect.element(summary.getByText('Rp18.500.000')).toBeVisible();
    const income = summary.getByText('Rp18.500.000').element().parentElement;
    expect(income?.textContent).toBe('+Rp18.500.000');
    expect(income?.classList.contains('text-green-fg')).toBe(true);
    await expect.element(summary.getByText('2 transaksi', { exact: true })).toBeVisible();
    await expect.element(summary.getByRole('heading', { name: 'Keluar' })).toBeVisible();
    await expect.element(summary.getByText('−Rp16.500.000')).toBeVisible();
    await expect.element(summary.getByText('41 transaksi', { exact: true })).toBeVisible();
    await expect.element(summary.getByText('Rp3.000.000')).toBeVisible();
    await expect.element(summary.getByText('3 transaksi · tidak dihitung')).toBeVisible();
    const daily = summary.getByRole('heading', { name: /Pengeluaran harian/ });
    await expect.element(daily).toMatchTextContent(/rata-rata/);
    await expect.element(daily.getByText('Rp1.100.000')).toBeVisible();
    await expect.element(summary.getByRole('img', { name: 'Grafik pengeluaran harian, 3 hari' })).toBeVisible();
  });

  it('averages zero before the first day', async () => {
    const view = transactionsView([], {
      today: '2026-09-30' as LocalDate,
      summary: { ...transactionsView([]).summary, dailySpend: [day('2026-10-01', 0n)] },
    });
    const { screen } = await renderApp(<TransactionSummary view={view} currency="IDR" />, {
      preferences: { locale: 'en' },
    });
    await expect.element(screen.getByRole('heading', { name: /Daily spending/ }).getByText('Rp0')).toBeVisible();
  });
});
