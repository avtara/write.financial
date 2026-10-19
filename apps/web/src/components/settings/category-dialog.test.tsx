// SPDX-License-Identifier: AGPL-3.0-only
import type { CategoryView } from '@wf/db/categories';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { categoryView } from '../../../test/ledger-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import { CategoryDialog, type EditableKind } from './category-dialog.tsx';

const server = vi.hoisted(() => ({
  createCategory: vi.fn(),
  updateCategory: vi.fn(),
  moveCategory: vi.fn(),
}));
vi.mock('../../server/fn/categories.ts', () => server);

const saved = vi.fn();

function Harness({ category = null, kind = 'expense' }: { category?: CategoryView | null; kind?: EditableKind }) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
        }}
      >
        buka
      </button>
      <CategoryDialog open={open} onOpenChange={setOpen} category={category} kind={kind} onSaved={saved} />
    </>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('CategoryDialog', () => {
  it('creates an expense category with group, icon, color, and the fixed flag', async () => {
    const created = categoryView({ id: 'new', name: 'Pendidikan' });
    server.createCategory.mockResolvedValue({ ok: true, value: created });
    const { screen } = await renderApp(<Harness />);
    const dialog = screen.getByRole('dialog', { name: 'Kategori baru' });
    await expect.element(dialog.getByText('Untuk mengelompokkan transaksi dan anggaran.')).toBeVisible();

    await dialog.getByRole('button', { name: 'Buat kategori' }).click();
    await expect.element(dialog.getByText('Isi nama kategori.')).toBeVisible();
    expect(server.createCategory).not.toHaveBeenCalled();

    await dialog.getByLabelText('Nama kategori').fill('  Pendidikan ');
    await dialog.getByRole('radio', { name: 'Keinginan' }).click();
    await dialog.getByRole('radio', { name: 'Buku' }).click();
    await dialog.getByRole('radio', { name: 'Biru' }).click();
    await dialog.getByRole('switch', { name: /Pengeluaran tetap/ }).click();
    await expect
      .poll(() => dialog.getByRole('group', { name: 'Pratinjau' }).element().textContent.replace(/\s+/g, ''))
      .toContain('PendidikanKeinginan');
    await dialog.getByRole('button', { name: 'Buat kategori' }).click();

    expect(server.createCategory).toHaveBeenCalledWith({
      data: { kind: 'expense', group: 'wants', name: 'Pendidikan', icon: 'book-open', color: 'blue', isFixed: true },
    });
    expect(saved).toHaveBeenCalledWith(created, true);
  });

  it('switches to an income category with three groups and no fixed flag, and shows refusals', async () => {
    server.createCategory
      .mockResolvedValueOnce({ ok: false, code: 'CATEGORY_NAME_TAKEN' })
      .mockResolvedValueOnce({ ok: false, code: 'INVALID_CATEGORY' })
      .mockRejectedValueOnce(new Error('offline'));
    const { screen } = await renderApp(<Harness />);
    await screen.getByRole('radio', { name: 'Pemasukan' }).click();
    const dialog = screen.getByRole('dialog', { name: 'Kategori pemasukan baru' });
    await expect.element(dialog.getByText('Untuk mengelompokkan sumber pemasukanmu.')).toBeVisible();
    await expect.element(dialog.getByRole('radio', { name: 'Aktif' })).toBeChecked();
    await expect.element(dialog.getByRole('radio', { name: 'Lainnya' })).toBeVisible();
    await expect.element(dialog.getByRole('switch')).not.toBeInTheDocument();
    await expect
      .poll(() => dialog.getByRole('group', { name: 'Pratinjau' }).element().textContent.replace(/\s+/g, ''))
      .toContain('PendidikanAktif');

    await dialog.getByLabelText('Nama kategori').fill('Les privat');
    await dialog.getByRole('button', { name: 'Buat kategori' }).click();
    await expect.element(dialog.getByText('Nama kategori ini sudah dipakai.')).toBeVisible();
    await expect.element(dialog.getByLabelText('Nama kategori')).toHaveAttribute('aria-invalid', 'true');
    expect(server.createCategory).toHaveBeenLastCalledWith({
      data: {
        kind: 'income',
        group: 'active',
        name: 'Les privat',
        icon: 'presentation',
        color: 'green',
        isFixed: false,
      },
    });

    await dialog.getByRole('button', { name: 'Buat kategori' }).click();
    await expect.element(dialog.getByRole('alert').last()).toBeVisible();
    await dialog.getByRole('button', { name: 'Buat kategori' }).click();
    await expect.element(dialog.getByRole('alert').last()).toBeVisible();
    expect(saved).not.toHaveBeenCalled();
  });

  it('edits a built-in category without renaming it and moves it to the chosen group', async () => {
    const builtIn = categoryView({ id: 'food', name: 'system:food', builtInKey: 'system:food', group: 'needs' });
    server.updateCategory.mockResolvedValue({ ok: true, value: builtIn });
    server.moveCategory.mockResolvedValue({ ok: true, value: { ...builtIn, group: 'wants' } });
    const { screen } = await renderApp(<Harness category={builtIn} />);
    const dialog = screen.getByRole('dialog', { name: 'Edit kategori' });
    await expect.element(dialog.getByRole('radiogroup', { name: 'Jenis' })).not.toBeInTheDocument();
    await expect.element(dialog.getByLabelText('Nama kategori')).toHaveValue('Makan & Dapur');
    await expect.element(dialog.getByLabelText('Nama kategori')).toHaveAttribute('readonly');
    await expect.element(dialog.getByText('Nama kategori bawaan mengikuti bahasa aplikasi.')).toBeVisible();
    await dialog.getByRole('radio', { name: 'Keinginan' }).click();
    await dialog.getByRole('button', { name: 'Simpan perubahan' }).click();

    expect(server.updateCategory).toHaveBeenCalledWith({
      data: { id: 'food', icon: 'shopping-bag', color: 'violet', isFixed: false },
    });
    expect(server.moveCategory).toHaveBeenCalledWith({ data: { id: 'food', group: 'wants' } });
    expect(saved).toHaveBeenCalledWith({ ...builtIn, group: 'wants' }, false);
  });

  it('edits a user category by name, keeps a system category in its group, and cancels', async () => {
    const own = categoryView({ kind: 'income', group: 'other', name: 'Les' });
    server.updateCategory.mockResolvedValue({ ok: true, value: own });
    const { screen } = await renderApp(<Harness category={own} />);
    await screen.getByLabelText('Nama kategori').fill('Les privat');
    await expect.element(screen.getByRole('switch')).not.toBeInTheDocument();
    await screen.getByRole('button', { name: 'Simpan perubahan' }).click();
    expect(server.updateCategory).toHaveBeenCalledWith({
      data: { id: 'c-1', name: 'Les privat', icon: 'shopping-bag', color: 'violet', isFixed: false },
    });
    expect(server.moveCategory).not.toHaveBeenCalled();
  });

  it('keeps a system category in its group and closes on Batal', async () => {
    const fee = categoryView({
      id: 'fee',
      kind: 'fee',
      group: 'financial',
      name: 'system:bank_fee',
      builtInKey: 'system:bank_fee',
      isSystem: true,
    });
    const { screen } = await renderApp(<Harness category={fee} />);
    const dialog = screen.getByRole('dialog', { name: 'Edit kategori' });
    await expect.element(dialog.getByRole('group', { name: 'Kelompok' })).not.toBeInTheDocument();
    await expect
      .poll(() => dialog.getByRole('group', { name: 'Pratinjau' }).element().textContent.replace(/\s+/g, ''))
      .toContain('BiayabankBiayakeuangan');
    await dialog.getByRole('button', { name: 'Batal' }).click();
    await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument();
    await screen.getByRole('button', { name: 'buka' }).click();
    await expect.element(screen.getByRole('dialog', { name: 'Edit kategori' })).toBeVisible();
  });
});
