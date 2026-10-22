// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Pertumbuhan portofolio" (FR-I3, design 09 `bgmSP`, hover `XZruO`): month-end value as a bar of the cost basis
 * ("Modal") and the gain ("Keuntungan") over 1B / 3B / YTD / 1T / Semua, the current month live, with the YTD return
 * of the portfolio (Modified Dietz) next to SPY and IHSG. Drawn in SVG with attributes only; the hover / focus card
 * is placed through the CSSOM. In USD mode the values are converted at today's rate.
 */
import type { BenchmarkView } from '@wf/db/market-data';
import type { BenchmarkKey } from '@wf/domain/market';
import type { YearMonth } from '@wf/domain/period';
import {
  GROWTH_RANGES,
  growthSeries,
  periodReturnBps,
  type GrowthPoint,
  type GrowthRange,
  type PortfolioSnapshot,
} from '@wf/domain/valuation';
import { formatNumber } from '@wf/i18n/format';
import type { Locale } from '@wf/i18n/locale';
import { m } from '@wf/i18n/messages';
import { Money } from '@wf/ui/money';
import { Percent } from '@wf/ui/percent';
import { usePrivacy } from '@wf/ui/privacy';
import { useState } from 'react';
import { useElementWidth } from '../../lib/use-element-width.ts';
import { monthName, periodLabel } from '../dashboard/dashboard-format.ts';
import { pointsInRange } from './investments-model.ts';

const TOP = 22;
const PLOT = 180;
const BOTTOM = 26;

const RANGE_LABELS: Readonly<Record<GrowthRange, () => string>> = {
  '1m': m.invest_growth_1m,
  '3m': m.invest_growth_3m,
  ytd: m.invest_growth_ytd,
  '1y': m.invest_growth_1y,
  all: m.invest_growth_all,
};

const BENCHMARK_LABELS: Readonly<Record<BenchmarkKey, string>> = { spy: 'SPY', ihsg: 'IHSG' };

export interface GrowthCardProps {
  /** Month-end points, oldest first, the last one live ({@link growthPoints}). */
  readonly points: readonly PortfolioSnapshot[];
  readonly benchmarks: readonly BenchmarkView[];
  readonly currency: string;
  /** Converts a base-currency amount for display (identity, or to USD). */
  readonly convert: (minor: bigint) => bigint;
  readonly locale: Locale;
}

export function GrowthCard({ points, benchmarks, currency, convert, locale }: GrowthCardProps) {
  const { hidden } = usePrivacy();
  const [measure, width] = useElementWidth();
  const [range, setRange] = useState<GrowthRange>('1y');
  const [active, setActive] = useState<number | null>(null);
  const shown = growthSeries(
    pointsInRange(points, range).map((point) => ({
      ...point,
      valueMinor: convert(point.valueMinor),
      costMinor: convert(point.costMinor),
      contributionsMinor: convert(point.contributionsMinor),
    })),
  );
  const ytd = periodReturnBps(pointsInRange(points, 'ytd'));
  const max = shown.reduce(
    (top, point) => [point.valueMinor, point.costMinor, top].reduce((a, b) => (b > a ? b : a)),
    1n,
  );
  const y = (minor: bigint) => TOP + PLOT - (Number(minor < 0n ? 0n : minor) / Number(max)) * PLOT;
  const slot = width === null || shown.length === 0 ? 0 : width / shown.length;
  const bar = Math.min(Math.max(slot * 0.62, 8), 64);
  const millions = (minor: bigint) =>
    formatNumber(Number(minor) / 1_000_000, locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  // Geometry and text of each column, computed before rendering (amounts reach the DOM only as these numbers).
  const bars = shown.map((point, index) => {
    const loss = point.valueMinor < point.costMinor;
    return {
      month: point.month,
      x: slot * index + slot / 2,
      lowY: y(loss ? point.valueMinor : point.costMinor),
      topY: y(loss ? point.costMinor : point.valueMinor),
      loss,
      current: index === shown.length - 1,
      text: millions(point.valueMinor),
      label: `${periodLabel(point.month, locale)}: ${m.invest_growth_legend_value()} ${hidden ? '•••' : millions(point.valueMinor)}`,
    };
  });

  return (
    <section
      aria-labelledby="invest-growth"
      className="flex min-w-0 flex-col gap-4 rounded-[12px] border border-border bg-card px-6 py-5"
    >
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h2 id="invest-growth" className="text-[15px] font-semibold text-fg">
            {m.invest_growth_title()}
          </h2>
          <p className="text-[12.5px] text-muted-fg">{m.invest_growth_subtitle()}</p>
        </div>
        <div
          role="group"
          aria-label={m.invest_growth_range()}
          className="flex items-center gap-0.5 rounded-[8px] border border-border p-0.5"
        >
          {GROWTH_RANGES.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={range === option}
              onClick={() => {
                setRange(option);
                setActive(null);
              }}
              className="h-7 rounded-[6px] px-2.5 font-mono text-[11.5px] text-muted-fg hover:text-fg aria-pressed:bg-muted aria-pressed:text-fg focus-visible:outline-2 focus-visible:outline-ring"
            >
              {RANGE_LABELS[option]()}
            </button>
          ))}
        </div>
      </div>
      <div ref={measure} className="relative">
        {width === null ? (
          <div aria-hidden="true" className="h-[228px]" />
        ) : (
          <svg width={width} height={TOP + PLOT + BOTTOM} role="group" aria-label={m.invest_growth_chart()}>
            {bars.map((column, index) => (
              <g
                key={column.month}
                tabIndex={0}
                role="img"
                aria-label={column.label}
                onMouseEnter={() => {
                  setActive(index);
                }}
                onMouseLeave={() => {
                  setActive(null);
                }}
                onFocus={() => {
                  setActive(index);
                }}
                onBlur={() => {
                  setActive(null);
                }}
                className="outline-none focus-visible:[&>rect:first-child]:stroke-ring"
              >
                <rect
                  x={column.x - slot / 2 + 2}
                  y={0}
                  width={Math.max(slot - 4, 0)}
                  height={TOP + PLOT}
                  rx={6}
                  className={active === index ? 'fill-tint-04' : 'fill-transparent'}
                  strokeWidth={2}
                />
                <rect
                  x={column.x - bar / 2}
                  y={column.lowY}
                  width={bar}
                  height={TOP + PLOT - column.lowY}
                  rx={2}
                  className={column.current ? 'fill-neutral-strong' : 'fill-neutral-mid'}
                />
                <rect
                  x={column.x - bar / 2}
                  y={column.topY}
                  width={bar}
                  height={column.lowY - column.topY}
                  rx={2}
                  className={column.loss ? 'fill-red' : column.current ? 'fill-green' : 'fill-heat-green'}
                />
                {hidden ? null : (
                  <text
                    x={column.x}
                    y={column.topY - 6}
                    textAnchor="middle"
                    className={`font-mono text-[10.5px] ${column.current ? 'fill-fg' : 'fill-subtle'}`}
                  >
                    {column.text}
                  </text>
                )}
                <text
                  x={column.x}
                  y={TOP + PLOT + 18}
                  textAnchor="middle"
                  className={`text-[11.5px] ${column.current ? 'fill-fg font-medium' : 'fill-subtle'}`}
                >
                  {monthName(column.month, locale)}
                </text>
              </g>
            ))}
          </svg>
        )}
        {active === null || width === null ? null : (
          <GrowthTooltip
            point={shown[active] as GrowthPoint}
            previous={active > 0 ? (shown[active - 1] as GrowthPoint).month : null}
            x={slot * active + slot}
            width={width}
            currency={currency}
            locale={locale}
          />
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border pt-3 text-[11.5px] text-muted-fg">
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="size-2 rounded-[2px] bg-neutral-strong" />
          {m.invest_growth_legend_cost()}
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="size-2 rounded-[2px] bg-green" />
          {m.invest_growth_legend_gain()}
        </span>
        <span className="flex-1" />
        <span>{m.invest_growth_return_ytd()}</span>
        <ul className="flex flex-wrap items-center gap-1.5">
          <ReturnChip label={m.invest_growth_portfolio()} bps={ytd} locale={locale} />
          {benchmarks.map((benchmark) => (
            <ReturnChip
              key={benchmark.key}
              label={BENCHMARK_LABELS[benchmark.key]}
              bps={benchmark.ytdBps}
              locale={locale}
            />
          ))}
        </ul>
      </div>
    </section>
  );
}

function ReturnChip({
  label,
  bps,
  locale,
}: {
  readonly label: string;
  readonly bps: number | null;
  readonly locale: Locale;
}) {
  return (
    <li className="flex items-center gap-1 rounded-[6px] border border-border px-1.5 py-0.5 font-mono text-[11px] text-muted-fg">
      {label}
      {bps === null ? (
        <span className="text-subtle">—</span>
      ) : (
        <Percent value={bps / 10_000} signed locale={locale} className={bps < 0 ? 'text-red-fg' : 'text-green-fg'} />
      )}
    </li>
  );
}

interface GrowthTooltipProps {
  readonly point: GrowthPoint;
  readonly previous: YearMonth | null;
  /** Right edge of the column, in the chart's coordinates. */
  readonly x: number;
  readonly width: number;
  readonly currency: string;
  readonly locale: Locale;
}

/** Design `XZruO`: "Akhir September 2026 · Rp57.700.000 · Modal disetor … · vs Agustus +Rp4.200.000 (+7,9%)". */
function GrowthTooltip({ point, previous, x, width, currency, locale }: GrowthTooltipProps) {
  const place = (element: HTMLDivElement | null) => {
    if (element === null) return;
    element.style.left = `${String(x + 230 <= width ? x : Math.max(x - 230 - 40, 0))}px`;
    element.style.top = '0px';
  };
  return (
    <div
      ref={place}
      role="tooltip"
      className="pointer-events-none absolute z-10 flex w-[230px] flex-col gap-2 rounded-[10px] border border-border-strong bg-popover p-3 text-[12px] shadow-lg"
    >
      <span className="text-[11px] text-subtle">
        {m.invest_growth_tip_end({ month: periodLabel(point.month, locale) })}
      </span>
      <Money
        minor={point.valueMinor}
        currency={currency}
        context="amount"
        locale={locale}
        className="text-[15px] font-medium text-fg"
      />
      <dl className="flex flex-col gap-1">
        <div className="flex justify-between gap-2">
          <dt className="text-muted-fg">{m.invest_growth_tip_cost()}</dt>
          <dd className="text-fg">
            <Money minor={point.costMinor} currency={currency} context="amount" locale={locale} />
          </dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-muted-fg">{m.invest_growth_legend_gain()}</dt>
          <dd className="flex items-center gap-1">
            <Money minor={point.gainMinor} currency={currency} context="delta" locale={locale} />
            {point.gainBps === null ? null : (
              <Percent value={point.gainBps / 10_000} signed locale={locale} className="text-subtle" />
            )}
          </dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-muted-fg">{m.invest_growth_tip_contributions()}</dt>
          <dd>
            <Money minor={point.contributionsMinor} currency={currency} context="delta" locale={locale} />
          </dd>
        </div>
      </dl>
      {previous === null || point.changeMinor === null ? null : (
        <p className="flex flex-wrap items-center gap-1 border-t border-border pt-2 text-[11px] text-subtle">
          {m.invest_growth_tip_vs({ month: monthName(previous, locale, 'long') })}{' '}
          <Money minor={point.changeMinor} currency={currency} context="delta" locale={locale} />
          {point.changeBps === null ? null : (
            <>
              (<Percent value={point.changeBps / 10_000} signed locale={locale} />)
            </>
          )}
        </p>
      )}
    </div>
  );
}
