// SPDX-License-Identifier: AGPL-3.0-only
import type { LocalDate } from '@wf/domain/period';
import { describe, expect, it, vi } from 'vitest';
import { OCTOBER_DAYS } from '../../../test/calendar-fixtures.ts';
import { day } from '../../../test/dashboard-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import { YearView } from './year-view.tsx';

// The header's record button (imported for its links) loads server code the browser has no use for.
vi.mock('../ledger/record-transaction.tsx', () => ({ useRecordTransaction: () => ({ open: vi.fn() }) }));

const TODAY = '2026-10-15' as LocalDate;
const SEPTEMBER = [day('2026-09-01', 4_000_000n, 18_500_000n), day('2026-09-12', 14_300_000n)];

describe('YearView', () => {
  it('golden: the year’s totals, costliest month and day, twelve months and the trend', async () => {
    const { screen } = await renderApp(
      <YearView year={2026} days={[...SEPTEMBER, ...OCTOBER_DAYS]} today={TODAY} baseCurrency="IDR" locale="id" />,
    );
    const kpis = screen.getByRole('region', { name: 'Ringkasan kalender' });
    await expect.element(kpis).toMatchTextContent(/Keluar 2026−Rp27\.390\.000rata-rata Rp13\.695\.000\/bulan/);
    await expect.element(kpis).toMatchTextContent(/Masuk 2026\+Rp43\.250\.000/);
    await expect.element(kpis).toMatchTextContent(/DitabungRp15\.860\.00036,7% dari pemasukan/);
    await expect.element(kpis).toMatchTextContent(/Bulan termahalSeptemberRp18\.300\.000/);
    await expect.element(kpis).toMatchTextContent(/Hari termahal12 SepRp14\.300\.000$/);
    const months = screen.getByRole('list', { name: 'Bulan-bulan 2026' }).getByRole('link');
    expect(months.elements()).toHaveLength(12);
    await expect.element(months.nth(9)).toHaveAttribute('aria-current', 'date');
    await expect.element(months.nth(9)).toMatchTextContent(/^Oktoberberjalan−Rp9\.090\.000/);
    await expect.element(months.nth(9)).toHaveAttribute('href', '/calendar?date=2026-10-01');
    await expect.element(months.nth(0)).toMatchTextContent(/^Januari—/);
    await expect.element(months.nth(10)).toHaveAttribute('data-future', 'true');
    expect(months.nth(9).element().querySelectorAll('rect.fill-green').length).toBeGreaterThan(0);
    const trend = screen.getByRole('region', { name: 'Tren bulanan 2026' });
    await expect.element(trend).toMatchTextContent(/Sep1,1%Okt63,3%Nov—/);
  });

  it('shows dashes for a year without data', async () => {
    const { screen } = await renderApp(<YearView year={2025} days={[]} today={TODAY} baseCurrency="IDR" locale="id" />);
    const kpis = screen.getByRole('region', { name: 'Ringkasan kalender' });
    await expect
      .element(kpis)
      .toMatchTextContent(/Keluar 2025Rp0Masuk 2025Rp0DitabungRp0Bulan termahal—Hari termahal—$/);
  });
});
