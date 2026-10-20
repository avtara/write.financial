// SPDX-License-Identifier: AGPL-3.0-only
import type { LocalDate } from '@wf/domain/period';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { BCA, JAGO, LEDGER, userCategory } from '../../../test/ledger-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import { transactionsView } from '../../../test/transaction-fixtures.ts';
import type { TransactionsSearch } from '../../lib/transactions-search.ts';
import type { TransactionsView } from '../../server/fn/transactions.ts';
import { datePresets, NoResults, TransactionFilters } from './transaction-filters.tsx';

const KOPI = userCategory({ id: 'c-kopi', name: 'Kopi' });
const SEWA = userCategory({ id: 'c-sewa', name: 'Sewa', group: 'needs' });
const GAJI = userCategory({ id: 'c-gaji', name: 'Gaji', kind: 'income', group: 'active' });
const ADMIN = userCategory({ id: 'c-admin', name: 'Admin bank', kind: 'fee', group: 'financial' });
const OLD = userCategory({ id: 'c-old', name: 'Lama', archivedAt: new Date('2026-01-01T00:00:00Z') });
const ledger = { ...LEDGER, categories: [KOPI, SEWA, GAJI, ADMIN, OLD] };

const BASE = transactionsView([]);
const [OCTOBER] = BASE.periods;
if (OCTOBER === undefined) throw new Error('no period');
const SEPTEMBER = {
  ...OCTOBER,
  id: 'p-09',
  label: '2026-09' as typeof OCTOBER.label,
  start: '2026-09-01' as LocalDate,
  end: '2026-09-30' as LocalDate,
  days: 30,
};
const group = (categoryId: string | null, count: number) => ({
  categoryId,
  kind: 'expense' as const,
  totalMinor: 0n,
  count,
  shareBps: 0,
});
const VIEW: TransactionsView = {
  ...BASE,
  periods: [SEPTEMBER, OCTOBER],
  summary: { ...BASE.summary, outCount: 41, inCount: 2, transferCount: 3 },
  categories: [group(KOPI.id, 5), group(null, 4)],
  accounts: [{ accountId: BCA.id, count: 7, inMinor: 0n, outMinor: 0n }],
};

async function renderFilters(search: TransactionsSearch = {}, view = VIEW, ledgerData = ledger) {
  const onSearchChange = vi.fn();
  const result = await renderApp(
    <TransactionFilters view={view} search={search} ledger={ledgerData} onSearchChange={onSearchChange} />,
  );
  return { ...result, onSearchChange, row: result.screen.getByRole('group', { name: 'Filter transaksi' }) };
}

const chip = (name: RegExp) => page.getByRole('button', { name });
const popover = (name: string) => page.getByRole('dialog', { name });

afterEach(() => {
  vi.clearAllMocks();
});

describe('datePresets', () => {
  it('offers today through this year, the week starting on the chosen day', () => {
    const today = '2026-10-15' as LocalDate;
    expect(datePresets(today, 'monday').map((preset) => [preset.label, preset.range])).toEqual([
      ['Hari ini', { start: today, end: today }],
      ['Kemarin', { start: '2026-10-14', end: '2026-10-14' }],
      ['Minggu ini', { start: '2026-10-12', end: today }],
      ['7 hari terakhir', { start: '2026-10-09', end: today }],
      ['Bulan ini', { start: '2026-10-01', end: today }],
      ['Bulan lalu', { start: '2026-09-01', end: '2026-09-30' }],
      ['Tahun ini', { start: '2026-01-01', end: today }],
    ]);
    expect(datePresets(today, 'sunday')[2]?.range.start).toBe('2026-10-11');
  });
});

describe('TransactionFilters', () => {
  it('picks a date range, a whole period, or goes back to the current period', async () => {
    const { onSearchChange } = await renderFilters();
    await expect.element(page.getByRole('button', { name: 'Kembali ke periode ini' })).not.toBeInTheDocument();
    await userEvent.click(chip(/^Tanggal/));
    await userEvent.click(page.getByRole('button', { name: /^7 hari terakhir/ }));
    await expect.element(page.getByText('7 hari · melintasi 1 periode')).toBeVisible();
    await userEvent.click(page.getByRole('button', { name: 'Terapkan' }));
    expect(onSearchChange).toHaveBeenLastCalledWith({ range: '2026-10-09..2026-10-15', period: undefined });
    await userEvent.click(chip(/^Tanggal/));
    await userEvent.click(page.getByRole('button', { name: /^Bulan lalu/ }));
    await userEvent.click(page.getByRole('button', { name: 'Terapkan' }));
    expect(onSearchChange).toHaveBeenLastCalledWith({ period: '2026-09', range: undefined });
  });

  it('resets a chosen range or period', async () => {
    const searches: TransactionsSearch[] = [{ range: '2026-10-01..2026-10-05' }, { period: SEPTEMBER.label }];
    for (const search of searches) {
      const { onSearchChange, screen } = await renderFilters(search);
      await userEvent.click(page.getByRole('button', { name: 'Kembali ke periode ini' }));
      expect(onSearchChange).toHaveBeenCalledWith({ range: undefined, period: undefined });
      await screen.unmount();
    }
  });

  it('filters by type with counts, clears, and removes the filter', async () => {
    const { onSearchChange } = await renderFilters();
    const type = chip(/^Jenis/);
    await expect.element(type).toHaveTextContent('JenisSemua');
    await userEvent.click(type);
    const list = popover('Jenis');
    await expect.element(list.getByText('41')).toBeVisible();
    await expect.element(list.getByText('2', { exact: true })).toBeVisible();
    await expect.element(list.getByText('3', { exact: true })).toBeVisible();
    const clear = list.getByRole('button', { name: 'Hapus pilihan' });
    await expect.element(clear).toBeDisabled();
    // Escape closes without applying.
    await userEvent.keyboard('{Escape}');
    await expect.element(list).not.toBeInTheDocument();
    await userEvent.click(type);
    await userEvent.click(list.getByRole('checkbox', { name: 'Pengeluaran' }));
    await userEvent.click(list.getByRole('checkbox', { name: 'Transfer' }));
    await userEvent.click(list.getByRole('checkbox', { name: 'Transfer' }));
    await userEvent.click(list.getByRole('button', { name: 'Tampilkan 41' }));
    expect(onSearchChange).toHaveBeenLastCalledWith({ type: 'expense' });
    await expect.element(list).not.toBeInTheDocument();
    await userEvent.click(type);
    await userEvent.click(popover('Jenis').getByRole('checkbox', { name: 'Pemasukan' }));
    await userEvent.click(popover('Jenis').getByRole('button', { name: 'Hapus pilihan' }));
    await userEvent.click(popover('Jenis').getByRole('button', { name: 'Tampilkan semua' }));
    expect(onSearchChange).toHaveBeenLastCalledWith({ type: undefined });
  });

  it('names the chosen values on the chip, or how many, with ×', async () => {
    const two = await renderFilters({ type: 'expense,income' });
    await expect.element(chip(/^Jenis/)).toHaveTextContent('JenisPengeluaran, Pemasukan');
    await userEvent.click(page.getByRole('button', { name: 'Hapus filter Jenis' }));
    expect(two.onSearchChange).toHaveBeenCalledWith({ type: undefined });
    await userEvent.click(chip(/^Jenis/));
    await expect.element(popover('Jenis').getByRole('checkbox', { name: 'Pemasukan' })).toBeChecked();
    await two.screen.unmount();
    await renderFilters({ type: 'expense,income,transfer' });
    await expect.element(chip(/^Jenis/)).toHaveTextContent('Jenis3 dipilih');
  });

  it('filters by category: grouped, searchable, without archived ones', async () => {
    const { onSearchChange } = await renderFilters();
    await userEvent.click(chip(/^Kategori/));
    const list = popover('Kategori');
    expect(
      list
        .getByRole('group')
        .elements()
        .map((fieldset) => fieldset.querySelector('legend')?.textContent),
    ).toEqual(['Kebutuhan', 'Keinginan', 'Pemasukan', 'Biaya keuangan']);
    await expect.element(list.getByRole('checkbox', { name: 'Lama' })).not.toBeInTheDocument();
    await userEvent.fill(list.getByRole('searchbox', { name: 'Cari kategori…' }), 'KO');
    await expect.element(list.getByRole('checkbox', { name: 'Sewa' })).not.toBeInTheDocument();
    await userEvent.click(list.getByRole('checkbox', { name: 'Kopi' }));
    await userEvent.fill(list.getByRole('searchbox'), 'zzz');
    await expect.element(list.getByText('Tidak ada yang cocok')).toBeVisible();
    await userEvent.fill(list.getByRole('searchbox'), '');
    await userEvent.click(list.getByRole('button', { name: 'Tampilkan 5' }));
    expect(onSearchChange).toHaveBeenLastCalledWith({ category: KOPI.id });
  });

  it('filters by active account, grouped by type', async () => {
    const { onSearchChange } = await renderFilters({ account: JAGO.id });
    await expect.element(chip(/^Rekening/)).toHaveTextContent('RekeningBank Jago');
    await userEvent.click(chip(/^Rekening/));
    const list = popover('Rekening');
    await expect.element(list.getByText('Bank', { exact: true })).toBeVisible();
    await expect.element(list.getByRole('checkbox', { name: 'Mandiri Lama' })).not.toBeInTheDocument();
    await userEvent.click(list.getByRole('checkbox', { name: 'BCA Tahapan' }));
    await userEvent.click(list.getByRole('button', { name: 'Tampilkan 7' }));
    expect(onSearchChange).toHaveBeenLastCalledWith({ account: `${JAGO.id},${BCA.id}` });
  });

  it('filters by tag, matching any or all of them', async () => {
    const { onSearchChange } = await renderFilters({ tag: 'kantor' });
    await userEvent.click(chip(/^Tag/));
    const list = popover('Tag');
    const any = list.getByRole('button', { name: 'Salah satu' });
    await expect.element(any).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(list.getByRole('button', { name: 'Semua tag' }));
    expect(onSearchChange).toHaveBeenLastCalledWith({ tagMode: 'all' });
    await userEvent.click(any);
    expect(onSearchChange).toHaveBeenLastCalledWith({ tagMode: undefined });
    await userEvent.click(list.getByRole('button', { name: 'Tampilkan 18' }));
    expect(onSearchChange).toHaveBeenLastCalledWith({ tag: 'kantor' });
  });

  it('marks the tag mode “all” when chosen', async () => {
    await renderFilters({ tagMode: 'all' });
    await userEvent.click(chip(/^Tag/));
    await expect
      .element(popover('Tag').getByRole('button', { name: 'Semua tag' }))
      .toHaveAttribute('aria-pressed', 'true');
  });

  it('shows the active “+ Filter” filters as removable chips', async () => {
    const { onSearchChange, row } = await renderFilters({
      min: 50_000,
      max: 1_000_000,
      attachment: true,
      source: 'manual,quick',
      currency: 'IDR,USD',
      uncategorized: true,
    });
    const chips = row.getByText(/^Rentang jumlah|^Ada lampiran|^Sumber|^Mata uang|^Belum dikategorikan/);
    expect(chips.elements().map((element) => element.closest('[data-active]')?.textContent)).toEqual([
      'Rentang jumlah ≥ Rp50.000 ≤ Rp1.000.000',
      'Ada lampiran',
      'Sumber Manual, Catat Cepat',
      'Mata uang IDR, USD',
      'Belum dikategorikan',
    ]);
    const removals = {
      'Rentang jumlah': { min: undefined, max: undefined },
      'Ada lampiran': { attachment: undefined },
      Sumber: { source: undefined },
      'Mata uang': { currency: undefined },
      'Belum dikategorikan': { uncategorized: undefined },
    };
    for (const [filter, patch] of Object.entries(removals)) {
      await userEvent.click(row.getByRole('button', { name: `Hapus filter ${filter}` }));
      expect(onSearchChange).toHaveBeenLastCalledWith(patch);
    }
  });

  it('shows one bound of the amount, and “Tanpa lampiran”', async () => {
    const low = await renderFilters({ min: 100_000, attachment: false });
    await expect.element(low.row.getByText('Tanpa lampiran')).toBeVisible();
    expect(
      low.row
        .getByText(/^Rentang jumlah/)
        .element()
        .closest('[data-active]')?.textContent,
    ).toBe('Rentang jumlah ≥ Rp100.000');
    await low.screen.unmount();
    const high = await renderFilters({ max: 20_000 });
    expect(
      high.row
        .getByText(/^Rentang jumlah/)
        .element()
        .closest('[data-active]')?.textContent,
    ).toBe('Rentang jumlah  ≤ Rp20.000');
  });

  it('adds amount, attachment, uncategorized, source, and currency filters from “+ Filter”', async () => {
    const { onSearchChange } = await renderFilters();
    await userEvent.click(chip(/^Filter$/));
    const more = popover('Tambah filter');
    const preset = more.getByRole('button', { name: /≥ 100\.000/ });
    await expect.element(preset).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(preset);
    await expect.element(preset).toHaveAttribute('aria-pressed', 'true');
    await expect.element(more.getByRole('textbox', { name: 'Min' })).toHaveValue('100.000');
    await expect.element(more.getByRole('checkbox', { name: 'Termasuk pemasukan & transfer' })).not.toBeChecked();
    await userEvent.click(more.getByRole('checkbox', { name: 'Ada lampiran' }));
    await expect.element(more.getByText('4 transaksi')).toBeVisible();
    await userEvent.click(more.getByRole('checkbox', { name: /Belum dikategorikan/ }));
    await userEvent.click(more.getByRole('checkbox', { name: 'Manual' }));
    await userEvent.click(more.getByRole('checkbox', { name: /Gmail/ }));
    await userEvent.click(more.getByRole('checkbox', { name: /Gmail/ }));
    await userEvent.click(more.getByRole('checkbox', { name: 'USD' }));
    await userEvent.click(more.getByRole('checkbox', { name: 'IDR' }));
    await userEvent.click(more.getByRole('checkbox', { name: 'IDR' }));
    await userEvent.click(more.getByRole('button', { name: 'Terapkan' }));
    // An amount range alone looks at spending.
    expect(onSearchChange).toHaveBeenLastCalledWith({
      min: 100_000,
      max: undefined,
      type: 'expense',
      attachment: true,
      uncategorized: true,
      source: 'manual',
      currency: 'USD',
    });
    await expect.element(more).not.toBeInTheDocument();
  });

  it('keeps the chosen types with an amount, or when asked to include everything', async () => {
    const typed = await renderFilters({ type: 'income', min: 1, max: 9, attachment: true, uncategorized: true });
    await userEvent.click(chip(/^Filter$/));
    const more = popover('Tambah filter');
    await expect.element(more.getByRole('checkbox', { name: 'Termasuk pemasukan & transfer' })).toBeChecked();
    await expect.element(more.getByRole('textbox', { name: 'Maks' })).toHaveValue('9');
    await expect.element(more.getByRole('checkbox', { name: 'Ada lampiran' })).toBeChecked();
    await userEvent.fill(more.getByRole('textbox', { name: 'Maks' }), '500.000');
    await userEvent.click(more.getByRole('button', { name: 'Terapkan' }));
    expect(typed.onSearchChange).toHaveBeenLastCalledWith(
      expect.not.objectContaining({ type: expect.anything() as unknown }),
    );
    expect(typed.onSearchChange).toHaveBeenLastCalledWith(expect.objectContaining({ min: 1, max: 500_000 }));
    await typed.screen.unmount();

    const all = await renderFilters({ source: 'quick', currency: 'IDR' });
    await userEvent.click(chip(/^Filter$/));
    const popup = popover('Tambah filter');
    await userEvent.fill(popup.getByRole('textbox', { name: 'Min' }), '50.000');
    await userEvent.click(popup.getByRole('checkbox', { name: 'Termasuk pemasukan & transfer' }));
    await userEvent.click(popup.getByRole('button', { name: 'Terapkan' }));
    expect(all.onSearchChange).toHaveBeenLastCalledWith({
      min: 50_000,
      max: undefined,
      attachment: undefined,
      uncategorized: undefined,
      source: 'quick',
      currency: 'IDR',
    });
  });

  it('clears the “+ Filter” choices, and hides the currency for one currency', async () => {
    const idrOnly = { ...ledger, accounts: ledger.accounts.filter((account) => account.currency === 'IDR') };
    const { onSearchChange } = await renderFilters(
      { min: 1, attachment: true, uncategorized: true, source: 'quick' },
      { ...VIEW, categories: [] },
      idrOnly,
    );
    await userEvent.click(chip(/^Filter$/));
    const more = popover('Tambah filter');
    await expect.element(more.getByText('Mata uang')).not.toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await expect.element(more).not.toBeInTheDocument();
    expect(onSearchChange).not.toHaveBeenCalled();
    await userEvent.click(chip(/^Filter$/));
    await expect.element(more.getByText('0 transaksi')).toBeVisible();
    await userEvent.click(more.getByRole('button', { name: 'Hapus pilihan' }));
    await expect.element(more.getByRole('checkbox', { name: 'Ada lampiran' })).not.toBeChecked();
    await userEvent.click(more.getByRole('button', { name: 'Terapkan' }));
    expect(onSearchChange).toHaveBeenLastCalledWith({
      min: undefined,
      max: undefined,
      attachment: undefined,
      uncategorized: undefined,
      source: undefined,
      currency: undefined,
    });
  });
});

describe('NoResults', () => {
  async function renderNoResults(search: TransactionsSearch, view: TransactionsView = VIEW) {
    const onSearchChange = vi.fn();
    const result = await renderApp(<NoResults view={view} search={search} onSearchChange={onSearchChange} />);
    return { ...result, onSearchChange, status: result.screen.getByRole('status') };
  }

  it('offers all dates and dropping every filter for a search with filters', async () => {
    const { status, onSearchChange } = await renderNoResults({ q: 'netflix', type: 'expense' });
    await expect.element(status.getByText('Tidak ada transaksi “netflix”')).toBeVisible();
    await expect.element(status.getByText(/^Dengan filter 1–15 Okt/)).toBeVisible();
    await expect.element(status.getByText('0 dari 0 transaksi')).toBeVisible();
    await userEvent.click(status.getByRole('button', { name: 'Cari di semua tanggal' }));
    // From the oldest period.
    expect(onSearchChange).toHaveBeenLastCalledWith({ range: '2026-09-01..2026-10-15', period: undefined });
    await userEvent.click(status.getByRole('button', { name: 'Hapus semua filter' }));
    expect(onSearchChange).toHaveBeenLastCalledWith({
      type: undefined,
      category: undefined,
      uncategorized: undefined,
      account: undefined,
      tag: undefined,
      tagMode: undefined,
      min: undefined,
      max: undefined,
      attachment: undefined,
      source: undefined,
      currency: undefined,
      q: undefined,
    });
  });

  it('only widens the dates without filters, at most the longest range back', async () => {
    const old = { ...SEPTEMBER, start: '2010-01-01' as LocalDate };
    for (const search of [{}, { q: '' }]) {
      const { status, onSearchChange, screen } = await renderNoResults(search, {
        ...VIEW,
        periods: [old],
        unfilteredCount: 128,
      });
      await expect.element(status.getByText('Tidak ada transaksi', { exact: true })).toBeVisible();
      await expect.element(status.getByText(/^Tidak ada transaksi pada 1–15 Okt/)).toBeVisible();
      await expect.element(status.getByText('0 dari 128 transaksi')).toBeVisible();
      await expect.element(status.getByRole('button', { name: 'Hapus semua filter' })).not.toBeInTheDocument();
      await userEvent.click(status.getByRole('button', { name: 'Cari di semua tanggal' }));
      expect(onSearchChange).toHaveBeenLastCalledWith({ range: '2021-10-12..2026-10-15', period: undefined });
      await screen.unmount();
    }
  });

  it('describes a search alone as without filters', async () => {
    const { status } = await renderNoResults({ q: 'kopi' }, { ...VIEW, periods: [] });
    await expect.element(status.getByText(/^Tidak ada transaksi pada/)).toBeVisible();
    await expect.element(status.getByRole('button', { name: 'Hapus semua filter' })).toBeVisible();
  });
});
