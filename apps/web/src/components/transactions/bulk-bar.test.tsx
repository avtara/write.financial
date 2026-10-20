// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { renderApp } from '../../../test/render.tsx';
import { transactionRow } from '../../../test/transaction-fixtures.ts';
import { BulkBar } from './bulk-bar.tsx';

const actions = vi.hoisted(() => ({
  remove: vi.fn(),
  duplicate: vi.fn(),
  split: vi.fn(),
  changeCategory: vi.fn(),
  moveAccount: vi.fn(),
  addTag: vi.fn(),
  copyAmount: vi.fn(),
  version: 0,
}));
vi.mock('./transaction-actions.tsx', () => ({ useTransactionActions: () => actions }));

const ROWS = [
  transactionRow('a', { amountBaseMinor: -28_000n }),
  transactionRow('b', { amountBaseMinor: -42_000n }),
  transactionRow('c', { amountBaseMinor: -110_000n }),
];

afterEach(() => {
  vi.clearAllMocks();
});

describe('BulkBar', () => {
  it('shows the count and total, and runs the bulk actions on the selection', async () => {
    const onClear = vi.fn();
    const { screen } = await renderApp(<BulkBar rows={ROWS} baseCurrency="IDR" onClear={onClear} />);
    const bar = screen.getByRole('toolbar', { name: 'Aksi transaksi terpilih' });
    expect(bar.element().textContent).toMatch(/^3dipilih−Rp180\.000Ubah kategori/);
    await userEvent.click(bar.getByRole('button', { name: 'Ubah kategori' }));
    await userEvent.click(bar.getByRole('button', { name: 'Pindah rekening' }));
    await userEvent.click(bar.getByRole('button', { name: 'Tambah tag' }));
    await userEvent.click(bar.getByRole('button', { name: 'Hapus' }));
    expect(actions.changeCategory).toHaveBeenCalledWith(ROWS);
    expect(actions.moveAccount).toHaveBeenCalledWith(ROWS);
    expect(actions.addTag).toHaveBeenCalledWith(['a', 'b', 'c']);
    expect(actions.remove).toHaveBeenCalledWith(ROWS);
    await userEvent.click(bar.getByRole('button', { name: 'Batalkan pilihan' }));
    expect(onClear).toHaveBeenCalledOnce();
  });

  it('clears on Escape unless something else handled it, and stops listening when gone', async () => {
    const onClear = vi.fn();
    const { screen } = await renderApp(<BulkBar rows={ROWS} baseCurrency="IDR" onClear={onClear} />);
    await userEvent.keyboard('a');
    const handled = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
    handled.preventDefault();
    window.dispatchEvent(handled);
    expect(onClear).not.toHaveBeenCalled();
    await userEvent.keyboard('{Escape}');
    expect(onClear).toHaveBeenCalledOnce();
    await screen.unmount();
    await userEvent.keyboard('{Escape}');
    expect(onClear).toHaveBeenCalledOnce();
  });
});
