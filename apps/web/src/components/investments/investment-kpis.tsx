// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The "Investasi" KPI strip (FR-I3, design 09 `bgmSP` / USD mode `JBGq7`): "Nilai portofolio" with the other
 * currency below, "Modal", "Untung belum terealisasi", "Hari ini", and "Dividen 12 bulan" with the yield. In USD mode
 * every total is converted at today's rate.
 */
import type { PortfolioView } from '@wf/db/investments';
import type { Locale } from '@wf/i18n/locale';
import { m } from '@wf/i18n/messages';
import { Percent } from '@wf/ui/percent';
import { TrendingDown, TrendingUp } from 'lucide-react';
import type { ReactNode } from 'react';
import { DisplayMoney } from './display-money.tsx';
import type { DisplayCurrency } from './investments-model.ts';

const VALUE = 'text-[22px] leading-tight font-medium tracking-[-0.4px]';

export interface InvestmentKpisProps {
  readonly portfolio: PortfolioView;
  readonly display: DisplayCurrency;
  /** 1 USD in the base currency; `null` when unknown (USD figures are then left out). */
  readonly usdRate: string | null;
  readonly locale: Locale;
}

/** At 768 px the five KPIs fill a 6-column grid as 2/2/2 over 3/3, so no cell is left empty. */
function Kpi({
  label,
  wide = false,
  children,
}: {
  readonly label: string;
  readonly wide?: boolean;
  readonly children: ReactNode;
}) {
  return (
    <div
      className={`flex min-w-0 flex-col gap-1.5 bg-card px-5 py-4 xl:col-span-1 ${wide ? 'md:col-span-3' : 'md:col-span-2'}`}
    >
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
  const shown = { base: baseCurrency, usdRate: display === 'usd' ? usdRate : null, locale };
  // Cash has a previous close of 1: "Hari ini" counts only priced holdings with a previous close.
  const hasToday = summary.positions.some(
    (position) => !position.key.startsWith('cash:') && position.todayBaseMinor !== null,
  );
  return (
    <section
      aria-label={m.invest_kpis_label()}
      // The 1px gaps over the border color are the dividers, in every layout and never on the outer edge. Five in a
      // row only from 1280 px: at 1024 a 22 px amount would touch the dividers, so tablets keep three over two.
      className="grid grid-cols-1 gap-px overflow-hidden rounded-[12px] border border-border bg-border md:grid-cols-6 xl:grid-cols-5"
    >
      <Kpi label={m.invest_kpi_value()}>
        <DisplayMoney baseMinor={summary.valueBaseMinor} display={shown} className={`${VALUE} text-fg`} />
        {usdRate === null ? null : (
          <span className="text-[12px] text-subtle">
            {m.invest_approx()}{' '}
            <DisplayMoney
              baseMinor={summary.valueBaseMinor}
              display={{ base: baseCurrency, usdRate: display === 'usd' ? null : usdRate, locale }}
            />
          </span>
        )}
      </Kpi>
      <Kpi label={m.invest_kpi_cost()}>
        <DisplayMoney baseMinor={summary.costBaseMinor} display={shown} className={`${VALUE} text-fg`} />
        <span className="text-[12px] text-subtle">{m.invest_kpi_cost_sub()}</span>
      </Kpi>
      <Kpi label={m.invest_kpi_gain()}>
        <DisplayMoney baseMinor={summary.gainBaseMinor} display={shown} context="signed" className={VALUE} />
        {summary.gainBps === null ? null : <ChangeChip bps={summary.gainBps} locale={locale} />}
      </Kpi>
      <Kpi label={m.invest_kpi_today()} wide>
        {hasToday ? (
          <>
            <DisplayMoney baseMinor={summary.todayBaseMinor} display={shown} context="signed" className={VALUE} />
            {summary.todayBps === null ? null : <ChangeChip bps={summary.todayBps} locale={locale} />}
          </>
        ) : (
          <>
            <span className={`${VALUE} font-mono text-subtle`}>—</span>
            <span className="text-[12px] text-subtle">{m.invest_kpi_today_none()}</span>
          </>
        )}
      </Kpi>
      <Kpi label={m.invest_kpi_dividends()} wide>
        <DisplayMoney baseMinor={summary.dividends12mBaseMinor} display={shown} className={`${VALUE} text-fg`} />
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
