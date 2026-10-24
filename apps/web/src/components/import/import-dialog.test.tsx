// SPDX-License-Identifier: AGPL-3.0-only
import { addDays, type LocalDate } from '@wf/domain/period';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { account, userCategory } from '../../../test/ledger-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import { MAX_RANGE_DAYS } from '../../lib/transactions-search.ts';
import { ImportDialog } from './import-dialog.tsx';

const server = vi.hoisted(() => ({
  requestImport: vi.fn(),
  confirmReviewBulk: vi.fn(),
  listTransactionRows: vi.fn(),
}));
vi.mock('../../server/fn/import.ts', () => ({ requestImport: server.requestImport }));
vi.mock('../../server/fn/review.ts', () => ({ confirmReviewBulk: server.confirmReviewBulk }));
vi.mock('../../server/fn/transactions.ts', () => ({ listTransactionRows: server.listTransactionRows }));

const BCA = account({ id: 'acc-bca', displayName: 'BCA Tahapan', currency: 'IDR' });
const JAGO = account({ id: 'acc-jago', displayName: 'Bank Jago', currency: 'IDR' });
const KOPI = userCategory({ id: 'c-kopi', name: 'Kopi' });
const GAJI = userCategory({ id: 'c-gaji', name: 'Gaji', kind: 'income', group: 'active' });
const accounts = [BCA, JAGO];
const categories = [KOPI, GAJI];

const HEADER = 'Tanggal;Keterangan;Mutasi;Saldo';
/** An outgoing Rp25.000 row, an outgoing transfer to Bank Jago, and an incoming Rp1.000.000 row. */
const STATEMENT = `${HEADER}\n05/10/2026;QRIS KOPI;-25.000;2.475.000\n06/10/2026;TRSF KE BANK JAGO;-1.000.000;1.475.000\n07/10/2026;GAJI;1.000.000;\n`;

const rowsPage = (rows: unknown[], total = rows.length) => ({
  ok: true,
  value: { rows, total, balances: null },
});

const csvFile = (content: string, name = 'mutasi.csv') => new File([content], name, { type: 'text/csv' });

/** The account's existing transaction that row A duplicates (Rp25.000 out, same day, same words). */
const existingRow = {
  localDate: '2026-10-05' as LocalDate,
  amountMinor: -2_500_000n,
  receivedMinor: null,
  description: 'QRIS KOPI',
  categoryId: KOPI.id,
};

afterEach(() => {
  vi.clearAllMocks();
});

async function renderDialog() {
  const onOpenChange = vi.fn();
  const result = await renderApp(
    <ImportDialog open onOpenChange={onOpenChange} accounts={accounts} categories={categories} />,
  );
  return { ...result, onOpenChange };
}

/** Picks `file` through the hidden file input. */
async function pickFile(file: File) {
  const input = document.querySelector<HTMLInputElement>('input[type=file]');
  if (input === null) throw new Error('no file input');
  await userEvent.upload(input, file);
}

/** Uploads `content` and waits for the review step. */
async function review(content: string) {
  server.listTransactionRows.mockResolvedValue(rowsPage([]));
  await renderDialog();
  await pickFile(csvFile(content));
  await vi.waitFor(async () => {
    await expect.element(page.getByText('Ditemukan')).toBeInTheDocument();
  });
}

describe('upload step', () => {
  it('offers the account, the dropzone, the template, and the privacy note', async () => {
    await renderDialog();
    await expect.element(page.getByText('Pilih rekening tujuan')).toBeInTheDocument();
    await expect.element(page.getByText('Pilih file CSV atau XLSX, atau seret ke sini')).toBeInTheDocument();
    await expect.element(page.getByText('Maks 10 MB · CSV · XLSX')).toBeInTheDocument();
    await expect
      .element(page.getByRole('link', { name: 'Unduh template CSV' }))
      .toHaveAttribute('download', 'template-impor.csv');
    await expect.element(page.getByText(/File diproses di perangkatmu/)).toBeInTheDocument();
  });

  it('disables the picker without an account', async () => {
    await renderApp(<ImportDialog open onOpenChange={vi.fn()} accounts={[]} categories={[]} />);
    await expect.element(page.getByRole('button', { name: 'Unggah file' })).toBeDisabled();
  });

  it('rejects a wrong type and an oversized file with the design’s copy', async () => {
    await renderDialog();
    await pickFile(new File(['x'], 'rekening.docx', { type: 'application/msword' }));
    await expect.element(page.getByText(/Format .docx tidak didukung/)).toBeInTheDocument();
    await pickFile(new File([new ArrayBuffer(10 * 1024 * 1024 + 1)], 'mutasi.csv', { type: 'text/csv' }));
    await expect.element(page.getByText(/melebihi batas 10 MB/)).toBeInTheDocument();
  });

  it('shows why an empty statement cannot be reviewed', async () => {
    server.listTransactionRows.mockResolvedValue(rowsPage([]));
    await renderDialog();
    await pickFile(csvFile(`${HEADER}\n`));
    await vi.waitFor(async () => {
      await expect.element(page.getByText(/Tidak ada baris transaksi yang bisa dibaca/)).toBeInTheDocument();
    });
  });

  it('answers a failed history load with a retry hint', async () => {
    server.listTransactionRows.mockResolvedValue({ ok: false, code: 'INTERNAL' });
    await renderDialog();
    await pickFile(csvFile(`${HEADER}\n05/10/2026;QRIS KOPI;-25.000;2.475.000\n`));
    await vi.waitFor(async () => {
      await expect.element(page.getByText(/Gagal memuat riwayat transaksi/)).toBeInTheDocument();
    });
  });

  it('answers a failed history page with the same retry hint', async () => {
    server.listTransactionRows
      .mockResolvedValueOnce(rowsPage([existingRow], 2))
      .mockResolvedValueOnce({ ok: false, code: 'INTERNAL' });
    await renderDialog();
    await pickFile(csvFile(`${HEADER}\n05/10/2026;QRIS KOPI;-25.000;2.475.000\n`));
    await vi.waitFor(async () => {
      await expect.element(page.getByText(/Gagal memuat riwayat transaksi/)).toBeInTheDocument();
    });
  });

  it('stays busy while the duplicate window loads', async () => {
    const pending = Promise.withResolvers<unknown>();
    server.listTransactionRows.mockReturnValue(pending.promise);
    await renderDialog();
    await pickFile(csvFile(`${HEADER}\n05/10/2026;QRIS KOPI;-25.000;2.475.000\n`));
    await expect.element(page.getByText('Membaca file…').first()).toBeVisible();
    await expect.element(page.getByRole('button', { name: 'Membaca file…' })).toBeDisabled();
    pending.resolve(rowsPage([]));
    await vi.waitFor(async () => {
      await expect.element(page.getByText('Ditemukan')).toBeInTheDocument();
    });
  });

  it('clamps the duplicate window of a statement that spans years', async () => {
    server.listTransactionRows.mockResolvedValue(rowsPage([]));
    await renderDialog();
    await pickFile(csvFile(`${HEADER}\n01/01/2020;LAMA;-25.000;1.000.000\n07/10/2026;QRIS KOPI;-25.000;2.475.000\n`));
    await vi.waitFor(async () => {
      await expect.element(page.getByText('Ditemukan')).toBeInTheDocument();
    });
    const to = addDays('2026-10-07' as LocalDate, 1);
    expect(server.listTransactionRows).toHaveBeenCalledWith({
      data: expect.objectContaining({ range: `${addDays(to, -(MAX_RANGE_DAYS - 1))}..${to}` }) as unknown,
    });
  });

  it('shows the review step without a history when no row has a readable date', async () => {
    await renderDialog();
    await pickFile(csvFile(`${HEADER}\n31/09/2026;QRIS KOPI;-25.000;2.475.000\n`));
    await vi.waitFor(async () => {
      await expect.element(page.getByText('Ditemukan')).toBeInTheDocument();
    });
    expect(server.listTransactionRows).not.toHaveBeenCalled();
  });

  it('ignores a change event without a chosen file and a drop without one', async () => {
    await renderDialog();
    const input = document.querySelector<HTMLInputElement>('input[type=file]');
    if (input === null) throw new Error('no file input');
    input.dispatchEvent(new Event('change', { bubbles: true }));
    const hint = page.getByText('Pilih file CSV atau XLSX, atau seret ke sini').element() as HTMLElement;
    const dropzone = hint.closest('div');
    if (dropzone === null) throw new Error('no dropzone');
    dropzone.dispatchEvent(
      new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() }),
    );
    await expect.element(page.getByText('Pilih rekening tujuan')).toBeInTheDocument();
    expect(page.getByRole('alert').query()).toBeNull();
  });

  it('answers an unreadable file with the read error', async () => {
    await renderDialog();
    // An empty ZIP archive: SheetJS recognizes the container but finds no workbook inside.
    const emptyZip = new Uint8Array(22);
    emptyZip.set([0x50, 0x4b, 0x05, 0x06]);
    await pickFile(
      new File([emptyZip], 'mutasi.xlsx', {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }),
    );
    await vi.waitFor(async () => {
      await expect.element(page.getByText(/mutasi.xlsx tidak bisa dibaca/)).toBeInTheDocument();
    });
  });

  it('asks for the account first when there is none', async () => {
    await renderApp(<ImportDialog open onOpenChange={vi.fn()} accounts={[]} categories={[]} />);
    await pickFile(csvFile(STATEMENT));
    await vi.waitFor(async () => {
      await expect.element(page.getByRole('alert')).toBeInTheDocument();
    });
  });

  it('opens the picker from the button and shows the generic format for a headerless file', async () => {
    server.listTransactionRows.mockResolvedValue(rowsPage([]));
    await renderDialog();
    await userEvent.click(page.getByRole('button', { name: 'Unggah file' }));
    await pickFile(csvFile('05/10/2026,QRIS KOPI,-25.000,2475000\n', 'rekening.csv'));
    await vi.waitFor(async () => {
      await expect.element(page.getByText(/terdeteksi format CSV umum/)).toBeInTheDocument();
    });
  });

  it('accepts a file by dropping it on the dropzone', async () => {
    server.listTransactionRows.mockResolvedValue(rowsPage([]));
    await renderDialog();
    const hint = page.getByText('Pilih file CSV atau XLSX, atau seret ke sini').element() as HTMLElement;
    const dropzone = hint.closest('div');
    if (dropzone === null) throw new Error('no dropzone');
    dropzone.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true }));
    const transfer = new DataTransfer();
    transfer.items.add(csvFile(STATEMENT));
    dropzone.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
    await vi.waitFor(async () => {
      await expect.element(page.getByText('Ditemukan')).toBeInTheDocument();
    });
  });

  it('loads the duplicate window across pages', async () => {
    server.listTransactionRows
      .mockResolvedValueOnce(rowsPage([existingRow], 2))
      .mockResolvedValueOnce(rowsPage([{ ...existingRow, description: 'KOPI LAGI' }], 2));
    await renderDialog();
    await pickFile(csvFile(STATEMENT));
    await vi.waitFor(async () => {
      await expect.element(page.getByText('Ditemukan')).toBeInTheDocument();
    });
    expect(server.listTransactionRows).toHaveBeenCalledTimes(2);
  });
});

describe('review step', () => {
  it('guesses the category from history and shows an error row that has a date', async () => {
    server.listTransactionRows.mockResolvedValue(
      rowsPage([
        {
          localDate: '2026-09-20',
          amountMinor: -9_999n,
          receivedMinor: null,
          description: 'QRIS KOPI BESAR',
          categoryId: KOPI.id,
        },
      ]),
    );
    await renderDialog();
    await pickFile(csvFile(`${HEADER}\n05/10/2026;QRIS KOPI;-25.000;2.475.000\n05/10/2026;GAGAL;nol;2.475.000\n`));
    await vi.waitFor(async () => {
      await expect.element(page.getByText('✦ kategori ditebak dari riwayat transaksimu')).toBeInTheDocument();
    });
    await expect
      .element(page.getByText("Baris 2: kolom jumlah berisi 'nol' yang tidak bisa dibaca"))
      .toBeInTheDocument();
  });

  it('skips a transfer row that duplicates the account’s history', async () => {
    server.listTransactionRows.mockResolvedValue(
      rowsPage([
        {
          localDate: '2026-10-06',
          amountMinor: -100_000_000n,
          receivedMinor: null,
          description: 'TRSF KE BANK JAGO',
          categoryId: null,
        },
      ]),
    );
    await renderDialog();
    await pickFile(csvFile(STATEMENT));
    await vi.waitFor(async () => {
      await expect.element(page.getByText('Duplikat').first()).toBeInTheDocument();
    });
    await expect.element(page.getByRole('button', { name: 'Impor 2 transaksi' })).toBeEnabled();
  });

  it('imports into the account chosen in the select', async () => {
    server.listTransactionRows.mockResolvedValue(rowsPage([]));
    server.requestImport.mockResolvedValue({
      ok: true,
      value: { created: 1, duplicates: 0, rejected: 0, itemIds: ['a'] },
    });
    server.confirmReviewBulk.mockResolvedValue({ ok: true, value: { confirmed: ['a'], failed: [] } });
    await renderDialog();
    await userEvent.selectOptions(page.getByLabelText('Pilih rekening tujuan'), JAGO.id);
    await pickFile(csvFile(`${HEADER}\n05/10/2026;QRIS KOPI;-25.000;2.475.000\n`));
    await vi.waitFor(async () => {
      await expect.element(page.getByRole('button', { name: 'Impor 1 transaksi' })).toBeEnabled();
    });
    await userEvent.click(page.getByRole('button', { name: 'Impor 1 transaksi' }));
    await vi.waitFor(async () => {
      await expect.element(page.getByText('1 transaksi tercatat')).toBeInTheDocument();
    });
    expect(server.requestImport).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ accountId: JAGO.id }) as unknown,
      }),
    );
  });

  it('shows the stat tiles, the meta line, and the rows with their status', async () => {
    server.listTransactionRows.mockResolvedValue(rowsPage([existingRow]));
    await renderDialog();
    await pickFile(csvFile(STATEMENT));
    await vi.waitFor(async () => {
      await expect.element(page.getByText('Ditemukan')).toBeInTheDocument();
    });
    await expect.element(page.getByText('mutasi.csv · 1 KB · terdeteksi format BCA → BCA Tahapan')).toBeInTheDocument();
    await expect.element(page.getByText('Akan diimpor')).toBeInTheDocument();
    await expect.element(page.getByText('Duplikat dilewati')).toBeInTheDocument();
    await expect.element(page.getByText('Gagal dibaca')).toBeInTheDocument();
    await expect.element(page.getByText('Baru').first()).toBeInTheDocument();
    await expect.element(page.getByText('Duplikat').first()).toBeInTheDocument();
    await expect.element(page.getByText(/Transfer ke/)).toBeInTheDocument();
    await expect.element(page.getByRole('button', { name: 'Impor 2 transaksi' })).toBeEnabled();
    await expect.element(page.getByText(/belum punya kategori/)).toBeInTheDocument();
  });

  it('skips a duplicate against the account’s transactions', async () => {
    server.listTransactionRows.mockResolvedValue(rowsPage([existingRow]));
    await renderDialog();
    await pickFile(csvFile(`${HEADER}\n05/10/2026;QRIS KOPI;-25.000;2.475.000\n`));
    await vi.waitFor(async () => {
      await expect.element(page.getByText('Duplikat')).toBeInTheDocument();
    });
    await expect.element(page.getByRole('button', { name: 'Impor 0 transaksi' })).toBeDisabled();
  });

  it('keeps the per-row reason of an unreadable row', async () => {
    await review(`${HEADER}\n31/09/2026;QRIS KOPI;-25.000;2.475.000\n`);
    await expect.element(page.getByText("Baris 1: format tanggal '31/09/2026' tidak valid")).toBeInTheDocument();
    await expect.element(page.getByRole('button', { name: 'Impor 0 transaksi' })).toBeDisabled();
  });

  it('shows an unnamed unreadable row as Gagal with its reason', async () => {
    await review(`${HEADER}\n31/09/2026;;-25.000;2.475.000\n`);
    await expect.element(page.getByText('Gagal')).toBeInTheDocument();
    await expect.element(page.getByText("Baris 1: format tanggal '31/09/2026' tidak valid")).toBeInTheDocument();
  });

  it('shows an incoming transfer between own accounts', async () => {
    server.listTransactionRows.mockResolvedValue(rowsPage([]));
    await renderDialog();
    await pickFile(csvFile(`${HEADER}\n07/10/2026;TRSF DARI BANK JAGO;1.000.000;2.475.000\n`));
    await vi.waitFor(async () => {
      await expect.element(page.getByText(/Transfer dari Bank Jago/)).toBeInTheDocument();
    });
  });

  it('labels the select of an unnamed row and lets the user clear a category again', async () => {
    server.listTransactionRows.mockResolvedValue(rowsPage([]));
    await renderDialog();
    await pickFile(csvFile(`${HEADER}\n05/10/2026;;-25.000;2.475.000\n05/10/2026;QRIS KOPI;-25.000;2.475.000\n`));
    await vi.waitFor(async () => {
      await expect.element(page.getByRole('combobox', { name: 'QRIS KOPI' })).toBeInTheDocument();
    });
    expect(
      page
        .getByRole('combobox')
        .elements()
        .map((select) => select.getAttribute('aria-label')),
    ).toContain('Pilih rekening tujuan');
    const fallback = page
      .getByRole('combobox')
      .elements()
      .find((select) => select.getAttribute('aria-label') === 'Pilih rekening tujuan');
    if (fallback === undefined) throw new Error('no fallback select');
    await userEvent.selectOptions(page.getByRole('combobox', { name: 'QRIS KOPI' }), KOPI.id);
    await expect.element(page.getByText(/1 transaksi belum punya kategori/)).toBeInTheDocument();
    await userEvent.selectOptions(page.getByRole('combobox', { name: 'QRIS KOPI' }), '');
    await expect.element(page.getByText(/2 transaksi belum punya kategori/)).toBeInTheDocument();
  });

  it('lets the user pick a category for a new row', async () => {
    server.listTransactionRows.mockResolvedValue(rowsPage([]));
    await renderDialog();
    await pickFile(csvFile(`${HEADER}\n05/10/2026;QRIS KOPI;-25.000;2.475.000\n`));
    await vi.waitFor(async () => {
      await expect.element(page.getByRole('combobox', { name: 'QRIS KOPI' })).toBeInTheDocument();
    });
    await expect.element(page.getByText(/belum punya kategori/)).toBeInTheDocument();
    await userEvent.selectOptions(page.getByRole('combobox', { name: 'QRIS KOPI' }), KOPI.id);
    await expect.element(page.getByText(/belum punya kategori/)).not.toBeInTheDocument();
  });

  it('goes back to the upload step with Kembali', async () => {
    await review(STATEMENT);
    await userEvent.click(page.getByRole('button', { name: 'Kembali' }));
    await expect.element(page.getByText('Pilih rekening tujuan')).toBeInTheDocument();
  });
});

const STORED = { ok: true, value: { created: 3, duplicates: 0, rejected: 0, itemIds: ['a', 'b', 'c'] } };

describe('submitting', () => {
  async function done(options: { request?: unknown; confirm?: unknown } = {}) {
    server.listTransactionRows.mockResolvedValue(rowsPage([]));
    server.requestImport.mockResolvedValue(options.request ?? STORED);
    server.confirmReviewBulk.mockResolvedValue(
      options.confirm ?? { ok: true, value: { confirmed: ['a', 'b', 'c'], failed: [] } },
    );
    const screen = await renderDialog();
    await pickFile(csvFile(STATEMENT));
    await vi.waitFor(async () => {
      await expect.element(page.getByRole('button', { name: 'Impor 3 transaksi' })).toBeEnabled();
    });
    await userEvent.click(page.getByRole('button', { name: 'Impor 3 transaksi' }));
    return screen;
  }

  it('stores the rows as review items, confirms them, and shows the done step', async () => {
    const { onOpenChange } = await done();
    await vi.waitFor(async () => {
      await expect.element(page.getByText('3 transaksi tercatat')).toBeInTheDocument();
    });
    expect(server.requestImport).toHaveBeenCalledWith({
      data: {
        accountId: BCA.id,
        rows: [
          {
            date: '2026-10-05',
            amountMinor: 2_500_000n,
            direction: 'out',
            description: 'QRIS KOPI',
            categoryId: null,
            transferAccountId: null,
          },
          {
            date: '2026-10-06',
            amountMinor: 100_000_000n,
            direction: 'out',
            description: 'TRSF KE BANK JAGO',
            categoryId: null,
            transferAccountId: 'acc-jago',
          },
          {
            date: '2026-10-07',
            amountMinor: 100_000_000n,
            direction: 'in',
            description: 'GAJI',
            categoryId: null,
            transferAccountId: null,
          },
        ],
      },
    });
    expect(server.confirmReviewBulk).toHaveBeenCalledWith({ data: { itemIds: ['a', 'b', 'c'] } });
    await userEvent.click(page.getByRole('button', { name: 'Selesai' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('reports skipped duplicates and failed rows on the done step', async () => {
    await done({
      request: { ok: true, value: { created: 2, duplicates: 3, rejected: 0, itemIds: ['a', 'b'] } },
      confirm: { ok: true, value: { confirmed: ['a'], failed: [{ id: 'b', code: 'NOT_FOUND' }] } },
    });
    await vi.waitFor(async () => {
      await expect.element(page.getByText('1 transaksi tercatat')).toBeInTheDocument();
    });
    await expect.element(page.getByText('3 duplikat dilewati')).toBeInTheDocument();
    await expect.element(page.getByText('Impor gagal · Coba lagi sebentar.')).toBeInTheDocument();
  });

  it('skips the confirmation when the server kept every row as a duplicate', async () => {
    await done({ request: { ok: true, value: { created: 0, duplicates: 3, rejected: 0, itemIds: [] } } });
    await vi.waitFor(async () => {
      await expect.element(page.getByText('0 transaksi tercatat')).toBeInTheDocument();
    });
    expect(server.confirmReviewBulk).not.toHaveBeenCalled();
  });

  it('reports a failed confirmation for every row', async () => {
    await done({ confirm: { ok: false, code: 'INTERNAL' } });
    await vi.waitFor(async () => {
      await expect.element(page.getByText('0 transaksi tercatat')).toBeInTheDocument();
    });
    await expect.element(page.getByText('Impor gagal · Coba lagi sebentar.')).toBeInTheDocument();
  });

  it('shows the ledger error when the server refuses the rows', async () => {
    await done({ request: { ok: false, code: 'NOT_FOUND' } });
    await vi.waitFor(async () => {
      await expect.element(page.getByText('Data ini sudah tidak ada. Muat ulang halaman.')).toBeInTheDocument();
    });
    expect(server.confirmReviewBulk).not.toHaveBeenCalled();
  });
});

/** Toggles the dialog the way the Transactions page does, so a finished one can be reopened. */
function Toggle() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
        }}
      >
        open
      </button>
      <ImportDialog open={open} onOpenChange={setOpen} accounts={accounts} categories={categories} />
    </>
  );
}

describe('closing', () => {
  it('starts over the next time it opens', async () => {
    server.listTransactionRows.mockResolvedValue(rowsPage([]));
    server.requestImport.mockResolvedValue(STORED);
    server.confirmReviewBulk.mockResolvedValue({ ok: true, value: { confirmed: ['a', 'b', 'c'], failed: [] } });
    await renderApp(<Toggle />);
    await userEvent.click(page.getByRole('button', { name: 'open' }));
    await pickFile(csvFile(STATEMENT));
    await vi.waitFor(async () => {
      await expect.element(page.getByRole('button', { name: 'Impor 3 transaksi' })).toBeEnabled();
    });
    await userEvent.click(page.getByRole('button', { name: 'Impor 3 transaksi' }));
    await vi.waitFor(async () => {
      await expect.element(page.getByRole('button', { name: 'Selesai' })).toBeInTheDocument();
    });
    await userEvent.click(page.getByRole('button', { name: 'Selesai' }));
    await userEvent.click(page.getByRole('button', { name: 'open' }));
    await expect.element(page.getByText('Pilih rekening tujuan')).toBeInTheDocument();
  });
});
