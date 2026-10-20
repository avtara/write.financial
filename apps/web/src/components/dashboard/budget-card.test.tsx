// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { dashboard, weekDashboard, yearDashboard } from '../../../test/dashboard-fixtures.ts';
import { CATEGORIES } from '../../../test/ledger-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import { BudgetCard } from './budget-card.tsx';

describe('BudgetCard', () => {
  it('lists the fullest lines first with "1 lewat batas"', async () => {
    const { screen } = await renderApp(<BudgetCard dashboard={dashboard()} categories={CATEGORIES} locale="id" />);
    const region = screen.getByRole('region', { name: 'Anggaran Kategori' });
    await expect.element(region.getByText('Terpakai dari batas bulanan')).toBeVisible();
    await expect.element(region.getByText('1 lewat batas')).toBeVisible();
    const items = region.getByRole('listitem').elements();
    expect(items.map((item) => item.textContent)).toEqual([
      'Belanja OnlineRp2.400.000 / 2.000.000',
      'Makan & DapurRp3.200.000 / 3.500.000',
      'Sewa KosRp0 / 4.500.000',
    ]);
    await expect.element(region.getByRole('link', { name: 'Lihat semua anggaran' })).toHaveAttribute('href', '/budget');
  });

  it('keeps lines without a limit and leaves out lines of missing categories', async () => {
    const base = dashboard().budget?.lines ?? [];
    const lines = [
      { categoryId: 'cat-health', limitMinor: 0n, spentMinor: 0n, usedBps: null, state: 'unused' as const },
      ...base,
      { categoryId: 'gone', limitMinor: 1n, spentMinor: 1n, usedBps: 10_000, state: 'ok' as const },
    ];
    const { screen } = await renderApp(
      <BudgetCard dashboard={dashboard({ budget: { lines, overCount: 1 } })} categories={CATEGORIES} locale="id" />,
    );
    const items = screen.getByRole('listitem').elements();
    expect(items).toHaveLength(4);
    expect(items.filter((item) => item.textContent.startsWith('Kesehatan'))).toHaveLength(1);
  });

  it('names the week’s and the year’s budget', async () => {
    const { screen } = await renderApp(
      <>
        <BudgetCard dashboard={weekDashboard()} categories={CATEGORIES} locale="id" />
        <BudgetCard dashboard={yearDashboard()} categories={CATEGORIES} locale="id" />
      </>,
    );
    await expect.element(screen.getByRole('heading', { name: 'Anggaran Minggu Ini' })).toBeVisible();
    await expect.element(screen.getByText('Jatah mingguan dari batas bulanan')).toBeVisible();
    await expect.element(screen.getByRole('heading', { name: 'Anggaran 2026' })).toBeVisible();
    await expect.element(screen.getByText('Terpakai dari batas bulan-bulan yang sudah berjalan')).toBeVisible();
  });

  it('leads to Anggaran without a budget', async () => {
    const empty = dashboard({ budget: null });
    const { screen } = await renderApp(<BudgetCard dashboard={empty} categories={CATEGORIES} locale="id" />);
    await expect.element(screen.getByText('Belum ada anggaran untuk periode ini.')).toBeVisible();
    await expect.element(screen.getByRole('link', { name: 'Atur anggaran' })).toHaveAttribute('href', '/budget');
    expect(screen.getByText('lewat batas').query()).toBeNull();
    const calm = dashboard({ budget: { lines: [], overCount: 0 } });
    const { screen: second } = await renderApp(<BudgetCard dashboard={calm} categories={CATEGORIES} locale="id" />);
    expect(second.getByText('lewat batas').query()).toBeNull();
  });
});
