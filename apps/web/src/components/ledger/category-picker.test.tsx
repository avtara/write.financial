// SPDX-License-Identifier: AGPL-3.0-only
import type { CategoryView } from '@wf/db/categories';
import type { CategoryKind } from '@wf/domain/categories';
import { useState, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { CATEGORIES, categoryId, userCategory } from '../../../test/ledger-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import { CategoryPicker, CategorySelect, frequentCategories } from './category-picker.tsx';

function Picker({
  initial = null,
  categories = CATEGORIES,
  kind = 'expense',
  onValueChange,
  invalid,
}: {
  readonly initial?: string | null;
  readonly categories?: readonly CategoryView[];
  readonly kind?: CategoryKind;
  readonly onValueChange?: (id: string) => void;
  readonly invalid?: boolean;
}) {
  const [value, setValue] = useState<string | null>(initial);
  return (
    <CategoryPicker
      heading="Kategori"
      categories={categories}
      kind={kind}
      value={value}
      onValueChange={(id) => {
        onValueChange?.(id);
        setValue(id);
      }}
      label="Pilih kategori"
      searchPlaceholder="Cari kategori…"
      describedBy="category-error"
      {...(invalid === undefined ? {} : { invalid })}
    />
  );
}

const tile = (name: string) => page.getByRole('group', { name: 'Kategori' }).getByRole('button', { name, exact: true });

describe('frequentCategories', () => {
  it('orders live categories of a kind by use, then by the user’s order', () => {
    const categories = [
      userCategory({ id: 'b', name: 'B', sortOrder: 2, transactionCount: 3 }),
      userCategory({ id: 'a', name: 'A', sortOrder: 1, transactionCount: 3 }),
      userCategory({ id: 'c', name: 'C', sortOrder: 0, transactionCount: 9 }),
      userCategory({ id: 'gone', name: 'Gone', transactionCount: 99, archivedAt: new Date() }),
      userCategory({ id: 'in', name: 'In', kind: 'income', group: 'other', transactionCount: 99 }),
    ];
    expect(frequentCategories(categories, 'expense').map((category) => category.id)).toEqual(['c', 'a', 'b']);
  });
});

describe('CategoryPicker', () => {
  it('offers the five most used categories as tiles and picks one', async () => {
    const onValueChange = vi.fn();
    await renderApp(<Picker onValueChange={onValueChange} />);
    const group = page.getByRole('group', { name: 'Kategori' });
    await expect.element(group).toHaveAttribute('aria-describedby', 'category-error');
    const tiles = group
      .getByRole('button')
      .elements()
      .map((button) => button.textContent);
    expect(tiles).toEqual([
      'Lihat semua',
      'Makan & Dapur',
      'Transportasi',
      'Belanja',
      'Tagihan & Utilitas',
      'Hiburan',
      'Lainnya',
    ]);
    await expect.element(tile('Lainnya')).toHaveAttribute('aria-pressed', 'false');
    await expect.element(tile('Makan & Dapur')).not.toHaveClass('border-red');

    await userEvent.click(tile('Transportasi'));
    expect(onValueChange).toHaveBeenCalledWith(categoryId('system:transport'));
    await expect.element(tile('Transportasi')).toHaveAttribute('aria-pressed', 'true');
    await expect.element(tile('Lainnya')).toHaveAttribute('aria-pressed', 'false');
  });

  it('shows a category chosen in "Lainnya" on its tile', async () => {
    await renderApp(<Picker />);
    await userEvent.click(tile('Lainnya'));
    await expect.element(page.getByRole('combobox')).toHaveAttribute('placeholder', 'Cari kategori…');
    await expect.element(page.getByText('Kebutuhan', { exact: true })).toBeVisible();
    await expect.element(page.getByText('Keinginan', { exact: true })).toBeVisible();
    // Only expense categories, live ones.
    expect(page.getByRole('option', { name: 'Gaji' }).query()).toBeNull();
    await userEvent.click(page.getByRole('option', { name: 'Kesehatan' }));
    await expect.element(tile('Kesehatan')).toHaveAttribute('aria-pressed', 'true');
    expect(tile('Lainnya').query()).toBeNull();
  });

  it('opens the same search from "Lihat semua"', async () => {
    await renderApp(<Picker initial={categoryId('system:food')} />);
    await expect.element(tile('Makan & Dapur')).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(page.getByRole('button', { name: 'Lihat semua' }));
    await expect.element(page.getByRole('combobox')).toHaveFocus();
    await expect.element(page.getByRole('option', { name: 'Makan & Dapur' })).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('hobi{Enter}');
    await expect.element(tile('Hobi')).toHaveAttribute('aria-pressed', 'true');
  });

  it('marks the tiles invalid and ignores a value of another kind', async () => {
    await renderApp(<Picker invalid initial={categoryId('system:salary')} />);
    await expect.element(page.getByText('Kategori', { exact: true })).toHaveClass('text-red-fg');
    await expect.element(tile('Makan & Dapur')).toHaveClass('border-red');
    await expect.element(tile('Lainnya')).toHaveAttribute('aria-pressed', 'false');
  });

  it('groups income categories, skipping empty groups, with a neutral icon for unknown ones', async () => {
    const categories = [
      userCategory({ id: 'proyek', name: 'Proyek', kind: 'income', group: 'active', icon: 'no-such-icon' }),
      userCategory({ id: 'jual', name: 'Jualan', kind: 'income', group: 'other', icon: 'store' }),
    ];
    await renderApp(<Picker kind="income" categories={categories} />);
    await userEvent.click(page.getByRole('button', { name: 'Lihat semua' }));
    await expect.element(page.getByText('Aktif', { exact: true })).toBeVisible();
    expect(page.getByText('Pasif', { exact: true }).query()).toBeNull();
    await expect.element(page.getByRole('option', { name: 'Proyek' })).toBeVisible();
    expect(page.getByRole('option', { name: 'Proyek' }).element().querySelector('svg.lucide-shapes')).not.toBeNull();
  });
});

describe('CategorySelect', () => {
  function Select({ budgetNote }: { readonly budgetNote?: (category: CategoryView) => ReactNode }) {
    const [value, setValue] = useState<string | null>(null);
    return (
      <CategorySelect
        categories={CATEGORIES}
        kind="fee"
        value={value}
        onValueChange={setValue}
        label="Kategori biaya"
        searchPlaceholder="Cari kategori…"
        placeholder="Pilih kategori"
        aria-label="Kategori biaya"
        {...(budgetNote === undefined ? {} : { budgetNote })}
      />
    );
  }

  it('shows the placeholder, then the chosen category', async () => {
    await renderApp(<Select />);
    const trigger = page.getByRole('button', { name: 'Kategori biaya' });
    await expect.element(trigger).toHaveTextContent('Pilih kategori');
    await userEvent.click(trigger);
    await expect.element(page.getByText('Biaya keuangan', { exact: true })).toBeVisible();
    await userEvent.click(page.getByRole('option', { name: 'Biaya bank' }));
    await expect.element(trigger).toHaveTextContent('Biaya bank');
  });

  it('shows a budget note beside each category', async () => {
    await renderApp(<Select budgetNote={(category) => `sisa ${category.transactionCount}`} />);
    await userEvent.click(page.getByRole('button', { name: 'Kategori biaya' }));
    await expect.element(page.getByRole('option', { name: /Biaya bank/ })).toHaveTextContent('Biaya banksisa 3');
  });

  it('takes extra classes', async () => {
    await renderApp(
      <CategorySelect
        categories={CATEGORIES}
        kind="expense"
        value={categoryId('system:food')}
        onValueChange={vi.fn()}
        label="Kategori"
        searchPlaceholder="Cari"
        placeholder="Pilih"
        className="h-9"
      />,
    );
    await expect.element(page.getByRole('button', { name: 'Makan & Dapur' })).toHaveClass('h-9');
  });
});
