// SPDX-License-Identifier: AGPL-3.0-only
import type { BudgetStatus } from '@wf/db/budgets';
import { describe, expect, it, vi } from 'vitest';
import { budgetLine, budgetStatus, FOOD, FUN, RENT, SHOPPING, TRANSPORT } from '../../../test/budget-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import { BudgetAttention } from './budget-attention.tsx';

async function renderAttention(status: BudgetStatus) {
  const handlers = { onCover: vi.fn(), onRaise: vi.fn(), onDismiss: vi.fn(), onRestore: vi.fn() };
  const { screen } = await renderApp(<BudgetAttention status={status} {...handlers} />);
  return { screen, region: screen.getByRole('region', { name: /Perlu perhatian/ }), ...handlers };
}

describe('BudgetAttention', () => {
  it('lists the overspent line first with its suggested source, then the warning', async () => {
    const { region, onCover, onRaise, onDismiss } = await renderAttention(budgetStatus());
    await expect.element(region.getByRole('heading', { name: 'Perlu perhatian 2' })).toBeVisible();
    const over = region.getByRole('listitem').nth(0);
    const warning = region.getByRole('listitem').nth(1);
    await expect.element(over.getByRole('heading')).toHaveTextContent('Belanja Online lewat Rp400.000');
    await expect.element(over.getByText('Tutup dari sisa Hiburan (Rp400.000).')).toBeVisible();
    await over.getByRole('button', { name: 'Pindahkan Rp400.000' }).click();
    expect(onCover).toHaveBeenCalledWith(SHOPPING, [{ categoryId: 'fun', amountMinor: 400_000n }]);

    await expect.element(warning.getByRole('heading')).toHaveTextContent('Makan 91,43% di hari ke-15');
    await expect
      .element(warning.getByText('Proyeksi Rp6.600.000. Batasi Rp18.000/hari atau naikkan batas.'))
      .toBeVisible();
    await warning.getByRole('button', { name: 'Naikkan batas' }).click();
    expect(onRaise).toHaveBeenCalledWith(FOOD);
    await region.getByRole('button', { name: 'Abaikan peringatan Makan sampai akhir periode' }).click();
    expect(onDismiss).toHaveBeenCalledWith(FOOD);
    await expect.element(region.getByText(/diabaikan sampai akhir bulan/)).not.toBeInTheDocument();
  });

  it('names several sources, explains a fixed warning, and restores the dismissed ones', async () => {
    const big = budgetLine({
      categoryId: 'big',
      group: 'wants',
      name: 'Liburan',
      limitMinor: 1_000_000n,
      spentMinor: 2_500_000n,
      state: 'over',
    });
    const bills = budgetLine({
      categoryId: 'bills',
      name: 'Tagihan',
      limitMinor: 1_000_000n,
      spentMinor: 900_000n,
      safeDailyMinor: null,
      isFixed: true,
      state: 'warning',
    });
    const dismissedTransport = { ...TRANSPORT, dismissed: true };
    const dismissedFun = { ...FUN, dismissed: true };
    const { region, onRestore } = await renderAttention(
      budgetStatus({
        lines: [FOOD, dismissedTransport, dismissedFun, big, bills],
        attention: [
          { categoryId: 'bills', reason: 'warning' },
          { categoryId: 'big', reason: 'over' },
        ],
      }),
    );
    await expect
      .element(
        region.getByText('Tutup dari sisa Hiburan (Rp1.000.000), Transportasi (Rp400.000) dan Makan (Rp100.000).'),
      )
      .toBeVisible();
    await expect.element(region.getByRole('button', { name: 'Pindahkan Rp1.500.000' })).toBeVisible();
    await expect.element(region.getByText('Sisa Rp100.000 untuk biaya tetap ini.')).toBeVisible();
    await expect.element(region.getByText('2 diabaikan sampai akhir bulan · Transportasi, Hiburan')).toBeVisible();
    await region.getByRole('button', { name: 'Tampilkan' }).click();
    expect(onRestore).toHaveBeenCalledWith([dismissedTransport, dismissedFun]);
  });

  it('has no move without a source and confirms when nothing needs attention', async () => {
    const first = await renderAttention(
      budgetStatus({ lines: [SHOPPING, RENT], attention: [{ categoryId: 'shopping', reason: 'over' }] }),
    );
    await expect.element(first.region.getByText('Tidak ada sisa di kategori lain untuk menutupnya.')).toBeVisible();
    await expect.element(first.region.getByRole('button', { name: /^Pindahkan/ })).not.toBeInTheDocument();
    await expect.element(first.region.getByRole('button', { name: /^Abaikan/ })).toBeVisible();

    await first.screen.unmount();
    const second = await renderAttention(budgetStatus({ attention: [] }));
    await expect.element(second.region.getByRole('heading', { name: 'Perlu perhatian', exact: true })).toBeVisible();
    await expect.element(second.region.getByText('Semua kategori masih aman.')).toBeVisible();
  });
});
