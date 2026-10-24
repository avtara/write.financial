// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Ekspor laporan" (FR-LP3, design yLlRY): the dialog over the report being viewed — format (PDF "siap dicetak",
 * Excel "sheet per bulan", CSV "semua aplikasi"), the sections checklist with their page numbers, light "hemat
 * tinta" or dark, A4 or Letter, and "Samarkan nomor rekening". The preview counts the printed pages (one per
 * chosen section, PDF only); submitting queues the worker job and the file appears in "Laporan tersimpan". The
 * auto-send toggle ("Kirim otomatis tiap tanggal 1 · PDF ke email terdaftar") is the same dialog's preference.
 */
import type { ReportView } from '@wf/db/reports';
import {
  REPORT_EXPORT_SECTIONS,
  type ReportExportOptions,
  type ReportExportSection,
  type ReportFormat,
} from '@wf/domain/report';
import type { Locale } from '@wf/i18n/locale';
import { m } from '@wf/i18n/messages';
import { Checkbox } from '@wf/ui/checkbox';
import { SegmentedControl } from '@wf/ui/segmented-control';
import { Switch } from '@wf/ui/switch';
import { toast } from '@wf/ui/toast';
import { Download } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ledgerErrorMessage } from '../../lib/ledger-errors.ts';
import { getReportAutoSend, requestReportExport, saveReportAutoSend } from '../../server/fn/report-export.ts';
import { Button, FormError } from '../form.tsx';
import { Modal } from '../modal.tsx';
import { StatusBadge } from './reports-states.tsx';

export interface ReportsExportDialogProps {
  /** The report being viewed; it is what gets exported (the dialog's "Periode"). */
  readonly view: ReportView;
  readonly locale: Locale;
  readonly onOpenChange: (open: boolean) => void;
  /** Called after the export was queued, so the page refetches "Laporan tersimpan". */
  readonly onExported: () => void;
}

/** "Ringkasan & kekayaan bersih" and friends, in the checklist (print) order. */
function sectionLabel(section: ReportExportSection): string {
  if (section === 'summary') return m.report_export_section_summary();
  if (section === 'flow') return m.report_export_section_flow();
  if (section === 'spending') return m.report_export_section_spending();
  return m.report_export_section_largest();
}

/** The 1-based printed page of `section` among the chosen ones (unchecked sections pull the rest forward). */
export function pageNumber(sections: readonly ReportExportSection[], section: ReportExportSection): number {
  return sections.indexOf(section) + 1;
}

const FORMAT_HINT: Readonly<Record<ReportFormat, () => string>> = {
  pdf: m.report_export_format_pdf_hint,
  xlsx: m.report_export_format_xlsx_hint,
  csv: m.report_export_format_csv_hint,
};

export function ReportsExportDialog({ view, locale, onOpenChange, onExported }: ReportsExportDialogProps) {
  const [format, setFormat] = useState<ReportFormat>('pdf');
  const [sections, setSections] = useState<readonly ReportExportSection[]>(REPORT_EXPORT_SECTIONS);
  const [theme, setTheme] = useState<ReportExportOptions['theme']>('light');
  const [paper, setPaper] = useState<ReportExportOptions['paper']>('a4');
  const [mask, setMask] = useState(false);
  const [autoSend, setAutoSend] = useState<boolean | null>(null);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  // The toggle's current state arrives while the dialog opens; until then it stays disabled.
  useEffect(() => {
    let live = true;
    void getReportAutoSend({ data: {} })
      .then((result) => {
        if (live && result.ok) setAutoSend(result.value);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  /** Keeps the chosen sections in print order, so page numbers never jump while ticking. */
  const toggle = (section: ReportExportSection, on: boolean): void => {
    setSections((current) =>
      on
        ? REPORT_EXPORT_SECTIONS.filter((s) => current.includes(s) || s === section)
        : current.filter((s) => s !== section),
    );
  };

  const submit = async (): Promise<void> => {
    setPending(true);
    setFailure(null);
    const result = await requestReportExport({
      data: {
        reportId: view.id,
        format,
        options: { sections: [...sections], theme, paper, maskAccountNumbers: mask },
      },
    });
    setPending(false);
    if (!result.ok) {
      setFailure(ledgerErrorMessage(result.code, locale));
      return;
    }
    toast({ title: m.report_export_queued() });
    onExported();
    onOpenChange(false);
  };

  return (
    <Modal open onOpenChange={onOpenChange} size="lg" title={m.report_export_title()}>
      <div className="flex flex-col gap-3">
        <section className="flex flex-col gap-1.5">
          <p className="text-[13px] font-medium text-fg">{m.report_export_format()}</p>
          <SegmentedControl
            label={m.report_export_format()}
            value={format}
            onValueChange={setFormat}
            options={[
              { value: 'pdf', label: m.report_export_format_pdf() },
              { value: 'xlsx', label: m.report_export_format_xlsx() },
              { value: 'csv', label: m.report_export_format_csv() },
            ]}
          />
          <p className="text-[11.5px] text-subtle">{FORMAT_HINT[format]()}</p>
        </section>

        <section className="flex flex-col gap-1.5">
          <p className="text-[13px] font-medium text-fg">{m.report_export_period()}</p>
          <p className="flex items-center gap-2 text-[12.5px] text-muted-fg">
            {view.label}
            <StatusBadge status={view.status} />
          </p>
        </section>

        <section className="flex flex-col gap-1.5">
          <p className="text-[13px] font-medium text-fg">{m.report_export_sections()}</p>
          {REPORT_EXPORT_SECTIONS.map((section) => (
            <Checkbox
              key={section}
              label={sectionLabel(section)}
              description={format === 'pdf' ? m.report_export_page({ page: pageNumber(sections, section) }) : undefined}
              checked={sections.includes(section)}
              onChange={(event) => {
                toggle(section, event.target.checked);
              }}
            />
          ))}
        </section>

        <section className="flex flex-col gap-1.5">
          <p className="text-[13px] font-medium text-fg">{m.report_export_appearance()}</p>
          <SegmentedControl
            label={m.report_export_appearance()}
            value={theme}
            onValueChange={setTheme}
            options={[
              { value: 'light', label: m.report_export_theme_light() },
              { value: 'dark', label: m.report_export_theme_dark() },
            ]}
          />
          {theme === 'light' ? <p className="text-[11.5px] text-subtle">{m.report_export_theme_light_hint()}</p> : null}
          <p className="mt-1 text-[13px] font-medium text-fg">{m.report_export_paper()}</p>
          <SegmentedControl
            label={m.report_export_paper()}
            value={paper}
            onValueChange={setPaper}
            options={[
              { value: 'a4', label: m.report_export_paper_a4() },
              { value: 'letter', label: m.report_export_paper_letter() },
            ]}
          />
        </section>

        <Switch
          label={m.report_export_mask()}
          description={m.report_export_mask_hint()}
          checked={mask}
          onChange={(event) => {
            setMask(event.target.checked);
          }}
        />

        <Switch
          label={m.report_export_auto_send()}
          description={m.report_export_auto_send_hint()}
          checked={autoSend === true}
          disabled={autoSend === null}
          onChange={(event) => {
            const enabled = event.target.checked;
            setAutoSend(enabled);
            void saveReportAutoSend({ data: { enabled } })
              .then((result) => {
                if (result.ok) setAutoSend(result.value);
              })
              .catch(() => undefined);
          }}
        />

        {format === 'pdf' ? (
          <p className="text-[12.5px] text-muted-fg">
            {m.report_export_pages({
              count: sections.length,
              paper: paper === 'a4' ? m.report_export_paper_a4() : m.report_export_paper_letter(),
            })}
          </p>
        ) : null}

        {failure === null ? null : <FormError>{failure}</FormError>}

        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              onOpenChange(false);
            }}
          >
            {m.report_export_cancel()}
          </Button>
          <Button size="sm" pending={pending} onClick={() => void submit()}>
            <Download aria-hidden="true" className="size-3.5" />
            {m.report_export_submit()}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
