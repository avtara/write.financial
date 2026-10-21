// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import { renderApp } from '../../../test/render.tsx';
import { GoalsEmpty } from './goals-empty.tsx';

describe('GoalsEmpty', () => {
  it('explains goals and offers the first one and four templates (Dana Darurat ±Rp54.000.000)', async () => {
    const onCreate = vi.fn();
    const { screen } = await renderApp(
      <GoalsEmpty averageSpendingMinor={18_000_000n} currency="IDR" locale="id" onCreate={onCreate} />,
    );
    await expect.element(screen.getByText('Belum ada tujuan tabungan')).toBeVisible();
    await expect.element(screen.getByText('Disarankan 3× pengeluaran bulanan · ±Rp54.000.000')).toBeVisible();
    await expect.element(screen.getByText('Tentukan tujuan & tenggat, kami hitung setoran per bulan')).toBeVisible();
    await expect.element(screen.getByText('Jangka panjang — bisa dihubungkan ke Investasi')).toBeVisible();
    await expect.element(screen.getByText('Target kecil, tercapai dalam hitungan bulan')).toBeVisible();
    await screen.getByRole('button', { name: 'Buat tujuan pertama' }).click();
    expect(onCreate).toHaveBeenLastCalledWith();
    await screen.getByRole('button', { name: 'Pakai template Dana Darurat' }).click();
    expect(onCreate).toHaveBeenLastCalledWith({
      name: 'Dana Darurat',
      icon: 'shield',
      color: 'blue',
      dynamic: true,
      hint: expect.any(Function) as unknown,
    });
    await screen.getByRole('button', { name: 'Pakai template Gadget / laptop' }).click();
    expect(onCreate).toHaveBeenLastCalledWith(expect.objectContaining({ icon: 'laptop', dynamic: false }));
  });

  it('suggests 3× monthly spending without an amount before there is any spending', async () => {
    const { screen } = await renderApp(
      <GoalsEmpty averageSpendingMinor={0n} currency="IDR" locale="id" onCreate={vi.fn()} />,
    );
    await expect.element(screen.getByText('Disarankan 3× pengeluaran bulanan', { exact: true })).toBeVisible();
  });
});
