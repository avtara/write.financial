// SPDX-License-Identifier: AGPL-3.0-only
import type { LocalDate } from '@wf/domain/period';
import { describe, expect, it, vi } from 'vitest';
import { renderApp } from '../../../test/render.tsx';
import { CalendarHeader, calendarSearch } from './calendar-header.tsx';

const record = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock('../ledger/record-transaction.tsx', () => ({ useRecordTransaction: () => record }));

const d = (value: string) => value as LocalDate;
const TODAY = d('2026-10-15');

describe('CalendarHeader', () => {
  it('links the views, the previous and next month, and today; records a transaction', async () => {
    const { screen } = await renderApp(
      <CalendarHeader view="month" date={d('2026-11-03')} today={TODAY} locale="id" description="Bulan depan" />,
    );
    await expect.element(screen.getByRole('heading', { level: 1, name: 'Kalender' })).toBeVisible();
    await expect.element(screen.getByText('Bulan depan')).toBeVisible();
    const views = screen.getByRole('navigation', { name: 'Tampilan kalender' });
    await expect
      .element(views.getByRole('link', { name: 'Minggu' }))
      .toHaveAttribute('href', '/calendar?view=week&date=2026-11-03');
    await expect.element(views.getByRole('link', { name: 'Bulan' })).toHaveAttribute('aria-current', 'page');
    await expect
      .element(screen.getByRole('link', { name: 'Sebelumnya' }))
      .toHaveAttribute('href', '/calendar?date=2026-10-01');
    await expect
      .element(screen.getByRole('link', { name: 'Berikutnya' }))
      .toHaveAttribute('href', '/calendar?date=2026-12-01');
    await expect.element(screen.getByText('November 2026')).toBeVisible();
    await expect.element(screen.getByRole('link', { name: 'Hari ini' })).toHaveAttribute('href', '/calendar');
    await screen.getByRole('button', { name: 'Catat Transaksi' }).click();
    expect(record.open).toHaveBeenCalledWith();
  });

  it('steps a week or a year and titles them', async () => {
    const week = await renderApp(<CalendarHeader view="week" date={TODAY} today={TODAY} locale="id" description="" />);
    await expect.element(week.screen.getByText('12–18 Okt')).toBeVisible();
    await expect
      .element(week.screen.getByRole('link', { name: 'Sebelumnya' }))
      .toHaveAttribute('href', '/calendar?view=week&date=2026-10-05');
    await week.screen.unmount();
    const year = await renderApp(<CalendarHeader view="year" date={TODAY} today={TODAY} locale="id" description="" />);
    await expect.element(year.screen.getByText('2026', { exact: true })).toBeVisible();
    await expect
      .element(year.screen.getByRole('link', { name: 'Berikutnya' }))
      .toHaveAttribute('href', '/calendar?view=year&date=2027-01-01');
    expect(calendarSearch('month', TODAY, TODAY)).toEqual({});
  });
});
