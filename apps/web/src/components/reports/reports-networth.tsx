// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Kekayaan bersih" (design `ogfhy`/PDF page 1): the total with its cash and debt breakdown (investments are shown
 * only on their own page), the honest notes about what could not be valued, and the six month-end history as bars — a
 * missing month is a gap, never zero.
 */
import type { ReportView } from '@wf/db/reports';
import type { YearMonth } from '@wf/domain/period';
import type { Locale } from '@wf/i18n/locale';
import { m } from '@wf/i18n/messages';
import { formatDate } from '@wf/ui/dates';
import { Money } from '@wf/ui/money';
import { monthName } from '../dashboard/dashboard-format.ts';
import { useElementWidth } from '../../lib/use-element-width.ts';
import { RichMessage } from '../rich-message.tsx';
import { REPORTS_CURRENCY, netWorthPoints, type NetWorthPoint } from './reports-model.ts';

const TOP = 8;
const PLOT = 72;
const BOTTOM = 18;

export interface NetWorthSectionProps {
  readonly view: ReportView;
  readonly locale: Locale;
}

/** The month-end bars; a `null` month keeps its slot empty. */
function HistoryChart({ points, locale }: { readonly points: readonly NetWorthPoint[]; readonly locale: Locale }) {
  const [measure, width] = useElementWidth();
  const known = points.filter(
    (point): point is NetWorthPoint & { readonly valueMinor: bigint } => point.valueMinor !== null,
  );
  const max = known.reduce((top, point) => (point.valueMinor > top ? point.valueMinor : top), 1n);
  const y = (minor: bigint) => TOP + PLOT - (Number(minor) / Number(max)) * PLOT;
  const slot = width === null || points.length === 0 ? 0 : width / points.length;
  const bar = Math.min(Math.max(slot * 0.55, 3), 40);
  // Geometry computed before rendering (the chart is decorative; the labels carry the months).
  const bars = points.map((point, index) => ({
    date: point.date,
    x: slot * index + slot / 2,
    top: point.valueMinor === null ? TOP + PLOT : y(point.valueMinor),
    known: point.valueMinor !== null,
  }));
  return (
    <div ref={measure} className="relative">
      {width === null ? (
        <div aria-hidden="true" className="h-[98px]" />
      ) : (
        <svg width={width} height={TOP + PLOT + BOTTOM} aria-hidden="true">
          {bars.map((point) => (
            <g key={point.date}>
              {point.known ? (
                <rect
                  x={point.x - bar / 2}
                  y={point.top}
                  width={bar}
                  height={TOP + PLOT - point.top}
                  rx={2}
                  className="fill-neutral-mid"
                />
              ) : null}
              <text x={point.x} y={TOP + PLOT + 14} textAnchor="middle" className="text-[10px] fill-subtle">
                {monthName(point.date.slice(0, 7) as YearMonth, locale)}
              </text>
            </g>
          ))}
        </svg>
      )}
    </div>
  );
}

export function NetWorthSection({ view, locale }: NetWorthSectionProps) {
  const netWorth = view.sections.netWorth;
  const points = netWorthPoints(view);
  const hasHistory = points.some((point) => point.valueMinor !== null);
  return (
    <section
      aria-labelledby="reports-networth"
      className="flex flex-col gap-4 rounded-[12px] border border-border bg-card px-6 py-5"
    >
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h2 id="reports-networth" className="text-[15px] font-semibold text-fg">
          {m.reports_networth_title()}
        </h2>
        {view.totals.netWorthMinor === null ? (
          <span className="font-mono text-[22px] leading-tight font-medium text-subtle">—</span>
        ) : (
          <Money
            minor={view.totals.netWorthMinor}
            currency={REPORTS_CURRENCY}
            context="amount"
            locale={locale}
            className="text-[22px] leading-tight font-medium text-fg"
          />
        )}
        {netWorth === null ? null : (
          <span className="text-[12px] text-subtle">
            {m.reports_networth_asof({ date: formatDate(netWorth.asOf, locale, 'date') })}
          </span>
        )}
      </div>
      {netWorth === null ? (
        <p className="text-[12.5px] text-muted-fg">{m.reports_networth_missing()}</p>
      ) : (
        <>
          <dl className="flex flex-wrap gap-x-6 gap-y-2 text-[12.5px]">
            <div className="flex flex-col gap-0.5">
              <dt className="text-muted-fg">{m.reports_networth_cash()}</dt>
              <dd>
                <Money
                  minor={netWorth.cashMinor}
                  currency={REPORTS_CURRENCY}
                  context="amount"
                  locale={locale}
                  className="font-medium"
                />
              </dd>
            </div>
            {netWorth.debtMinor === 0n ? null : (
              <div className="flex flex-col gap-0.5">
                <dt className="text-muted-fg">{m.reports_networth_debt()}</dt>
                <dd>
                  <Money
                    minor={-netWorth.debtMinor}
                    currency={REPORTS_CURRENCY}
                    context="delta"
                    locale={locale}
                    className="font-medium"
                  />
                </dd>
              </div>
            )}
          </dl>
          {netWorth.missingPortfolio ? (
            <p className="text-[12.5px] text-amber-fg">{m.reports_networth_missing()}</p>
          ) : null}
          {netWorth.unvaluedCurrencies.length === 0 ? null : (
            <p className="text-[12.5px] text-amber-fg">
              <RichMessage
                message={m.reports_networth_unvalued}
                slots={{ currencies: netWorth.unvaluedCurrencies.join(', ') }}
              />
            </p>
          )}
        </>
      )}
      {hasHistory ? <HistoryChart points={points} locale={locale} /> : null}
    </section>
  );
}
