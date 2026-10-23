// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import { portfolioView, SPY } from '../../../test/investment-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import { TargetsDialog, percentToBps } from './targets-dialog.tsx';

describe('allocation targets', () => {
  it.each([
    ['0', 0],
    ['12,34', 1234],
    ['100', 10000],
    ['100.01', null],
    ['1.001', null],
    ['-1', null],
    ['', null],
  ])('parses %s as %s basis points', (text, expected) => {
    expect(percentToBps(text)).toBe(expected);
  });

  it('blocks a 101% total and offers an exact repair before saving', async () => {
    const save = vi.fn().mockResolvedValue(null);
    const { screen } = await renderApp(
      <TargetsDialog open portfolio={portfolioView()} locale="id" onOpenChange={vi.fn()} onSubmit={save} />,
    );
    await screen.getByRole('textbox', { name: 'Target Kripto', exact: true }).fill('8');
    await expect.element(screen.getByRole('button', { name: 'Simpan target' })).toBeDisabled();
    await expect.element(screen.getByRole('alert')).toMatchTextContent('Total target lebih 1,0%');
    await screen.getByRole('button', { name: 'Ambil 1,0% dari Saham AS' }).click();
    await expect.element(screen.getByRole('button', { name: 'Simpan target' })).toBeEnabled();
    await screen.getByRole('button', { name: 'Simpan target' }).click();
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ us_stocks: 4900, crypto: 800 }));
  });

  it('marks an unreadable percentage, reports a missing total, and cancels', async () => {
    const onOpenChange = vi.fn();
    const save = vi.fn();
    const { screen } = await renderApp(
      <TargetsDialog
        open
        portfolio={portfolioView({ targets: {}, assets: [SPY], platforms: [] })}
        locale="id"
        onOpenChange={onOpenChange}
        onSubmit={save}
      />,
    );
    // Every class starts at 0; the shortfall can be given to the largest target.
    await expect.element(screen.getByRole('alert')).toMatchTextContent('Total target kurang 100,0%');
    await screen.getByRole('button', { name: 'Tambah 100,0% ke Saham AS' }).click();
    await expect.element(screen.getByRole('button', { name: 'Simpan target' })).toBeEnabled();
    // No single class can absorb a 75-point excess spread over seven 25% targets.
    for (const name of ['Saham AS', 'Internasional', 'Indonesia', 'Kripto', 'Kas & SGOV', 'Emas', 'Income']) {
      await screen.getByRole('textbox', { name: `Target ${name}` }).fill('25');
    }
    await expect.element(screen.getByRole('alert')).toMatchTextContent('Total target lebih 75,0%');
    expect(screen.getByRole('button', { name: /^(Ambil|Tambah) / }).query()).toBeNull();
    // The form refuses an over-100 total even if it is submitted directly.
    const form = screen.getByRole('button', { name: 'Batal' }).element().closest('form') as HTMLFormElement;
    form.requestSubmit();
    expect(save).not.toHaveBeenCalled();
    const target = screen.getByRole('textbox', { name: 'Target Kripto' });
    await target.fill('x');
    await expect.element(target).toHaveAttribute('aria-invalid', 'true');
    await expect.element(screen.getByRole('cell', { name: '—' })).toBeVisible();
    await expect.element(screen.getByRole('button', { name: 'Simpan target' })).toBeDisabled();
    form.requestSubmit();
    expect(save).not.toHaveBeenCalled();
    await screen.getByRole('button', { name: 'Batal' }).click();
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(save).not.toHaveBeenCalled();
  });

  it('counts changes and shows a refusal without closing', async () => {
    const save = vi.fn().mockResolvedValueOnce('Tidak tersimpan.').mockResolvedValueOnce(null);
    const { screen } = await renderApp(
      <TargetsDialog
        open
        portfolio={portfolioView({ targets: {} })}
        locale="id"
        onOpenChange={vi.fn()}
        onSubmit={save}
      />,
    );
    await expect.element(screen.getByText('Belum ada perubahan')).toBeVisible();
    await screen.getByRole('textbox', { name: 'Target Kripto' }).fill('100');
    await expect.element(screen.getByText('1 perubahan belum disimpan')).toBeVisible();
    await screen.getByRole('button', { name: 'Simpan target' }).click();
    await expect.element(screen.getByText('Tidak tersimpan.')).toBeVisible();
    await screen.getByRole('button', { name: 'Simpan target' }).click();
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith({ crypto: 10000 });
  });
});
