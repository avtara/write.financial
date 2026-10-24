// SPDX-License-Identifier: AGPL-3.0-only
import { DEFAULT_REPORT_EXPORT_OPTIONS } from '@wf/domain/report';
import { describe, expect, it } from 'vitest';
import { fakeReportView, richReportView } from '../test/fakes.ts';
import { buildReportHtml, maskAccountNumber } from './report-html.ts';

const IDR = 'IDR';

describe('buildReportHtml', () => {
  it('renders the four pages with the design labels, locale numbers, and the comparison', () => {
    const html = buildReportHtml(richReportView(), DEFAULT_REPORT_EXPORT_OPTIONS, 'id', IDR);
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('lang="id"');
    expect(html).toContain('data-theme="light"');
    // Page 1: KPIs with the delta against the compared period, net worth breakdown and history, goals.
    expect(html).toContain('Laporan September 2026');
    expect(html).toContain('121 transaksi');
    expect(html).toContain('>Final<');
    expect(html).toContain('dibandingkan dengan Agustus 2026');
    expect(html).toContain('Rp25.800.000'); // amount context with symbol
    expect(html).toContain('+3,6%'); // signed percent, id separators
    expect(html).toContain('−1,8 poin'); // savings rate points
    expect(html).toContain('Kekayaan bersih');
    expect(html).toContain('Kas &amp; rekening');
    expect(html).toContain('Utang');
    expect(html).toContain('Tujuan');
    expect(html).not.toContain('•• '); // masking is off by default
  });

  it('masks account numbers only where the option asks, escaping names', () => {
    const view = richReportView();
    const masked = buildReportHtml(view, { ...DEFAULT_REPORT_EXPORT_OPTIONS, maskAccountNumbers: true }, 'id', IDR);
    expect(masked).toContain('BCA •• 7890');
    expect(masked).not.toContain('1234567890');
    const visible = buildReportHtml(view, DEFAULT_REPORT_EXPORT_OPTIONS, 'id', IDR);
    expect(visible).toContain('BCA 1234567890');
    // Merchant names are escaped, never raw HTML.
    expect(visible).toContain('&quot;Kopi&quot;, Nugget &amp; &lt;Ayam&gt;');
  });

  it('omits the pages the dialog left out and supports dark and Letter', () => {
    const view = richReportView();
    const onlyLargest = buildReportHtml(
      view,
      { ...DEFAULT_REPORT_EXPORT_OPTIONS, sections: ['largest'], theme: 'dark' },
      'en',
      IDR,
    );
    expect(onlyLargest).toContain('data-theme="dark"');
    expect(onlyLargest).toContain('Transaksi terbesar');
    expect(onlyLargest).toContain('Langganan');
    expect(onlyLargest).not.toContain('Ringkasan'); // page 1 heading
    expect(onlyLargest).not.toContain('Arus rekening');
    expect(onlyLargest).not.toContain('Pengeluaran per kategori');
    // English formatting: percent with a dot separator.
    expect(onlyLargest).toContain('35.5%');
  });

  it('renders a first provisional report without compare, valuation, or savings rate', () => {
    const html = buildReportHtml(
      { ...fakeReportView(), status: 'provisional' },
      DEFAULT_REPORT_EXPORT_OPTIONS,
      'id',
      IDR,
    );
    expect(html).toContain('>Sementara<');
    expect(html).not.toContain('dibandingkan dengan');
    // Null KPIs become the en dash, not fabricated zeros.
    expect(html).toContain('<strong>–</strong>');
    // Empty tables say so instead of rendering headers with no rows.
    expect(html).toContain('Tidak ada data pada rentang ini.');
  });
});

describe('maskAccountNumber', () => {
  it('keeps the last four digits of every long digit run', () => {
    expect(maskAccountNumber('BCA 1234567890')).toBe('BCA •• 7890');
    expect(maskAccountNumber(' Mandiri 12345678 9012 ')).toBe(' Mandiri •• 5678 9012 ');
    expect(maskAccountNumber('GoPay')).toBe('GoPay');
    expect(maskAccountNumber('No 1234 digits')).toBe('No 1234 digits');
  });
});
