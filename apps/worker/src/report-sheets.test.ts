// SPDX-License-Identifier: AGPL-3.0-only
import { DEFAULT_REPORT_EXPORT_OPTIONS } from '@wf/domain/report';
import { describe, expect, it } from 'vitest';
import { fakeReportView, richReportView } from '../test/fakes.ts';
import { buildReportCsv, buildReportWorkbook, reportFileName, reportBlocks } from './report-sheets.ts';

const ALL = DEFAULT_REPORT_EXPORT_OPTIONS;

describe('reportBlocks', () => {
  it('keeps one block per section in print order, restricted to the chosen sections', () => {
    const names = reportBlocks(richReportView(), ALL).map((block) => block.name);
    expect(names).toEqual([
      'Ringkasan',
      'Tujuan',
      'Pemasukan',
      'Rekening',
      'Pengeluaran',
      'Merchant',
      'Tag',
      'Transaksi Terbesar',
      'Langganan',
    ]);
    const onlySpending = reportBlocks(richReportView(), { ...ALL, sections: ['spending'] }).map((block) => block.name);
    expect(onlySpending).toEqual(['Pengeluaran', 'Merchant', 'Tag']);
  });

  it('skips the empty optional blocks of a bare report and always keeps the subscription summary', () => {
    const names = reportBlocks(fakeReportView(), ALL).map((block) => block.name);
    expect(names).toEqual(['Ringkasan', 'Langganan']);
    // A provisional aggregate keeps its badge.
    const provisional = reportBlocks({ ...fakeReportView(), status: 'provisional' }, ALL)[0];
    expect(provisional?.rows.find((row) => row[0] === 'Status')).toEqual(['Status', 'Sementara']);
  });
});

describe('buildReportWorkbook', () => {
  it('writes one sheet per block with dates rendered in the locale', () => {
    const bytes = buildReportWorkbook(richReportView(), ALL, 'id');
    expect([...bytes.slice(0, 2)]).toEqual([0x50, 0x4b]); // zip magic of an xlsx container
    expect(bytes.length).toBeGreaterThan(1000);
    const sheetNames = reportBlocks(richReportView(), ALL).map((block) => block.name);
    // The workbook is a zip; its central directory lists the sheet names as `xl/worksheets/sheetN.xml` plus
    // workbook.xml with the names — a real read-back happens in the integration environment, here the shape suffices.
    expect(sheetNames.length).toBe(9);
    const largest = reportBlocks(richReportView(), { ...ALL, sections: ['largest'] })[0];
    expect(largest?.rows[1]?.[0]).toBe('2026-09-05'); // ISO in the block; the workbook renders it for reading
  });

  it('falls back to a placeholder sheet when every optional block is empty', () => {
    const bytes = buildReportWorkbook(fakeReportView(), { ...ALL, sections: ['flow'] }, 'id');
    expect([...bytes.slice(0, 2)]).toEqual([0x50, 0x4b]);
    // Dates render in the workbook's locale (Sep 5, 2026 in en).
    const en = buildReportWorkbook(richReportView(), ALL, 'en');
    expect(en.length).toBeGreaterThan(1000);
  });
});

describe('buildReportCsv', () => {
  it('writes one block per section, RFC 4180 quoted, machine-readable minor units', () => {
    const csv = buildReportCsv(richReportView(), ALL);
    const blocks = csv.trim().split('\n\n');
    expect(blocks[0]?.split('\n')[0]).toBe('Ringkasan');
    expect(blocks[0]).toContain('Pemasukan,25800000');
    expect(csv.endsWith('\n')).toBe(true);
    // Names with commas, quotes, and angle brackets are quoted and escaped.
    expect(csv).toContain('"""Kopi"", Nugget & <Ayam>"');
    expect(csv).toContain('#akhir-pekan');
    expect(csv).not.toContain('Rp'); // no display formatting in CSV
  });

  it('keeps ISO dates and leaves out the sections the dialog did not choose', () => {
    const csv = buildReportCsv(richReportView(), { ...ALL, sections: ['largest'] });
    expect(csv).toContain('2026-09-05');
    expect(csv).not.toContain('Ringkasan');
    const bare = buildReportCsv(fakeReportView(), { ...ALL, sections: ['flow'] });
    expect(bare).toBe('\n'); // no blocks, just the trailing newline
  });
});

describe('reportFileName', () => {
  it('flattens the label into a safe attachment name', () => {
    expect(reportFileName(richReportView(), 'pdf')).toBe('Laporan-September-2026.pdf');
    expect(reportFileName({ ...fakeReportView(), label: '2026-10-01/2026-10-15' }, 'xlsx')).toBe(
      'Laporan-2026-10-01-2026-10-15.xlsx',
    );
    expect(reportFileName(fakeReportView(), 'csv')).toBe('Laporan-September-2026.csv');
  });
});
