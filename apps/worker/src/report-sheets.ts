// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Tabular exports of a stored report (design yLlRY): XLSX via SheetJS CE with one sheet per section, and CSV as one
 * machine-readable file ("semua aplikasi") with the same blocks. Both keep raw minor units and ISO dates so any tool
 * can parse them; the display locale only names the date columns' rendering in XLSX.
 */
import { utils, write } from 'xlsx';
import type { Locale } from '@wf/domain/money';
import type { ReportExportOptions } from '@wf/domain/report';
import type { ReportView } from '@wf/db/reports';

type Row = readonly (string | number)[];

/** One named block of the report; the sheet name (XLSX) and the CSV block heading. */
interface Block {
  readonly name: string;
  readonly rows: readonly Row[];
}

const date = (iso: string, locale: Locale): string =>
  new Intl.DateTimeFormat(locale === 'id' ? 'id-ID' : 'en-US', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${iso}T00:00:00Z`));

/** The report's blocks in print order, restricted to the sections the export dialog chose. */
export function reportBlocks(view: ReportView, options: ReportExportOptions): readonly Block[] {
  const want = (section: ReportExportOptions['sections'][number]): boolean => options.sections.includes(section);
  const blocks: Block[] = [];
  if (want('summary')) {
    blocks.push({
      name: 'Ringkasan',
      rows: [
        ['Laporan', view.label],
        ['Rentang', `${view.range.from} – ${view.range.to}`],
        ['Status', view.status === 'final' ? 'Final' : 'Sementara'],
        ['Transaksi', view.totals.txCount],
        ...(view.compare === null ? [] : ([['Dibandingkan dengan', view.compare.label]] as const)),
        ['Pemasukan', view.totals.incomeMinor.toString()],
        ['Pengeluaran', view.totals.expenseMinor.toString()],
        ['Ditabung', view.totals.savedMinor.toString()],
        ...(view.totals.netWorthMinor === null
          ? []
          : ([['Kekayaan bersih', view.totals.netWorthMinor.toString()]] as const)),
      ],
    });
    if (view.sections.goals.length > 0) {
      blocks.push({
        name: 'Tujuan',
        rows: [
          ['Tujuan', 'Target', 'Tersimpan', 'Progres'],
          ...view.sections.goals.map(
            (goal) =>
              [
                goal.name,
                goal.targetMinor.toString(),
                goal.savedMinor === null ? '' : goal.savedMinor.toString(),
                goal.progressBps === null ? '' : goal.progressBps / 10_000,
              ] as Row,
          ),
        ],
      });
    }
  }
  if (want('flow')) {
    if (view.sections.incomeSources.length > 0) {
      blocks.push({
        name: 'Pemasukan',
        rows: [
          ['Sumber', 'Jumlah', 'Bagian'],
          ...view.sections.incomeSources.map(
            (line) => [line.name ?? 'Tanpa kategori', line.totalMinor.toString(), line.shareBps / 10_000] as Row,
          ),
        ],
      });
    }
    if (view.sections.accounts.length > 0) {
      blocks.push({
        name: 'Rekening',
        rows: [
          ['Rekening', 'Masuk', 'Keluar'],
          ...view.sections.accounts.map(
            (line) => [line.name, line.inMinor.toString(), line.outMinor.toString()] as Row,
          ),
        ],
      });
    }
  }
  if (want('spending')) {
    if (view.sections.categories.length > 0) {
      blocks.push({
        name: 'Pengeluaran',
        rows: [
          ['Kategori', 'Anggaran', 'Terpakai', 'Lewat'],
          ...view.sections.categories.map(
            (line) =>
              [
                line.name ?? 'Tanpa kategori',
                line.limitMinor === null ? '' : line.limitMinor.toString(),
                line.spentMinor.toString(),
                line.overMinor.toString(),
              ] as Row,
          ),
        ],
      });
    }
    if (view.sections.merchants.length > 0) {
      blocks.push({
        name: 'Merchant',
        rows: [
          ['Merchant', 'Jumlah', 'Transaksi'],
          ...view.sections.merchants.map((line) => [line.merchant, line.totalMinor.toString(), line.count] as Row),
        ],
      });
    }
    if (view.sections.tags.length > 0) {
      blocks.push({
        name: 'Tag',
        rows: [
          ['Tag', 'Jumlah', 'Transaksi'],
          ...view.sections.tags.map((line) => [`#${line.name}`, line.totalMinor.toString(), line.count] as Row),
        ],
      });
    }
  }
  if (want('largest')) {
    if (view.sections.largest.length > 0) {
      blocks.push({
        name: 'Transaksi Terbesar',
        rows: [
          ['Tanggal', 'Keterangan', 'Merchant', 'Jumlah', 'Bagian'],
          ...view.sections.largest.map(
            (line) =>
              [
                line.date,
                line.description,
                line.merchant ?? '',
                line.amountMinor.toString(),
                line.shareBps / 10_000,
              ] as Row,
          ),
        ],
      });
    }
    blocks.push({
      name: 'Langganan',
      rows: [
        ['Aktif', 'Per bulan (minor)', 'Per tahun (minor)', 'Tanpa kurs'],
        [
          view.sections.subscriptions.active,
          view.sections.subscriptions.monthlyMinor.toString(),
          view.sections.subscriptions.yearlyMinor.toString(),
          view.sections.subscriptions.unconverted,
        ],
      ],
    });
  }
  return blocks;
}

/** One XLSX workbook with a sheet per block (ISO dates rendered in the user's locale). */
export function buildReportWorkbook(view: ReportView, options: ReportExportOptions, locale: Locale): Uint8Array {
  const book = utils.book_new();
  const blocks = reportBlocks(view, options);
  if (blocks.length === 0) {
    utils.book_append_sheet(book, utils.aoa_to_sheet([['Tidak ada bagian yang dipilih.']]), 'Laporan');
  }
  for (const block of blocks) {
    const readable = block.rows.map((row) =>
      row.map((cell) => (typeof cell === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(cell) ? date(cell, locale) : cell)),
    );
    utils.book_append_sheet(book, utils.aoa_to_sheet(readable), block.name.slice(0, 31));
  }
  return new Uint8Array(write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer);
}

const CSV_CELL = /[",\n;]/;

/** One CSV block per section with blank lines between; RFC 4180 quoting. */
export function buildReportCsv(view: ReportView, options: ReportExportOptions): string {
  const cell = (value: string | number): string => {
    const text = String(value);
    return CSV_CELL.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  return (
    reportBlocks(view, options)
      .map((block) => [block.name, ...block.rows.map((row) => row.map(cell).join(','))].join('\n'))
      .join('\n\n') + '\n'
  );
}

/** Attachment filename of an export ("Laporan-September-2026.pdf"); characters outside letters, digits, and dashes are flattened. */
export function reportFileName(view: ReportView, format: 'pdf' | 'xlsx' | 'csv'): string {
  return `Laporan-${view.label.replaceAll(/[^\p{L}\p{N}-]+/gu, '-')}.${format}`;
}
