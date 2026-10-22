// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Pengeluaran harian" (FR-L1, design `t7l0Cj` "Daily Spend"): one bar per day of the period or range, days above the
 * average in red, the average as a dashed line, and the first, middle, and last day under the axis. Days without
 * spending and days after today are low stubs. Every bar up to today shows its date and amount in a tooltip on hover
 * and on keyboard focus: the bars are one tab stop, moved with the arrow keys, Home, and End.
 *
 * Plain SVG with presentation attributes only, so the production CSP (no inline styles) accepts it. For assistive
 * technology the chart is a list named "Grafik pengeluaran harian, N hari" whose items read "1 Okt 2026, Rp200.000".
 */
import type { LocalDate } from '@wf/domain/period';
import { m } from '@wf/i18n/messages';
import { formatDate } from '@wf/ui/dates';
import { Money } from '@wf/ui/money';
import { Tooltip } from '@wf/ui/tooltip';
import { useRef, useState, type KeyboardEvent } from 'react';
import { usePreferences } from '../preferences.tsx';

export interface DailyChartProps {
  readonly days: readonly { readonly date: LocalDate; readonly outMinor: bigint }[];
  readonly averageMinor: bigint;
  readonly currency: string;
  readonly today: LocalDate;
}

/** The bar area's height in px, and the SVG's user units (one unit per px). */
const HEIGHT = 44;
/** A day without spending, or still to come (design: a 3 px stub). */
const STUB = 3;

/** Narrower gaps as the range grows, so a quarter or a year still fits the card. */
function gapClass(count: number): string {
  if (count <= 16) return 'gap-1';
  if (count <= 31) return 'gap-[3px]';
  return count <= 92 ? 'gap-px' : 'gap-0';
}

export function DailyChart({ days, averageMinor, currency, today }: DailyChartProps) {
  const { preferences } = usePreferences();
  const { locale } = preferences;
  const items = useRef<(HTMLSpanElement | null)[]>([]);
  const [stop, setStop] = useState<number | null>(null);
  const max = days.reduce((largest, day) => (day.outMinor > largest ? day.outMinor : largest), averageMinor);
  const scale = (minor: bigint) => (max === 0n ? 0 : Number((minor * 1000n) / max) / 1000) * HEIGHT;
  const averageY = HEIGHT - scale(averageMinor);
  // The days are in order, so the ones up to today come first; only they have a bar to point at.
  const elapsed = days.filter((day) => day.date <= today).length;
  const tabStop = Math.min(stop ?? elapsed - 1, elapsed - 1);
  // The axis labels: the first, middle, and last day (none without days).
  const first = days[0];
  const middle = days[Math.floor((days.length - 1) / 2)];
  const last = days.at(-1);
  // Plain numbers and classes for the SVG attributes; a day without spending or still to come is a stub. The SVG
  // stretches to its column, so the corners get a narrow `rx` and a `ry` in px (design: r2 bars, r1 stubs).
  const bars = days.map((day, index) => {
    const stub = day.date > today || day.outMinor === 0n;
    return {
      day,
      index,
      height: stub ? STUB : Math.max(scale(day.outMinor), STUB),
      ry: stub ? 1 : 2,
      fill: stub
        ? 'fill-surface-4'
        : day.outMinor > averageMinor
          ? 'fill-red group-hover:fill-red-fg group-focus-visible:fill-red-fg'
          : 'fill-neutral-bar group-hover:fill-neutral-mid group-focus-visible:fill-neutral-mid',
    };
  });

  const keyDown = (index: number, event: KeyboardEvent) => {
    const target = {
      ArrowLeft: index - 1,
      ArrowRight: index + 1,
      Home: 0,
      End: elapsed - 1,
    }[event.key];
    if (target === undefined) return;
    event.preventDefault();
    const next = Math.min(Math.max(target, 0), elapsed - 1);
    setStop(next);
    items.current[next]?.focus();
  };

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="relative h-11">
        <div
          role="list"
          aria-label={m.transactions_chart_label({ days: days.length })}
          className={`flex h-full items-end ${gapClass(days.length)}`}
        >
          {bars.map(({ day, index, height, ry, fill }) => {
            const bar = (
              <svg aria-hidden="true" viewBox={`0 0 10 ${HEIGHT}`} preserveAspectRatio="none" className="h-full w-full">
                <rect y={HEIGHT - height} width={10} height={height} rx={0.6} ry={ry} className={fill} />
              </svg>
            );
            if (day.date > today) {
              return (
                <span key={day.date} aria-hidden="true" className="flex h-full min-w-0 flex-1">
                  {bar}
                </span>
              );
            }
            return (
              <Tooltip
                key={day.date}
                heading={formatDate(day.date, locale, 'weekday')}
                content={<Money minor={day.outMinor} currency={currency} context="amount" locale={locale} />}
                delayDuration={0}
              >
                <span
                  ref={(node) => {
                    items.current[index] = node;
                  }}
                  role="listitem"
                  tabIndex={index === tabStop ? 0 : -1}
                  onFocus={() => {
                    setStop(index);
                  }}
                  onKeyDown={(event) => {
                    keyDown(index, event);
                  }}
                  className="group flex h-full min-w-0 flex-1 cursor-default rounded-[3px] outline-offset-2 focus-visible:outline-2 focus-visible:outline-ring"
                >
                  {bar}
                  <span className="sr-only">
                    {formatDate(day.date, locale, 'date')},{' '}
                    <Money minor={day.outMinor} currency={currency} context="amount" locale={locale} />
                  </span>
                </span>
              </Tooltip>
            );
          })}
        </div>
        {averageMinor === 0n ? null : (
          <svg
            aria-hidden="true"
            viewBox={`0 0 100 ${HEIGHT}`}
            preserveAspectRatio="none"
            className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
          >
            <line
              x1={0}
              x2={100}
              y1={averageY}
              y2={averageY}
              strokeDasharray="3 3"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
              className="stroke-muted-fg"
            />
          </svg>
        )}
      </div>
      {first === undefined || middle === undefined || last === undefined ? null : (
        <div aria-hidden="true" className="flex justify-between font-mono text-[10.5px] text-subtle">
          <span>{formatDate(first.date, locale, 'day')}</span>
          <span>{Number(middle.date.slice(8))}</span>
          <span>{formatDate(last.date, locale, 'day')}</span>
        </div>
      )}
    </div>
  );
}
