// SPDX-License-Identifier: AGPL-3.0-only
import type { BudgetLineView } from '@wf/db/budgets';
import { describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { budgetLine, FOOD, FUN, LINES, RENT, SHOPPING, TRANSPORT } from '../../../test/budget-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import { MoveLeftoverDialog, type MoveRequest } from './move-leftover-dialog.tsx';

async function renderDialog(request: MoveRequest | null, lines: readonly BudgetLineView[] = LINES) {
  const onClose = vi.fn();
  const onMove = vi.fn<(target: BudgetLineView, sources: unknown[]) => Promise<boolean>>();
  const { screen } = await renderApp(
    <MoveLeftoverDialog
      request={request}
      lines={lines}
      totalLimitMinor={12_500_000n}
      onClose={onClose}
      onMove={onMove}
    />,
  );
  return { screen, onClose, onMove };
}

describe('MoveLeftoverDialog', () => {
  it('covers an overspend from the suggested source and adjusts the amounts', async () => {
    const { screen, onMove, onClose } = await renderDialog({
      targetId: 'shopping',
      sources: [{ categoryId: 'fun', amountMinor: 400_000n }],
    });
    const dialog = screen.getByRole('dialog', { name: 'Tutup kekurangan Belanja' });
    await expect
      .element(dialog.getByText('Pindahkan sisa dari kategori lain. Total anggaran tetap sama.'))
      .toBeVisible();
    await expect.element(dialog.getByRole('combobox', { name: 'Pindahkan ke' })).not.toBeInTheDocument();
    // Belanja (the target) and Sewa (fixed) are no sources.
    expect(dialog.getByRole('checkbox').elements()).toHaveLength(3);
    await expect.element(dialog.getByRole('checkbox', { name: /^Hiburan/ })).toBeChecked();
    await expect.element(dialog.getByText('sisa Rp1.000.000 → sisa Rp600.000')).toBeVisible();
    const result = dialog.getByRole('region', { name: 'Hasil' });
    await expect.element(result).toMatchTextContent(/Belanja120,00%100,00%/);
    await expect.element(result.getByText('Batas Rp2.000.000 → Rp2.400.000 · terpakai Rp2.400.000')).toBeVisible();
    await expect
      .element(result.getByText('Belanja jadi pas di batas — transaksi berikutnya akan lewat lagi.'))
      .toBeVisible();
    await expect.element(result.getByText('Total anggaran tetap Rp12.500.000.')).toBeVisible();
    await expect.element(dialog.getByText('Rp400.000 dari 1 kategori')).toBeVisible();

    await dialog.getByRole('checkbox', { name: /^Transportasi/ }).click();
    await expect.element(dialog.getByRole('textbox', { name: 'Jumlah dari Transportasi' })).toHaveValue('400.000');
    await expect.element(result).toMatchTextContent(/120,00%85,71%/);
    await expect.element(result.getByText(/jadi pas di batas/)).not.toBeInTheDocument();
    await dialog.getByRole('checkbox', { name: /^Transportasi/ }).click();
    await expect.element(dialog.getByRole('textbox', { name: 'Jumlah dari Transportasi' })).toHaveValue('');

    // More than Makan has left: invalid until corrected.
    const food = dialog.getByRole('textbox', { name: 'Jumlah dari Makan' });
    await userEvent.fill(food, '500.000');
    await expect.element(food).toHaveAttribute('aria-invalid', 'true');
    await expect.element(dialog.getByText(/^sisa Rp300\.000 → sisa .Rp200\.000$/)).toHaveClass('text-red-fg');
    await expect.element(dialog.getByRole('button', { name: 'Pindahkan Rp900.000' })).toBeDisabled();
    (dialog.element().querySelector('form') as HTMLFormElement).requestSubmit();
    expect(onMove).not.toHaveBeenCalled();
    await userEvent.fill(food, '');

    onMove.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    await dialog.getByRole('button', { name: 'Pindahkan Rp400.000' }).click();
    expect(onMove).toHaveBeenCalledWith(SHOPPING, [{ categoryId: 'fun', amountMinor: 400_000n }]);
    // A failed move keeps the dialog usable.
    await expect.element(dialog.getByRole('button', { name: 'Pindahkan Rp400.000' })).toBeEnabled();
    await dialog.getByRole('button', { name: 'Pindahkan Rp400.000' }).click();
    expect(onMove).toHaveBeenCalledTimes(2);
    expect(onClose).not.toHaveBeenCalled();

    await dialog.getByRole('button', { name: 'Batal' }).click();
    expect(onClose).toHaveBeenCalledOnce();
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('moves a row’s leftover to a picked category', async () => {
    const { screen, onMove } = await renderDialog({
      targetId: null,
      sources: [{ categoryId: 'transport', amountMinor: 400_000n }],
    });
    const dialog = screen.getByRole('dialog', { name: 'Pindahkan sisa' });
    const target = dialog.getByRole('combobox', { name: 'Pindahkan ke' });
    expect([...(target.element() as HTMLSelectElement).options].map((option) => option.text)).toEqual([
      'Pilih kategori',
      'Makan',
      'Sewa',
      'Belanja',
      'Hiburan',
    ]);
    await expect.element(dialog.getByRole('region', { name: 'Hasil' })).not.toBeInTheDocument();
    await expect.element(dialog.getByRole('button', { name: 'Pindahkan Rp400.000' })).toBeDisabled();
    await target.selectOptions('food');
    await expect.element(dialog.getByRole('region', { name: 'Hasil' })).toMatchTextContent(/Makan91,43%82,05%/);
    await expect.element(dialog.getByRole('checkbox', { name: /^Makan/ })).not.toBeInTheDocument();
    onMove.mockResolvedValue(true);
    await dialog.getByRole('button', { name: 'Pindahkan Rp400.000' }).click();
    expect(onMove).toHaveBeenCalledWith(FOOD, [{ categoryId: 'transport', amountMinor: 400_000n }]);
    await target.selectOptions('');
    await expect.element(dialog.getByRole('region', { name: 'Hasil' })).not.toBeInTheDocument();
  });

  it('shows a target going over, one without a limit, and no sources at all', async () => {
    const first = await renderDialog({
      targetId: 'shopping',
      sources: [{ categoryId: 'transport', amountMinor: 100_000n }],
    });
    await expect.element(first.screen.getByRole('region', { name: 'Hasil' })).toMatchTextContent(/120,00%114,29%/);
    expect(first.screen.getByRole('region', { name: 'Hasil' }).element().querySelector('rect.fill-red')).not.toBeNull();
    await first.screen.unmount();

    const zero = budgetLine({ categoryId: 'zero', name: 'Zakat', limitMinor: 0n, spentMinor: 0n });
    const second = await renderDialog({ targetId: 'zero', sources: [] }, [zero, SHOPPING, RENT]);
    const dialog = second.screen.getByRole('dialog', { name: 'Tutup kekurangan Zakat' });
    await expect.element(dialog.getByText('Tidak ada kategori lain yang masih punya sisa.')).toBeVisible();
    await expect.element(dialog.getByRole('region', { name: 'Hasil' })).toMatchTextContent(/Zakat——/);
    await expect.element(dialog.getByText(/jadi pas di batas/)).not.toBeInTheDocument();
    await second.screen.unmount();

    const closed = await renderDialog(null, [FUN, TRANSPORT]);
    await expect.element(closed.screen.getByRole('dialog')).not.toBeInTheDocument();
  });
});
