// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The words around a report (design §A.2): the Final/Sementara badge, the immutability banner of a final report
 * (design `IvIWD`), the failure state with "Coba lagi", and the new user's timeline up to the first report
 * (design `gyfhQ`).
 */
import { Link, useNavigate } from '@tanstack/react-router';
import type { ReportStatus } from '@wf/domain/report';
import type { LocalDate } from '@wf/domain/period';
import type { Locale } from '@wf/i18n/locale';
import { m } from '@wf/i18n/messages';
import { formatDate } from '@wf/ui/dates';
import { PageState } from '@wf/ui/page-state';
import { Lock } from 'lucide-react';
import { Button } from '../form.tsx';
import { openSettings } from '../settings/settings-sections.ts';
import { emptySteps } from './reports-model.ts';

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

/** The empty state (design `gyfhQ`): the timeline to the first report, then "Catat transaksi" / "Atur tanggal mulai". */
export function ReportsEmpty({ today, locale }: { readonly today: LocalDate; readonly locale: Locale }) {
  const navigate = useNavigate();
  const steps = emptySteps(today, locale);
  return (
    <section className="flex flex-col gap-6 rounded-[12px] border border-border bg-card px-6 py-10">
      <p className="text-center text-[15px] font-semibold text-fg">{m.reports_empty_title()}</p>
      <ol className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-[12.5px]">
        {steps.map((step, index) => (
          <li key={step.key} className="flex items-center gap-2">
            {index > 0 ? (
              <span aria-hidden="true" className="text-subtle">
                →
              </span>
            ) : null}
            <span className="font-mono tabular-nums text-muted-fg">{formatDate(step.at, locale, 'day')}</span>
            <span className="text-fg">
              {step.key === 'recorded'
                ? m.reports_empty_step_recorded()
                : step.key === 'closed'
                  ? m.reports_empty_step_closed()
                  : m.reports_empty_step_published({ label: step.label as string })}
            </span>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap justify-center gap-2">
        <Link
          to="/transactions"
          className="inline-flex h-7 items-center rounded-[7px] border border-border px-2 text-[12.5px] text-fg hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
        >
          {m.reports_empty_cta_record()}
        </Link>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            void navigate(openSettings('period'));
          }}
        >
          {m.reports_empty_cta_start()}
        </Button>
      </div>
    </section>
  );
}
