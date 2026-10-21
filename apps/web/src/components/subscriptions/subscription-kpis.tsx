// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The subscriptions KPI strip (FR-SUB2, design `CZmJm`): "Per bulan" with its share of this period's spending, "Per
 * tahun" (≈, Rp10.000 steps) with its share of a month's expected income, "Sisa tagihan Okt" with the remaining bills
 * and their dates, and "Biaya langganan · 6 bulan": one bar per month with what changed ("+ Spotify", "ChatGPT naik").
 */
import type { SubscriptionsOverview } from '@wf/db/schedules';
import type { Locale } from '@wf/i18n/locale';
import { m } from '@wf/i18n/messages';
import { formatDateRange } from '@wf/ui/dates';
import { Money } from '@wf/ui/money';
import { Percent } from '@wf/ui/percent';
import type { ReactNode } from 'react';
import { RichMessage } from '../rich-message.tsx';

export interface SubscriptionKpisProps {
  readonly overview: SubscriptionsOverview;
  /** This period's spending and a month's expected income, for the shares; `null` when unknown or zero. */
  readonly spentMinor: bigint | null;
  readonly incomeMinor: bigint | null;
  readonly locale: Locale;
}

/** Bar heights in the chart's 0–40 viewBox; the tallest month fills it. */
const CHART_HEIGHT = 40;

export function SubscriptionKpis({ overview, spentMinor, incomeMinor, locale }: SubscriptionKpisProps) {
  const { totals, remainingThisMonth: remaining, baseCurrency, history, today } = overview;
  const monthName = (month: string, style: 'short' | 'long') =>
    new Intl.DateTimeFormat(locale, { month: style, timeZone: 'UTC' }).format(new Date(`${month}-01T00:00:00Z`));
  const names = new Map(overview.subscriptions.map((subscription) => [subscription.id, subscription.name]));
  const highest = history.reduce((max, month) => (month.monthlyMinor > max ? month.monthlyMinor : max), 0n);
  const heights = new Map(
    history.map((month) => [
      month.month,
      highest === 0n ? 0 : Math.max(2, (Number(month.monthlyMinor) / Number(highest)) * CHART_HEIGHT),
    ]),
  );
  const spendingShare = spentMinor === null ? null : Number(totals.monthlyMinor) / Number(spentMinor);
  const incomeShare = incomeMinor === null ? null : Number(totals.yearlyMinor) / Number(incomeMinor);
  const first = history[0];
  const last = history.at(-1);
  const growth =
    first === undefined || last === undefined || first.monthlyMinor === 0n
      ? null
      : Number(last.monthlyMinor - first.monthlyMinor) / Number(first.monthlyMinor);
  return (
    <section
      aria-label={m.subscriptions_kpis_label()}
      className="grid grid-cols-1 overflow-hidden rounded-[12px] border border-border bg-card md:grid-cols-3 xl:grid-cols-[repeat(3,minmax(0,1fr))_minmax(0,2fr)]"
    >
      <Kpi label={m.subscriptions_kpi_monthly()}>
        <Money
          minor={totals.monthlyMinor}
          currency={baseCurrency}
          context="amount"
          locale={locale}
          className="text-[26px] leading-tight font-medium text-fg"
        />
        {spendingShare === null ? null : (
          <span className="text-[12px] text-subtle">
            <RichMessage
              message={m.subscriptions_kpi_of_spending}
              slots={{
                share: <Percent value={spendingShare} locale={locale} />,
              }}
            />
          </span>
        )}
      </Kpi>
      <Kpi label={m.subscriptions_kpi_yearly()}>
        <Money
          minor={totals.approxYearlyMinor}
          currency={baseCurrency}
          context="amount"
          locale={locale}
          className="text-[26px] leading-tight font-medium text-fg"
        />
        {incomeShare === null ? null : (
          <span className="text-[12px] text-subtle">
            <RichMessage
              message={m.subscriptions_kpi_of_income}
              slots={{
                share: <Percent value={incomeShare} decimals={0} locale={locale} />,
              }}
            />
          </span>
        )}
      </Kpi>
      <Kpi label={m.subscriptions_kpi_remaining({ month: monthName(today.slice(0, 7), 'short') })}>
        <Money
          minor={remaining.totalMinor}
          currency={baseCurrency}
          context="amount"
          locale={locale}
          className="text-[26px] leading-tight font-medium text-fg"
        />
        <span className="text-[12px] text-subtle">
          {remaining.firstDue === null || remaining.lastDue === null
            ? m.subscriptions_kpi_remaining_none()
            : m.subscriptions_kpi_remaining_bills({
                count: remaining.count,
                dates: formatDateRange({ start: remaining.firstDue, end: remaining.lastDue }, locale, today),
              })}
        </span>
      </Kpi>
      <figure className="flex min-w-0 flex-col gap-3 border-t border-border px-5 py-4 md:col-span-3 xl:col-span-1 xl:border-t-0 xl:border-l">
        <figcaption className="flex items-baseline justify-between gap-2 text-[12.5px] text-muted-fg">
          <span>{m.subscriptions_chart_title({ months: history.length })}</span>
          {growth === null || first === undefined ? null : (
            <span className="text-[11.5px] text-subtle">
              <RichMessage
                message={m.subscriptions_chart_growth}
                slots={{
                  change: <Percent value={growth} decimals={0} signed locale={locale} />,
                  month: monthName(first.month, 'short'),
                }}
              />
            </span>
          )}
        </figcaption>
        <ol className="grid grid-cols-6 items-end gap-2">
          {history.map((month) => {
            const height = heights.get(month.month) as number;
            const notes = [
              ...month.added.map((id) => m.subscriptions_chart_added({ name: names.get(id) ?? '' })),
              ...month.increased.map((id) => m.subscriptions_chart_increased({ name: names.get(id) ?? '' })),
            ];
            return (
              <li key={month.month} className="flex min-w-0 flex-col items-center gap-1">
                <span className="min-h-[14px] w-full truncate text-center text-[10.5px] text-subtle">
                  {notes.join(', ')}
                </span>
                <svg
                  aria-hidden="true"
                  viewBox={`0 0 10 ${String(CHART_HEIGHT)}`}
                  preserveAspectRatio="none"
                  className="block h-10 w-full"
                >
                  <rect
                    x="0"
                    y={CHART_HEIGHT - height}
                    width="10"
                    height={height}
                    className={month === last ? 'fill-fg' : 'fill-surface-5'}
                  />
                </svg>
                <span className="flex w-full flex-col items-center text-[10.5px] text-subtle">
                  <span>{monthName(month.month, 'short')}</span>
                  <Money
                    minor={month.monthlyMinor}
                    currency={baseCurrency}
                    context="table"
                    locale={locale}
                    className="text-center!"
                  />
                </span>
              </li>
            );
          })}
        </ol>
      </figure>
    </section>
  );
}

function Kpi({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 border-b border-border px-5 py-4 md:border-r md:border-b-0">
      <span className="text-[12.5px] text-muted-fg">{label}</span>
      {children}
    </div>
  );
}
