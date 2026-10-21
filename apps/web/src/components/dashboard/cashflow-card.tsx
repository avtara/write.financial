// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Pemasukan vs Pengeluaran" (FR-D2, design `iUqiN`, `tBbvD`, `g9BK2`, hover `SGcTm`): income and spending side by
 * side for the last six periods, the week's days, or the year's months, the current column highlighted, with the net
 * cashflow, the costliest column, and the spending trend (or the average) below. Drawn in SVG with attributes only
 * (no chart library, no `style`); the hover / focus card is placed through the CSSOM.
 */
import type { Dashboard } from '@wf/db/dashboard';
import { changeBps } from '@wf/domain/dashboard';
import { formatMoney, formatPercent } from '@wf/i18n/format';
import type { Locale } from '@wf/i18n/locale';
import { m } from '@wf/i18n/messages';
import { Money } from '@wf/ui/money';
import { usePrivacy } from '@wf/ui/privacy';
import { useState, type ReactNode } from 'react';
import { useElementWidth } from '../../lib/use-element-width.ts';
import { RichMessage } from '../rich-message.tsx';
import {
  averageSpending,
  axisTicks,
  biggestSpending,
  cashflowColumns,
  spendingTrendBps,
  type CashflowColumn,
} from './cashflow-model.ts';
import { shortRange } from './dashboard-format.ts';

export interface CashflowCardProps {
  readonly dashboard: Dashboard;
  readonly locale: Locale;
}

const AXIS = 84;
const TOP = 10;
const PLOT = 190;
const BOTTOM = 26;

export function CashflowCard({ dashboard, locale }: CashflowCardProps) {
  const { hidden } = usePrivacy();
  const [measure, width] = useElementWidth();
  const [active, setActive] = useState<number | null>(null);
  const currency = dashboard.baseCurrency;
  const columns = cashflowColumns(dashboard, locale);
  const max = columns.reduce(
    (top, column) => [column.incomeMinor, column.expenseMinor, top].reduce((a, b) => (b > a ? b : a)),
    0n,
  );
  const ticks = axisTicks(max);
  const scaleMinor = ticks.at(-1) as bigint;
  const y = (minor: bigint) => TOP + PLOT - (Number(minor) / Number(scaleMinor)) * PLOT;
  const biggest = biggestSpending(columns);
  const week = dashboard.scope === 'week';
  const year = dashboard.scope === 'year';
  const trendBps = spendingTrendBps(columns);
  const money = (minor: bigint, context: 'amount' | 'table' | 'delta' = 'amount') =>
    formatMoney(minor, currency, { locale, context, privacy: hidden });

  const subtitle = week
    ? m.overview_cashflow_per_day({ range: shortRange(dashboard.ranges.full, locale, dashboard.today) })
    : year
      ? m.overview_cashflow_per_month({ year: dashboard.ranges.full.from.slice(0, 4) })
      : m.overview_cashflow_six_periods();
  // The trend always holds the period containing the end of what is shown.
  const current = columns.find((column) => column.current) as CashflowColumn;

  const stats: { label: string; value: ReactNode; tone?: string }[] = [
    {
      label: week
        ? m.overview_cashflow_net_week()
        : year
          ? m.overview_cashflow_net_year({ year: dashboard.ranges.full.from.slice(0, 4) })
          : m.overview_cashflow_net({ what: current.label }),
      value: <Money minor={dashboard.kpis.current.savedMinor} currency={currency} context="delta" locale={locale} />,
    },
    {
      label: week
        ? m.overview_cashflow_costliest_day()
        : year
          ? m.overview_cashflow_costliest_month()
          : m.overview_cashflow_biggest(),
      value:
        biggest === null ? (
          '—'
        ) : (
          <>
            {biggest.label} ·{' '}
            <Money minor={biggest.expenseMinor} currency={currency} context="amount" locale={locale} />
          </>
        ),
    },
    trendBps === null || week || year
      ? {
          label: m.overview_cashflow_average(),
          value: (
            <RichMessage
              message={week ? m.overview_cashflow_per_day_amount : m.overview_cashflow_per_month_amount}
              slots={{
                amount: <Money minor={averageSpending(columns)} currency={currency} context="amount" locale={locale} />,
              }}
            />
          ),
        }
      : {
          label: m.overview_cashflow_trend(),
          value: m.overview_cashflow_trend_value({
            change: formatPercent(trendBps / 10_000, locale, { signed: true, maximumFractionDigits: 1 }),
          }),
          tone: trendBps <= 0 ? 'text-green-fg' : 'text-red-fg',
        },
  ];

  const slot = width === null ? 0 : (width - AXIS) / columns.length;
  const bar = Math.min(Math.max(slot * 0.22, 6), 26);
  // Geometry and the accessible name of each column, computed before rendering (amounts reach the DOM as text only
  // through `money`, which honours the privacy mode).
  const bars = columns.map((column, index) => ({
    column,
    x: AXIS + slot * index + slot / 2,
    incomeY: y(column.incomeMinor),
    expenseY: y(column.expenseMinor),
    label: column.future
      ? column.title
      : `${column.title}: ${m.overview_kpi_income()} ${money(column.incomeMinor)}, ${m.overview_kpi_expense()} ${money(column.expenseMinor)}`,
  }));

  return (
    <section
      aria-labelledby="overview-cashflow"
      className="flex flex-col gap-4 rounded-[12px] border border-border bg-card px-6 py-5"
    >
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h2 id="overview-cashflow" className="text-[15px] font-semibold text-fg">
            {m.overview_cashflow_title()}
          </h2>
          <p className="text-[12.5px] text-muted-fg">
            {subtitle}
            {week || year ? null : (
              <>
                {' · '}
                <RichMessage
                  message={m.overview_cashflow_average_saved}
                  slots={{
                    amount: (
                      <Money
                        minor={dashboard.trend.averageSavedMinor}
                        currency={currency}
                        context="amount"
                        locale={locale}
                      />
                    ),
                  }}
                />
              </>
            )}
          </p>
        </div>
        <ul className="flex items-center gap-4 text-[11.5px] text-muted-fg">
          <li className="flex items-center gap-1.5">
            <span aria-hidden="true" className="size-2 rounded-[2px] bg-fg" />
            {m.overview_kpi_income()}
          </li>
          <li className="flex items-center gap-1.5">
            <span aria-hidden="true" className="size-2 rounded-[2px] bg-red" />
            {m.overview_kpi_expense()}
          </li>
        </ul>
      </div>
      <div ref={measure} className="relative">
        {width === null ? (
          <div aria-hidden="true" className="h-[226px]" />
        ) : (
          <svg width={width} height={TOP + PLOT + BOTTOM} role="group" aria-label={m.overview_cashflow_chart()}>
            <g aria-hidden="true">
              {ticks.map((tick) => (
                <g key={String(tick)}>
                  <line
                    x1={AXIS}
                    x2={width}
                    y1={y(tick)}
                    y2={y(tick)}
                    className="stroke-border"
                    strokeDasharray={tick === 0n ? undefined : '2 4'}
                  />
                  <text
                    x={AXIS - 10}
                    y={y(tick)}
                    textAnchor="end"
                    dominantBaseline="middle"
                    className="fill-subtle font-mono text-[10.5px]"
                  >
                    {money(tick, 'table')}
                  </text>
                </g>
              ))}
            </g>
            {bars.map(({ column, x, incomeY, expenseY, label }, index) => {
              return (
                <g
                  key={column.key}
                  tabIndex={column.future ? undefined : 0}
                  role="img"
                  aria-label={label}
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
                    x={x - slot / 2 + 2}
                    y={TOP}
                    // Not negative while the card is measured at 0 px (hidden behind a sheet or still laying out).
                    width={Math.max(slot - 4, 0)}
                    height={PLOT}
                    rx={6}
                    className={active === index ? 'fill-tint-04' : 'fill-transparent'}
                    strokeWidth={2}
                  />
                  {column.future ? (
                    <rect
                      x={x - bar - 2}
                      y={TOP + PLOT - 10}
                      width={bar * 2 + 4}
                      height={10}
                      rx={2}
                      className="fill-none stroke-border"
                    />
                  ) : (
                    <>
                      <rect
                        x={x - bar - 2}
                        y={incomeY}
                        width={bar}
                        height={TOP + PLOT - incomeY}
                        rx={2}
                        className={column.current ? 'fill-fg' : 'fill-neutral-strong'}
                      />
                      <rect
                        x={x + 2}
                        y={expenseY}
                        width={bar}
                        height={TOP + PLOT - expenseY}
                        rx={2}
                        className={column.current ? 'fill-red' : 'fill-heat-red'}
                      />
                    </>
                  )}
                  <text
                    x={x}
                    y={TOP + PLOT + 18}
                    textAnchor="middle"
                    className={`text-[11.5px] ${column.current ? 'fill-fg font-medium' : column.future ? 'fill-text-faint' : 'fill-subtle'}`}
                  >
                    {column.label}
                  </text>
                </g>
              );
            })}
          </svg>
        )}
        {active === null || width === null ? null : (
          <CashflowTooltip
            columns={columns}
            index={active}
            x={AXIS + slot * active + slot}
            width={width}
            currency={currency}
            locale={locale}
          />
        )}
      </div>
      <dl className="grid grid-cols-3 gap-4 border-t border-border pt-4">
        {stats.map((stat) => (
          <div key={stat.label} className="flex min-w-0 flex-col gap-1">
            <dt className="truncate text-[11.5px] text-subtle">{stat.label}</dt>
            <dd className={`truncate font-mono text-[13px] font-medium ${stat.tone ?? 'text-fg'}`}>{stat.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

interface CashflowTooltipProps {
  readonly columns: readonly CashflowColumn[];
  readonly index: number;
  /** Right edge of the column, in the chart's coordinates. */
  readonly x: number;
  readonly width: number;
  readonly currency: string;
  readonly locale: Locale;
}

/** Design `SGcTm`: "September 2026 · selisih +Rp7.500.000 · …· Rasio tabung 29% · vs Agustus +8,3% belanja". */
function CashflowTooltip({ columns, index, x, width, currency, locale }: CashflowTooltipProps) {
  const column = columns[index] as CashflowColumn;
  const previous = index > 0 ? columns[index - 1] : undefined;
  const savedMinor = column.incomeMinor - column.expenseMinor;
  const rate = column.incomeMinor > 0n ? Number(savedMinor) / Number(column.incomeMinor) : null;
  const spendBps = previous === undefined ? null : changeBps(column.expenseMinor, previous.expenseMinor);
  const place = (element: HTMLDivElement | null) => {
    if (element === null) return;
    element.style.left = `${String(x + 220 <= width ? x : Math.max(x - 220 - 40, 0))}px`;
    element.style.top = '0px';
  };
  return (
    <div
      ref={place}
      role="tooltip"
      className="pointer-events-none absolute z-10 flex w-[220px] flex-col gap-2 rounded-[10px] border border-border-strong bg-popover p-3 text-[12px] shadow-lg"
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-medium text-fg">{column.title}</span>
        <span className="text-[11px] text-subtle">
          {m.overview_cashflow_tip_difference()}{' '}
          <Money minor={savedMinor} currency={currency} context="delta" locale={locale} className="text-fg" />
        </span>
      </div>
      <dl className="flex flex-col gap-1">
        <div className="flex justify-between gap-2">
          <dt className="text-muted-fg">{m.overview_kpi_income()}</dt>
          <dd>
            <Money
              minor={column.incomeMinor}
              currency={currency}
              context="amount"
              locale={locale}
              className="text-fg"
            />
          </dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-muted-fg">{m.overview_kpi_expense()}</dt>
          <dd>
            <Money
              minor={column.expenseMinor}
              currency={currency}
              context="amount"
              locale={locale}
              className="text-fg"
            />
          </dd>
        </div>
        {rate === null ? null : (
          <div className="flex justify-between gap-2">
            <dt className="text-muted-fg">{m.overview_cashflow_tip_rate()}</dt>
            <dd className="font-mono text-fg">{formatPercent(rate, locale, { maximumFractionDigits: 0 })}</dd>
          </div>
        )}
      </dl>
      {spendBps === null || previous === undefined ? null : (
        <p className="border-t border-border pt-2 text-[11px] text-subtle">
          {m.overview_cashflow_tip_vs({
            what: previous.title,
            change: formatPercent(spendBps / 10_000, locale, { signed: true, maximumFractionDigits: 1 }),
          })}
        </p>
      )}
    </div>
  );
}
