// SPDX-License-Identifier: AGPL-3.0-only
import type { BudgetStatus } from '@wf/db/budgets';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { budgetStatus, FOOD, FUN, RENT } from '../../../test/budget-fixtures.ts';
import { categoryView } from '../../../test/ledger-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import { BudgetSetupSheet } from './budget-setup-sheet.tsx';

const server = vi.hoisted(() => ({ getBudgetFill: vi.fn(), saveBudgetVersion: vi.fn() }));
vi.mock('../../server/fn/budget.ts', () => ({ getBudgetFill: server.getBudgetFill }));
vi.mock('../../server/fn/budget-write.ts', () => ({ saveBudgetVersion: server.saveBudgetVersion }));
const toasts = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock('@wf/ui/toast', () => toasts);

const CATEGORIES = [
  categoryView({ id: 'food', name: 'Makan', group: 'needs' }),
  categoryView({ id: 'coffee', name: 'Kopi', group: 'wants', icon: 'coffee' }),
  categoryView({ id: 'books', name: 'Buku', group: 'financial', icon: 'no-such-icon' }),
  categoryView({ id: 'salary', name: 'Gaji', kind: 'income', group: 'active' }),
  categoryView({ id: 'old', name: 'Lama', archivedAt: new Date('2026-01-01') }),
];

const ok = <T,>(value: T) => Promise.resolve({ ok: true, value });

async function renderSheet(status: BudgetStatus = budgetStatus(), open = true) {
  const onOpenChange = vi.fn();
  const onSaved = vi.fn();
  const { screen } = await renderApp(
    <BudgetSetupSheet
      open={open}
      onOpenChange={onOpenChange}
      status={status}
      categories={CATEGORIES}
      onSaved={onSaved}
    />,
  );
  return { screen, sheet: screen.getByRole('dialog', { name: 'Atur anggaran' }), onOpenChange, onSaved };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('BudgetSetupSheet', () => {
  it('fills from the 3-month average, edits limits, and saves the version from this period', async () => {
    server.getBudgetFill.mockReturnValue(
      ok([
        { categoryId: 'food', averageMinor: 3_300_000n },
        { categoryId: 'transport', averageMinor: 1_800_000n },
        { categoryId: 'coffee', averageMinor: 150_000n },
      ]),
    );
    server.saveBudgetVersion.mockReturnValue(ok({ id: 'v-2' }));
    const { sheet, onSaved } = await renderSheet();
    expect(server.getBudgetFill).toHaveBeenCalledWith({ data: { periodId: 'p-okt' } });
    await expect.element(sheet.getByText('Berlaku setiap bulan sampai diubah lagi')).toBeVisible();
    await expect.element(sheet.getByRole('textbox', { name: 'Pemasukan per bulan' })).toHaveValue('15.000.000');
    const allocated = sheet.getByRole('region', { name: 'Dialokasikan' });
    await expect.element(allocated).toMatchTextContent(/DialokasikanRp12\.500\.000Sisa pemasukanRp2\.500\.000/);
    await expect.element(allocated).toMatchTextContent(/Kebutuhan Rp9\.500\.000Keinginan Rp3\.000\.000$/);
    await expect.element(sheet.getByText('5 kategori')).toBeVisible();
    const needs = sheet.getByRole('region', { name: 'Kebutuhan' });
    await expect.element(needs.getByText('rata-rata 3 bulan Rp3.300.000')).toBeVisible();
    await expect.element(needs.getByText('belum ada rata-rata')).toBeVisible();
    await expect.element(sheet.getByText('0 perubahan · berlaku mulai Oktober 2026')).toBeVisible();

    await sheet.getByRole('button', { name: 'Isi dari rata-rata 3 bulan' }).click();
    await expect.element(sheet.getByRole('textbox', { name: 'Batas Makan' })).toHaveValue('3.300.000');
    await expect.element(sheet.getByRole('textbox', { name: 'Batas Transportasi' })).toHaveValue('1.800.000');
    await expect.element(sheet.getByRole('textbox', { name: 'Batas Sewa' })).toHaveValue('4.000.000');
    // Makan 3.500.000 → 3.300.000 and Transportasi 2.000.000 → 1.800.000.
    await expect.element(needs.getByText('−200.000').first()).toHaveClass('text-red-fg');
    expect(needs.getByText('−200.000').elements()).toHaveLength(2);
    await userEvent.fill(sheet.getByRole('textbox', { name: 'Batas Hiburan' }), '1.500.000');
    await expect.element(sheet.getByText('+500.000')).toHaveClass('text-green-fg');
    await expect.element(sheet.getByText('3 perubahan · berlaku mulai Oktober 2026')).toBeVisible();
    await expect.element(allocated).toMatchTextContent(/Rp12\.600\.000Sisa pemasukanRp2\.400\.000/);

    await sheet.getByRole('button', { name: 'Simpan anggaran' }).click();
    expect(server.saveBudgetVersion).toHaveBeenCalledWith({
      data: {
        effectiveFrom: '2026-10',
        expectedIncomeMinor: 15_000_000n,
        lines: [
          { categoryId: 'food', limitMinor: 3_300_000n, rollover: false, isFixed: false, alertPct: 85 },
          { categoryId: 'transport', limitMinor: 1_800_000n, rollover: false, isFixed: false, alertPct: 85 },
          { categoryId: 'rent', limitMinor: 4_000_000n, rollover: false, isFixed: true, alertPct: 85 },
          { categoryId: 'shopping', limitMinor: 2_000_000n, rollover: false, isFixed: false, alertPct: 85 },
          { categoryId: 'fun', limitMinor: 1_500_000n, rollover: false, isFixed: false, alertPct: 85 },
        ],
      },
    });
    await vi.waitFor(() => {
      expect(onSaved).toHaveBeenCalledOnce();
    });
    expect(toasts.toast).toHaveBeenCalledWith({ title: 'Anggaran disimpan, berlaku mulai Oktober 2026' });
  });

  it('adds and removes categories, needs every limit, and shows income over-allocated', async () => {
    server.getBudgetFill.mockReturnValue(ok([{ categoryId: 'coffee', averageMinor: 150_000n }]));
    server.saveBudgetVersion.mockReturnValue(Promise.resolve({ ok: false, code: 'PERIOD_CLOSED' }));
    const { screen, sheet, onSaved } = await renderSheet();
    await expect.element(sheet.getByText('rata-rata 3 bulan Rp150.000')).not.toBeInTheDocument();

    await sheet.getByRole('button', { name: 'Hapus Hiburan dari anggaran' }).click();
    await expect.element(sheet.getByRole('textbox', { name: 'Batas Hiburan' })).not.toBeInTheDocument();
    await expect.element(sheet.getByText('1 perubahan · berlaku mulai Oktober 2026')).toBeVisible();

    await sheet.getByRole('button', { name: 'Tambah kategori' }).click();
    await expect.element(screen.getByRole('option', { name: 'Makan' })).not.toBeInTheDocument();
    await expect.element(screen.getByRole('option', { name: 'Gaji' })).not.toBeInTheDocument();
    await screen.getByRole('option', { name: 'Kopi' }).click();
    await expect.element(sheet.getByRole('textbox', { name: 'Batas Kopi' })).toHaveValue('150.000');
    await expect.element(sheet.getByText('rata-rata 3 bulan Rp150.000')).toBeVisible();
    await sheet.getByRole('button', { name: 'Tambah kategori' }).click();
    await screen.getByRole('option', { name: 'Buku' }).click();
    await expect.element(sheet.getByRole('textbox', { name: 'Batas Buku' })).toHaveValue('0');
    await expect
      .element(sheet.getByRole('region', { name: 'Biaya keuangan' }).getByText('kategori baru'))
      .toBeVisible();

    await userEvent.fill(sheet.getByRole('textbox', { name: 'Batas Makan' }), '');
    await expect.element(sheet.getByRole('button', { name: 'Simpan anggaran' })).toBeDisabled();
    await userEvent.fill(sheet.getByRole('textbox', { name: 'Batas Makan' }), '9.000.000');
    await expect
      .element(sheet.getByRole('region', { name: 'Dialokasikan' }))
      .toMatchTextContent(/Sisa pemasukan.Rp2\.150\.000/);
    await expect.element(sheet.getByText(/^.Rp2\.150\.000$/)).toHaveClass('text-red-fg');

    await sheet.getByRole('button', { name: 'Simpan anggaran' }).click();
    await vi.waitFor(() => {
      expect(toasts.toast).toHaveBeenCalledWith({
        tone: 'error',
        title: 'Anggaran gagal disimpan',
        description: 'Periode ini sudah ditutup dan hanya bisa dibaca.',
      });
    });
    expect(onSaved).not.toHaveBeenCalled();
    await expect.element(sheet.getByRole('button', { name: 'Simpan anggaran' })).toBeEnabled();
  });

  it('works without an income, a version, or averages, and cancels', async () => {
    server.getBudgetFill.mockReturnValue(Promise.resolve({ ok: false, code: 'NOT_FOUND' }));
    server.saveBudgetVersion.mockRejectedValue(new Error('offline'));
    const { sheet, onOpenChange } = await renderSheet(budgetStatus({ version: null, lines: [FOOD] }));
    await expect.element(sheet.getByRole('textbox', { name: 'Pemasukan per bulan' })).toHaveValue('');
    await expect.element(sheet.getByText('Sisa pemasukan')).not.toBeInTheDocument();
    await expect.element(sheet.getByRole('button', { name: 'Isi dari rata-rata 3 bulan' })).toBeDisabled();
    await sheet.getByRole('button', { name: 'Hapus Makan dari anggaran' }).click();
    await expect.element(sheet.getByText('0 kategori')).toBeVisible();
    await sheet.getByRole('button', { name: 'Simpan anggaran' }).click();
    await vi.waitFor(() => {
      expect(toasts.toast).toHaveBeenCalledWith(expect.objectContaining({ tone: 'error' }));
    });
    expect(server.saveBudgetVersion).toHaveBeenCalledWith({
      data: { effectiveFrom: '2026-10', expectedIncomeMinor: null, lines: [] },
    });
    await sheet.getByRole('button', { name: 'Batal' }).click();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('keeps the fill off without suggestions and ignores a late answer after closing', async () => {
    server.getBudgetFill.mockReturnValueOnce(ok([]));
    const first = await renderSheet(budgetStatus({ lines: [RENT, FUN] }));
    await expect.element(first.sheet.getByRole('button', { name: 'Isi dari rata-rata 3 bulan' })).toBeDisabled();
    await first.screen.unmount();

    const late = Promise.withResolvers<unknown>();
    server.getBudgetFill.mockReturnValueOnce(late.promise);
    const second = await renderSheet();
    await second.screen.unmount();
    late.resolve({ ok: true, value: [{ categoryId: 'food', averageMinor: 1n }] });
    await late.promise;

    const closed = await renderSheet(budgetStatus(), false);
    await expect.element(closed.screen.getByRole('dialog')).not.toBeInTheDocument();
  });
});
