// SPDX-License-Identifier: AGPL-3.0-only
/** The calendar's KPI strip (design `zEWoe`, `qYzQD`, `Ncucu`): a labelled band of figures, each with a note. */
import { m } from '@wf/i18n/messages';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

export function KpiStrip({ columns, children }: { readonly columns: 4 | 5; readonly children: ReactNode }) {
  return (
    <section
      aria-label={m.calendar_kpis_label()}
      className={`grid grid-cols-2 overflow-hidden rounded-[12px] border border-border bg-card ${columns === 4 ? 'lg:grid-cols-4' : 'lg:grid-cols-5'}`}
    >
      {children}
    </section>
  );
}

const TONE = { red: 'text-red-fg', green: 'text-green-fg', none: 'text-fg' } as const;

export interface KpiProps {
  readonly label: string;
  readonly value: ReactNode;
  readonly icon?: LucideIcon;
  readonly tone?: keyof typeof TONE;
  readonly note?: ReactNode;
}

export function Kpi({ label, value, icon: Icon, tone = 'none', note }: KpiProps) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5 border-b border-border px-5 py-4 lg:border-r lg:border-b-0 lg:last:border-r-0">
      <span className="flex items-center gap-1.5 text-[12.5px] text-muted-fg">
        {Icon === undefined ? null : <Icon aria-hidden="true" className="size-3.5" />}
        {label}
      </span>
      <span className={`font-mono text-[20px] leading-tight font-medium ${TONE[tone]}`}>{value}</span>
      <span className="text-[12px] text-subtle">{note}</span>
    </div>
  );
}
