// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import { renderApp } from '../../../test/render.tsx';
import { moveBucket, PriorityPanel } from './priority-panel.tsx';

describe('moveBucket', () => {
  it('moves a bucket one step', () => {
    expect(moveBucket(['installments', 'spending'], 1, -1)).toEqual(['spending', 'installments']);
    expect(moveBucket(['installments', 'spending'], 0, 1)).toEqual(['spending', 'installments']);
  });
});

describe('PriorityPanel (rHTMd "Prioritas pembayaran kartu")', () => {
  it('shows installments, the bill, and credit in order; reorders, cancels, and saves', async () => {
    const onSave = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const { screen } = await renderApp(<PriorityPanel priority={['installments', 'spending']} onSave={onSave} />);
    const panel = screen.getByRole('region', { name: 'Prioritas pembayaran kartu' });
    await expect
      .element(panel.getByRole('list'))
      .toHaveTextContent(
        '1Utang cicilanpelunasan dipercepat2Tagihan berjalanbelanja non-cicilan3Lebih bayarjadi saldo kredit',
      );
    await panel.getByRole('button', { name: 'Ubah' }).click();
    await expect.element(panel.getByRole('button', { name: 'Naikkan Utang cicilan' })).toBeDisabled();
    await expect.element(panel.getByRole('button', { name: 'Turunkan Tagihan berjalan' })).toBeDisabled();
    await panel.getByRole('button', { name: 'Batal' }).click();
    await expect.element(panel.getByRole('button', { name: 'Ubah' })).toBeVisible();

    await panel.getByRole('button', { name: 'Ubah' }).click();
    await panel.getByRole('button', { name: 'Naikkan Tagihan berjalan' }).click();
    await expect.element(panel.getByRole('list')).toMatchTextContent(/^1Tagihan berjalan/);
    await panel.getByRole('button', { name: 'Simpan' }).click();
    expect(onSave).toHaveBeenLastCalledWith(['spending', 'installments']);
    // A failed save stays in edit mode; the next one closes it.
    await expect.element(panel.getByRole('button', { name: 'Simpan' })).toBeVisible();
    await panel.getByRole('button', { name: 'Turunkan Tagihan berjalan' }).click();
    await panel.getByRole('button', { name: 'Simpan' }).click();
    expect(onSave).toHaveBeenLastCalledWith(['installments', 'spending']);
    await expect.element(panel.getByRole('button', { name: 'Ubah' })).toBeVisible();
  });
});
