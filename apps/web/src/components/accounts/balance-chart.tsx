// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Saldo 6 bulan" (FR-R6, design `ycP7T` detail panel): month-end balances as bars on Recharts, the current month
 * highlighted, the axis starting at {@link axisStart} (stated under the chart, as the design asks for an explicit
 * axis note). Amounts never appear inside the SVG, so privacy mode only needs the note's `<Money>`. Recharts writes
 * inline styles, which the CSP allows only through the CSSOM: render this on the client only.
 */
import type { AccountSeriesPoint } from '@wf/db/accounts';
import type { Locale } from '@wf/i18n/locale';
import { Bar, BarChart, ResponsiveContainer, XAxis, YAxis } from 'recharts';

export interface BalanceChartProps {
  readonly series: readonly AccountSeriesPoint[];
  /** Where the value axis starts (bars show the balance above it). */
  readonly startMinor: bigint;
  readonly locale: Locale;
  /** Names the chart for assistive technology; the figures are listed in the visible flows. */
  readonly label: string;
}

export function BalanceChart({ series, startMinor, locale, label }: BalanceChartProps) {
  const month = new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' });
  // Recharts takes each bar's `fill` from its data entry: the current month stands out.
  const data = series.map((point, index) => ({
    month: month.format(new Date(`${point.month}-01T00:00:00Z`)),
    value: Number(point.closingBalanceMinor - startMinor),
    fill: index === series.length - 1 ? 'var(--blue)' : 'var(--surface-4)',
  }));
  return (
    <div role="img" aria-label={label} className="h-[110px] w-full">
      <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 320, height: 110 }}>
        <BarChart data={data} margin={{ top: 4, right: 0, bottom: 0, left: 0 }} barCategoryGap="12%">
          <YAxis hide domain={[0, 'dataMax']} />
          <XAxis
            dataKey="month"
            axisLine={false}
            tickLine={false}
            tick={{ fill: 'var(--subtle)', fontSize: 11 }}
            interval={0}
          />
          <Bar dataKey="value" radius={[3, 3, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
