// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The "Investasi" KPI strip (FR-I3, design 09 `bgmSP` / USD mode `JBGq7`): "Nilai portofolio" with the other
 * currency below, "Modal", "Untung belum terealisasi", "Hari ini", and "Dividen 12 bulan" with the yield. In USD mode
 * every total is converted at today's rate.
 */
import type { PortfolioView } from '@wf/db/investments';
import type { Locale } from '@wf/i18n/locale';
import { m } from '@wf/i18n/messages';
import { Money } from '@wf/ui/money';
import { Percent } from '@wf/ui/percent';
import { TrendingDown, TrendingUp } from 'lucide-react';
import type { ReactNode } from 'react';
import { toUsd, type DisplayCurrency } from './investments-model.ts';

const VALUE = 'text-[22px] leading-tight font-medium tracking-[-0.4px]';

export interface InvestmentKpisProps {
  readonly portfolio: PortfolioView;
  readonly display: DisplayCurrency;
  /** 1 USD in the base currency; `null` when unknown (USD figures are then left out). */
  readonly usdRate: string | null;
  readonly locale: Locale;
}

function Kpi({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5 border-b border-border px-5 py-4 lg:border-r lg:border-b-0 lg:last:border-r-0">
      <span className="text-[12.5px] text-muted-fg">{label}</span>
      {children}
    </div>
  );
}

/** "+13,9%" in a green (or red) chip with a trend arrow. */
export function ChangeChip({ bps, locale }: { readonly bps: number; readonly locale: Locale }) {
  const Icon = bps < 0 ? TrendingDown : TrendingUp;
  return (
    <span
      className={`inline-flex w-fit items-center gap-1 rounded-[5px] px-1.5 py-0.5 text-[11px] ${bps < 0 ? 'bg-red-tint-2 text-red-fg' : 'bg-green-tint-2 text-green-fg'}`}
    >
      <Icon aria-hidden="true" className="size-3" />
      <Percent value={bps / 10_000} signed locale={locale} />
    </span>
  );
}

export function InvestmentKpis({ portfolio, display, usdRate, locale }: InvestmentKpisProps) {
  const { summary, baseCurrency } = portfolio;
  const usd = display === 'usd' && usdRate !== null;
  const currency = usd ? 'USD' : baseCurrency;
  const shown = (minor: bigint) => (usd ? toUsd(minor, baseCurrency, usdRate) : minor);
  const money = (minor: bigint, className: string, context: 'amount' | 'delta' = 'amount') => (
    <Money minor={shown(minor)} currency={currency} context={context} locale={locale} className={className} />
  );
  // Cash has a previous close of 1: "Hari ini" counts only priced holdings with a previous close.
  const hasToday = summary.positions.some((position) => !position.key.startsWith('cash:') && position.todayBaseMinor !== null);
  return (
    <section
      aria-label={m.invest_kpis_label()}
      className="grid grid-cols-1 overflow-hidden rounded-[12px] border border-border bg-card md:grid-cols-3 lg:grid-cols-5"
    >
      <Kpi label={m.invest_kpi_value()}>
        {money(summary.valueBaseMinor, `${VALUE} text-fg`)}
        {usdRate === null ? null : (
          <span className="text-[12px] text-subtle">
            ≈{' '}
            {usd ? (
              <Money minor={summary.valueBaseMinor} currency={baseCurrency} context="amount" locale={locale} />
            ) : (
              <Money
                minor={toUsd(summary.valueBaseMinor, baseCurrency, usdRate)}
                currency="USD"
                context="amount"
                locale={locale}
              />
            )}
          </span>
        )}
      </Kpi>
      <Kpi label={m.invest_kpi_cost()}>
        {money(summary.costBaseMinor, `${VALUE} text-fg`)}
        <span className="text-[12px] text-subtle">{m.invest_kpi_cost_sub()}</span>
      </Kpi>
      <Kpi label={m.invest_kpi_gain()}>
        {money(summary.gainBaseMinor, VALUE, 'delta')}
        {summary.gainBps === null ? null : <ChangeChip bps={summary.gainBps} locale={locale} />}
      </Kpi>
      <Kpi label={m.invest_kpi_today()}>
        {hasToday ? (
          <>
            {money(summary.todayBaseMinor, VALUE, 'delta')}
            {summary.todayBps === null ? null : <ChangeChip bps={summary.todayBps} locale={locale} />}
          </>
        ) : (
          <>
            <span className={`${VALUE} font-mono text-subtle`}>—</span>
            <span className="text-[12px] text-subtle">{m.invest_kpi_today_none()}</span>
          </>
        )}
      </Kpi>
      <Kpi label={m.invest_kpi_dividends()}>
        {money(summary.dividends12mBaseMinor, `${VALUE} text-fg`)}
        <span className="text-[12px] text-subtle">
          {m.invest_kpi_dividends_sub()}
          {summary.yieldBps === null ? null : (
            <>
              {' · '}
              {m.invest_kpi_yield()} <Percent value={summary.yieldBps / 10_000} locale={locale} />
            </>
          )}
        </span>
      </Kpi>
    </section>
  );
}
