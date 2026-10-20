// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { categoryId, LEDGER, userCategory } from '../../../test/ledger-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import { transactionRow } from '../../../test/transaction-fixtures.ts';
import { RowMenu } from './row-menu.tsx';

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

const GOJEK = transactionRow('t-1', {
  merchant: 'Gojek',
  categoryId: categoryId('system:transport'),
  amountMinor: -42_000n,
});

async function openMenu(row = GOJEK, ledger = LEDGER) {
  const onOpen = vi.fn();
  const { screen } = await renderApp(<RowMenu row={row} ledger={ledger} label="Gojek" onOpen={onOpen} />);
  await userEvent.click(screen.getByRole('button', { name: 'Menu Gojek' }));
  return { onOpen, screen };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('RowMenu', () => {
  it('runs Edit, Duplikat, Pisah, Pindah rekening, Tambah tag, Salin jumlah, and Hapus', async () => {
    const { onOpen, screen } = await openMenu();
    const reopen = () => userEvent.click(screen.getByRole('button', { name: 'Menu Gojek' }));
    await expect.element(page.getByRole('menuitem', { name: /^Edit/ })).toHaveTextContent('EditE');
    await expect
      .element(page.getByRole('menuitem', { name: /^Salin jumlah/ }))
      .toHaveTextContent('Salin jumlah−42.000');
    await expect.element(page.getByRole('menuitem', { name: /^Hapus/ })).toHaveTextContent('Hapus⌫');
    await userEvent.click(page.getByRole('menuitem', { name: /^Edit/ }));
    expect(onOpen).toHaveBeenCalledWith('t-1');
    for (const name of [
      /^Duplikat/,
      /^Pisah transaksi/,
      /^Pindah rekening/,
      /^Tambah tag/,
      /^Salin jumlah/,
      /^Hapus/,
    ]) {
      await reopen();
      await userEvent.click(page.getByRole('menuitem', { name }));
    }
    expect(actions.duplicate).toHaveBeenCalledWith('t-1');
    expect(actions.split).toHaveBeenCalledWith('t-1');
    expect(actions.moveAccount).toHaveBeenCalledWith([GOJEK]);
    expect(actions.addTag).toHaveBeenCalledWith(['t-1']);
    expect(actions.copyAmount).toHaveBeenCalledWith(GOJEK);
    expect(actions.remove).toHaveBeenCalledWith([GOJEK]);
  });

  it('offers the current and the most used categories, then all of them, from the keyboard', async () => {
    await openMenu();
    const trigger = page.getByRole('menuitem', { name: 'Ubah kategori' });
    await userEvent.hover(trigger);
    const items = page.getByRole('menuitemcheckbox');
    await expect.element(items.first()).toHaveAccessibleName('Transportasi');
    await expect.element(items.first()).toBeChecked();
    expect(items.elements().map((item) => item.textContent)).toEqual([
      'Transportasi',
      'Makan & Dapur',
      'Belanja Online',
      'Tagihan & Utilitas',
    ]);
    await userEvent.click(items.first());
    expect(actions.changeCategory).not.toHaveBeenCalled();
  });

  it('sets a frequent category or asks for one', async () => {
    const { screen } = await openMenu();
    await userEvent.hover(page.getByRole('menuitem', { name: 'Ubah kategori' }));
    await userEvent.click(page.getByRole('menuitemcheckbox', { name: 'Makan & Dapur' }));
    expect(actions.changeCategory).toHaveBeenCalledWith([GOJEK], categoryId('system:food'));
    await userEvent.click(screen.getByRole('button', { name: 'Menu Gojek' }));
    await userEvent.hover(page.getByRole('menuitem', { name: 'Ubah kategori' }));
    await userEvent.click(page.getByRole('menuitem', { name: 'Semua kategori…' }));
    expect(actions.changeCategory).toHaveBeenLastCalledWith([GOJEK]);
  });

  it('lists only frequent categories for an uncategorized row, with a fallback glyph', async () => {
    const odd = userCategory({ id: 'odd', name: 'Aneh', icon: 'no-such-icon', transactionCount: 99 });
    await openMenu(transactionRow('t-1', { categoryId: null }), { ...LEDGER, categories: [...LEDGER.categories, odd] });
    await userEvent.hover(page.getByRole('menuitem', { name: 'Ubah kategori' }));
    const items = page.getByRole('menuitemcheckbox');
    await expect.element(items.first()).toHaveAccessibleName('Aneh');
    expect(items.elements()).toHaveLength(3);
  });

  it('has no split, category, or account move for transfers', async () => {
    await openMenu(transactionRow('t-1', { type: 'transfer', categoryId: null }));
    await expect.element(page.getByRole('menuitem', { name: /^Duplikat/ })).toBeVisible();
    for (const name of ['Pisah transaksi', 'Ubah kategori', 'Pindah rekening']) {
      await expect.element(page.getByRole('menuitem', { name })).not.toBeInTheDocument();
    }
  });
});
