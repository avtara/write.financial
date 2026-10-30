// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The report's KPI strip (design `ogfhy`): Pemasukan, Pengeluaran, Ditabung, Saving Rate, and Kekayaan bersih per
 * the range end, each with its like-for-like change — income, expenses, and savings relative ("+3,6%"), the savings
 * rate in points ("−3,0 poin"). Without a comparison (a first report) only the amounts show; an unavailable net
 * worth reads "—", never an invented zero.
 */
import type { ReportView } from '@wf/db/reports';
import type { LocalDate } from '@wf/domain/period';
import type { Locale } from '@wf/i18n/locale';
import { m } from '@wf/i18n/messages';
import { formatDate } from '@wf/ui/dates';
import { Money } from '@wf/ui/money';
import { Percent } from '@wf/ui/percent';
import { TrendingDown, TrendingUp } from 'lucide-react';
import type { ReactNode } from 'react';
import { REPORTS_CURRENCY, comparisonLabel, formatPoints } from './reports-model.ts';

const VALUE = 'text-[22px] leading-tight font-medium tracking-[-0.4px]';

export interface ReportsKpisProps {
  readonly view: ReportView;
  readonly locale: Locale;
  readonly today: LocalDate;
}

/** A change chip: green when it is good news (more income or savings, less spending), red otherwise. */
function DeltaChip({ bps, good, locale }: { readonly bps: number; readonly good: boolean; readonly locale: Locale }) {
  const Icon = bps < 0 ? TrendingDown : TrendingUp;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-[4px] px-1.5 py-px font-mono text-[11px] ${bps === 0 ? 'bg-tint-06 text-muted-fg' : good ? 'bg-green-tint-2 text-green-fg' : 'bg-red-tint-2 text-red-fg'}`}
    >
      <Icon aria-hidden="true" className="size-3" />
      <Percent value={bps / 10_000} signed locale={locale} />
    </span>
  );
}

function Tile({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div
      role="group"
      aria-label={label}
      className="flex min-w-0 flex-col gap-1.5 border-border p-5 not-last:border-r max-lg:nth-2:border-r-0 max-lg:nth-[-n+2]:border-b"
    >
      <span className="text-[12.5px] text-muted-fg">{label}</span>
      {children}
    </div>
  );
}

/** The chip line under an amount: the change against the compared period, then "vs Agustus 2026". */
function ChangeLine({
  bps,
  good,
  vs,
  locale,
}: {
  readonly bps: number | null;
  readonly good: boolean;
  readonly vs: string | null;
  readonly locale: Locale;
}) {
  return (
    <span className="flex min-h-5 flex-wrap items-center gap-1.5 text-[11.5px] text-subtle">
      {bps === null ? null : <DeltaChip bps={bps} good={good} locale={locale} />}
      {vs}
    </span>
  );
}

export function ReportsKpis({ view, locale, today }: ReportsKpisProps) {
  const { totals, delta, sections } = view;
  const vs = comparisonLabel(view.compare, locale, today);
  const vsText = vs === null ? null : m.overview_vs({ what: vs });
  const netWorth = sections.netWorth;
  return (
    <section
      aria-label={m.overview_kpis_label()}
      className="grid grid-cols-2 overflow-hidden rounded-[12px] border border-border bg-card lg:grid-cols-5"
    >
      <Tile label={m.overview_kpi_income()}>
        <Money
          minor={totals.incomeMinor}
          currency={REPORTS_CURRENCY}
          context="amount"
          locale={locale}
          className={`${VALUE} text-fg`}
        />
        <ChangeLine bps={delta?.incomeBps ?? null} good locale={locale} vs={vsText} />
      </Tile>
      <Tile label={m.overview_kpi_expense()}>
        <Money
          minor={totals.expenseMinor}
          currency={REPORTS_CURRENCY}
          context="amount"
          locale={locale}
          className={`${VALUE} text-fg`}
        />
        <ChangeLine bps={delta?.expenseBps ?? null} good={false} locale={locale} vs={vsText} />
      </Tile>
      <Tile label={m.overview_kpi_leftover()}>
        <Money
          minor={totals.savedMinor}
          currency={REPORTS_CURRENCY}
          context="delta"
          locale={locale}
          className={`${VALUE} text-fg`}
        />
        <ChangeLine bps={delta?.savedBps ?? null} good locale={locale} vs={vsText} />
      </Tile>
      <Tile label={m.overview_kpi_saving_rate()}>
        <span className={`${VALUE} font-mono text-fg tabular-nums`}>
          {totals.savingRateBps === null ? '—' : <Percent value={totals.savingRateBps / 10_000} locale={locale} />}
        </span>
        <span className="flex min-h-5 items-center">
          {delta === null || delta.savingRatePoints === null ? null : (
            <span className="rounded-[4px] bg-blue-tint-2 px-1.5 py-px font-mono text-[11px] text-blue-fg">
              {m.reports_rate_points({ value: formatPoints(delta.savingRatePoints / 100, locale) })}
            </span>
          )}
        </span>
      </Tile>
      <Tile label={m.reports_networth_title()}>
        {totals.netWorthMinor === null ? (
          <span className={`${VALUE} font-mono text-subtle`}>—</span>
        ) : (
          <Money
            minor={totals.netWorthMinor}
            currency={REPORTS_CURRENCY}
            context="amount"
            locale={locale}
            className={`${VALUE} text-fg`}
          />
        )}
        <span className="min-h-5 text-[11.5px] text-subtle">
          {netWorth === null ? null : m.reports_networth_asof({ date: formatDate(netWorth.asOf, locale, 'date') })}
        </span>
      </Tile>
    </section>
  );
}
