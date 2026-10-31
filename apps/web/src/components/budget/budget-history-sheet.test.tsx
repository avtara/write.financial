// SPDX-License-Identifier: AGPL-3.0-only
import type { BudgetHistoryEntry } from '@wf/db/budgets';
import type { YearMonth } from '@wf/domain/period';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { categoryView } from '../../../test/ledger-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import { BudgetHistorySheet, monthlyTotals } from './budget-history-sheet.tsx';

const server = vi.hoisted(() => ({ getBudgetHistory: vi.fn() }));
vi.mock('../../server/fn/budget.ts', () => server);

const AT = new Date('2026-10-05T02:30:00Z');
const ym = (label: string) => label as YearMonth;

function entry(effectiveFrom: string, totalMinor: bigint, changes: BudgetHistoryEntry['changes']): BudgetHistoryEntry {
  return {
    versionId: `v-${effectiveFrom}`,
    effectiveFrom: ym(effectiveFrom),
    totalMinor,
    lineCount: 5,
    createdAt: AT,
    changes,
  };
}

const CATEGORIES = [
  categoryView({ id: 'food', name: 'Makan', group: 'needs', icon: 'utensils' }),
  categoryView({ id: 'shopping', name: 'Belanja' }),
  categoryView({ id: 'fun', name: 'Hiburan' }),
  categoryView({ id: 'unchanged', name: 'Kopi' }),
];

/** Newest first, like the server. */
const HISTORY: BudgetHistoryEntry[] = [
  entry('2026-10', 12_700_000n, [
    { categoryId: 'food', change: 'updated', fromMinor: 3_500_000n, toMinor: 3_700_000n, at: AT },
    { categoryId: 'gone', change: 'added', fromMinor: null, toMinor: 100_000n, at: AT },
    { categoryId: 'shopping', change: 'removed', fromMinor: 2_000_000n, toMinor: null, at: AT },
  ]),
  entry('2026-09', 14_600_000n, [
    { categoryId: 'fun', change: 'added', fromMinor: null, toMinor: null, at: AT },
    { categoryId: 'shopping', change: 'removed', fromMinor: null, toMinor: null, at: AT },
    { categoryId: 'food', change: 'updated', fromMinor: null, toMinor: null, at: AT },
  ]),
  entry('2026-08', 14_600_000n, null),
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe('monthlyTotals', () => {
  it('runs from the first version to the month after the current one', () => {
    expect(monthlyTotals([], ym('2026-10'))).toEqual([]);
    expect(monthlyTotals(HISTORY, ym('2026-10'))).toEqual([
      { label: '2026-08', totalMinor: 14_600_000n, automatic: false },
      { label: '2026-09', totalMinor: 14_600_000n, automatic: false },
      { label: '2026-10', totalMinor: 12_700_000n, automatic: false },
      { label: '2026-11', totalMinor: 12_700_000n, automatic: true },
    ]);
  });

  it('wraps December into January and keeps a version starting next month', () => {
    expect(monthlyTotals([entry('2026-12', 1n, null)], ym('2026-12'))).toEqual([
      { label: '2026-12', totalMinor: 1n, automatic: false },
      { label: '2027-01', totalMinor: 1n, automatic: true },
    ]);
    expect(monthlyTotals([entry('2026-11', 2n, []), entry('2026-10', 1n, null)], ym('2026-10'))).toEqual([
      { label: '2026-10', totalMinor: 1n, automatic: false },
      { label: '2026-11', totalMinor: 2n, automatic: false },
    ]);
  });
});

async function renderSheet(current = '2026-10', open = true) {
  const onOpenChange = vi.fn();
  const { screen } = await renderApp(
    <BudgetHistorySheet
      open={open}
      onOpenChange={onOpenChange}
      categories={CATEGORIES}
      current={ym(current)}
      timeZone="Asia/Jakarta"
    />,
  );
  return { screen, sheet: screen.getByRole('dialog', { name: 'Riwayat perubahan anggaran' }), onOpenChange };
}

describe('BudgetHistorySheet', () => {
  it('shows the monthly totals and every change, filterable by category', async () => {
    server.getBudgetHistory.mockResolvedValue({ ok: true, value: HISTORY });
    const { sheet, onOpenChange } = await renderSheet();
    await expect.element(sheet.getByText('Perubahan sejak Agustus 2026')).toBeVisible();
    await expect.element(sheet.getByText('7 perubahan')).toBeVisible();
    const totals = sheet.getByRole('region', { name: 'Total anggaran per bulan' });
    await expect
      .element(totals)
      .toMatchTextContent(/^Total anggaran per bulanRp12\.700\.000berlaku sampai diubah lagi/);
    await expect.element(totals.getByText('Nov · otomatis')).toBeVisible();
    await expect.element(totals.getByText('Okt', { exact: true })).toHaveClass('font-semibold');
    await expect.element(totals.getByText('Agu', { exact: true })).toHaveClass('text-subtle');

    await expect.element(sheet.getByText('Berlaku mulai Oktober 2026')).toBeVisible();
    await expect.element(sheet.getByText('+200.000')).toHaveClass('text-green-fg');
    await expect.element(sheet.getByText('Kategori terhapus')).toBeVisible();
    await expect.element(sheet.getByText('Kategori baru · Rp100.000')).toBeVisible();
    await expect.element(sheet.getByText('Dihapus dari anggaran · Rp2.000.000')).toBeVisible();
    await expect.element(sheet.getByText('−2.000.000')).toHaveClass('text-red-fg');
    await expect.element(sheet.getByText('Kategori baru · Rp0')).toBeVisible();
    await expect.element(sheet.getByText('Dihapus dari anggaran · Rp0')).toBeVisible();
    await expect.element(sheet.getByText('Anggaran dibuat')).toBeVisible();
    await expect.element(sheet.getByText('5 kategori')).toBeVisible();
    expect(sheet.getByText(/^5 Okt · 09[.:]30$/).elements().length).toBeGreaterThan(0);

    const filter = sheet.getByRole('combobox', { name: 'Saring kategori' });
    expect([...(filter.element() as HTMLSelectElement).options].map((option) => option.text)).toEqual([
      'Semua kategori',
      'Makan',
      'Belanja',
      'Hiburan',
    ]);
    await filter.selectOptions('fun');
    await expect.element(sheet.getByText('Berlaku mulai Oktober 2026')).not.toBeInTheDocument();
    await expect.element(sheet.getByText('Berlaku mulai September 2026')).toBeVisible();
    await expect.element(sheet.getByText('Anggaran dibuat')).not.toBeInTheDocument();
    await filter.selectOptions('');
    await expect.element(sheet.getByText('Anggaran dibuat')).toBeVisible();

    await userEvent.keyboard('{Escape}');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('leaves out the chart for a month before the first version', async () => {
    server.getBudgetHistory.mockResolvedValue({ ok: true, value: HISTORY });
    const { sheet } = await renderSheet('2026-07');
    await expect.element(sheet.getByText('Anggaran dibuat')).toBeVisible();
    await expect.element(sheet.getByRole('region', { name: 'Total anggaran per bulan' })).not.toBeInTheDocument();
  });

  it('shows loading, failure, and an empty history', async () => {
    const pending = Promise.withResolvers<unknown>();
    server.getBudgetHistory.mockReturnValueOnce(pending.promise);
    const first = await renderSheet();
    await expect.element(first.sheet.getByText('Memuat riwayat…')).toBeVisible();
    await first.screen.unmount();
    pending.resolve({ ok: true, value: HISTORY });
    await pending.promise;

    server.getBudgetHistory.mockResolvedValueOnce({ ok: false, code: 'NOT_FOUND' });
    const second = await renderSheet();
    await expect.element(second.sheet.getByText('Riwayat gagal dimuat')).toBeVisible();
    await expect.element(second.sheet.getByText('Data ini sudah tidak ada. Muat ulang halaman.')).toBeVisible();
    await second.screen.unmount();

    server.getBudgetHistory.mockResolvedValueOnce({ ok: true, value: [] });
    const third = await renderSheet();
    await expect.element(third.sheet.getByText('Belum ada riwayat anggaran')).toBeVisible();
    await third.screen.unmount();

    const closed = await renderSheet('2026-10', false);
    await expect.element(closed.screen.getByRole('dialog')).not.toBeInTheDocument();
    expect(server.getBudgetHistory).toHaveBeenCalledTimes(3);
  });
});
