// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { budgetLine, budgetStatus } from '../../../test/budget-fixtures.ts';
import { dashboard, FOOD_ID, RENT_ID, weekDashboard } from '../../../test/dashboard-fixtures.ts';
import { CATEGORIES } from '../../../test/ledger-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import { CategorySpendingCard } from './category-spending-card.tsx';

describe('CategorySpendingCard', () => {
  it('shows each budget line of the period with its note, then the unbudgeted spending', async () => {
    const status = budgetStatus({
      lines: [
        budgetLine({ categoryId: FOOD_ID, state: 'warning', safeDailyMinor: 19_000n }),
        budgetLine({
          categoryId: RENT_ID,
          name: 'Sewa',
          isFixed: true,
          limitMinor: 4_500_000n,
          spentMinor: 4_500_000n,
          state: 'paid',
        }),
      ],
    });
    const { screen } = await renderApp(
      <CategorySpendingCard
        dashboard={dashboard()}
        budget={status}
        categories={CATEGORIES}
        locale="id"
        caption="1–31 Oktober 2026"
      />,
    );
    const region = screen.getByRole('region', { name: 'Pengeluaran per Kategori' });
    await expect.element(region.getByText('4 kategori · 1–31 Oktober 2026')).toBeVisible();
    await expect.element(region.getByRole('listitem').first()).toMatchTextContent('KebutuhanRp7.700.000');
    const food = region.getByRole('link', { name: /^Makan/ });
    await expect.element(food).toMatchTextContent('3.200.000 / 3.500.000');
    await expect.element(food).toMatchTextContent('sisa Rp300.000 · Rp19.000/hari');
    await expect.element(food).toHaveAttribute('href', `/transactions?period=2026-10&category=${FOOD_ID}`);
    await expect.element(region.getByRole('link', { name: /^Sewa/ })).toMatchTextContent('Tetap');
    await expect.element(region.getByRole('link', { name: /^Sewa/ })).toMatchTextContent('lunas');
    await expect
      .element(region.getByRole('link', { name: /^Tanpa kategori/ }))
      .toHaveAttribute('href', '/transactions?period=2026-10&uncategorized=true');
    await expect
      .element(region.getByRole('link').filter({ has: region.getByText('Belanja', { exact: true }) }))
      .toMatchTextContent('14,55% dari pengeluaran');
    await expect.element(region.getByRole('link', { name: 'Anggaran' })).toHaveAttribute('href', '/budget');
  });

  it('uses the dashboard’s scaled lines outside a month', async () => {
    const { screen } = await renderApp(
      <CategorySpendingCard
        dashboard={weekDashboard()}
        budget={null}
        categories={CATEGORIES}
        locale="id"
        caption="12–18 Okt"
      />,
    );
    await expect
      .element(screen.getByRole('link').filter({ has: screen.getByText('Belanja', { exact: true }) }))
      .toMatchTextContent('lewat Rp400.000');
    await expect.element(screen.getByRole('link', { name: /^Makan & Dapur/ })).toMatchTextContent('sisa Rp300.000');
    await expect.element(screen.getByRole('link', { name: /^Sewa Kos/ })).toMatchTextContent('belum terpakai');
  });

  it('says so without spending', async () => {
    const quiet = dashboard({ budget: null, categories: [], flow: { incomes: [], expenses: [], transfers: [] } });
    const { screen } = await renderApp(
      <CategorySpendingCard dashboard={quiet} budget={null} categories={CATEGORIES} locale="id" caption="Okt" />,
    );
    await expect.element(screen.getByText('Belum ada pengeluaran di rentang ini.')).toBeVisible();
    expect(screen.getByText('Kebutuhan').query()).toBeNull();
  });
});
