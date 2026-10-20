// SPDX-License-Identifier: AGPL-3.0-only
import type { BudgetLineView } from '@wf/db/budgets';
import type { CategoryView } from '@wf/db/categories';
import { useState } from 'react';
import { describe, expect, it, vi, type Mock } from 'vitest';
import { userEvent } from 'vitest/browser';
import { budgetLine, FOOD, LINES, RENT, SHOPPING, TRANSPORT } from '../../../test/budget-fixtures.ts';
import { categoryView } from '../../../test/ledger-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import { BudgetList, LineNote, type BudgetLineActions } from './budget-list.tsx';

const CATEGORIES: CategoryView[] = [
  categoryView({ id: 'food', name: 'Makan', group: 'needs' }),
  categoryView({ id: 'coffee', name: 'Kopi', group: 'wants', icon: 'coffee', sortOrder: 2 }),
  categoryView({ id: 'books', name: 'Buku', group: 'wants', icon: 'no-such-icon', sortOrder: 1 }),
  categoryView({ id: 'health', name: 'Kesehatan', group: 'needs', icon: 'heart-pulse' }),
  categoryView({ id: 'salary', name: 'Gaji', kind: 'income', group: 'active' }),
  categoryView({ id: 'old', name: 'Lama', archivedAt: new Date('2026-01-01') }),
];

/** Every row action as a mock. */
type ActionMocks = { readonly [K in keyof BudgetLineActions]: Mock<BudgetLineActions[K]> };

function actionsMock(): ActionMocks {
  return {
    onEditLimit: vi.fn(),
    onSaveLimit: vi.fn(),
    onCancelEdit: vi.fn(),
    onMoveFrom: vi.fn(),
    onDetail: vi.fn(),
    onOptions: vi.fn(),
    onRemove: vi.fn(),
  };
}

function Harness({
  lines = LINES,
  readOnly = false,
  actions,
  onAdd = vi.fn(),
  onCreateCategory = vi.fn(),
}: {
  lines?: readonly BudgetLineView[];
  readOnly?: boolean;
  actions: ActionMocks;
  onAdd?: (categoryId: string) => void;
  onCreateCategory?: () => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  return (
    <BudgetList
      lines={lines}
      readOnly={readOnly}
      idealBps={4839}
      totalLimitMinor={12_500_000n}
      editingId={editingId}
      actions={{
        ...actions,
        onEditLimit: (line) => {
          actions.onEditLimit(line);
          setEditingId(line.categoryId);
        },
        onCancelEdit: () => {
          actions.onCancelEdit();
          setEditingId(null);
        },
        onSaveLimit: async (...args) => {
          const saved = await actions.onSaveLimit(...args);
          if (saved) setEditingId(null);
          return saved;
        },
      }}
      categories={CATEGORIES}
      spending={[{ categoryId: 'coffee', kind: 'expense', totalMinor: 22_660n, count: 3, shareBps: 10 }]}
      onAdd={onAdd}
      onCreateCategory={onCreateCategory}
    />
  );
}

const names = (scope: { element: () => Element }) =>
  [...scope.element().querySelectorAll('li button:first-child')].map((button) => button.textContent);

describe('BudgetList', () => {
  it('groups the rows into Needs and Wants with each line’s note, limit, and share', async () => {
    const actions = actionsMock();
    const { screen } = await renderApp(<Harness actions={actions} />);
    const list = screen.getByRole('region', { name: 'Anggaran per kategori' });
    await expect.element(list.getByText('5 kategori · garis putih = posisi ideal hari ini')).toBeVisible();
    const needs = list.getByRole('region', { name: 'Kebutuhan' });
    await expect.element(needs.getByRole('heading')).toHaveTextContent('KebutuhanRp8.800.000 / Rp9.500.000');
    await expect.element(needs.getByText('sisa Rp300.000 · Rp18.000/hari')).toBeVisible();
    await expect.element(needs.getByText('lunas')).toBeVisible();
    const wants = list.getByRole('region', { name: 'Keinginan' });
    await expect.element(wants.getByText('lewat Rp400.000')).toHaveClass('text-red-fg');
    await expect.element(wants.getByText('belum terpakai')).toBeVisible();
    expect(wants.getByText('120%').element().parentElement?.className).toContain('text-red-fg');
    await expect.element(list.getByRole('button', { name: 'Ubah batas Makan' })).toHaveTextContent('3.500.000');

    await list.getByRole('button', { name: 'Makan', exact: true }).click();
    expect(actions.onDetail).toHaveBeenCalledWith(FOOD);
  });

  it('shows the group tabs with their summary', async () => {
    const zero = budgetLine({ categoryId: 'fees', group: 'financial', name: 'Biaya', limitMinor: 0n, spentMinor: 0n });
    const { screen } = await renderApp(<Harness actions={actionsMock()} lines={[...LINES, zero]} />);
    await screen.getByRole('tab', { name: 'Keinginan' }).click();
    const panel = screen.getByRole('tabpanel');
    await expect.element(panel.getByText('2 kategori Keinginan · Rp2.400.000 dari Rp3.000.000 (80%)')).toBeVisible();
    expect(names(panel)).toEqual(['Belanja Online', 'Hiburan']);
    await screen.getByRole('tab', { name: 'Biaya keuangan' }).click();
    await expect.element(screen.getByRole('tabpanel').getByText(/\(—\)$/)).toBeVisible();
    await screen.getByRole('tab', { name: 'Semua' }).click();
    await expect.element(screen.getByRole('region', { name: 'Biaya keuangan' })).toBeVisible();
  });

  it('sorts the rows and drops the grouping', async () => {
    const { screen } = await renderApp(<Harness actions={actionsMock()} />);
    await screen.getByRole('button', { name: 'Urutkan: Urutan sendiri' }).click();
    await screen.getByRole('menuitemradio', { name: 'Nama A–Z' }).click();
    await expect.element(screen.getByRole('button', { name: 'Urutkan: Nama A–Z' })).toBeVisible();
    expect(names(screen.getByRole('region', { name: 'Kebutuhan' }))).toEqual(['Makan', 'Sewa', 'Transportasi']);
    await screen.getByRole('button', { name: 'Urutkan: Nama A–Z' }).click();
    await screen.getByRole('menuitemcheckbox', { name: 'Kelompokkan Kebutuhan & Keinginan' }).click();
    await expect.element(screen.getByRole('region', { name: 'Kebutuhan' })).not.toBeInTheDocument();
    expect(names(screen.getByRole('tabpanel'))).toEqual(['Belanja Online', 'Hiburan', 'Makan', 'Sewa', 'Transportasi']);
  });

  it('edits a limit in place: ↵ saves, a failed save keeps the editor, Esc cancels', async () => {
    const actions = actionsMock();
    actions.onSaveLimit.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const { screen } = await renderApp(<Harness actions={actions} />);
    await screen.getByRole('button', { name: 'Ubah batas Makan' }).click();
    expect(actions.onEditLimit).toHaveBeenCalledWith(FOOD);
    const input = screen.getByRole('textbox', { name: 'Ubah batas Makan' });
    await expect.element(input).toHaveFocus();
    await expect.element(input).toHaveValue('3.500.000');
    await expect.element(screen.getByText(/total Rp/)).not.toBeInTheDocument();
    await userEvent.fill(input, '3.700.000');
    await expect.element(screen.getByText('+Rp200.000 → total Rp12.700.000')).toHaveClass('text-amber-fg');
    await userEvent.fill(input, '3.000.000');
    await expect.element(screen.getByText('−Rp500.000 → total Rp12.000.000')).toHaveClass('text-green-fg');

    await userEvent.keyboard('{Enter}');
    expect(actions.onSaveLimit).toHaveBeenCalledWith(FOOD, 3_000_000n);
    await expect.element(input).toBeEnabled();
    await userEvent.click(input);
    await userEvent.keyboard('{Enter}');
    await expect.element(input).not.toBeInTheDocument();
    expect(actions.onSaveLimit).toHaveBeenCalledTimes(2);

    await screen.getByRole('button', { name: 'Ubah batas Transportasi' }).click();
    const transport = screen.getByRole('textbox', { name: 'Ubah batas Transportasi' });
    await userEvent.fill(transport, '');
    await userEvent.keyboard('{Enter}');
    expect(actions.onSaveLimit).toHaveBeenCalledTimes(2);
    await userEvent.keyboard('{Escape}');
    expect(actions.onCancelEdit).toHaveBeenCalledOnce();
    await expect.element(transport).not.toBeInTheDocument();
  });

  it('offers the FR-B4 options and the row actions in the menu', async () => {
    const actions = actionsMock();
    const { screen } = await renderApp(<Harness actions={actions} />);
    const open = async (name: string) => {
      await screen.getByRole('button', { name: `Opsi ${name}` }).click();
    };

    await open('Makan');
    await expect.element(screen.getByRole('menuitem', { name: /^Ubah batas/ })).toMatchTextContent(/3\.500\.000$/);
    const move = screen.getByRole('menuitem', { name: /^Pindahkan sisa ke…/ });
    await expect.element(move).toMatchTextContent(/Rp300\.000$/);
    await move.click();
    expect(actions.onMoveFrom).toHaveBeenCalledWith(FOOD);
    await open('Makan');
    await screen.getByRole('menuitem', { name: 'Lihat detail' }).click();
    expect(actions.onDetail).toHaveBeenCalledWith(FOOD);
    await open('Makan');
    await screen.getByRole('menuitemcheckbox', { name: 'Bawa sisa ke bulan depan' }).click();
    expect(actions.onOptions).toHaveBeenLastCalledWith(FOOD, { rollover: true });
    await open('Makan');
    await screen.getByRole('menuitemcheckbox', { name: 'Anggaran tetap' }).click();
    expect(actions.onOptions).toHaveBeenLastCalledWith(FOOD, { isFixed: true });
    await open('Makan');
    await expect.element(screen.getByRole('menuitemradio', { name: 'Ingatkan di 85%' })).toBeChecked();
    await screen.getByRole('menuitemradio', { name: 'Ingatkan di 50%' }).click();
    expect(actions.onOptions).toHaveBeenLastCalledWith(FOOD, { alertPct: 50 });
    await open('Makan');
    await screen.getByRole('menuitem', { name: 'Hapus dari anggaran' }).click();
    expect(actions.onRemove).toHaveBeenCalledWith(FOOD);
    await open('Makan');
    await screen.getByRole('menuitem', { name: /^Ubah batas/ }).click();
    expect(actions.onEditLimit).toHaveBeenCalledWith(FOOD);
    await expect.element(screen.getByRole('textbox', { name: 'Ubah batas Makan' })).toBeVisible();

    // Fixed or nothing left: nothing to move.
    await open('Sewa');
    await expect
      .element(screen.getByRole('menuitem', { name: 'Pindahkan sisa ke…' }))
      .toHaveAttribute('aria-disabled', 'true');
  });

  it('adds an unbudgeted expense category or creates a new one', async () => {
    const onAdd = vi.fn();
    const onCreateCategory = vi.fn();
    const { screen } = await renderApp(
      <Harness actions={actionsMock()} onAdd={onAdd} onCreateCategory={onCreateCategory} />,
    );
    await screen.getByRole('button', { name: 'Tambah kategori anggaran' }).click();
    await expect
      .element(screen.getByRole('option', { name: /^Kesehatan/ }))
      .toHaveTextContent('KesehatanRp0 bulan ini');
    await expect.element(screen.getByRole('option', { name: /^Kopi/ })).toHaveTextContent('KopiRp22.660 bulan ini');
    expect(
      screen
        .getByRole('option')
        .elements()
        .map((option) => option.textContent.split('Rp')[0]),
    ).toEqual(['Kesehatan', 'Buku', 'Kopi']);
    await screen.getByRole('option', { name: /^Kopi/ }).click();
    expect(onAdd).toHaveBeenCalledWith('coffee');

    await screen.getByRole('button', { name: 'Tambah kategori anggaran' }).click();
    await screen.getByRole('button', { name: 'Buat kategori baru' }).click();
    expect(onCreateCategory).toHaveBeenCalledOnce();
    await expect.element(screen.getByRole('combobox')).not.toBeInTheDocument();
  });

  it('shows a closed period without edit controls', async () => {
    const dismissed = { ...TRANSPORT, dismissed: true, willExceedByMinor: 50_000n };
    const { screen } = await renderApp(
      <Harness actions={actionsMock()} readOnly lines={[FOOD, dismissed, RENT, SHOPPING]} />,
    );
    await expect.element(screen.getByText('4 kategori · 1 lewat batas')).toBeVisible();
    await expect.element(screen.getByText('sisa Rp300.000', { exact: true })).toBeVisible();
    await expect.element(screen.getByRole('img', { name: 'Peringatan diabaikan' })).toBeVisible();
    await expect.element(screen.getByText('sisa Rp400.000', { exact: true })).toBeVisible();
    await expect.element(screen.getByRole('button', { name: /^Ubah batas/ })).not.toBeInTheDocument();
    await expect.element(screen.getByRole('button', { name: /^Opsi/ })).not.toBeInTheDocument();
    await expect.element(screen.getByRole('button', { name: 'Tambah kategori anggaran' })).not.toBeInTheDocument();
    await expect.element(screen.getByText('3.500.000', { exact: true })).toHaveClass('text-subtle');
  });
});

describe('LineNote', () => {
  it('warns before a line goes over and shows what is left of a fixed one', async () => {
    const { screen } = await renderApp(
      <ul>
        <li data-testid="will">
          <LineNote line={{ ...TRANSPORT, willExceedByMinor: 50_000n }} readOnly={false} />
        </li>
        <li data-testid="fixed">
          <LineNote line={{ ...RENT, state: 'ok', spentMinor: 0n, remainingMinor: 4_000_000n }} readOnly={false} />
        </li>
        <li data-testid="over">
          <LineNote line={SHOPPING} readOnly />
        </li>
      </ul>,
    );
    await expect.element(screen.getByTestId('will')).toHaveTextContent('akan lewat Rp50.000');
    await expect.element(screen.getByTestId('fixed')).toHaveTextContent('sisa Rp4.000.000');
    await expect.element(screen.getByTestId('over')).toHaveTextContent('lewat Rp400.000');
  });
});
