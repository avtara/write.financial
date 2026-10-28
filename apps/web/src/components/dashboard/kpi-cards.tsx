// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The four KPIs (FR-D2, design `iUqiN`): Pemasukan, Pengeluaran, Ditabung & Investasi, and the saving rate against
 * the 30% target, each with its like-for-like change (FR-D1: "+4,1% vs Sep"). Without data (design `olRpH`) they read
 * "Rp0 · belum ada data" and "—".
 */
import type { Kpis } from '@wf/db/dashboard';
import { formatPercent } from '@wf/i18n/format';
import type { Locale } from '@wf/i18n/locale';
import { m } from '@wf/i18n/messages';
import { Money } from '@wf/ui/money';
import { TrendingDown, TrendingUp } from 'lucide-react';

export interface KpiCardsProps {
  /** `null`: no data yet. */
  readonly kpis: {
    readonly current: Kpis;
    readonly change: {
      readonly incomeBps: number | null;
      readonly expenseBps: number | null;
      readonly savedBps: number | null;
    };
    readonly savingRateTargetBps: number;
  } | null;
  /** "vs Sep". */
  readonly comparison: string;
  readonly currency: string;
  readonly locale: Locale;
}

type Kind = 'income' | 'expense' | 'saved';

const DOT: Readonly<Record<Kind | 'rate', string>> = {
  income: 'bg-fg',
  expense: 'bg-red',
  saved: 'bg-green',
  rate: 'bg-blue',
};

/** A change badge: green when it is good news (more income or savings, less spending), red otherwise. */
function Change({ bps, kind, locale }: { bps: number; kind: Kind; locale: Locale }) {
  const good = kind === 'expense' ? bps < 0 : bps > 0;
  const Icon = bps < 0 ? TrendingDown : TrendingUp;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-[4px] px-1.5 py-px font-mono text-[11px] ${bps === 0 ? 'bg-tint-06 text-muted-fg' : good ? 'bg-green-tint-2 text-green-fg' : 'bg-red-tint-2 text-red-fg'}`}
    >
      <Icon aria-hidden="true" className="size-3" />
      {formatPercent(bps / 10_000, locale, { signed: true, maximumFractionDigits: Math.abs(bps) < 1000 ? 1 : 0 })}
    </span>
  );
}

export function KpiCards({ kpis, comparison, currency, locale }: KpiCardsProps) {
  const cards: { kind: Kind; label: string; valueMinor: bigint; bps: number | null }[] = [
    {
      kind: 'income',
      label: m.overview_kpi_income(),
      valueMinor: kpis?.current.incomeMinor ?? 0n,
      bps: kpis?.change.incomeBps ?? null,
    },
    {
      kind: 'expense',
      label: m.overview_kpi_expense(),
      valueMinor: kpis?.current.expenseMinor ?? 0n,
      bps: kpis?.change.expenseBps ?? null,
    },
    {
      kind: 'saved',
      label: m.overview_kpi_saved(),
      valueMinor: kpis?.current.savedMinor ?? 0n,
      bps: kpis?.change.savedBps ?? null,
    },
  ];
  const rateBps = kpis?.current.savingRateBps ?? null;
  return (
    <section
      aria-label={m.overview_kpis_label()}
      className="grid grid-cols-2 overflow-hidden rounded-[12px] border border-border bg-card lg:grid-cols-4"
    >
      {cards.map(({ kind, label, valueMinor, bps }) => (
        <div
          key={kind}
          role="group"
          aria-label={label}
          className="flex min-w-0 flex-col gap-2 border-border p-5 not-last:border-r max-lg:nth-2:border-r-0 max-lg:nth-[-n+2]:border-b"
        >
          <span className="flex items-center gap-2 text-[12.5px] text-muted-fg">
            <span aria-hidden="true" className={`size-1.5 rounded-full ${DOT[kind]}`} />
            {label}
          </span>
          <Money
            minor={valueMinor}
            currency={currency}
            context="amount"
            locale={locale}
            className="truncate text-[24px] leading-tight font-medium text-fg"
          />
          <span className="flex min-h-5 items-center gap-1.5 text-[11.5px] text-subtle">
            {kpis === null ? (
              m.overview_kpi_no_data()
            ) : // Nothing to compare with (no data in the previous period): no badge and no lone "vs 2025".
            bps === null ? null : (
              <>
                <Change bps={bps} kind={kind} locale={locale} />
                {comparison}
              </>
            )}
          </span>
        </div>
      ))}
      <div role="group" aria-label={m.overview_kpi_saving_rate()} className="flex min-w-0 flex-col gap-2 p-5">
        <span className="flex items-center gap-2 text-[12.5px] text-muted-fg">
          <span aria-hidden="true" className={`size-1.5 rounded-full ${DOT.rate}`} />
          {m.overview_kpi_saving_rate()}
        </span>
        <span className="font-mono text-[24px] leading-tight font-medium text-fg tabular-nums">
          {rateBps === null ? '—' : formatPercent(rateBps / 10_000, locale, { maximumFractionDigits: 1 })}
        </span>
        {kpis === null ? null : (
          <span className="flex min-h-5 items-center">
            <span className="rounded-[4px] bg-blue-tint-2 px-1.5 py-px font-mono text-[11px] text-blue-fg">
              {m.overview_kpi_target({
                target: formatPercent(kpis.savingRateTargetBps / 10_000, locale, { maximumFractionDigits: 0 }),
              })}
            </span>
          </span>
        )}
      </div>
    </section>
  );
}
