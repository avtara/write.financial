// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import type { ReportView } from '@wf/db/reports';
import { reportTotals, totalsDelta } from '@wf/domain/report';
import { FINAL_VIEW, PROVISIONAL_VIEW, TODAY } from '../../../test/report-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import { ReportsKpis } from './reports-kpis.tsx';

const zeroPrevious = {
  ...FINAL_VIEW,
  previous: reportTotals({ incomeMinor: 0n, expenseMinor: 0n, txCount: 0 }),
  delta: totalsDelta(FINAL_VIEW.totals, reportTotals({ incomeMinor: 0n, expenseMinor: 0n, txCount: 0 })),
} satisfies ReportView;

/** The income repeated exactly: a change of 0 bps renders as a neutral chip. */
const flatIncome = {
  ...FINAL_VIEW,
  previous: reportTotals({ incomeMinor: 25_800_000n, expenseMinor: 16_900_000n, txCount: 118 }),
  delta: totalsDelta(
    FINAL_VIEW.totals,
    reportTotals({ incomeMinor: 25_800_000n, expenseMinor: 16_900_000n, txCount: 118 }),
  ),
} satisfies ReportView;

/** Without income there is no savings rate; the tile reads "—". */
const noIncome = {
  ...FINAL_VIEW,
  totals: reportTotals({ incomeMinor: 0n, expenseMinor: 500_000n, txCount: 3 }),
  delta: null,
} satisfies ReportView;

describe('ReportsKpis edge cases', () => {
  it('renders a neutral chip for a 0 bps change', async () => {
    const { screen } = await renderApp(<ReportsKpis view={flatIncome} locale="id" today={TODAY} />);
    await expect.element(screen.getByRole('group', { name: 'Pemasukan' })).toMatchTextContent('0%');
  });

  it('reads "—" for the savings rate without income', async () => {
    const { screen } = await renderApp(<ReportsKpis view={noIncome} locale="id" today={TODAY} />);
    await expect.element(screen.getByRole('group', { name: 'Saving Rate' })).toMatchTextContent('—');
  });
});

describe('ReportsKpis', () => {
  it('shows the amounts with their relative changes and the rate change in points', async () => {
    const { screen } = await renderApp(<ReportsKpis view={FINAL_VIEW} locale="id" today={TODAY} />);
    const strip = screen.getByRole('group', { name: 'Pemasukan' });
    await expect.element(strip).toMatchTextContent('Rp25.800.000');
    await expect.element(strip).toMatchTextContent('+3,6%');
    await expect.element(strip).toMatchTextContent('vs Agustus 2026');
    await expect.element(screen.getByRole('group', { name: 'Pengeluaran' })).toMatchTextContent('Rp18.300.000');
    await expect.element(screen.getByRole('group', { name: 'Pengeluaran' })).toMatchTextContent('+8,3%');
    const saved = screen.getByRole('group', { name: 'Ditabung & Investasi' });
    await expect.element(saved).toMatchTextContent('+7.500.000');
    await expect.element(saved).toMatchTextContent('−6,3%');
    const rate = screen.getByRole('group', { name: 'Saving Rate' });
    await expect.element(rate).toMatchTextContent('29,1%');
    await expect.element(rate).toMatchTextContent('−3,1 poin');
    await expect.element(screen.getByRole('group', { name: 'Kekayaan bersih' })).toMatchTextContent('Rp112.200.000');
    await expect.element(screen.getByRole('group', { name: 'Kekayaan bersih' })).toMatchTextContent('per 30 Sep 2026');
  });

  it('uses the English copy and decimal point', async () => {
    const { screen } = await renderApp(<ReportsKpis view={FINAL_VIEW} locale="en" today={TODAY} />, {
      preferences: { locale: 'en' },
    });
    await expect.element(screen.getByRole('group', { name: 'Income' })).toMatchTextContent('vs August 2026');
    await expect.element(screen.getByRole('group', { name: 'Income' })).toMatchTextContent('+3.6%');
    await expect.element(screen.getByRole('group', { name: 'Saving rate' })).toMatchTextContent('−3.1 pts');
    await expect.element(screen.getByRole('group', { name: 'Net worth' })).toMatchTextContent('as of Sep 30, 2026');
  });

  it('keeps a provisional report honest: no comparison, no chips, and "—" for the unavailable net worth', async () => {
    const { screen } = await renderApp(<ReportsKpis view={PROVISIONAL_VIEW} locale="id" today={TODAY} />);
    const income = screen.getByRole('group', { name: 'Pemasukan' });
    await expect.element(income).toMatchTextContent('Rp70.000.000');
    await expect.element(income).toMatchTextContent('vs 1 Apr – 30 Jun');
    await expect.element(income).not.toMatchTextContent('%');
    await expect.element(screen.getByRole('group', { name: 'Saving Rate' })).toMatchTextContent('28,6%');
    const netWorth = screen.getByRole('group', { name: 'Kekayaan bersih' });
    await expect.element(netWorth).toMatchTextContent('—');
    await expect.element(netWorth).not.toMatchTextContent('per');
  });

  it('omits the chips of changes against an empty previous period and reads "—" without income', async () => {
    const { screen } = await renderApp(<ReportsKpis view={zeroPrevious} locale="id" today={TODAY} />);
    const income = screen.getByRole('group', { name: 'Pemasukan' });
    await expect.element(income).toMatchTextContent('vs Agustus 2026');
    await expect.element(income).not.toMatchTextContent('%');
    await expect.element(screen.getByRole('group', { name: 'Saving Rate' })).toMatchTextContent('29,1%');
    await expect.element(screen.getByRole('group', { name: 'Saving Rate' })).not.toMatchTextContent('poin');
  });
});
