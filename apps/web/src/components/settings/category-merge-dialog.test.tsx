// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { categoryView } from '../../../test/ledger-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import { CategoryMergeDialog } from './category-merge-dialog.tsx';

const server = vi.hoisted(() => ({ mergeCategories: vi.fn() }));
vi.mock('../../server/fn/categories.ts', () => server);

const SOURCE = categoryView({ id: 'shop' });
const TARGET = categoryView({ id: 'fun', name: 'Hiburan', transactionCount: 39 });
const OTHERS = [
  SOURCE,
  TARGET,
  categoryView({ id: 'gone', name: 'Diarsip', archivedAt: new Date('2026-10-01') }),
  categoryView({ id: 'pay', kind: 'income', group: 'active', name: 'Gaji' }),
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe('CategoryMergeDialog', () => {
  it('offers live categories of the same kind, shows the impact, and reports refusals', async () => {
    server.mergeCategories
      .mockResolvedValueOnce({ ok: false, code: 'CATEGORY_KIND_MISMATCH' })
      .mockResolvedValueOnce({ ok: true, value: { moved: 12 } });
    const merged = vi.fn();
    const close = vi.fn();
    const { screen } = await renderApp(
      <CategoryMergeDialog source={SOURCE} categories={OTHERS} onClose={close} onMerged={merged} />,
    );
    const dialog = screen.getByRole('dialog', { name: 'Gabungkan Belanja' });
    await expect.element(dialog.getByRole('button', { name: 'Gabungkan' })).toBeDisabled();
    // Submitting without a target (the button is disabled) does nothing.
    dialog.element().querySelector('form')?.requestSubmit();
    expect(server.mergeCategories).not.toHaveBeenCalled();
    await dialog.getByRole('combobox', { name: 'Gabungkan ke' }).click();
    expect(screen.getByRole('option').elements()).toHaveLength(1);
    await screen.getByRole('option', { name: /Hiburan/ }).click();
    await expect
      .element(dialog.getByRole('status'))
      .toHaveTextContent('12 transaksi dipindah dari Belanja ke Hiburan. Belanja dihapus.');

    await dialog.getByRole('button', { name: 'Gabungkan' }).click();
    await expect.element(dialog.getByText('Kategori ini tidak cocok dengan jenis transaksinya.')).toBeVisible();
    await dialog.getByRole('button', { name: 'Gabungkan' }).click();
    expect(merged).toHaveBeenCalledWith(SOURCE, TARGET, 12);

    await userEvent.keyboard('{Escape}');
    expect(close).toHaveBeenCalled();
  });

  it('stays closed without a source', async () => {
    const { screen } = await renderApp(
      <CategoryMergeDialog source={null} categories={OTHERS} onClose={vi.fn()} onMerged={vi.fn()} />,
    );
    await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument();
  });
});
