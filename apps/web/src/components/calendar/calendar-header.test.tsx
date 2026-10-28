// SPDX-License-Identifier: AGPL-3.0-only
import type { LocalDate } from '@wf/domain/period';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { renderApp } from '../../../test/render.tsx';
import { CalendarHeader, calendarSearch } from './calendar-header.tsx';

const record = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock('../ledger/record-transaction.tsx', () => ({ useRecordTransaction: () => record }));

const d = (value: string) => value as LocalDate;
const TODAY = d('2026-10-15');

afterEach(async () => {
  await page.viewport(414, 896);
});

describe('CalendarHeader', () => {
  it('links the views and the previous and next month; records a transaction', async () => {
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
    await screen.getByRole('button', { name: 'Catat Transaksi' }).click();
    expect(record.open).toHaveBeenCalledWith();
  });

  it('folds "Hari ini" into ⋯ on a portrait tablet and goes back to today', async () => {
    const { screen, router } = await renderApp(
      <CalendarHeader view="month" date={d('2026-11-03')} today={TODAY} locale="id" description="" />,
    );
    await expect.element(screen.getByRole('button', { name: 'Hari ini', includeHidden: true })).not.toBeVisible();
    await expect.element(screen.getByRole('button', { name: 'Catat Transaksi' })).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Aksi lainnya' }));
    await userEvent.click(page.getByRole('menuitem', { name: 'Hari ini' }));
    await expect.poll(() => router.state.location.pathname).toBe('/calendar');
    expect(router.state.location.search).toEqual({});
  });

  it('shows "Hari ini" as a button from 1024 px, keeping the view', async () => {
    await page.viewport(1440, 900);
    const { screen, router } = await renderApp(
      <CalendarHeader view="week" date={d('2026-11-03')} today={TODAY} locale="id" description="" />,
    );
    await expect.element(screen.getByRole('button', { name: 'Aksi lainnya', includeHidden: true })).not.toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Hari ini' }));
    await expect.poll(() => router.state.location.pathname).toBe('/calendar');
    expect(router.state.location.search).toEqual({ view: 'week' });
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
