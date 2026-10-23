// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import type { ReportNetWorth, ReportView } from '@wf/db/reports';
import type { LocalDate } from '@wf/domain/period';
import { FINAL_VIEW, PROVISIONAL_VIEW } from '../../../test/report-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import { NetWorthSection } from './reports-networth.tsx';

const rectCount = () => document.querySelectorAll('svg rect').length;

describe('NetWorthSection', () => {
  it('shows the total, its breakdown, and the honesty notes of the partial valuation', async () => {
    const { screen } = await renderApp(<NetWorthSection view={FINAL_VIEW} locale="id" />);
    const section = screen.getByRole('region', { name: 'Kekayaan bersih' });
    await expect.element(section).toMatchTextContent('Rp112.200.000');
    await expect.element(section).toMatchTextContent('per 30 Sep 2026');
    await expect.element(section).toMatchTextContent('Kas & rekening');
    await expect.element(section).toMatchTextContent('Rp54.500.000');
    await expect.element(section).toMatchTextContent('Investasi');
    await expect.element(section).toMatchTextContent('Rp57.700.000');
    await expect.element(section).not.toMatchTextContent('Utang');
    await expect.element(section).toMatchTextContent('USD tidak dihitung karena tidak ada kurs pada akhir periode.');
  });

  it('draws the history with gaps for the months without a snapshot', async () => {
    await renderApp(<NetWorthSection view={FINAL_VIEW} locale="id" />);
    await expect.poll(rectCount).toBe(3);
    await expect.poll(() => document.body.textContent.includes('Apr')).toBe(true);
    await expect.poll(() => document.body.textContent.includes('Sep')).toBe(true);
  });

  it('draws a descending history and stays quiet for a complete valuation', async () => {
    const base = FINAL_VIEW.sections.netWorth as ReportNetWorth;
    const descending = {
      ...FINAL_VIEW,
      sections: {
        ...FINAL_VIEW.sections,
        netWorth: { ...base, unvaluedCurrencies: [] },
        netWorthHistory: [
          { date: '2026-08-31' as LocalDate, valuation: { ...base, valueMinor: 120_000_000n } },
          { date: '2026-09-30' as LocalDate, valuation: base },
        ],
      },
    } satisfies ReportView;
    const { screen } = await renderApp(<NetWorthSection view={descending} locale="id" />);
    const section = screen.getByRole('region', { name: 'Kekayaan bersih' });
    await expect.element(section).toMatchTextContent('Rp112.200.000');
    await expect.element(section).not.toMatchTextContent('tidak dihitung');
    await expect.poll(rectCount).toBe(2);
  });

  it('reports the missing portfolio history', async () => {
    const base = FINAL_VIEW.sections.netWorth as ReportNetWorth;
    const missing = {
      ...FINAL_VIEW,
      sections: { ...FINAL_VIEW.sections, netWorth: { ...base, missingPortfolio: true } },
    } satisfies ReportView;
    const { screen } = await renderApp(<NetWorthSection view={missing} locale="id" />);
    await expect.element(screen.getByText('Sebagian nilai tidak dapat dihitung untuk tanggal ini.')).toBeVisible();
  });

  it('shows the debt line when principal is owed', async () => {
    const base = FINAL_VIEW.sections.netWorth as ReportNetWorth;
    const withDebt = {
      ...FINAL_VIEW,
      sections: { ...FINAL_VIEW.sections, netWorth: { ...base, debtMinor: 2_000_000n } },
    } satisfies ReportView;
    const { screen } = await renderApp(<NetWorthSection view={withDebt} locale="id" />);
    await expect.element(screen.getByRole('region', { name: 'Kekayaan bersih' })).toMatchTextContent('Utang');
    await expect.element(screen.getByRole('region', { name: 'Kekayaan bersih' })).toMatchTextContent('−2.000.000');
  });

  it('reads "—" and the explanation when nothing could be valued, and draws no chart', async () => {
    const { screen } = await renderApp(<NetWorthSection view={PROVISIONAL_VIEW} locale="id" />);
    const section = screen.getByRole('region', { name: 'Kekayaan bersih' });
    await expect.element(section).toMatchTextContent('—');
    await expect.element(screen.getByText('Sebagian nilai tidak dapat dihitung untuk tanggal ini.')).toBeVisible();
    expect(rectCount()).toBe(0);
  });
});
