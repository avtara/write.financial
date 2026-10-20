// SPDX-License-Identifier: AGPL-3.0-only
import type { TransactionRow } from '@wf/db/transaction-query';
import type { LocalDate } from '@wf/domain/period';
import { useEffect, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { BCA, categoryId, LEDGER } from '../../../test/ledger-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import { transactionRow, transactionsView } from '../../../test/transaction-fixtures.ts';
import { DEFAULT_TABLE_PREFS } from '../../lib/transaction-columns.ts';
import type { TransactionsSearch } from '../../lib/transactions-search.ts';
import type { TransactionsView } from '../../server/fn/transactions.ts';
import { TransactionsTable } from './transactions-table.tsx';

const server = vi.hoisted(() => ({ listTransactionRows: vi.fn(), saveTablePrefs: vi.fn() }));
vi.mock('../../server/fn/transactions.ts', () => server);
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
vi.mock('./transaction-filters.tsx', () => ({
  NoResults: ({ search }: { search: TransactionsSearch }) => <p>Tidak ada hasil untuk {search.q}</p>,
}));
const toasts = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock('@wf/ui/toast', () => toasts);

const FOOD = categoryId('system:food');
const TRANSPORT = categoryId('system:transport');
const SALARY = categoryId('system:salary');

const WARTEG = transactionRow('warteg', { merchant: 'Warteg Bahari', tags: ['kantor'], amountMinor: -28_000n });
const GOJEK = transactionRow('gojek', {
  merchant: 'Gojek',
  description: 'ke kantor',
  categoryId: TRANSPORT,
  occurredAt: new Date('2026-10-15T01:12:00Z'),
  amountMinor: -42_000n,
  amountBaseMinor: -42_000n,
});
const STUDIO = transactionRow('studio', {
  type: 'income',
  merchant: 'Studio Arunika',
  categoryId: SALARY,
  localDate: '2026-10-14' as LocalDate,
  occurredAt: new Date('2026-10-14T14:03:00Z'),
  amountMinor: 6_200_000n,
  amountBaseMinor: 6_200_000n,
});
const BIBIT = transactionRow('bibit', {
  type: 'transfer',
  merchant: 'Ke Bibit RDPU',
  categoryId: null,
  localDate: '2026-10-14' as LocalDate,
  occurredAt: new Date('2026-10-14T12:30:00Z'),
  amountMinor: -3_000_000n,
  amountBaseMinor: -3_000_000n,
});
const ROWS = [WARTEG, GOJEK, STUDIO, BIBIT];

function view(rows: readonly TransactionRow[] = ROWS, patch: Partial<TransactionsView> = {}): TransactionsView {
  return transactionsView(rows, {
    days: [
      { date: '2026-10-15' as LocalDate, inMinor: 0n, outMinor: 70_000n, count: 2 },
      { date: '2026-10-14' as LocalDate, inMinor: 6_200_000n, outMinor: 0n, count: 2 },
    ],
    categories: [
      { categoryId: TRANSPORT, kind: 'expense', totalMinor: 42_000n, count: 1, shareBps: 6000 },
      { categoryId: FOOD, kind: 'expense', totalMinor: 28_000n, count: 1, shareBps: 4000 },
      { categoryId: SALARY, kind: 'income', totalMinor: 6_200_000n, count: 1, shareBps: 10_000 },
    ],
    summary: {
      ...transactionsView([]).summary,
      inMinor: 6_200_000n,
      outMinor: 70_000n,
      transferMinor: 3_000_000n,
      transferCount: 1,
    },
    ...patch,
  });
}

let setView: (next: TransactionsView) => void = () => {};

function Harness(props: {
  initial: TransactionsView;
  search: TransactionsSearch;
  onSearchChange: (patch: Partial<TransactionsSearch>) => void;
  onOpen: (id: string) => void;
  selectedId?: string;
}) {
  const [current, setCurrent] = useState(props.initial);
  useEffect(() => {
    setView = setCurrent;
  }, []);
  return (
    <TransactionsTable
      view={current}
      search={props.search}
      ledger={LEDGER}
      timeZone="Asia/Jakarta"
      {...(props.selectedId === undefined ? {} : { selectedId: props.selectedId })}
      onOpen={props.onOpen}
      onSearchChange={props.onSearchChange}
      filters={<div>Filter chips</div>}
    />
  );
}

async function renderTable(initial = view(), search: TransactionsSearch = {}, selectedId?: string) {
  const onSearchChange = vi.fn();
  const onOpen = vi.fn();
  const { screen } = await renderApp(
    <Harness
      initial={initial}
      search={search}
      onSearchChange={onSearchChange}
      onOpen={onOpen}
      {...(selectedId === undefined ? {} : { selectedId })}
    />,
  );
  const table = screen.getByRole('region', { name: 'Daftar transaksi' });
  const row = (name: string) => table.getByRole('group', { name });
  return { screen, table, row, onSearchChange, onOpen };
}

const focus = (element: Element) => {
  (element as HTMLElement).focus();
};

beforeEach(async () => {
  await page.viewport(1440, 900);
  server.saveTablePrefs.mockResolvedValue({ ok: true, value: DEFAULT_TABLE_PREFS });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('TransactionsTable', () => {
  it('shows the toolbar, filters, header, day groups, rows, and the footer', async () => {
    const { table, row } = await renderTable(view(), {}, 'gojek');
    await expect.element(table.getByRole('searchbox', { name: 'Cari transaksi' })).toBeVisible();
    await expect.element(table.getByRole('tab', { name: 'Per hari' })).toHaveAttribute('aria-selected', 'true');
    await expect.element(table.getByRole('button', { name: 'Atur kolom' })).toBeVisible();
    await expect.element(table.getByText('Filter chips')).toBeVisible();
    await expect.element(table.getByRole('button', { name: 'Waktu' })).toBeVisible();
    await expect.element(table.getByRole('button', { name: 'Jumlah' })).toBeVisible();
    await expect.element(table.getByText('Rekening', { exact: true })).toBeVisible();
    const list = table.getByRole('list', { name: 'Daftar transaksi' });
    await expect.element(list.getByText('Hari ini')).toBeVisible();
    await expect.element(list.getByText('Kamis, 15 Okt')).toBeVisible();
    await expect.element(list.getByText('Rabu, 14 Okt')).toBeVisible();
    await expect.element(list.getByText('−Rp70.000')).toBeVisible();
    await expect.element(list.getByText('+Rp6.200.000').first()).toBeVisible();
    await expect.element(row('Gojek')).toHaveAttribute('aria-current', 'true');
    await expect.element(row('Warteg Bahari')).toHaveAttribute('tabindex', '0');
    await expect.element(row('Gojek')).toHaveAttribute('tabindex', '-1');
    await expect.element(table.getByText('Menampilkan 4 dari 4 transaksi')).toBeVisible();
    await expect.element(table.getByText(/^Dicari di/)).not.toBeInTheDocument();
  });

  it('switches views; Per hari also drops an amount sort', async () => {
    const plain = await renderTable();
    await userEvent.click(plain.table.getByRole('tab', { name: 'Per kategori' }));
    expect(plain.onSearchChange).toHaveBeenLastCalledWith({ view: 'category' });
    await userEvent.click(plain.table.getByRole('tab', { name: 'Rata' }));
    expect(plain.onSearchChange).toHaveBeenLastCalledWith({ view: 'flat' });
    await plain.screen.unmount();
    const flat = await renderTable(view(), { view: 'flat' });
    await userEvent.click(flat.table.getByRole('tab', { name: 'Per hari' }));
    expect(flat.onSearchChange).toHaveBeenLastCalledWith({ view: undefined });
    await flat.screen.unmount();
    const amount = await renderTable(view(), { sort: 'amount_asc' });
    await expect.element(amount.table.getByRole('tab', { name: 'Rata' })).toHaveAttribute('aria-selected', 'true');
    await userEvent.click(amount.table.getByRole('tab', { name: 'Per hari' }));
    expect(amount.onSearchChange).toHaveBeenLastCalledWith({ view: undefined, sort: undefined });
  });

  it('groups by category with shares and totals, transfers last', async () => {
    const { table } = await renderTable(view(), { view: 'category' });
    const list = table.getByRole('list');
    await expect.element(list.getByText('60%')).toBeVisible();
    await expect.element(list.getByText('40%')).toBeVisible();
    await expect.element(list.getByText('−Rp42.000').first()).toBeVisible();
    const headers = list
      .getByText('1 transaksi')
      .elements()
      .map((element) => element.previousElementSibling?.textContent);
    expect(headers).toEqual(['Transportasi', 'Makan & Dapur', 'Gaji', 'Transfer']);
    expect(list.getByText('Rp3.000.000', { exact: true }).elements()).toHaveLength(2);
    expect(list.element().querySelectorAll('progress')).toHaveLength(3);
  });

  it('shows date and time and the totals in the Flat view, sorted by amount', async () => {
    const { table, onSearchChange } = await renderTable(view(), { view: 'flat', sort: 'amount_asc' });
    await expect.element(table.getByText('Kamis, 15 Okt')).not.toBeInTheDocument();
    await expect.element(table.getByText('15 Okt · 12.41')).toBeVisible();
    const footer = table.getByText('4 transaksi', { exact: true }).element().parentElement;
    expect(footer?.textContent).toBe('4 transaksiMasuk +Rp6.200.000Keluar −Rp70.000Transfer Rp3.000.000');
    const amount = table.getByRole('button', { name: 'Jumlah' });
    expect(amount.element().querySelector('svg')).not.toBeNull();
    expect(table.getByRole('button', { name: 'Tanggal' }).element().querySelector('svg')).toBeNull();
    await userEvent.click(amount);
    await userEvent.click(page.getByRole('menuitemradio', { name: 'Terbaru dulu' }));
    expect(onSearchChange).toHaveBeenLastCalledWith({ sort: undefined });
  });

  it('shows the search scope, highlight, and result summary', async () => {
    const { table, onSearchChange } = await renderTable(view([WARTEG, GOJEK]), { q: 'kantor', sort: 'date_asc' });
    await expect.element(table.getByText('2 hasil', { exact: true })).toBeVisible();
    await expect.element(table.getByText(/^Dicari di/)).toHaveTextContent('Dicari diDeskripsiCatatanTag');
    await expect
      .element(table.getByText(/2 hasil untuk “kantor” · 1–15 Okt · total/))
      .toHaveTextContent('2 hasil untuk “kantor” · 1–15 Okt · total +Rp6.130.000');
    expect(table.element().querySelector('mark')?.textContent).toBe('kantor');
    const time = table.getByRole('button', { name: 'Waktu' });
    expect(time.element().querySelector('svg')).not.toBeNull();
    await userEvent.clear(table.getByRole('searchbox'));
    await expect.poll(() => onSearchChange.mock.lastCall).toEqual([{ q: undefined }]);
  });

  it('shows NoResults when filters hide everything, or a plain note for an empty range', async () => {
    const filtered = await renderTable(view([], { unfilteredCount: 12 }), { q: 'netflix' });
    await expect.element(filtered.table.getByText('Tidak ada hasil untuk netflix')).toBeVisible();
    await expect.element(filtered.table.getByRole('list')).not.toBeInTheDocument();
    await filtered.screen.unmount();
    const empty = await renderTable(view([], { unfilteredCount: 0 }));
    await expect.element(empty.table.getByText('Belum ada transaksi di rentang tanggal ini')).toBeVisible();
  });

  it('loads the next page at the end of the list, with running balances and a retry', async () => {
    const third = transactionRow('third', { merchant: 'Indomaret', occurredAt: new Date('2026-10-15T00:55:00Z') });
    const first = view([WARTEG, GOJEK], {
      page: { rows: [WARTEG, GOJEK], total: 4, balances: { warteg: 42_000_000n, gojek: 42_028_000n } },
      prefs: {
        ...DEFAULT_TABLE_PREFS,
        columns: DEFAULT_TABLE_PREFS.columns.map((column) =>
          column.id === 'balance' || column.id === 'attachment' ? { ...column, visible: true } : column,
        ),
      },
    });
    server.listTransactionRows
      .mockResolvedValueOnce({ ok: false, code: 'UNKNOWN' })
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ ok: true, value: { rows: [third], total: 4, balances: { third: 42_070_000n } } })
      .mockResolvedValueOnce({ ok: true, value: { rows: [STUDIO], total: 4, balances: null } });
    const { table, row } = await renderTable(first, { account: BCA.id, q: 'a' });
    await expect.element(table.getByRole('alert')).toHaveTextContent('Transaksi berikutnya gagal dimuat.');
    expect(server.listTransactionRows).toHaveBeenCalledWith({ data: { account: BCA.id, q: 'a', offset: 2 } });
    await userEvent.click(table.getByRole('button', { name: 'Coba lagi' }));
    await expect.element(table.getByRole('alert')).toBeVisible();
    await userEvent.click(table.getByRole('button', { name: 'Coba lagi' }));
    await expect.element(row('Indomaret')).toBeVisible();
    await expect.element(row('Studio Arunika')).toBeVisible();
    expect(server.listTransactionRows).toHaveBeenCalledTimes(4);
    await expect.element(row('Indomaret').getByText('Rp42.070.000')).toBeVisible();
    await expect.element(row('Warteg Bahari').getByText('Rp42.000.000')).toBeVisible();
    await expect.element(row('Studio Arunika').getByText('—')).toBeVisible();
    await expect.element(table.getByText('Menampilkan 4 dari 4 transaksi')).not.toBeInTheDocument();
  });

  it('drops a page that arrives after the view changed, and starts loading without balances', async () => {
    const pending = Promise.withResolvers<unknown>();
    server.listTransactionRows.mockReturnValueOnce(pending.promise);
    const { table, row } = await renderTable(view([WARTEG], { page: { rows: [WARTEG], total: 2, balances: null } }));
    await expect.element(table.getByText('Memuat transaksi lainnya…')).toBeVisible();
    setView(view([GOJEK], { page: { rows: [GOJEK], total: 1, balances: null } }));
    await expect.element(table.getByText('Menampilkan 1 dari 1 transaksi')).toBeVisible();
    pending.resolve({ ok: true, value: { rows: [STUDIO], total: 2, balances: null } });
    await pending.promise;
    await expect.element(row('Gojek')).toBeVisible();
    await expect.element(table.getByText('Menampilkan 1 dari 1 transaksi')).toBeVisible();
    await expect.element(row('Studio Arunika')).not.toBeInTheDocument();
  });

  it('saves column changes optimistically and undoes them when saving fails', async () => {
    const { table } = await renderTable();
    const toggle = async () => {
      await userEvent.click(table.getByRole('button', { name: 'Atur kolom' }));
      await userEvent.click(page.getByRole('switch', { name: 'Rekening' }));
      await userEvent.keyboard('{Escape}');
    };
    await toggle();
    expect(server.saveTablePrefs).toHaveBeenCalledOnce();
    await expect.element(table.getByText('Rekening', { exact: true })).not.toBeInTheDocument();
    server.saveTablePrefs.mockResolvedValueOnce({ ok: false, code: 'UNKNOWN' });
    await toggle();
    await expect.poll(() => toasts.toast.mock.calls.length).toBe(1);
    expect(toasts.toast.mock.calls[0]?.[0]).toMatchObject({ tone: 'error', title: 'Pengaturan kolom gagal disimpan' });
    await expect.element(table.getByText('Rekening', { exact: true })).not.toBeInTheDocument();
    server.saveTablePrefs.mockRejectedValueOnce(new Error('offline'));
    await toggle();
    await expect.poll(() => toasts.toast.mock.calls.length).toBe(2);
    await expect.element(table.getByText('Rekening', { exact: true })).not.toBeInTheDocument();
  });

  it('selects with checkboxes, shift-click ranges, and select-all, and runs bulk actions', async () => {
    const { table, row } = await renderTable();
    const selectAll = table.getByRole('checkbox', { name: 'Pilih semua yang dimuat' });
    await userEvent.click(row('Warteg Bahari').getByRole('checkbox'));
    await expect.element(selectAll).toHaveProperty('indeterminate', true);
    await userEvent.keyboard('{Shift>}');
    await userEvent.click(row('Studio Arunika').getByRole('checkbox'));
    await userEvent.keyboard('{/Shift}');
    const bar = page.getByRole('toolbar', { name: 'Aksi transaksi terpilih' });
    await expect.poll(() => bar.element().textContent).toMatch(/^3dipilih/);
    await userEvent.click(bar.getByRole('button', { name: 'Hapus' }));
    expect(actions.remove).toHaveBeenCalledWith([WARTEG, GOJEK, STUDIO]);
    await userEvent.click(row('Gojek').getByRole('checkbox'));
    await expect.poll(() => bar.element().textContent).toMatch(/^2dipilih/);
    await userEvent.click(selectAll);
    await expect.element(selectAll).toBeChecked();
    await expect.element(selectAll).toHaveProperty('indeterminate', false);
    await expect.poll(() => bar.element().textContent).toMatch(/^4dipilih/);
    await userEvent.click(selectAll);
    await expect.element(bar).not.toBeInTheDocument();
    await userEvent.click(selectAll);
    await userEvent.click(page.getByRole('button', { name: 'Batalkan pilihan' }));
    await expect.element(bar).not.toBeInTheDocument();
  });

  it('works from the keyboard: move, select, open, duplicate, delete', async () => {
    const { row, onOpen } = await renderTable();
    focus(row('Warteg Bahari').element());
    await userEvent.keyboard('{ArrowUp}');
    await expect.element(row('Warteg Bahari')).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    await expect.element(row('Gojek')).toHaveFocus();
    await expect.element(row('Gojek')).toHaveAttribute('tabindex', '0');
    await userEvent.keyboard('{Shift>}{ArrowDown}{/Shift}');
    await expect.element(row('Studio Arunika')).toHaveFocus();
    await expect.element(row('Gojek').getByRole('checkbox')).toBeChecked();
    await expect.element(row('Studio Arunika').getByRole('checkbox')).toBeChecked();
    await userEvent.keyboard('{Backspace}');
    expect(actions.remove).toHaveBeenLastCalledWith([GOJEK, STUDIO]);
    await userEvent.keyboard(' ');
    await expect.element(row('Studio Arunika').getByRole('checkbox')).not.toBeChecked();
    await userEvent.keyboard('{Delete}');
    expect(actions.remove).toHaveBeenLastCalledWith([STUDIO]);
    await userEvent.keyboard('{Shift>} {/Shift}');
    await userEvent.keyboard('{Enter}');
    await userEvent.keyboard('e');
    await userEvent.keyboard('d');
    expect(onOpen.mock.calls).toEqual([['studio'], ['studio']]);
    expect(actions.duplicate).toHaveBeenCalledWith('studio');
    await userEvent.keyboard('{ArrowDown}{ArrowDown}');
    await expect.element(row('Ke Bibit RDPU')).toHaveFocus();
    // Modifier chords, other keys, and keys from inside the row are not the row's.
    await userEvent.keyboard('{Control>}e{/Control}x');
    focus(row('Ke Bibit RDPU').getByRole('checkbox').element());
    await userEvent.keyboard('{Enter}');
    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  it('starts over when the first page changes', async () => {
    const { table, row } = await renderTable();
    await userEvent.click(row('Gojek').getByRole('checkbox'));
    await expect.element(page.getByRole('toolbar')).toBeVisible();
    setView(view([WARTEG]));
    await expect.element(page.getByRole('toolbar')).not.toBeInTheDocument();
    await expect.element(table.getByText('Menampilkan 1 dari 1 transaksi')).toBeVisible();
  });

  it('opens a row on click, and groups uncategorized rows by category', async () => {
    const parkir = transactionRow('parkir', { merchant: 'Parkir', categoryId: null });
    const { table, row, onOpen } = await renderTable(view([parkir]), { view: 'category' });
    await expect.element(table.getByRole('list').getByText('Belum dikategorikan').first()).toBeVisible();
    await userEvent.click(row('Parkir').getByText('Parkir'));
    expect(onOpen).toHaveBeenCalledWith('parkir');
  });
});
