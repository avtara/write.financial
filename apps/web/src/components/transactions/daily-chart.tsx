// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Pengeluaran harian" (FR-L1, design `t7l0Cj`): one bar per day of the period or range, days above the average in
 * red, the average as a dashed line, and the first, middle, and last day under the axis. Plain SVG with presentation
 * attributes only, so the production CSP (no inline styles) accepts it; days after today have no bar. For assistive
 * technology the chart is one image with a summary, and the numbers are in a visually hidden table.
 */
import type { LocalDate } from '@wf/domain/period';
import { m } from '@wf/i18n/messages';
import { formatDate } from '@wf/ui/dates';
import { Money } from '@wf/ui/money';
import { usePreferences } from '../preferences.tsx';

export interface DailyChartProps {
  readonly days: readonly { readonly date: LocalDate; readonly outMinor: bigint }[];
  readonly averageMinor: bigint;
  readonly currency: string;
  readonly today: LocalDate;
}

const WIDTH = 240;
const HEIGHT = 44;
const GAP = 1.5;

export function DailyChart({ days, averageMinor, currency, today }: DailyChartProps) {
  const { preferences } = usePreferences();
  const { locale } = preferences;
  const max = days.reduce((largest, day) => (day.outMinor > largest ? day.outMinor : largest), averageMinor);
  const scale = (minor: bigint) => (max === 0n ? 0 : Number((minor * 1000n) / max) / 1000) * HEIGHT;
  const step = days.length === 0 ? 0 : WIDTH / days.length;
  const averageY = HEIGHT - scale(averageMinor);
  // The axis labels: the first, middle, and last day (none without days).
  const first = days[0];
  const middle = days[Math.floor((days.length - 1) / 2)];
  const last = days.at(-1);
  // Days up to today that had spending; plain numbers for the SVG attributes.
  const bars = days.flatMap((day, index) =>
    day.date > today || day.outMinor === 0n
      ? []
      : [
          {
            date: day.date,
            x: index * step + GAP / 2,
            height: scale(day.outMinor),
            above: day.outMinor > averageMinor,
          },
        ],
  );
  return (
    <figure className="flex min-w-0 flex-col gap-1.5">
      <svg
        role="img"
        aria-label={m.transactions_chart_label({ days: days.length })}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="none"
        className="h-11 w-full"
      >
        {bars.map((bar) => (
          <rect
            key={bar.date}
            x={bar.x}
            y={HEIGHT - bar.height}
            width={Math.max(step - GAP, 0.5)}
            height={bar.height}
            rx={0.75}
            className={bar.above ? 'fill-red' : 'fill-subtle'}
          />
        ))}
        {averageMinor === 0n ? null : (
          <line
            x1={0}
            x2={WIDTH}
            y1={averageY}
            y2={averageY}
            strokeDasharray="3 3"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
            className="stroke-muted-fg"
          />
        )}
      </svg>
      {first === undefined || middle === undefined || last === undefined ? null : (
        <figcaption aria-hidden="true" className="flex justify-between font-mono text-[10.5px] text-subtle">
          <span>{formatDate(first.date, locale, 'day')}</span>
          <span>{Number(middle.date.slice(8))}</span>
          <span>{formatDate(last.date, locale, 'day')}</span>
        </figcaption>
      )}
      <table className="sr-only">
        <caption>{m.transactions_chart_caption()}</caption>
        <tbody>
          {days.map((day) => (
            <tr key={day.date}>
              <th scope="row">{formatDate(day.date, locale, 'date')}</th>
              <td>
                <Money minor={day.outMinor} currency={currency} context="amount" locale={locale} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
