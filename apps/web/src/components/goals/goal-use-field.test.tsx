// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import { PERPANJANG_STNK } from '../../../test/goal-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import { GoalUseField } from './goal-use-field.tsx';

const STNK = { ...PERPANJANG_STNK, savedMinor: 850_000n };

describe('GoalUseField', () => {
  it('golden: Perpanjang STNK at 100% pays Rp812.000 and leaves Rp38.000 to move', async () => {
    const onUse = vi.fn();
    const onPlain = vi.fn();
    const { screen } = await renderApp(
      <GoalUseField goal={STNK} amountMinor={812_000n} using={false} locale="id" onUse={onUse} onPlain={onPlain} />,
    );
    const field = screen.getByRole('region', { name: 'Bayar dari tujuan Perpanjang STNK' });
    await expect.element(field).toMatchTextContent('100,00% · Rp850.000');
    await expect
      .element(field)
      .toMatchTextContent(
        'Tujuan ditandai Terpakai, bukan dihitung mundur. Sisa Rp38.000 bisa dipindah ke tujuan lain setelah disimpan.',
      );
    await expect
      .element(field.getByRole('button', { name: 'Pakai dana tujuan' }))
      .toHaveAttribute('aria-pressed', 'false');
    await field.getByRole('button', { name: 'Pakai dana tujuan' }).click();
    expect(onUse).toHaveBeenCalled();
    await field.getByRole('button', { name: 'Catat sebagai pengeluaran biasa' }).click();
    expect(onPlain).toHaveBeenCalled();
  });

  const view = (amountMinor: bigint | null, goal = STNK) =>
    renderApp(
      <GoalUseField goal={goal} amountMinor={amountMinor} using locale="id" onUse={vi.fn()} onPlain={vi.fn()} />,
    );

  it('says what the free balance pays beyond the goal', async () => {
    const { screen } = await view(900_000n);
    await expect.element(screen.getByText(/Rp50\.000 di luar dana tujuan dibayar dari saldo bebas\./)).toBeVisible();
    await expect
      .element(screen.getByRole('button', { name: 'Pakai dana tujuan' }))
      .toHaveAttribute('aria-pressed', 'true');
  });

  it('says nothing about a leftover when none is left', async () => {
    const { screen } = await view(850_000n);
    await expect
      .element(screen.getByText('Tujuan ditandai Terpakai, bukan dihitung mundur.', { exact: true }))
      .toBeVisible();
  });

  it('says nothing about a leftover before an amount is typed, and shows no share without a target', async () => {
    const { screen } = await view(null, { ...STNK, targetMinor: 0n });
    await expect
      .element(screen.getByText('Tujuan ditandai Terpakai, bukan dihitung mundur.', { exact: true }))
      .toBeVisible();
    await expect.element(screen.getByRole('region')).not.toMatchTextContent('%');
  });
});
