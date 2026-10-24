// SPDX-License-Identifier: AGPL-3.0-only
/**
 * FR-LP4 export processor (`rep.{reportId}.{format}`, plan §6): renders one stored report into PDF (Chromium print of
 * {@link ../report-html.ts!buildReportHtml} — a self-contained document, so the render needs no app server), XLSX, or
 * CSV, stores the bytes in the encrypted `reports` bucket, and — for the auto-send flow — emails the PDF to the user.
 * The renderer and everything financial are injectable ports; the payload carries ids and rendering options only.
 */
import { createRequire } from 'node:module';
import type { Locale } from '@wf/domain/money';
import type { ReportExportOptions, ReportFormat } from '@wf/domain/report';
import type { ReportView } from '@wf/db/reports';
import type { Mailer } from '@wf/integrations/mailer';
import { MailNotConfiguredError } from '@wf/integrations/mailer';
import { JOBS } from '@wf/jobs/queues';
import type { ProcessorJob } from '../processors.ts';
import { buildReportHtml } from '../report-html.ts';
import { buildReportCsv, buildReportWorkbook, reportFileName } from '../report-sheets.ts';
import type { WorkerDb } from '../worker-db.ts';

export type ReportPdfRenderer = (html: string, paper: ReportExportOptions['paper']) => Promise<Uint8Array>;

export interface ReportExportResult {
  readonly format: ReportFormat;
  readonly fileKey: string;
  readonly sizeBytes: number;
  readonly emailed: boolean;
  readonly emailedReason?: 'not_requested' | 'gone' | 'mail_not_configured';
}

export interface ReportExportProcessorDeps {
  readonly db: Pick<WorkerDb, 'reports' | 'reportFiles' | 'preferences'>;
  /** Renders the self-contained HTML into PDF bytes; `createChromiumRenderer` is the production port. */
  readonly render: ReportPdfRenderer;
  readonly mailer: Mailer;
  /** `PUBLIC_URL`: the link in the auto-send email. */
  readonly publicUrl: string;
  readonly now: () => Date;
}

/** The media type of each format; must match `@wf/db/report-files`. */
const MIME: Readonly<Record<ReportFormat, string>> = {
  pdf: 'application/pdf',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv',
};

/** The part of playwright-core's chromium the renderer uses (kept structural, so the package stays optional). */
interface ChromiumLike {
  executablePath(): string;
  launch(options: { readonly executablePath: string }): Promise<{
    newPage(): Promise<{
      setContent(html: string, options: { readonly waitUntil: 'load' }): Promise<void>;
      pdf(options: { readonly format: 'A4' | 'Letter'; readonly printBackground: boolean }): Promise<Buffer>;
      close(): Promise<void>;
    }>;
    close(): Promise<void>;
  }>;
}

/**
 * The chromium binary: `PLAYWRIGHT_CHROMIUM_EXECUTABLE` (deployments that install the browser themselves), else the
 * registry path of the browsers the root `playwright` devDependency installed (`pnpm exec playwright install
 * chromium`; the revisions match because both packages share the version). In the container image the browser is a
 * system chromium pointed at with `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium`.
 */
export function chromiumExecutable(chromium: ChromiumLike): string {
  const fromEnv = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  if (fromEnv !== undefined && fromEnv !== '') return fromEnv;
  try {
    return chromium.executablePath();
  } catch (error) {
    throw new Error(
      'No chromium for the report PDF: set PLAYWRIGHT_CHROMIUM_EXECUTABLE or run `pnpm exec playwright install chromium`',
      { cause: error },
    );
  }
}

/** playwright-core first (no browser manager), then the root `playwright` devDependency; neither in the slim image. */
export function chromiumOf(load: (specifier: string) => unknown): ChromiumLike {
  for (const specifier of ['playwright-core', 'playwright'] as const) {
    try {
      const chromium = (load(specifier) as { readonly chromium?: ChromiumLike }).chromium;
      if (chromium !== undefined) return chromium;
    } catch {
      continue;
    }
  }
  throw new Error(
    'The report PDF needs playwright-core: add it to apps/worker (follow-up for the deploy image) or ship a renderer port',
  );
}

/** The production module loader: node's require, so `playwright-core` resolves without a bundler. */
export const nodeRequire = (specifier: string): unknown => createRequire(import.meta.url)(specifier);

/** Prints the self-contained HTML with an already-resolved chromium; the browser is opened and closed per PDF. */
function printWith(chromium: ChromiumLike, executablePath: string): ReportPdfRenderer {
  return async (html, paper) => {
    const browser = await chromium.launch({ executablePath });
    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'load' });
      const pdf = await page.pdf({ format: paper === 'letter' ? 'Letter' : 'A4', printBackground: true });
      await page.close();
      return new Uint8Array(pdf);
    } finally {
      await browser.close();
    }
  };
}

/**
 * The production renderer: chromium prints the HTML. The module and the browser binary are resolved lazily on the
 * first PDF, never at startup, so a host without a browser runs every other queue fine and only PDF jobs fail.
 */
export function createChromiumRenderer(load: (specifier: string) => unknown = nodeRequire): ReportPdfRenderer {
  let renderer: ReportPdfRenderer | null = null;
  return async (html, paper) => {
    if (renderer === null) {
      const chromium = chromiumOf(load);
      renderer = printWith(chromium, chromiumExecutable(chromium));
    }
    return renderer(html, paper);
  };
}

/** The bytes of one export; the user's locale formats the printed artifact, their currency the amounts. */
async function build(
  view: ReportView,
  format: ReportFormat,
  options: ReportExportOptions,
  locale: Locale,
  currency: string,
  render: ReportPdfRenderer,
): Promise<Uint8Array> {
  switch (format) {
    case 'pdf':
      return render(buildReportHtml(view, options, locale, currency), options.paper);
    case 'xlsx':
      return buildReportWorkbook(view, options, locale);
    case 'csv':
      return new TextEncoder().encode(buildReportCsv(view, options));
  }
}

export function createReportExportProcessor({
  db,
  render,
  mailer,
  publicUrl,
  now,
}: ReportExportProcessorDeps): (job: ProcessorJob) => Promise<ReportExportResult> {
  return async (job) => {
    const { userId, reportId, format, email, options } = JOBS['report-export'].parse(job.data);
    const view = await db.reports.get(userId, reportId);
    // The locale, currency, and address come from the user's profile at send time; a deleted user still gets a file.
    const recipient = email ? await db.reportFiles.recipient(userId) : null;
    const bytes = await build(view, format, options, recipient?.locale ?? 'id', recipient?.currency ?? 'IDR', render);
    const meta = await db.reportFiles.save(userId, reportId, format, options, bytes, now());
    const saved = { format, fileKey: meta.fileKey, sizeBytes: meta.sizeBytes };
    // The export itself always succeeds here; the email outcome is reported, not fatal (see the notify processor).
    if (recipient === null) return { ...saved, emailed: false, emailedReason: email ? 'gone' : 'not_requested' };
    if (!mailer.configured) return { ...saved, emailed: false, emailedReason: 'mail_not_configured' };
    try {
      await mailer.send({
        to: recipient.email,
        template: { kind: 'report_export', label: view.label, url: new URL('/reports', publicUrl).href },
        context: { locale: recipient.locale, instanceName: 'write.financial', recipientName: recipient.name },
        attachments: [
          { filename: reportFileName(view, format), content: Buffer.from(bytes), contentType: MIME[format] },
        ],
      });
    } catch (error) {
      // Without SMTP the export itself succeeded; retrying at once cannot help (see the notify processor).
      if (error instanceof MailNotConfiguredError)
        return { ...saved, emailed: false, emailedReason: 'mail_not_configured' };
      throw error;
    }
    return { ...saved, emailed: true };
  };
}
