// SPDX-License-Identifier: AGPL-3.0-only
import type { CategoryView } from '@wf/db/categories';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { categoryView } from '../../../test/ledger-fixtures.ts';
import { flushReact, renderApp } from '../../../test/render.tsx';
import { CategoriesSection } from './categories-section.tsx';

const server = vi.hoisted(() => ({
  createCategory: vi.fn(),
  updateCategory: vi.fn(),
  moveCategory: vi.fn(),
  mergeCategories: vi.fn(),
  archiveCategory: vi.fn(),
  unarchiveCategory: vi.fn(),
  deleteCategory: vi.fn(),
  reorderCategories: vi.fn(),
}));
vi.mock('../../server/fn/categories.ts', () => server);
const toasts = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock('@wf/ui/toast', () => toasts);

const RENT = categoryView({
  id: 'rent',
  group: 'needs',
  name: 'system:rent',
  builtInKey: 'system:rent',
  icon: 'house',
  color: 'blue',
  isFixed: true,
  sortOrder: 0,
  transactionCount: 1,
});
const FOOD = categoryView({
  id: 'food',
  group: 'needs',
  name: 'system:food',
  builtInKey: 'system:food',
  icon: 'utensils',
  sortOrder: 1,
  transactionCount: 18,
});
const SHOPPING = categoryView({ id: 'shop', sortOrder: 0 });
const OLD = categoryView({ id: 'old', name: 'Lama', archivedAt: new Date('2026-10-01'), transactionCount: 0 });
const BANK = categoryView({
  id: 'bank',
  kind: 'fee',
  group: 'financial',
  name: 'system:bank_fee',
  builtInKey: 'system:bank_fee',
  icon: 'landmark',
  isSystem: true,
  transactionCount: 0,
});
const SALARY = categoryView({
  id: 'salary',
  kind: 'income',
  group: 'active',
  name: 'system:salary',
  builtInKey: 'system:salary',
  icon: 'briefcase',
});
const ALL = [RENT, FOOD, SHOPPING, OLD, BANK, SALARY];

function Harness({ initial = ALL, next }: { initial?: CategoryView[]; next?: CategoryView[] }) {
  const [categories, setCategories] = useState(initial);
  return (
    <>
      <CategoriesSection categories={categories} />
      {next === undefined ? null : (
        <button
          type="button"
          onClick={() => {
            setCategories(next);
          }}
        >
          muat ulang
        </button>
      )}
    </>
  );
}

const ok = <T,>(value: T) => Promise.resolve({ ok: true, value });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('CategoriesSection', () => {
  it('lists the expense groups with counts, badges, and archived categories, and the income tab', async () => {
    const { screen } = await renderApp(<Harness />);
    await expect.element(screen.getByRole('tab', { name: 'Pengeluaran · 4' })).toHaveAttribute('aria-selected', 'true');
    const needs = screen.getByRole('region', { name: 'Kebutuhan' });
    await expect.element(needs.getByRole('heading', { name: 'Kebutuhan · 2' })).toBeVisible();
    await expect.element(needs.getByText('Sewa Kos')).toBeVisible();
    await expect.element(needs.getByText('Tetap')).toBeVisible();
    await expect.element(needs.getByText('1 transaksi')).toBeVisible();
    await expect.element(screen.getByRole('region', { name: 'Biaya keuangan' }).getByText('Sistem')).toBeVisible();
    await expect
      .element(screen.getByRole('region', { name: 'Biaya keuangan' }).getByText('Belum dipakai'))
      .toBeVisible();
    const archived = screen.getByRole('region', { name: 'Diarsipkan' });
    await expect.element(archived.getByText('Lama')).toBeVisible();
    // Alone in its group or archived: nothing to reorder.
    await expect.element(screen.getByRole('button', { name: 'Ubah urutan Belanja Online' })).not.toBeInTheDocument();

    await screen.getByRole('tab', { name: 'Pemasukan · 1' }).click();
    await expect.element(screen.getByRole('region', { name: 'Aktif' }).getByText('Gaji')).toBeVisible();
    await expect
      .element(screen.getByRole('region', { name: 'Lainnya' }).getByText('Belum ada kategori di kelompok ini.'))
      .toBeVisible();
    await expect.element(screen.getByRole('region', { name: 'Diarsipkan' })).not.toBeInTheDocument();
  });

  it('creates a category of the open tab and edits one from the menu', async () => {
    const created = categoryView({ id: 'les', kind: 'income', group: 'active', name: 'Les privat' });
    server.createCategory.mockReturnValue(ok(created));
    server.updateCategory.mockReturnValue(ok(FOOD));
    const { screen } = await renderApp(<Harness />);
    await screen.getByRole('tab', { name: 'Pemasukan · 1' }).click();
    await screen.getByRole('button', { name: 'Kategori baru' }).click();
    const dialog = screen.getByRole('dialog', { name: 'Kategori pemasukan baru' });
    await dialog.getByLabelText('Nama kategori').fill('Les privat');
    await dialog.getByRole('button', { name: 'Buat kategori' }).click();
    await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument();
    expect(toasts.toast).toHaveBeenCalledWith({ title: 'Kategori Les privat dibuat' });

    await screen.getByRole('tab', { name: /Pengeluaran/ }).click();
    await screen.getByRole('button', { name: 'Menu Makan & Dapur' }).click();
    await screen.getByRole('menuitem', { name: 'Edit kategori' }).click();
    await screen
      .getByRole('dialog', { name: 'Edit kategori' })
      .getByRole('button', { name: 'Simpan perubahan' })
      .click();
    expect(toasts.toast).toHaveBeenLastCalledWith({ title: 'Makan & Dapur disimpan' });
  });

  it('moves, archives with undo, and unarchives from the menu; refusals become error toasts', async () => {
    server.moveCategory
      .mockReturnValueOnce(ok(FOOD))
      .mockReturnValueOnce(Promise.resolve({ ok: false, code: 'CATEGORY_SYSTEM' }));
    server.archiveCategory.mockReturnValue(ok(SHOPPING));
    server.unarchiveCategory.mockReturnValue(ok(SHOPPING));
    const { screen } = await renderApp(<Harness />);

    await screen.getByRole('button', { name: 'Menu Makan & Dapur' }).click();
    await screen.getByRole('menuitem', { name: 'Pindah ke Keinginan' }).click();
    expect(server.moveCategory).toHaveBeenCalledWith({ data: { id: 'food', group: 'wants' } });
    await vi.waitFor(() => {
      expect(toasts.toast).toHaveBeenCalledWith({ title: 'Makan & Dapur dipindah ke Keinginan' });
    });

    await screen.getByRole('button', { name: 'Menu Makan & Dapur' }).click();
    await screen.getByRole('menuitem', { name: 'Pindah ke Keinginan' }).click();
    await vi.waitFor(() => {
      expect(toasts.toast).toHaveBeenLastCalledWith({
        title: 'Perubahan kategori gagal disimpan',
        description: 'Kategori sistem tidak bisa diubah dengan cara ini.',
        tone: 'error',
      });
    });

    await screen.getByRole('button', { name: 'Menu Belanja Online' }).click();
    await screen.getByRole('menuitem', { name: 'Arsipkan' }).click();
    await vi.waitFor(() => {
      expect(toasts.toast).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Belanja Online diarsipkan' }));
    });
    const [{ action }] = toasts.toast.mock.lastCall as [{ action: { label: string; onClick: () => void } }];
    expect(action.label).toBe('Urungkan');
    action.onClick();
    await vi.waitFor(() => {
      expect(server.unarchiveCategory).toHaveBeenCalledWith({ data: { id: 'shop' } });
    });

    await screen.getByRole('button', { name: 'Menu Lama' }).click();
    await expect.element(screen.getByRole('menuitem', { name: /Pindah ke/ })).not.toBeInTheDocument();
    await screen.getByRole('menuitem', { name: 'Pulihkan dari arsip' }).click();
    await vi.waitFor(() => {
      expect(toasts.toast).toHaveBeenLastCalledWith({ title: 'Lama dipulihkan' });
    });
  });

  it('offers only Edit for system categories', async () => {
    const { screen } = await renderApp(<Harness />);
    await screen.getByRole('button', { name: 'Menu Biaya bank' }).click();
    await expect.element(screen.getByRole('menuitem', { name: 'Edit kategori' })).toBeVisible();
    expect(screen.getByRole('menuitem').elements()).toHaveLength(1);
  });

  it('merges into another category', async () => {
    server.mergeCategories.mockReturnValue(ok({ moved: 12 }));
    const { screen } = await renderApp(<Harness />);
    await screen.getByRole('button', { name: 'Menu Belanja Online' }).click();
    await screen.getByRole('menuitem', { name: 'Gabungkan dengan…' }).click();
    await screen
      .getByRole('dialog', { name: 'Gabungkan Belanja Online' })
      .getByRole('button', { name: 'Batal' })
      .click();
    await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument();
    await screen.getByRole('button', { name: 'Menu Belanja Online' }).click();
    await screen.getByRole('menuitem', { name: 'Gabungkan dengan…' }).click();
    const dialog = screen.getByRole('dialog', { name: 'Gabungkan Belanja Online' });
    await dialog.getByRole('combobox', { name: 'Gabungkan ke' }).click();
    await screen.getByRole('option', { name: /Makan & Dapur/ }).click();
    await dialog.getByRole('button', { name: 'Gabungkan' }).click();
    expect(server.mergeCategories).toHaveBeenCalledWith({ data: { sourceId: 'shop', targetId: 'food' } });
    await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument();
    expect(toasts.toast).toHaveBeenLastCalledWith({
      title: 'Belanja Online digabung ke Makan & Dapur',
      description: '12 transaksi dipindah.',
    });
  });

  it('deletes after a confirmation that shows the impact', async () => {
    server.deleteCategory.mockReturnValueOnce(ok({ uncategorized: 12 })).mockReturnValueOnce(ok({ uncategorized: 0 }));
    const { screen } = await renderApp(<Harness />);
    await screen.getByRole('button', { name: 'Menu Belanja Online' }).click();
    await screen.getByRole('menuitem', { name: 'Hapus kategori' }).click();
    const confirm = screen.getByRole('alertdialog', { name: 'Hapus kategori Belanja Online?' });
    await expect.element(confirm.getByText(/masih dipakai di 12 transaksi/)).toBeVisible();
    await expect.element(confirm.getByText(/masuk Perlu kategori/)).toBeVisible();
    await confirm.getByRole('button', { name: 'Hapus kategori' }).click();
    expect(server.deleteCategory).toHaveBeenCalledWith({ data: { id: 'shop' } });
    await vi.waitFor(() => {
      expect(toasts.toast).toHaveBeenLastCalledWith({
        title: 'Belanja Online dihapus',
        description: '12 transaksi perlu kategori baru.',
        tone: 'warning',
      });
    });

    await screen.getByRole('button', { name: 'Menu Lama' }).click();
    await screen.getByRole('menuitem', { name: 'Hapus kategori' }).click();
    const unused = screen.getByRole('alertdialog', { name: 'Hapus kategori Lama?' });
    await expect
      .element(unused.getByText('Kategori ini belum dipakai. Tindakan ini tidak bisa dibatalkan.'))
      .toBeVisible();
    await unused.getByRole('button', { name: 'Batal' }).click();
    await expect.element(screen.getByRole('alertdialog')).not.toBeInTheDocument();
    await screen.getByRole('button', { name: 'Menu Lama' }).click();
    await screen.getByRole('menuitem', { name: 'Hapus kategori' }).click();
    await screen.getByRole('alertdialog').getByRole('button', { name: 'Hapus kategori' }).click();
    await vi.waitFor(() => {
      expect(toasts.toast).toHaveBeenLastCalledWith({ title: 'Lama dihapus' });
    });
  });

  it('reorders with the arrow keys on the handle and keeps focus there', async () => {
    server.reorderCategories.mockReturnValue(ok(null));
    const { screen } = await renderApp(<Harness />);
    const rent = screen.getByRole('button', { name: 'Ubah urutan Sewa Kos' });
    await expect.element(rent).toHaveAccessibleDescription('Tekan panah atas atau bawah untuk memindahkan.');
    (rent.element() as HTMLElement).focus();
    await userEvent.keyboard('{ArrowUp}');
    expect(server.reorderCategories).not.toHaveBeenCalled();
    await userEvent.keyboard('{ArrowDown}');
    expect(server.reorderCategories).toHaveBeenCalledWith({ data: { ids: ['food', 'rent'] } });
    await expect.element(screen.getByText('Sewa Kos dipindah ke urutan 2 dari 2')).toBeInTheDocument();
    await expect.element(rent).toHaveFocus();
    const rows = screen.getByRole('region', { name: 'Kebutuhan' }).getByRole('listitem');
    await expect.poll(() => rows.first().element().textContent).toContain('Makan & Dapur');
    await userEvent.keyboard('{ArrowDown}');
    await userEvent.keyboard('a');
    expect(server.reorderCategories).toHaveBeenCalledTimes(1);
    await userEvent.keyboard('{ArrowUp}');
    expect(server.reorderCategories).toHaveBeenLastCalledWith({ data: { ids: ['rent', 'food'] } });
  });

  it('reorders by dragging within a group only, and reloads fresh data', async () => {
    server.reorderCategories.mockReturnValue(ok(null));
    const reloaded = [{ ...FOOD, sortOrder: 0 }, { ...RENT, sortOrder: 1 }, SHOPPING];
    const { screen } = await renderApp(<Harness next={reloaded} />);
    const row = (name: string) => screen.getByRole('listitem').filter({ hasText: name }).element() as HTMLElement;
    const drag = async (from: HTMLElement, to: HTMLElement) => {
      const dataTransfer = new DataTransfer();
      from.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer }));
      await flushReact();
      to.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer }));
      to.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }));
      from.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer }));
    };

    await drag(row('Sewa Kos'), row('Makan & Dapur'));
    await vi.waitFor(() => {
      expect(server.reorderCategories).toHaveBeenCalledWith({ data: { ids: ['food', 'rent'] } });
    });
    await drag(row('Sewa Kos'), row('Makan & Dapur'));
    await vi.waitFor(() => {
      expect(server.reorderCategories).toHaveBeenLastCalledWith({ data: { ids: ['rent', 'food'] } });
    });
    // Another group, the same row, or a drop without a drag: nothing changes.
    await drag(row('Sewa Kos'), row('Belanja Online'));
    await drag(row('Sewa Kos'), row('Sewa Kos'));
    row('Makan & Dapur').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true }));
    const archived = row('Lama');
    const over = new DragEvent('dragover', { bubbles: true, cancelable: true });
    archived.dispatchEvent(over);
    expect(over.defaultPrevented).toBe(false);
    expect(server.reorderCategories).toHaveBeenCalledTimes(2);

    await screen.getByRole('button', { name: 'muat ulang' }).click();
    await expect.element(screen.getByText('Lama')).not.toBeInTheDocument();
    await expect
      .poll(() => screen.getByRole('region', { name: 'Kebutuhan' }).getByRole('listitem').first().element().textContent)
      .toContain('Makan & Dapur');
  });
});
