// SPDX-License-Identifier: AGPL-3.0-only
import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import {
  detectBank,
  fileSize,
  ImportRejectedError,
  importRejectMessage,
  isSupportedType,
  mapColumns,
  MAX_IMPORT_BYTES,
  parseAmountCell,
  parseDateCell,
  parseRow,
  parseStatementFile,
  positionalMapping,
  TEMPLATE_CSV,
  type ColumnMapping,
} from './import-parse.ts';

const csv = (content: string, name = 'mutasi-bca-okt-2026.csv') => new File([content], name, { type: 'text/csv' });

const withMapping = (patch: Partial<ColumnMapping>): ColumnMapping => ({
  date: 0,
  description: 1,
  amount: 2,
  amountIn: null,
  amountOut: null,
  balance: 3,
  ...patch,
});

describe('fileSize', () => {
  it('formats KB and MB', () => {
    expect(fileSize(42 * 1024)).toBe('42 KB');
    expect(fileSize(14.8 * 1024 * 1024)).toBe('14,8 MB');
  });
});

describe('importRejectMessage', () => {
  it('explains a wrong type and an oversized file with the design’s copy', () => {
    expect(importRejectMessage('type', 'rekening.docx', 0)).toBe(
      'rekening.docx tidak diproses · Format .docx tidak didukung. Gunakan CSV atau XLSX maks 10 MB.',
    );
    expect(importRejectMessage('too-large', 'mutasi.csv', 14.8 * 1024 * 1024)).toBe(
      'mutasi.csv tidak diproses · Ukuran 14,8 MB melebihi batas 10 MB. Pecah file per bulan.',
    );
  });
});

describe('detectBank', () => {
  it('recognizes the known bank headers and answers null for a generic CSV', () => {
    expect(detectBank(['Tanggal', 'Keterangan', 'Mutasi', 'Saldo'])).toBe('BCA');
    expect(detectBank(['Tanggal transaksi', 'Keterangan', 'Jumlah'])).toBe('Mandiri');
    expect(detectBank(['Date', 'Description', 'Amount'])).toBeNull();
  });
});

describe('mapColumns', () => {
  it('maps amounts in/out, one signed amount, and the balance by header name', () => {
    expect(mapColumns(['Tanggal', 'Keterangan', 'Masuk', 'Keluar', 'Saldo'])).toEqual({
      date: 0,
      description: 1,
      amount: null,
      amountIn: 2,
      amountOut: 3,
      balance: 4,
    });
    expect(mapColumns(['TGL', 'Deskripsi', 'Jumlah', 'Saldo Akhir'])).toEqual({
      date: 0,
      description: 1,
      amount: 2,
      amountIn: null,
      amountOut: null,
      balance: 3,
    });
    expect(mapColumns(['Tanggal Transaksi', 'Keterangan', 'Debit', 'Kredit'])).toEqual({
      date: 0,
      description: 1,
      amount: null,
      amountIn: 3,
      amountOut: 2,
      balance: null,
    });
  });

  it('does not map the balance as the amount and answers null for unknown headers', () => {
    expect(mapColumns(['Saldo Mutasi', 'Keterangan'])).toMatchObject({ amount: null, balance: 0 });
    expect(mapColumns(['foo', 'bar'])).toEqual({
      date: null,
      description: null,
      amount: null,
      amountIn: null,
      amountOut: null,
      balance: null,
    });
  });
});

describe('positionalMapping', () => {
  it('falls back to date, description, amount, balance and refuses too-narrow files', () => {
    expect(positionalMapping(4)).toEqual({
      date: 0,
      description: 1,
      amount: 2,
      amountIn: null,
      amountOut: null,
      balance: 3,
    });
    expect(positionalMapping(3)).toMatchObject({ amount: 2, balance: null });
    expect(positionalMapping(2)).toMatchObject({ date: null, amount: null });
  });
});

describe('importRejectMessage', () => {
  it('falls back to a placeholder extension without a dot', () => {
    expect(importRejectMessage('type', 'mutasi', 0)).toContain('Format .? tidak didukung');
  });
});

describe('parseDateCell', () => {
  it('answers null for missing and broken spreadsheet dates', () => {
    expect(parseDateCell(null)).toBeNull();
    expect(parseDateCell(new Date('not a date'))).toBeNull();
  });

  it('reads ISO, day-first, textual, and spreadsheet dates', () => {
    expect(parseDateCell('2026-10-15')?.date).toBe('2026-10-15');
    expect(parseDateCell('15/10/2026')?.date).toBe('2026-10-15');
    expect(parseDateCell('5-10-26')?.date).toBe('2026-10-05');
    expect(parseDateCell('05 Okt 2026')?.date).toBe('2026-10-05');
    expect(parseDateCell(new Date(Date.UTC(2026, 9, 15)))?.date).toBe('2026-10-15');
  });

  it('answers null for empty and impossible dates', () => {
    expect(parseDateCell('31/09/2026')).toBeNull();
    expect(parseDateCell('')).toBeNull();
    expect(parseDateCell('gagal')).toBeNull();
    expect(parseDateCell('05 Foo 2026')).toBeNull();
  });
});

describe('parseAmountCell', () => {
  it('reads Indonesian amounts, negatives in parentheses, and plain numbers', () => {
    expect(parseAmountCell('Rp1.234.567,89')).toBe(123_456_789);
    expect(parseAmountCell('(25.000)')).toBe(-2_500_000);
    expect(parseAmountCell('1,234.56')).toBe(123_456);
    expect(parseAmountCell('Rp 25.000')).toBe(2_500_000);
    expect(parseAmountCell(12.345)).toBe(1235);
    expect(parseAmountCell('-500')).toBe(-50_000);
  });

  it('answers null when nothing numeric remains', () => {
    expect(parseAmountCell(null)).toBeNull();
    expect(parseAmountCell(Number.NaN)).toBeNull();
    expect(parseAmountCell('')).toBeNull();
    expect(parseAmountCell('Rp')).toBeNull();
    expect(parseAmountCell('kosong')).toBeNull();
  });
});

describe('parseRow', () => {
  it('reads a row with one signed amount', () => {
    expect(parseRow(['05/10/2026', 'QRIS KOPI', '-25.000', '2.475.000'], 1, withMapping({}))).toMatchObject({
      row: 1,
      date: '2026-10-05',
      amountMinor: 2_500_000,
      direction: 'out',
      description: 'QRIS KOPI',
      errors: [],
    });
  });

  it('reads amounts in/out and prefers the non-empty column', () => {
    const mapping = withMapping({ amount: null, amountIn: 2, amountOut: 3 });
    expect(parseRow(['05/10/2026', 'TRANSFER MASUK', '1.000.000', ''], 2, mapping)).toMatchObject({
      amountMinor: 1_000_000_00,
      direction: 'in',
    });
    expect(parseRow(['05/10/2026', 'QRIS KOPI', '', '25.000'], 2, mapping)).toMatchObject({
      amountMinor: 2_500_000,
      direction: 'out',
    });
  });

  it('keeps a reason per broken cell, with the design’s copy', () => {
    expect(parseRow(['31/09/2026', 'x', '1.000'], 17, withMapping({})).errors).toEqual([
      "Baris 17: format tanggal '31/09/2026' tidak valid",
    ]);
    expect(parseRow(['05/10/2026', 'x', '', '2.475.000'], 33, withMapping({})).errors).toEqual([
      'Baris 33: kolom jumlah kosong',
    ]);
    expect(parseRow(['', 'x', '1.000'], 4, withMapping({})).errors).toEqual(['Baris 4: kolom tanggal kosong']);
    expect(parseRow(['05/10/2026', 'x', 'nol'], 5, withMapping({})).errors).toEqual([
      "Baris 5: kolom jumlah berisi 'nol' yang tidak bisa dibaca",
    ]);
    expect(parseRow(['05/10/2026', 'x', '0'], 6, withMapping({})).errors).toEqual([
      "Baris 6: kolom jumlah berisi '0' yang tidak bisa dibaca",
    ]);
  });

  it('reads a single inflow column without an outflow one', () => {
    expect(
      parseRow(['05/10/2026', 'GAJI', '1.000.000'], 4, withMapping({ amount: null, amountIn: 2, amountOut: null })),
    ).toMatchObject({
      amountMinor: 100_000_000,
      direction: 'in',
    });
  });

  it('reads a single outflow column without an inflow one', () => {
    expect(
      parseRow(['05/10/2026', 'QRIS KOPI', '25.000'], 3, withMapping({ amount: null, amountIn: null, amountOut: 2 })),
    ).toMatchObject({
      amountMinor: 2_500_000,
      direction: 'out',
    });
  });

  it('reports an empty amount when both inflow and outflow columns are blank', () => {
    const mapping = withMapping({ amount: null, amountIn: 2, amountOut: 3 });
    expect(parseRow(['05/10/2026', 'SALDO AWAL', '', ''], 7, mapping).errors).toEqual(['Baris 7: kolom jumlah kosong']);
  });

  it('reads rows without a description or balance column and with a broken inflow cell', () => {
    const mapping = withMapping({ description: null, amount: null, amountIn: 2, amountOut: 3, balance: null });
    expect(parseRow(['05/10/2026', '', 'abc', '25.000'], 5, mapping)).toMatchObject({
      description: null,
      amountMinor: 2_500_000,
      direction: 'out',
    });
    expect(parseRow(['05/10/2026', null, '1.000'], 6, withMapping({ balance: null })).description).toBeNull();
  });

  it('reports unmapped columns and trims or drops the description', () => {
    expect(parseRow(['05/10/2026', 'x', '1.000'], 7, withMapping({ date: null, amount: null })).errors).toEqual([
      'Baris 7: kolom wajib (tanggal, keterangan, jumlah) tidak terbaca',
    ]);
    expect(parseRow(['05/10/2026', '  ', '1.000'], 8, withMapping({})).description).toBeNull();
    expect(parseRow(['05/10/2026', ` ${'a'.repeat(201)} `, '1.000'], 9, withMapping({})).description).toHaveLength(200);
  });
});

describe('isSupportedType', () => {
  it('accepts the CSV and Excel extensions and media types only', () => {
    expect(isSupportedType('a.csv', '')).toBe(true);
    expect(isSupportedType('a.XLSX', '')).toBe(true);
    expect(isSupportedType('a', 'application/vnd.ms-excel')).toBe(true);
    expect(isSupportedType('a.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe(
      false,
    );
  });
});

describe('parseStatementFile', () => {
  it('parses a bank CSV: bank detected, rows mapped, headers kept', async () => {
    const statement = await parseStatementFile(
      csv('Tanggal;Keterangan;Mutasi;Saldo\n05/10/2026;QRIS KOPI;-25.000;2.475.000\n06/10/2026;GAJI;1.000.000;\n'),
    );
    expect(statement.name).toBe('mutasi-bca-okt-2026.csv');
    expect(statement.bank).toBe('BCA');
    expect(statement.headers).toEqual(['Tanggal', 'Keterangan', 'Mutasi', 'Saldo']);
    expect(statement.rows).toHaveLength(2);
    expect(statement.rows[0]).toMatchObject({ row: 1, direction: 'out', amountMinor: 2_500_000 });
    expect(statement.rows[1]).toMatchObject({ row: 2, direction: 'in', amountMinor: 1_000_000_00 });
  });

  it('sniffs the delimiter and falls back to positional columns without headers', async () => {
    const statement = await parseStatementFile(csv('05/10/2026,QRIS KOPI,-25.000,2475000\n', 'rekening.csv'));
    expect(statement.bank).toBeNull();
    expect(statement.rows[0]).toMatchObject({ date: '2026-10-05', direction: 'out', amountMinor: 2_500_000 });
  });

  it('keeps a headerless first line that is not a date out of the rows', async () => {
    const statement = await parseStatementFile(csv('A;B;C\n05/10/2026;QRIS KOPI;-25.000\n', 'rekening.csv'));
    expect(statement.rows).toHaveLength(1);
    expect(statement.rows[0]).toMatchObject({ date: '2026-10-05', direction: 'out' });
  });

  it('answers unreadable rows for a file whose columns name no amount', async () => {
    const statement = await parseStatementFile(csv('Tanggal;Keterangan\n05/10/2026;QRIS KOPI\n'));
    expect(statement.rows[0]).toMatchObject({ row: 1, date: null });
    expect(statement.rows[0]?.errors).toEqual(['Baris 1: kolom wajib (tanggal, keterangan, jumlah) tidak terbaca']);
  });

  it('parses an XLSX statement', async () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        ['Tanggal', 'Keterangan', 'Masuk', 'Keluar', 'Saldo'],
        [new Date(Date.UTC(2026, 9, 5)), 'QRIS KOPI', '', 25_000, 2_475_000],
      ]),
      'Mutasi',
    );
    const bytes = XLSX.write(workbook, { type: 'array' }) as ArrayBuffer;
    const statement = await parseStatementFile(
      new File([bytes], 'mutasi.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    );
    expect(statement.rows[0]).toMatchObject({ date: '2026-10-05', direction: 'out', amountMinor: 2_500_000 });
  });

  it('parses its own template', async () => {
    const statement = await parseStatementFile(csv(TEMPLATE_CSV, 'template-impor.csv'));
    expect(statement.rows.map((row) => row.direction)).toEqual(['out', 'out', 'in']);
    expect(statement.rows[0]).toMatchObject({ description: 'Saldo awal', amountMinor: 500_000_00 });
  });

  it('refuses a wrong type and an oversized file with the design’s rejections', async () => {
    await expect(parseStatementFile(new File(['x'], 'rekening.docx', { type: 'application/msword' }))).rejects.toThrow(
      new ImportRejectedError('type', 'rekening.docx'),
    );
    await expect(
      parseStatementFile(new File([new ArrayBuffer(MAX_IMPORT_BYTES + 1)], 'mutasi.csv', { type: 'text/csv' })),
    ).rejects.toMatchObject({ reason: 'too-large' });
  });

  it('answers empty rows for a file without data rows', async () => {
    expect((await parseStatementFile(csv('Tanggal;Keterangan;Mutasi;Saldo\n'))).rows).toEqual([]);
  });
});
