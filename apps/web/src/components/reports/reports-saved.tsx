// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Laporan tersimpan · Diunduh atau dikirim otomatis" (design §A.4): every saved report with its status, range, and
 * totals, and — when exports exist (FR-LP4) — every stored file with its format, size, and date, each row a
 * download of the decrypted bytes. A report row opens the report; rows the page cannot fetch yet (no period id in
 * hand) stay static until the home response carries it.
 */
import type { ReportFileMeta } from '@wf/db/report-files';
import type { ReportSummary } from '@wf/db/reports';
import type { LocalDate } from '@wf/domain/period';
import type { Locale } from '@wf/i18n/locale';
import { m } from '@wf/i18n/messages';
import { formatDateTime } from '@wf/i18n/format';
import { Download } from 'lucide-react';
import { shortRange } from '../dashboard/dashboard-format.ts';
import { formatFileSize } from './reports-model.ts';
import { StatusBadge } from './reports-states.tsx';
import type { ReportSelection } from './reports-model.ts';

export interface SavedSectionProps {
  readonly reports: readonly ReportSummary[];
  readonly selectedId: string | null;
  /** The selection the page can fetch for each row (its period id is known). */
  readonly selectable: ReadonlyMap<string, ReportSelection>;
  readonly locale: Locale;
  readonly today: LocalDate;
  /** The user's zone, for the files' dates. */
  readonly timeZone: string;
  /** The stored export files, newest first; `null` while the list has not loaded, hidden when empty. */
  readonly files: readonly ReportFileMeta[] | null;
  readonly onSelect: (selection: ReportSelection) => void;
}

/** "PDF · 1,2 MB · 1 Okt 2026, 09.00" — the quiet metadata of one stored file. */
function fileMeta(file: ReportFileMeta, locale: Locale, timeZone: string): string {
  return [
    file.format.toUpperCase(),
    formatFileSize(file.sizeBytes, locale),
    formatDateTime(file.createdAt, locale, timeZone),
  ].join(' · ');
}

export function SavedSection({
  reports,
  selectedId,
  selectable,
  locale,
  today,
  timeZone,
  files,
  onSelect,
}: SavedSectionProps) {
  return (
    <section
      aria-labelledby="reports-saved"
      className="flex flex-col gap-3 rounded-[12px] border border-border bg-card px-6 py-5"
    >
      <div className="flex flex-col gap-1">
        <h2 id="reports-saved" className="text-[15px] font-semibold text-fg">
          {m.reports_saved_title()}
        </h2>
        <p className="text-[12.5px] text-muted-fg">{m.reports_saved_hint()}</p>
      </div>
      {reports.length === 0 ? (
        files !== null && files.length > 0 ? null : (
          <p className="text-[12.5px] text-subtle">{m.reports_saved_empty()}</p>
        )
      ) : (
        <ul className="flex flex-col">
          {reports.map((report, index) => {
            const selection = selectable.get(report.id);
            const content = (
              <>
                <span className="min-w-0 flex-1 truncate text-fg">{report.label}</span>
                <StatusBadge status={report.status} />
                <span className="font-mono text-[11.5px] text-subtle tabular-nums">
                  {shortRange(report.range, locale, today)}
                </span>
                <span className="text-subtle">{m.reports_tx_count({ count: report.totals.txCount })}</span>
              </>
            );
            return (
              <li key={index} className="border-border not-first:border-t">
                {selection === undefined ? (
                  <div className="-mx-2 flex flex-wrap items-center gap-x-3 gap-y-1 px-2 py-2 text-[12.5px]">
                    {content}
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      onSelect(selection);
                    }}
                    aria-pressed={report.id === selectedId}
                    className="-mx-2 flex w-[calc(100%+16px)] flex-wrap items-center gap-x-3 gap-y-1 rounded-[8px] px-2 py-2 text-left text-[12.5px] hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    {content}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {files === null || files.length === 0 ? null : (
        <ul className="flex flex-col">
          {files.map((file) => {
            // The stored file keeps only its report's id; the label comes from the saved reports next to it.
            const label = reports.find((report) => report.id === file.reportId)?.label;
            const name = `Laporan${label === undefined ? '' : `-${label}`}.${file.format}`;
            return (
              <li key={file.id} className="border-border not-first:border-t">
                <div className="-mx-2 flex flex-wrap items-center gap-x-3 gap-y-1 px-2 py-2 text-[12.5px]">
                  <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-fg">{name}</span>
                  <span className="text-subtle">{fileMeta(file, locale, timeZone)}</span>
                  <a
                    href={`/api/reports/${file.id}`}
                    download
                    aria-label={m.report_files_download({ name })}
                    className="-mx-1 rounded-[6px] px-1 py-0.5 text-muted-fg hover:bg-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    <Download aria-hidden="true" className="size-3.5" />
                  </a>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
