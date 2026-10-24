// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Self-contained HTML document of a stored report (design yLlRY; the four A4 pages TAU0h, t3PQGb, STgHg, ZWRR8). The
 * worker prints it with Chromium's `page.pdf()` into the export dialog's PDF. Labels are the design's Indonesian copy
 * as plain strings — the PDF is a printed artifact, not UI (D26); numbers and dates follow the user's locale via
 * `@wf/domain/money` and `Intl`. User-provided names are escaped; the document carries no scripts and no links.
 */
import { formatMoney, MINUS, type Locale, type MoneyContext } from '@wf/domain/money';
import type { ReportExportOptions, ReportExportSection } from '@wf/domain/report';
import type { ReportView } from '@wf/db/reports';

type Fmt = {
  readonly money: (minor: bigint, context?: MoneyContext) => string;
  readonly pct: (bps: number) => string;
  readonly signedPct: (bps: number | null) => string;
  readonly points: (bps: number | null) => string;
  readonly date: (iso: string) => string;
  readonly range: () => string;
};

const INTL_LOCALE: Readonly<Record<Locale, string>> = { id: 'id-ID', en: 'en-US' };

const esc = (text: string): string =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

/** "BCA 1234567890" → "BCA •• 7890" (design yLlRY "Samarkan nomor rekening"): amounts stay visible. */
export function maskAccountNumber(name: string): string {
  return name.replace(/\d{5,}/g, (run) => `•• ${run.slice(-4)}`);
}

function formatters(view: ReportView, locale: Locale, currency: string): Fmt {
  const intl = INTL_LOCALE[locale];
  return {
    money: (minor, context = 'table') => formatMoney(minor, currency, { locale, context }),
    pct: (bps) => new Intl.NumberFormat(intl, { style: 'percent', maximumFractionDigits: 1 }).format(bps / 10_000),
    signedPct: (bps) =>
      bps === null
        ? '–'
        : new Intl.NumberFormat(intl, { style: 'percent', maximumFractionDigits: 1, signDisplay: 'exceptZero' })
            .format(bps / 10_000)
            .replaceAll('-', MINUS),
    points: (bps) =>
      bps === null
        ? '–'
        : `${new Intl.NumberFormat(intl, { maximumFractionDigits: 1, signDisplay: 'exceptZero' })
            .format(bps / 100)
            .replaceAll('-', MINUS)} poin`,
    date: (iso) =>
      new Intl.DateTimeFormat(intl, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(
        new Date(`${iso}T00:00:00Z`),
      ),
    range: () =>
      new Intl.DateTimeFormat(intl, { day: 'numeric', month: 'short', timeZone: 'UTC' })
        .formatRange(new Date(`${view.range.from}T00:00:00Z`), new Date(`${view.range.to}T00:00:00Z`))
        .replace(/[\u2009\u202f]/g, ' ') +
      ' ' +
      view.range.to.slice(0, 4),
  };
}

const title = (view: ReportView, format: Fmt): string => `
  <header class="head">
    <div>
      <h1>Laporan ${esc(view.label)}</h1>
      <p class="sub">${esc(format.range())} · ${view.totals.txCount} transaksi ·
        <span class="badge">${view.status === 'final' ? 'Final' : 'Sementara'}</span></p>
      ${view.compare === null ? '' : `<p class="sub">dibandingkan dengan ${esc(view.compare.label)}</p>`}
    </div>
    <div class="brand">write.financial</div>
  </header>`;

function table(headers: readonly string[], rows: readonly (readonly string[])[]): string {
  if (rows.length === 0) return '<p class="empty">Tidak ada data pada rentang ini.</p>';
  return `<table><thead><tr>${headers.map((header) => `<th>${header}</th>`).join('')}</tr></thead><tbody>${rows
    .map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join('')}</tr>`)
    .join('')}</tbody></table>`;
}

function summaryPage(view: ReportView, format: Fmt): string {
  const { totals } = view;
  const netWorth =
    totals.netWorthMinor === null
      ? ''
      : `<div class="kpi"><span>Kekayaan bersih</span><strong>${esc(format.money(totals.netWorthMinor, 'amount'))}</strong>
        <em>per ${esc(format.date(view.range.to))}</em></div>`;
  const breakdown =
    view.sections.netWorth === null
      ? ''
      : table(
          ['Komponen', 'Nilai'],
          [
            [esc('Kas & rekening'), esc(format.money(view.sections.netWorth.cashMinor))],
            [esc('Investasi'), esc(format.money(view.sections.netWorth.investmentsMinor))],
            [esc('Utang'), esc(format.money(-view.sections.netWorth.debtMinor))],
          ],
        );
  const history = table(
    ['Bulan', 'Kekayaan bersih'],
    view.sections.netWorthHistory.map((point) => [
      esc(format.date(point.date)),
      point.valuation === null ? '–' : esc(format.money(point.valuation.valueMinor)),
    ]),
  );
  const goals = table(
    ['Tujuan', 'Target', 'Tersimpan', 'Progres'],
    view.sections.goals.map((goal) => [
      esc(goal.name),
      esc(format.money(goal.targetMinor)),
      goal.savedMinor === null ? '–' : esc(format.money(goal.savedMinor)),
      goal.progressBps === null ? '–' : esc(format.pct(goal.progressBps)),
    ]),
  );
  return `
  ${title(view, format)}
  <h2>Ringkasan</h2>
  <div class="kpis">
    <div class="kpi"><span>Pemasukan</span><strong>${esc(format.money(totals.incomeMinor, 'amount'))}</strong><em>${esc(format.signedPct(view.delta?.incomeBps ?? null))}</em></div>
    <div class="kpi"><span>Pengeluaran</span><strong>${esc(format.money(totals.expenseMinor, 'amount'))}</strong><em>${esc(format.signedPct(view.delta?.expenseBps ?? null))}</em></div>
    <div class="kpi"><span>Ditabung</span><strong>${esc(format.money(totals.savedMinor, 'amount'))}</strong><em>${esc(format.signedPct(view.delta?.savedBps ?? null))}</em></div>
    <div class="kpi"><span>Tingkat tabungan</span><strong>${totals.savingRateBps === null ? '–' : esc(format.pct(totals.savingRateBps))}</strong><em>${esc(format.points(view.delta?.savingRatePoints ?? null))}</em></div>
    ${netWorth}
  </div>
  <h2>Kekayaan bersih</h2>
  ${breakdown}
  ${history}
  <h2>Tujuan</h2>
  ${goals}`;
}

function flowPage(view: ReportView, format: Fmt, options: ReportExportOptions): string {
  return `
  ${title(view, format)}
  <h2>Pemasukan</h2>
  ${table(
    ['Sumber', 'Jumlah', 'Bagian'],
    view.sections.incomeSources.map((line) => [
      esc(line.name ?? 'Tanpa kategori'),
      esc(format.money(line.totalMinor)),
      esc(format.pct(line.shareBps)),
    ]),
  )}
  <h2>Arus rekening</h2>
  ${table(
    ['Rekening', 'Masuk', 'Keluar'],
    view.sections.accounts.map((line) => [
      esc(options.maskAccountNumbers ? maskAccountNumber(line.name) : line.name),
      line.inMinor === 0n ? '–' : esc(format.money(line.inMinor)),
      line.outMinor === 0n ? '–' : esc(format.money(line.outMinor)),
    ]),
  )}`;
}

function spendingPage(view: ReportView, format: Fmt): string {
  const busiest =
    view.sections.busiestWeek === null
      ? ''
      : `<p class="note">Minggu terboros ${esc(format.date(view.sections.busiestWeek.from))}–${esc(
          format.date(view.sections.busiestWeek.to),
        )} · ${esc(format.money(view.sections.busiestWeek.totalMinor))}</p>`;
  return `
  ${title(view, format)}
  <p class="note">Rata-rata ${esc(format.money(view.sections.averageDailyMinor, 'amount'))}/hari</p>
  <h2>Pengeluaran per kategori</h2>
  ${table(
    ['Kategori', 'Anggaran', 'Terpakai', 'Bagian'],
    view.sections.categories.map((line) => [
      esc(line.name ?? 'Tanpa kategori'),
      line.limitMinor === null ? '–' : esc(format.money(line.limitMinor)),
      esc(format.money(line.spentMinor)),
      line.overMinor > 0n
        ? `${esc(format.pct(line.usedBps ?? 0))} (lewat ${esc(format.money(line.overMinor))})`
        : esc(format.pct(line.shareBps)),
    ]),
  )}
  <h2>Merchant</h2>
  ${table(
    ['Merchant', 'Jumlah', 'Transaksi'],
    view.sections.merchants
      .slice(0, 10)
      .map((line) => [esc(line.merchant), esc(format.money(line.totalMinor)), String(line.count)]),
  )}
  <h2>Tag</h2>
  ${table(
    ['Tag', 'Jumlah', 'Transaksi'],
    view.sections.tags.map((line) => [esc(`#${line.name}`), esc(format.money(line.totalMinor)), String(line.count)]),
  )}
  ${busiest}`;
}

function largestPage(view: ReportView, format: Fmt): string {
  const subs = view.sections.subscriptions;
  return `
  ${title(view, format)}
  <h2>Transaksi terbesar</h2>
  <p class="note">${esc(
    view.sections.largestShareBps === null
      ? 'Tidak ada pengeluaran pada rentang ini.'
      : `${view.sections.largest.length} transaksi = ${format.pct(view.sections.largestShareBps)} dari pengeluaran`,
  )}</p>
  ${table(
    ['Tanggal', 'Keterangan', 'Jumlah', 'Bagian'],
    view.sections.largest.map((line) => [
      esc(format.date(line.date)),
      esc(line.merchant === null || line.merchant === '' ? line.description : `${line.description} · ${line.merchant}`),
      esc(format.money(line.amountMinor)),
      esc(format.pct(line.shareBps)),
    ]),
  )}
  <h2>Langganan</h2>
  <p class="note">${subs.active} aktif · ${esc(format.money(subs.monthlyMinor, 'amount'))}/bulan ≈ ${esc(
    format.money(subs.yearlyMinor, 'amount'),
  )}/tahun${subs.unconverted > 0 ? ` · ${subs.unconverted} langganan tanpa kurs pada akhir periode` : ''}</p>`;
}

const STYLE = `
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: 'Segoe UI', 'Helvetica Neue', Arial, sans-serif; font-size: 11px; line-height: 1.45;
    color: var(--fg); background: var(--bg); }
  :root { --fg: #18181b; --muted: #71717a; --line: #e4e4e7; --bg: #ffffff; --strong: #18181b; }
  body[data-theme='dark'] { --fg: #fafafa; --muted: #a1a1aa; --line: #3f3f46; --bg: #09090b; --strong: #fafafa; }
  .page { padding: 14mm 16mm; page-break-after: always; }
  .page:last-child { page-break-after: auto; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid var(--strong);
    padding-bottom: 8px; margin-bottom: 12px; }
  h1 { font-size: 20px; margin: 0 0 2px; }
  h2 { font-size: 13px; margin: 16px 0 6px; }
  .sub { color: var(--muted); margin: 0; }
  .badge { border: 1px solid var(--muted); border-radius: 4px; padding: 0 5px; font-size: 10px; }
  .brand { color: var(--muted); font-size: 10px; }
  .kpis { display: flex; flex-wrap: wrap; gap: 8px; }
  .kpi { border: 1px solid var(--line); border-radius: 6px; padding: 8px 10px; min-width: 130px; flex: 1; }
  .kpi span, .kpi em { display: block; color: var(--muted); font-style: normal; font-size: 10px; }
  .kpi strong { font-size: 15px; color: var(--strong); }
  table { width: 100%; border-collapse: collapse; margin-top: 4px; }
  th, td { text-align: left; padding: 4px 6px; border-bottom: 1px solid var(--line); }
  th { color: var(--muted); font-weight: 600; font-size: 10px; }
  td:last-child, th:last-child, td:nth-last-child(2), th:nth-last-child(2) { text-align: right; }
  .note { color: var(--muted); margin: 4px 0; }
  .empty { color: var(--muted); font-style: italic; }
`;

/** Builds the whole document; pages the dialog left out are simply not emitted. */
export function buildReportHtml(
  view: ReportView,
  options: ReportExportOptions,
  locale: Locale,
  currency: string,
): string {
  const format = formatters(view, locale, currency);
  const pages: readonly (readonly [ReportExportSection, () => string])[] = [
    ['summary', () => summaryPage(view, format)],
    ['flow', () => flowPage(view, format, options)],
    ['spending', () => spendingPage(view, format)],
    ['largest', () => largestPage(view, format)],
  ];
  return `<!doctype html>
<html lang="${locale}"><head><meta charset="utf-8"><title>Laporan ${esc(view.label)}</title><style>${STYLE}</style></head>
<body data-theme="${options.theme}">${pages
    .filter(([section]) => options.sections.includes(section))
    .map(([, build]) => `<section class="page">${build()}</section>`)
    .join('')}</body></html>`;
}
