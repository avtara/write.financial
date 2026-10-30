// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Arus uang" (PDF page 2, design `t3PQGb`): the money that stayed, the daily average, the busiest week, the daily
 * spending chart with that week highlighted, and the income sources with their shares. Drawn in SVG with attributes
 * only (no chart library, no `style`).
 */
import type { ReportView } from '@wf/db/reports';
import type { BusiestWeek } from '@wf/domain/report';
import type { LocalDate } from '@wf/domain/period';
import type { Locale } from '@wf/i18n/locale';
import { m } from '@wf/i18n/messages';
import { formatDate } from '@wf/ui/dates';
import { Money } from '@wf/ui/money';
import { Percent } from '@wf/ui/percent';
import { useElementWidth } from '../../lib/use-element-width.ts';
import { RichMessage } from '../rich-message.tsx';
import { REPORTS_CURRENCY } from './reports-model.ts';

const TOP = 8;
const PLOT = 96;
const BOTTOM = 20;

export interface FlowSectionProps {
  readonly view: ReportView;
  readonly locale: Locale;
}

/** One bar per recorded day; the days of the busiest week are blue, the rest neutral. */
function DailyChart({
  days,
  busiest,
  locale,
}: {
  readonly days: readonly { readonly date: LocalDate; readonly outMinor: bigint }[];
  readonly busiest: BusiestWeek | null;
  readonly locale: Locale;
}) {
  const [measure, width] = useElementWidth();
  const max = days.reduce((top, day) => (day.outMinor > top ? day.outMinor : top), 1n);
  const slot = width === null || days.length === 0 ? 0 : width / days.length;
  const bar = Math.min(Math.max(slot * 0.6, 2), 18);
  const y = (outMinor: bigint) => TOP + PLOT - (Number(outMinor) / Number(max)) * PLOT;
  // Geometry computed before rendering (the amounts never reach the DOM; the chart is decorative).
  const bars = days.map((day, index) => ({
    date: day.date,
    x: slot * index + slot / 2,
    top: y(day.outMinor),
    hot: busiest !== null && day.date >= busiest.from && day.date <= busiest.to,
  }));
  return (
    <div ref={measure} className="relative">
      {width === null ? (
        <div aria-hidden="true" className="h-[124px]" />
      ) : (
        <svg width={width} height={TOP + PLOT + BOTTOM} aria-hidden="true">
          {bars.map((bar_) => (
            <g key={bar_.date}>
              <rect
                x={bar_.x - bar / 2}
                y={bar_.top}
                width={bar}
                height={TOP + PLOT - bar_.top}
                rx={2}
                className={bar_.hot ? 'fill-blue' : 'fill-neutral-mid'}
              />
              <text
                x={bar_.x}
                y={TOP + PLOT + 14}
                textAnchor="middle"
                className={`text-[10px] ${bar_.hot ? 'fill-fg font-medium' : 'fill-subtle'}`}
              >
                {formatDate(bar_.date, locale, 'day')}
              </text>
            </g>
          ))}
        </svg>
      )}
    </div>
  );
}

export function FlowSection({ view, locale }: FlowSectionProps) {
  const { sections, totals } = view;
  return (
    <section
      aria-labelledby="reports-flow"
      className="flex flex-col gap-4 rounded-[12px] border border-border bg-card px-6 py-5"
    >
      <div className="flex flex-col gap-1">
        <h2 id="reports-flow" className="text-[15px] font-semibold text-fg">
          {m.reports_section_flow()}
        </h2>
        <p className="text-[12.5px] text-muted-fg">{m.reports_tx_count({ count: totals.txCount })}</p>
      </div>
      <div className="grid grid-cols-1 gap-3 text-[12.5px] md:grid-cols-3">
        <div className="flex flex-col gap-1">
          <span className="text-muted-fg">{m.overview_kpi_leftover()}</span>
          <Money
            minor={totals.savedMinor}
            currency={REPORTS_CURRENCY}
            context="delta"
            locale={locale}
            className="text-[15px] font-medium"
          />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-muted-fg">{m.overview_cashflow_average()}</span>
          <span className="text-[15px] font-medium text-fg">
            <RichMessage
              message={m.reports_avg_daily}
              slots={{
                amount: (
                  <Money
                    minor={sections.averageDailyMinor}
                    currency={REPORTS_CURRENCY}
                    context="amount"
                    locale={locale}
                  />
                ),
              }}
            />
          </span>
        </div>
        {sections.busiestWeek === null ? null : (
          <p className="text-[13.5px] font-medium text-fg">
            <RichMessage
              message={m.reports_busiest_week}
              slots={{
                from: formatDate(sections.busiestWeek.from, locale, 'day'),
                to: formatDate(sections.busiestWeek.to, locale, 'day'),
                amount: (
                  <Money
                    minor={sections.busiestWeek.totalMinor}
                    currency={REPORTS_CURRENCY}
                    context="amount"
                    locale={locale}
                  />
                ),
              }}
            />
          </p>
        )}
      </div>
      {sections.days.length === 0 ? null : (
        <DailyChart days={sections.days} busiest={sections.busiestWeek} locale={locale} />
      )}
      {sections.incomeSources.length === 0 ? null : (
        <div className="flex flex-col gap-2 border-t border-border pt-3">
          <h3 className="text-[13px] font-semibold text-fg">{m.reports_section_income()}</h3>
          <ul className="flex flex-col">
            {sections.incomeSources.map((line, index) => (
              <li
                key={index}
                className="flex items-center justify-between gap-3 border-border py-2 text-[12.5px] not-first:border-t"
              >
                <span className="text-fg">{line.name ?? m.overview_flow_uncategorized()}</span>
                <span className="flex items-baseline gap-3">
                  <Percent value={line.shareBps / 10_000} locale={locale} className="text-[11.5px] text-subtle" />
                  <Money
                    minor={line.totalMinor}
                    currency={REPORTS_CURRENCY}
                    context="table"
                    locale={locale}
                    className="text-fg"
                  />
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
