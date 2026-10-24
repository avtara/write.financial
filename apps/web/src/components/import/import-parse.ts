// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Browser-side statement parsing (FR-L9, D4 — "File diproses di perangkatmu dan tidak disimpan"): CSV through
 * PapaParse (delimiter and quote sniffing) and XLSX through SheetJS, column auto-mapping for the common Indonesian
 * bank exports (date, description, one signed amount or amounts in/out, balance) with a positional fallback, a
 * generic template the user can download, and per-row reasons for every row that cannot be read. The file itself
 * never leaves the device — only the resulting rows are sent (see `server/fn/import.ts`).
 */
import { parseLocalDate, type LocalDate } from '@wf/domain/period';
import { m } from '@wf/i18n/messages';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import type { WorkSheet } from 'xlsx';
import type { ParsedRow } from './import-model.ts';

/** The FR-L9 upload limit. */
export const MAX_IMPORT_BYTES = 10 * 1024 * 1024;
/** File types the picker and the dropzone accept (PDF e-statement is P2). */
export const IMPORT_ACCEPT =
  '.csv,.xlsx,.xls,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export type ImportRejectReason = 'too-large' | 'type';

/** The upload-stage rejections with the design's error copy (design `El2vm`). */
export class ImportRejectedError extends Error {
  readonly reason: ImportRejectReason;
  readonly fileName: string;

  constructor(reason: ImportRejectReason, fileName: string) {
    super(reason === 'too-large' ? 'statement too large' : 'statement type not supported');
    this.reason = reason;
    this.fileName = fileName;
  }
}

/** The message for a refused file (the browser-side precheck and this module's own check share it). */
export function importRejectMessage(reason: ImportRejectReason, fileName: string, size: number): string {
  const ext = fileName.includes('.') ? fileName.slice(fileName.lastIndexOf('.') + 1).toLowerCase() : '?';
  return reason === 'too-large'
    ? m.import_error_size({ name: fileName, size: fileSize(size) })
    : m.import_error_type({ name: fileName, ext: `.${ext}` });
}

/** "42 KB", "14,8 MB". */
export function fileSize(bytes: number): string {
  const format = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 });
  return bytes < 1024 * 1024
    ? `${format.format(Math.max(1, Math.round(bytes / 1024)))} KB`
    : `${format.format(bytes / (1024 * 1024))} MB`;
}

/** Which column holds what: indices into the header row; `null` when the file has no such column. */
export interface ColumnMapping {
  readonly date: number | null;
  readonly description: number | null;
  /** One signed amount column ("Jumlah", "Mutasi"). */
  readonly amount: number | null;
  /** Separate inflow/outflow columns ("Masuk"/"Keluar", "Kredit"/"Debit"). */
  readonly amountIn: number | null;
  readonly amountOut: number | null;
  readonly balance: number | null;
}

const EMPTY_MAPPING: ColumnMapping = {
  date: null,
  description: null,
  amount: null,
  amountIn: null,
  amountOut: null,
  balance: null,
};

/** Banks whose export header the mapping recognizes (auto detection, design `e56WO`); `null` = generic CSV. */
const BANKS: readonly { readonly name: string; readonly match: (headers: string) => boolean }[] = [
  { name: 'BCA', match: (h) => /mutasi|saldo awal|saldo akhir/.test(h) },
  { name: 'Mandiri', match: (h) => /tanggal transaksi|tanggal nilai/.test(h) },
  { name: 'BRI', match: (h) => /saldo akhir|tgl transaksi/.test(h) },
];

/** The recognized bank's name, or `null` for a generic CSV ("CSV umum"). */
export function detectBank(headers: readonly string[]): string | null {
  const joined = headers.join(' ').toLowerCase();
  return BANKS.find((bank) => bank.match(joined))?.name ?? null;
}

/** A header naming a date column ("Tanggal", "Tgl", "Date") — never the description or an amount. */
const isDateHeader = (header: string): boolean => /tgl|tanggal|date/.test(header);

/** The first header matching `pattern` (and, with `allowDate = false`, not naming a date column). */
const first = (headers: readonly string[], pattern: RegExp, allowDate = false): number | null => {
  const index = headers.findIndex((header) => pattern.test(header) && (allowDate || !isDateHeader(header)));
  return index === -1 ? null : index;
};

/**
 * Maps the columns by header name: the date column, the description, one signed amount or amounts in/out
 * (debit = out, credit = in, as bank statements label them), and the balance. Without recognizable headers the
 * caller falls back to the positional mapping.
 */
export function mapColumns(headers: readonly string[]): ColumnMapping {
  const lower = headers.map((header) => header.toLowerCase());
  const date = first(lower, /(^|\s)(tgl|tanggal|date|waktu)(\s|$)/, true) ?? first(lower, /tgl|tanggal|date/, true);
  const description = first(lower, /keterangan|deskripsi|description|detail|uraian|transaksi|merchant/);
  const amountIn = first(lower, /masuk|kredit|deposit|setoran/);
  const amountOut = first(lower, /keluar|debit|withdrawal/);
  const balance = first(lower, /saldo|balance/);
  const amount = first(lower, /jumlah|nominal|mutasi|amount|nilai/);
  return {
    date,
    description,
    amountIn: amountIn === amountOut ? null : amountIn,
    amountOut: amountIn === amountOut ? null : amountOut,
    amount: amount === null || amount === balance ? null : amount,
    balance,
  };
}

/** Positional fallback for headerless exports: date, description, amount, and the rest is balance. */
export function positionalMapping(width: number): ColumnMapping {
  if (width < 3) return EMPTY_MAPPING;
  return { ...EMPTY_MAPPING, date: 0, description: 1, amount: 2, balance: width > 3 ? width - 1 : null };
}

const MONTHS: Record<string, number> = {
  jan: 1,
  januari: 1,
  feb: 2,
  februari: 2,
  peb: 2,
  mar: 3,
  maret: 3,
  apr: 4,
  april: 4,
  mei: 5,
  may: 5,
  jun: 6,
  juni: 6,
  jul: 7,
  juli: 7,
  agu: 8,
  agustus: 8,
  aug: 8,
  sep: 9,
  sept: 9,
  september: 9,
  okt: 10,
  oct: 10,
  oktober: 10,
  october: 10,
  nov: 11,
  november: 11,
  des: 12,
  dec: 12,
  desember: 12,
  december: 12,
};

/** `Date` → `YYYY-MM-DD` in UTC (SheetJS dates are UTC noon). */
function isoOf(date: Date): LocalDate {
  return date.toISOString().slice(0, 10) as LocalDate;
}

/** Group `index` of `match` (the patterns above always capture it), so `noUncheckedIndexedAccess` stays quiet. */
const group = (match: RegExpExecArray, index: number): string => match[index] as string;

/** A cell as trimmed text ("31/09/2026", 25000); anything but a string or a number reads as empty. */
const cellText = (value: unknown): string =>
  typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';

/**
 * Parses a date cell: ISO `YYYY-MM-DD`, `DD/MM/YYYY` (or `-`, two-digit year), `DD MMM YYYY`, or a spreadsheet
 * date. Answers `null` (keep the raw value for the reason) when it is not a real calendar date.
 */
export function parseDateCell(value: unknown): { date: LocalDate; raw: string } | null {
  const raw = cellText(value);
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : { date: isoOf(value), raw };
  if (raw === '') return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (iso !== null) return validDate(group(iso, 1), group(iso, 2), group(iso, 3), raw);
  const dmy = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/.exec(raw);
  if (dmy !== null) {
    const captured = group(dmy, 3);
    const year = captured.length === 2 ? `20${captured}` : captured;
    return validDate(year, group(dmy, 2), group(dmy, 1), raw);
  }
  const textual = /^(\d{1,2})\s+([a-z]+)\s+(\d{4})$/i.exec(raw);
  if (textual !== null) {
    const month = MONTHS[group(textual, 2).toLowerCase()];
    return month === undefined ? null : validDate(group(textual, 3), String(month), group(textual, 1), raw);
  }
  return null;
}

/** The cell's date when it is a real calendar day (`31/09/2026` is not), keeping the raw value for the reason. */
function validDate(year: string, month: string, day: string, raw: string): { date: LocalDate; raw: string } | null {
  const iso = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  try {
    // parseLocalDate rejects, e.g., 31/09; the rejection is the signal, not the value.
    return { date: parseLocalDate(iso), raw };
  } catch {
    return null;
  }
}

/**
 * Parses an amount cell ("Rp1.234.567,89", "(1.234,00)" = negative, "1,234.56") into minor units (cents);
 * `null` when nothing numeric remains.
 */
export function parseAmountCell(value: unknown): number | null {
  if (typeof value === 'number') return Number.isNaN(value) ? null : Math.round(value * 100);
  let raw = cellText(value);
  if (raw === '') return null;
  const negative = /^\(.*\)$/.test(raw) || raw.startsWith('-');
  raw = raw
    .replace(/[()-]/g, '')
    .replace(/rp|usd|idr|\$/gi, '')
    .trim();
  if (raw === '') return null;
  const lastComma = raw.lastIndexOf(',');
  const lastDot = raw.lastIndexOf('.');
  if (lastComma > lastDot) raw = raw.replace(/\./g, '').replace(',', '.');
  else if (lastComma === -1 && /\.\d{3}$/.test(raw))
    raw = raw.replace(/\./g, ''); // "25.000" = thousands
  else raw = raw.replace(/,/g, '');
  const amount = Number.parseFloat(raw);
  if (Number.isNaN(amount)) return null;
  return Math.round(amount * 100) * (negative ? -1 : 1);
}

/** A grid row (one statement line) of raw cells. */
type Cells = readonly unknown[];

/**
 * Reads one grid row with `mapping`: date, description, direction, and positive amount in minor units; a row that
 * cannot be read keeps its localized reasons ("Baris 17: format tanggal '31/09/2026' tidak valid", …).
 */
export function parseRow(cells: Cells, row: number, mapping: ColumnMapping): ParsedRow {
  const cell = (index: number | null) => (index === null ? undefined : cells[index]);
  const errors: string[] = [];
  // A file without a recognizable date or amount column is unreadable as a whole; say so once per row.
  if (mapping.date === null || (mapping.amount === null && mapping.amountIn === null && mapping.amountOut === null)) {
    return {
      row,
      date: null,
      amountMinor: null,
      direction: null,
      description: null,
      errors: [m.import_row_no_columns({ row })],
    };
  }
  const dateCell = parseDateCell(cell(mapping.date));
  if (dateCell === null) {
    const raw = cellText(cell(mapping.date));
    errors.push(raw === '' ? m.import_row_date_missing({ row }) : m.import_row_date_invalid({ row, value: raw }));
  }
  const description = cellText(cell(mapping.description)).slice(0, 200) || null;

  let direction: 'in' | 'out' | null = null;
  let amountMinor: number | null = null;
  if (mapping.amount !== null) {
    const amountRaw = cellText(cell(mapping.amount));
    if (amountRaw === '') {
      errors.push(m.import_row_amount_missing({ row }));
    } else {
      const parsed = parseAmountCell(amountRaw);
      if (parsed === null || parsed === 0) {
        errors.push(m.import_row_amount_invalid({ row, value: amountRaw }));
      } else {
        amountMinor = Math.abs(parsed);
        direction = parsed > 0 ? 'in' : 'out';
      }
    }
  } else {
    // The guard above guarantees an inflow/outflow pair here; the missing side reads as 0.
    const inMinor = mapping.amountIn === null ? 0 : (parseAmountCell(cell(mapping.amountIn)) ?? 0);
    const outMinor = mapping.amountOut === null ? 0 : (parseAmountCell(cell(mapping.amountOut)) ?? 0);
    if (inMinor === 0 && outMinor === 0) {
      errors.push(m.import_row_amount_missing({ row }));
    } else if (Math.abs(inMinor) >= Math.abs(outMinor)) {
      amountMinor = Math.abs(inMinor);
      direction = 'in';
    } else {
      amountMinor = Math.abs(outMinor);
      direction = 'out';
    }
  }
  return { row, date: dateCell?.date ?? null, amountMinor, direction, description, errors };
}

/** The generic template ("Unduh template CSV", design `e56WO`): semicolon-separated, Indonesian headers. */
export const TEMPLATE_CSV = [
  'Tanggal;Keterangan;Masuk;Keluar;Saldo',
  '01/10/2026;Saldo awal;;500000;2.500.000',
  '05/10/2026;QRIS KOPI SENIN;;25000;2.475.000',
  '07/10/2026;TRANSFER MASUK BUDI;1000000;;3.475.000',
].join('\n');

export interface ParsedStatement {
  readonly name: string;
  readonly size: number;
  /** The recognized bank, or `null` for a generic CSV. */
  readonly bank: string | null;
  /** The mapped header names, for the review's meta line. */
  readonly headers: readonly string[];
  readonly rows: readonly ParsedRow[];
}

function gridOfCsv(text: string): string[][] {
  // delimiter: "" lets PapaParse sniff `,` `;` `\t` `|`; the first row is the header (or the first data row).
  const result = Papa.parse<string[]>(text, { delimiter: '', skipEmptyLines: 'greedy' });
  return result.data;
}

function gridOfXlsx(bytes: ArrayBuffer): unknown[][] {
  const workbook = XLSX.read(bytes, { type: 'array', cellDates: true });
  // A workbook without a readable first sheet has no rows to answer (`sheet_to_json` reads `undefined` as empty);
  // the caller then shows the empty-file reason.
  const sheet = workbook.Sheets[workbook.SheetNames[0] as string] as WorkSheet;
  return XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', raw: true });
}

/** True when the file's extension or media type is CSV or Excel. */
export function isSupportedType(name: string, type: string): boolean {
  if (/^\.csv$|^\.xlsx?$/.test(name.slice(name.lastIndexOf('.')).toLowerCase())) return true;
  return [
    'text/csv',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ].includes(type);
}

/**
 * Parses an uploaded statement: type and size rejections first (with the design's copy), then the grid, the column
 * mapping (by header name, positional fallback), and one {@link ParsedRow} per data row.
 */
export async function parseStatementFile(file: File): Promise<ParsedStatement> {
  if (!isSupportedType(file.name, file.type)) throw new ImportRejectedError('type', file.name);
  if (file.size > MAX_IMPORT_BYTES) throw new ImportRejectedError('too-large', file.name);
  const grid = file.name.toLowerCase().endsWith('.csv')
    ? gridOfCsv(await file.text())
    : gridOfXlsx(await file.arrayBuffer());
  const [head = [], ...data] = grid;
  const headers = head.map(String);
  const readRows = (mapping: ColumnMapping, cells: readonly unknown[][]) =>
    cells.map((row, index) => parseRow(row, index + 1, mapping));
  let mapping = mapColumns(headers);
  const mapped =
    mapping.date !== null && (mapping.amount !== null || mapping.amountIn !== null || mapping.amountOut !== null);
  let rows: ParsedRow[];
  if (mapped) {
    rows = readRows(mapping, data);
  } else {
    mapping = positionalMapping(head.length);
    // A file without a header row: its first line already parses as a date, so it is a data row.
    rows = readRows(
      mapping,
      mapping.date !== null && parseDateCell(head[mapping.date]) !== null ? [head, ...data] : data,
    );
  }
  return { name: file.name, size: file.size, bank: detectBank(headers), headers, rows };
}
