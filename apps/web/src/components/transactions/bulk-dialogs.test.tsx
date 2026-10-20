// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { GOTRADE, JAGO, LEDGER, userCategory } from '../../../test/ledger-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import { transactionRow } from '../../../test/transaction-fixtures.ts';
import { AddTagDialog, CategoryDialog, MoveAccountDialog } from './bulk-dialogs.tsx';

const KOPI = userCategory({ id: 'c-kopi', name: 'Kopi' });
const GAJI = userCategory({ id: 'c-gaji', name: 'Gaji', kind: 'income', group: 'active' });
const ledger = { ...LEDGER, categories: [KOPI, GAJI] };

const EXPENSE_A = transactionRow('a');
const EXPENSE_B = transactionRow('b');
const INCOME = transactionRow('c', { type: 'income', amountMinor: 10_000n });
const TRANSFER = transactionRow('d', { type: 'transfer', categoryId: null, toAccountId: JAGO.id });

const apply = () => page.getByRole('button', { name: 'Terapkan' });

describe('CategoryDialog', () => {
  it('recategorizes the expenses, skipping transfers, and waits for the change', async () => {
    const done = Promise.withResolvers<undefined>();
    const onApply = vi.fn(() => done.promise);
    const onCancel = vi.fn();
    await renderApp(
      <CategoryDialog rows={[EXPENSE_A, TRANSFER, EXPENSE_B]} ledger={ledger} onCancel={onCancel} onApply={onApply} />,
    );
    const dialog = page.getByRole('dialog', { name: 'Ubah kategori 2 transaksi' });
    await expect.element(dialog.getByText('1 transfer dilewati', { exact: false })).toBeVisible();
    await expect.element(apply()).toBeDisabled();
    await userEvent.click(dialog.getByRole('button', { name: 'Pilih kategori' }));
    await expect.element(page.getByRole('option', { name: 'Gaji' })).not.toBeInTheDocument();
    await userEvent.click(page.getByRole('option', { name: 'Kopi' }));
    await userEvent.click(apply());
    expect(onApply).toHaveBeenCalledWith(['a', 'b'], KOPI.id);
    await expect.element(apply()).toHaveAttribute('aria-busy', 'true');
    await expect.element(dialog.getByRole('button', { name: 'Batal' })).toBeDisabled();
    done.resolve(undefined);
    await expect.element(apply()).toHaveAttribute('aria-busy', 'false');
    await userEvent.click(dialog.getByRole('button', { name: 'Batal' }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('offers income categories for incomes', async () => {
    const onApply = vi.fn(() => Promise.resolve());
    await renderApp(<CategoryDialog rows={[INCOME]} ledger={ledger} onCancel={vi.fn()} onApply={onApply} />);
    await userEvent.click(page.getByRole('dialog').getByRole('button', { name: 'Pilih kategori' }));
    await userEvent.click(page.getByRole('option', { name: 'Gaji' }));
    await userEvent.click(apply());
    expect(onApply).toHaveBeenCalledWith(['c'], GAJI.id);
  });

  it('refuses expenses and incomes together, and transfers alone', async () => {
    const onCancel = vi.fn();
    const mixed = await renderApp(
      <CategoryDialog rows={[EXPENSE_A, INCOME]} ledger={ledger} onCancel={onCancel} onApply={vi.fn()} />,
    );
    const dialog = page.getByRole('dialog', { name: 'Ubah kategori 2 transaksi' });
    await expect
      .element(dialog.getByText('Pengeluaran dan pemasukan punya kategori berbeda.', { exact: false }))
      .toBeVisible();
    await expect.element(apply()).toBeDisabled();
    await userEvent.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalledOnce();
    await mixed.screen.unmount();

    await renderApp(<CategoryDialog rows={[TRANSFER]} ledger={ledger} onCancel={vi.fn()} onApply={vi.fn()} />);
    const transfers = page.getByRole('dialog', { name: 'Ubah kategori 0 transaksi' });
    await userEvent.click(transfers.getByRole('button', { name: 'Pilih kategori' }));
    await userEvent.click(page.getByRole('option', { name: 'Kopi' }));
    await expect.element(apply()).toBeDisabled();
  });
});

describe('MoveAccountDialog', () => {
  it('moves the entries to an active account of their currency', async () => {
    const onApply = vi.fn(() => Promise.resolve());
    await renderApp(
      <MoveAccountDialog rows={[EXPENSE_A, TRANSFER]} ledger={ledger} onCancel={vi.fn()} onApply={onApply} />,
    );
    const dialog = page.getByRole('dialog', { name: 'Pindah 1 transaksi' });
    await expect.element(dialog).toHaveAccessibleDescription('Hanya rekening IDR; jumlahnya tetap sama.');
    await expect.element(dialog.getByText('1 transfer dilewati', { exact: false })).toBeVisible();
    await expect.element(apply()).toBeDisabled();
    await userEvent.click(dialog.getByRole('button', { name: 'Pilih rekening tujuan' }));
    await expect.element(page.getByRole('option', { name: /Gotrade/ })).not.toBeInTheDocument();
    await expect.element(page.getByRole('option', { name: /Mandiri Lama/ })).not.toBeInTheDocument();
    await userEvent.click(page.getByRole('option', { name: /Bank Jago/ }));
    await expect.element(dialog.getByRole('button', { name: 'Pilih rekening tujuan' })).toMatchTextContent(/Bank Jago/);
    await userEvent.click(apply());
    expect(onApply).toHaveBeenCalledWith(['a'], JAGO.id);
  });

  it('refuses rows in different currencies, and transfers alone', async () => {
    const onCancel = vi.fn();
    const usd = transactionRow('u', { accountId: GOTRADE.id, currency: 'USD' });
    const mixed = await renderApp(
      <MoveAccountDialog rows={[EXPENSE_A, usd]} ledger={ledger} onCancel={onCancel} onApply={vi.fn()} />,
    );
    const dialog = page.getByRole('dialog', { name: 'Pindah 2 transaksi' });
    await expect.element(dialog).not.toHaveAttribute('aria-describedby');
    await expect.element(dialog.getByText('memakai mata uang berbeda', { exact: false })).toBeVisible();
    await expect.element(apply()).toBeDisabled();
    await userEvent.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalledOnce();
    await mixed.screen.unmount();

    await renderApp(<MoveAccountDialog rows={[TRANSFER]} ledger={ledger} onCancel={vi.fn()} onApply={vi.fn()} />);
    const transfers = page.getByRole('dialog', { name: 'Pindah 0 transaksi' });
    await expect.element(transfers).toHaveAccessibleDescription('Hanya rekening ; jumlahnya tetap sama.');
    await expect.element(apply()).toBeDisabled();
  });
});

describe('AddTagDialog', () => {
  it('adds one tag, the newest one typed', async () => {
    const onApply = vi.fn(() => Promise.resolve());
    const onCancel = vi.fn();
    await renderApp(<AddTagDialog count={3} ledger={ledger} onCancel={onCancel} onApply={onApply} />);
    const dialog = page.getByRole('dialog', { name: 'Tambah tag ke 3 transaksi' });
    await expect.element(dialog).toHaveAccessibleDescription('Tag ditambahkan ke setiap transaksi yang dipilih.');
    await expect.element(apply()).toBeDisabled();
    const input = dialog.getByRole('combobox');
    await userEvent.click(input);
    await userEvent.keyboard('kantor{Enter}');
    await userEvent.keyboard('piknik{Enter}');
    await userEvent.click(apply());
    expect(onApply).toHaveBeenCalledWith('piknik');
    await userEvent.keyboard('{Escape}');
    await userEvent.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalled();
  });
});
