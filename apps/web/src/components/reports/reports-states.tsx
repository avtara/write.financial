// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The words around a report (design §A.2): the Final/Sementara badge, the immutability banner of a final report
 * (design `IvIWD`), the failure state with "Coba lagi", and the new user's timeline up to the first report
 * (design `gyfhQ`).
 */
import { useNavigate } from '@tanstack/react-router';
import type { ReportStatus } from '@wf/domain/report';
import type { LocalDate } from '@wf/domain/period';
import type { Locale } from '@wf/i18n/locale';
import { m } from '@wf/i18n/messages';
import { formatDate, formatDateRange } from '@wf/ui/dates';
import { PageState } from '@wf/ui/page-state';
import { CalendarCog, FileChartColumn, Lock, Plus } from 'lucide-react';
import { Button } from '../form.tsx';
import { openSettings } from '../settings/settings-sections.ts';
import { emptyTimeline } from './reports-model.ts';

/** "Final" in green, "Sementara" in amber (D10: only closed months are final). */
export function StatusBadge({ status }: { readonly status: ReportStatus }) {
  return (
    <span
      className={`rounded-[4px] px-1.5 py-px text-[11px] font-medium ${status === 'final' ? 'bg-green-tint-2 text-green-fg' : 'bg-amber-tint-2 text-amber-fg'}`}
    >
      {status === 'final' ? m.reports_final_badge() : m.reports_provisional_badge()}
    </span>
  );
}

/** The info banner of a final report: closed months are never rewritten, even after a settings change. */
export function ImmutabilityBanner() {
  return (
    <p className="flex items-center gap-2 rounded-[10px] border border-blue-tint-4 bg-blue-tint-1 px-4 py-2.5 text-[12.5px] text-blue-fg">
      <Lock aria-hidden="true" className="size-3.5 shrink-0" />
      {m.reports_immutable()}
    </p>
  );
}

/** "Laporan {label} gagal disusun" with "Coba lagi" (design `fOodO`). */
export function ReportsError({ label, onRetry }: { readonly label: string; readonly onRetry: () => void }) {
  return (
    <section className="rounded-[12px] border border-border bg-card">
      <PageState
        kind="error"
        title={m.reports_error_title({ label })}
        action={
          <Button size="sm" variant="secondary" onClick={onRetry}>
            {m.reports_error_retry()}
          </Button>
        }
      />
    </section>
  );
}

/**
 * The empty state (design `gyfhQ`): the timeline to the first report (recording starts today, the first period
 * closes, its report is published), when that is and why, then "Catat transaksi" (`onRecord`: the page opens the
 * Record sheet, so these presentational states stay free of the ledger) / "Atur tanggal mulai".
 */
export function ReportsEmpty({
  today,
  locale,
  onRecord,
}: {
  readonly today: LocalDate;
  readonly locale: Locale;
  readonly onRecord: () => void;
}) {
  const navigate = useNavigate();
  const timeline = emptyTimeline(today, locale);
  const steps = [
    { at: today, label: m.reports_empty_step_recorded(), note: m.reports_empty_step_recorded_note() },
    {
      at: timeline.period.end,
      label: m.reports_empty_step_closed(),
      // The next period starts on the day the report is published.
      note: m.reports_empty_step_closed_note({ day: Number(timeline.publishedAt.slice(8)) }),
    },
    {
      at: timeline.publishedAt,
      label: m.reports_empty_step_published({ label: timeline.month }),
      note: m.reports_empty_step_published_note(),
    },
  ];
  return (
    <section className="flex flex-col items-center gap-3.5 rounded-[16px] border border-border bg-card px-6 py-10 text-center">
      <ol className="flex w-full max-w-[460px] pb-[22px] text-left">
        {steps.map((step, index) => (
          // Today can be the closing day, so the date alone is not a unique key.
          <li key={step.label} className="group flex min-w-0 flex-1 flex-col gap-1.5">
            <span aria-hidden="true" className="flex items-center">
              <span className="size-2.5 shrink-0 rounded-full border-[1.5px] border-border-strong bg-card group-first:border-blue group-first:bg-blue" />
              {index < steps.length - 1 ? <span className="h-px flex-1 bg-border" /> : null}
            </span>
            <span className="font-mono text-[12px] font-medium text-fg tabular-nums group-first:text-blue-fg">
              {formatDate(step.at, locale, 'day')}
            </span>
            <span className="pr-2 text-[12px] text-text-secondary">{step.label}</span>
            <span className="text-[11px] text-subtle">{step.note}</span>
          </li>
        ))}
      </ol>
      <span className="flex size-[52px] items-center justify-center rounded-[14px] border border-border bg-surface-2 text-muted-fg">
        <FileChartColumn aria-hidden="true" className="size-6" />
      </span>
      <h2 className="text-[20px] font-semibold text-fg">
        {m.reports_empty_title({
          day: Number(timeline.publishedAt.slice(8)),
          month: timeline.publishedMonth,
        })}
      </h2>
      <p className="max-w-[500px] text-[14px] leading-[22px] text-muted-fg">
        {m.reports_empty_body({
          month: timeline.month,
          range: formatDateRange(timeline.period, locale, today),
        })}
      </p>
      <div className="flex flex-wrap justify-center gap-2 pt-1.5">
        <Button size="sm" onClick={onRecord}>
          <Plus aria-hidden="true" className="size-3.5" />
          {m.reports_empty_cta_record()}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            void navigate(openSettings('period'));
          }}
        >
          <CalendarCog aria-hidden="true" className="size-3.5" />
          {m.reports_empty_cta_start()}
        </Button>
      </div>
    </section>
  );
}
