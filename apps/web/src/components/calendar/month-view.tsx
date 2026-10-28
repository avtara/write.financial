// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The calendar's month (FR-C1–C3, design `zEWoe`, `aXUNE`, `Z0Mxk`, `z6baj`): the KPIs ("Rata-rata harian",
 * "Hari termahal", "Hari hemat", "Akhir pekan" — or, for a month that has not started, its largest bill, scheduled
 * bills and payday), the heat grid with each day's income, savings, net, needs / wants bar and scheduled events, the
 * week totals (W1–W6), the legend that hides layers, a tooltip per day, and "Pola per hari".
 */
import type { LocalDate, YearMonth } from '@wf/domain/period';
import type { Locale } from '@wf/i18n/locale';
import { m } from '@wf/i18n/messages';
import { formatDate, formatMonth, weekdayNames } from '@wf/ui/dates';
import { Money } from '@wf/ui/money';
import { Tooltip } from '@wf/ui/tooltip';
import { ArrowDownLeft, CalendarDays, Flame, Leaf, PiggyBank, Sparkles, Wallet } from 'lucide-react';
import { RichMessage } from '../rich-message.tsx';
import { Kpi, KpiStrip } from './calendar-kpi.tsx';
import { CALENDAR_LAYERS, weekTotal, type CalendarLayer, type DayDetail, type MonthStats } from './calendar-model.ts';

const HEAT: readonly string[] = ['bg-surface-2', 'bg-red-tint-1', 'bg-red-tint-2', 'bg-red-tint-3', 'bg-red-tint-4'];

const LAYER_LABEL: Readonly<Record<CalendarLayer, () => string>> = {
  spending: m.calendar_layer_spending,
  income: m.calendar_layer_income,
  savings: m.calendar_layer_savings,
  scheduled: m.calendar_layer_scheduled,
};

const LAYER_DOT: Readonly<Record<CalendarLayer, string>> = {
  spending: 'bg-red',
  income: 'bg-green',
  savings: 'bg-blue',
  scheduled: 'bg-amber',
};

export interface MonthKpisProps {
  readonly stats: MonthStats;
  readonly grid: readonly (readonly DayDetail[])[];
  readonly weekendRatio: number | null;
  readonly future: boolean;
  readonly baseCurrency: string;
  readonly locale: Locale;
}

export function MonthKpis({ stats, grid, weekendRatio, future, baseCurrency, locale }: MonthKpisProps) {
  const money = (minor: bigint) => <Money minor={minor} currency={baseCurrency} context="amount" locale={locale} />;
  const days = grid.flat().filter((day) => day.inRange);
  if (future) {
    const bills = days.flatMap((day) => day.scheduled.filter((item) => item.direction === 'out'));
    const transfers = days.flatMap((day) => day.scheduled.filter((item) => item.direction === 'transfer'));
    const largest = bills.toSorted((a, b) => Number(b.expectedMinor - a.expectedMinor))[0];
    const payday = days.find((day) => day.projected.length > 0);
    const billsMinor = bills.reduce((total, item) => total + item.expectedMinor, 0n);
    const transferMinor = transfers.reduce((total, item) => total + item.expectedMinor, 0n);
    const paydayMinor = payday?.projected.reduce((total, income) => total + income.amountMinor, 0n) ?? 0n;
    const largestBill = largest === undefined ? '—' : money(largest.expectedMinor);
    const billsTotal = money(billsMinor);
    const transfersTotal = transferMinor === 0n ? null : money(transferMinor);
    const paydayTotal = money(paydayMinor);
    return (
      <KpiStrip columns={4}>
        <Kpi icon={CalendarDays} label={m.calendar_kpi_average()} value="—" note={m.calendar_kpi_no_transactions()} />
        <Kpi
          icon={Flame}
          label={m.calendar_kpi_largest_bill()}
          value={largestBill}
          note={
            largest === undefined
              ? null
              : `${largest.name ?? m.calendar_scheduled_unnamed()} · ${formatDate(largest.dueDate, locale, 'day')}`
          }
        />
        <Kpi
          icon={Leaf}
          label={m.calendar_kpi_scheduled()}
          value={m.calendar_kpi_bills({ count: bills.length })}
          note={
            <>
              {billsTotal}
              {transfersTotal === null ? null : (
                <>
                  {' + '}
                  <RichMessage message={m.calendar_kpi_transfers} slots={{ amount: transfersTotal }} />
                </>
              )}
            </>
          }
        />
        <Kpi
          icon={Wallet}
          label={m.calendar_kpi_payday()}
          value={payday === undefined ? '—' : formatDate(payday.date, locale, 'day')}
          note={
            payday === undefined ? null : (
              <RichMessage message={m.calendar_kpi_payday_estimate} slots={{ amount: paydayTotal }} />
            )
          }
        />
      </KpiStrip>
    );
  }
  const costliest = stats.costliest;
  const average = stats.elapsed === 0 ? '—' : money(stats.averageMinor);
  const costliestAmount = costliest === null ? '—' : money(costliest.outMinor);
  const costliestTimes =
    costliest === null || stats.averageMinor === 0n ? 0 : Number(costliest.outMinor) / Number(stats.averageMinor);
  const frugalLimit = money(stats.frugalLimitMinor);
  return (
    <KpiStrip columns={4}>
      <Kpi
        icon={CalendarDays}
        label={m.calendar_kpi_average()}
        value={average}
        note={m.calendar_kpi_elapsed({ days: stats.elapsed })}
      />
      <Kpi
        icon={Flame}
        tone="red"
        label={m.calendar_kpi_costliest()}
        value={costliestAmount}
        note={
          costliest === null
            ? null
            : m.calendar_kpi_costliest_note({
                date: formatDate(costliest.date, locale, 'weekday'),
                times: new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(costliestTimes),
              })
        }
      />
      <Kpi
        icon={Leaf}
        tone="green"
        label={m.calendar_kpi_frugal()}
        value={m.calendar_kpi_days({ count: stats.frugalDays })}
        note={<RichMessage message={m.calendar_kpi_frugal_note} slots={{ amount: frugalLimit }} />}
      />
      <Kpi
        icon={Sparkles}
        label={m.calendar_kpi_weekend()}
        value={
          weekendRatio === null
            ? '—'
            : `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(weekendRatio)}×`
        }
        note={weekendRatio === null ? null : m.calendar_kpi_weekend_note()}
      />
    </KpiStrip>
  );
}

export interface MonthGridProps {
  readonly month: YearMonth;
  readonly grid: readonly (readonly DayDetail[])[];
  readonly stats: MonthStats;
  readonly today: LocalDate;
  /** The month has not started: its days show schedules and the projection. */
  readonly future: boolean;
  /** "Perkiraan dari pola Okt": the month the projection comes from. */
  readonly patternMonth: YearMonth | null;
  readonly selected: LocalDate | null;
  readonly onSelect: (date: LocalDate) => void;
  readonly layers: readonly CalendarLayer[];
  readonly onToggleLayer: (layer: CalendarLayer) => void;
  readonly baseCurrency: string;
  readonly locale: Locale;
}

export function MonthGrid({
  month,
  grid,
  stats,
  today,
  future,
  patternMonth,
  selected,
  onSelect,
  layers,
  onToggleLayer,
  baseCurrency,
  locale,
}: MonthGridProps) {
  const shown = (layer: CalendarLayer) => layers.includes(layer);
  const amount = (minor: bigint, className = '') => (
    <Money
      minor={minor}
      currency={baseCurrency}
      context="table"
      locale={locale}
      className={`text-left! ${className}`}
    />
  );
  const weekdays = weekdayNames(locale, 1);
  const first = `${month}-01` as LocalDate;
  const caption =
    future && patternMonth !== null
      ? m.calendar_month_future()
      : !shown('income')
        ? m.calendar_month_income_hidden()
        : m.calendar_month_hint();

  const weeks = grid.map((week) => {
    const total = weekTotal(week);
    return { week, total, spent: amount(total.outMinor, 'text-right!') };
  });

  const cell = (day: DayDetail) => {
    const ratio = stats.averageMinor === 0n ? null : Number(day.outMinor) / Number(stats.averageMinor);
    const needsShare =
      day.needsMinor + day.wantsMinor === 0n ? null : Number(day.needsMinor) / Number(day.needsMinor + day.wantsMinor);
    const surplus = day.surplus && shown('income');
    const heat = shown('spending') && !surplus ? HEAT[day.heat] : 'bg-surface-2';
    const spent = amount(-day.outMinor);
    const needs = amount(day.needsMinor);
    const wants = amount(day.wantsMinor);
    const saved = amount(day.savingsMinor);
    const received = amount(day.inMinor);
    const spentPlain = amount(day.outMinor);
    const tip = (
      <span className="flex min-w-[190px] flex-col gap-1">
        {day.future ? (
          <span className="text-subtle">{m.calendar_tip_future()}</span>
        ) : (
          <>
            {ratio === null ? null : (
              <span className="text-subtle">
                {m.calendar_tip_ratio({
                  times: new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(ratio),
                })}
              </span>
            )}
            <span className="flex justify-between gap-3">
              <span>{m.calendar_tip_out()}</span>
              {spent}
            </span>
            {day.needsMinor === 0n ? null : (
              <span className="flex justify-between gap-3 text-subtle">
                <span>{m.calendar_group_needs()}</span>
                {needs}
              </span>
            )}
            {day.wantsMinor === 0n ? null : (
              <span className="flex justify-between gap-3 text-subtle">
                <span>{m.calendar_group_wants()}</span>
                {wants}
              </span>
            )}
            <span className="text-subtle">
              {m.calendar_tip_count({ count: day.count })}
              {day.largest === null
                ? ''
                : ` · ${m.calendar_tip_largest({ name: day.largest.merchant ?? day.largest.description ?? '—' })}`}
            </span>
          </>
        )}
        <span className="text-subtle">{m.calendar_tip_open()}</span>
      </span>
    );
    return (
      <Tooltip heading={formatDate(day.date, locale, 'full')} content={tip}>
        <button
          type="button"
          aria-pressed={selected === day.date}
          onClick={() => {
            onSelect(day.date);
          }}
          data-surplus={surplus ? 'true' : undefined}
          className={`relative flex min-h-[92px] w-full min-w-0 flex-col gap-0.5 rounded-[8px] border p-1.5 text-left focus-visible:outline-2 focus-visible:outline-ring aria-pressed:border-fg data-[surplus=true]:bg-green-tint-3 xl:min-h-[122px] ${heat} ${day.date === today ? 'border-blue' : 'border-transparent'}`}
        >
          {/* The date first, then what the cell shows, so the name holds the visible text (WCAG 2.5.3). */}
          <span className="sr-only">
            {[formatDate(day.date, locale, 'full'), day.outMinor === 0n ? null : m.calendar_cell_out()]
              .filter((part) => part !== null)
              .join(', ')}
          </span>
          <span className="flex items-center justify-between gap-1 text-[12px] font-medium text-fg">
            {Number(day.date.slice(8))}
            {day.date === today ? (
              <span className="rounded-[4px] bg-blue px-1 text-[9.5px] text-on-accent">{m.calendar_today()}</span>
            ) : null}
          </span>
          {shown('savings') && day.savingsMinor > 0n ? (
            // The lighter tint keeps the blue text at 4.5:1 over the green surplus cell too.
            <span className="truncate rounded-[3px] bg-blue-tint-1 px-1 text-[10px] text-blue-fg">{saved}</span>
          ) : null}
          {shown('income') && day.inMinor > 0n ? (
            <span className="flex items-center gap-0.5 truncate text-[10px] text-green-fg">
              <ArrowDownLeft aria-hidden="true" className="size-2.5 shrink-0 max-lg:hidden" />
              {received}
            </span>
          ) : null}
          {shown('income')
            ? day.projected.map((income) => (
                <span
                  key={income.label}
                  className="truncate rounded-[3px] bg-green-tint-2 px-1 text-[10px] text-green-fg"
                >
                  {income.label}
                </span>
              ))
            : null}
          {shown('scheduled')
            ? day.scheduled.map((item) => (
                <span
                  key={`${item.sourceId}-${item.dueDate}`}
                  data-direction={item.direction}
                  className="flex items-center gap-1 truncate rounded-[3px] bg-tint-06 px-1 text-[10px] text-fg"
                >
                  <span
                    aria-hidden="true"
                    data-direction={item.direction}
                    className="size-1.5 shrink-0 rounded-full bg-amber data-[direction=in]:bg-green data-[direction=transfer]:bg-blue"
                  />
                  <span className="min-w-0 flex-1 truncate">{item.name ?? m.calendar_scheduled_unnamed()}</span>
                  <Money
                    minor={item.expectedMinor}
                    currency={item.currency}
                    context="table"
                    locale={locale}
                    className="hidden shrink-0 text-subtle 2xl:block"
                  />
                </span>
              ))
            : null}
          <span className="mt-auto flex flex-col gap-1">
            {day.inRange && !day.future && day.outMinor + day.inMinor > 0n ? (
              surplus ? (
                <Money
                  minor={day.inMinor - day.outMinor}
                  currency={baseCurrency}
                  context="delta"
                  locale={locale}
                  className="truncate text-[10px] lg:text-[11px] xl:text-[10px]"
                />
              ) : shown('spending') ? (
                <span className="truncate font-mono text-[10.5px] text-fg lg:text-[11.5px] xl:text-[10.5px]">
                  {spentPlain}
                </span>
              ) : null
            ) : null}
            {shown('spending') && needsShare !== null ? (
              <svg aria-hidden="true" viewBox="0 0 100 3" preserveAspectRatio="none" className="block h-[3px] w-full">
                <rect x="0" width={needsShare * 100} height="3" className="fill-blue" />
                <rect x={needsShare * 100} width={100 - needsShare * 100} height="3" className="fill-violet" />
              </svg>
            ) : null}
          </span>
        </button>
      </Tooltip>
    );
  };

  return (
    <section
      aria-labelledby="calendar-month"
      className="flex min-w-0 flex-col gap-4 rounded-[12px] border border-border bg-card p-5"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="calendar-month" className="text-[15px] font-semibold text-fg">
            {formatMonth(first, locale)}
          </h2>
          <p className="text-[12.5px] text-muted-fg">{caption}</p>
        </div>
        <ul aria-label={m.calendar_legend()} className="flex flex-wrap gap-1.5">
          {CALENDAR_LAYERS.map((layer) => (
            <li key={layer}>
              <button
                type="button"
                aria-pressed={shown(layer)}
                onClick={() => {
                  onToggleLayer(layer);
                }}
                className="inline-flex items-center gap-1.5 rounded-[6px] border border-border px-2 py-1 text-[11.5px] text-subtle hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring aria-pressed:text-fg"
              >
                <span aria-hidden="true" className={`size-2 rounded-[2px] ${LAYER_DOT[layer]}`} />
                {LAYER_LABEL[layer]()}
              </button>
            </li>
          ))}
        </ul>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full table-fixed border-separate border-spacing-1">
          <thead>
            <tr>
              {weekdays.map((name) => (
                <th
                  key={name.long}
                  scope="col"
                  abbr={name.long}
                  className="text-left text-[11.5px] font-normal text-subtle"
                >
                  {name.short}
                </th>
              ))}
              <th scope="col" className="w-[96px] text-right text-[11.5px] font-normal text-subtle max-lg:hidden">
                {m.calendar_total()}
              </th>
            </tr>
          </thead>
          <tbody>
            {weeks.map(({ week, total, spent: weekSpent }, index) => {
              return (
                <tr key={(week[0] as DayDetail).date}>
                  {week.map((day) => (
                    <td key={day.date} className="p-0 align-top">
                      {day.inRange ? (
                        cell(day)
                      ) : (
                        <span aria-hidden="true" className="flex min-h-[92px] p-1.5 text-[12px] text-subtle">
                          {Number(day.date.slice(8))}
                        </span>
                      )}
                    </td>
                  ))}
                  <td className="p-0 pl-2 text-right align-middle max-lg:hidden">
                    <span className="flex flex-col items-end gap-0.5 text-[11px] text-subtle">
                      <span>{m.calendar_week_label({ week: index + 1 })}</span>
                      {future ? null : <span className="font-mono text-[13px] text-fg">{weekSpent}</span>}
                      {!future && total.netMinor > 0n && shown('income') ? (
                        <Money minor={total.netMinor} currency={baseCurrency} context="delta" locale={locale} />
                      ) : null}
                      {total.projectedMinor > 0n ? (
                        <span className="font-mono text-green-fg">
                          <Money minor={total.projectedMinor} currency={baseCurrency} context="delta" locale={locale} />{' '}
                          {m.calendar_projection()}
                        </span>
                      ) : null}
                      {total.scheduledMinor > 0n && shown('scheduled') ? (
                        <span>
                          <RichMessage
                            message={m.calendar_week_total_scheduled}
                            slots={{
                              amount: (
                                <Money
                                  minor={total.scheduledMinor}
                                  currency={baseCurrency}
                                  context="amount"
                                  locale={locale}
                                />
                              ),
                            }}
                          />
                        </span>
                      ) : null}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export interface WeekdayPatternProps {
  readonly stats: MonthStats;
  readonly weekendRatio: number | null;
  readonly baseCurrency: string;
  readonly locale: Locale;
}

/** "Pola per hari": the month's average spending per weekday, the weekend highlighted. */
export function WeekdayPattern({ stats, weekendRatio, baseCurrency, locale }: WeekdayPatternProps) {
  const highest = stats.weekdays.reduce((max, value) => (value > max ? value : max), 1n);
  const names = weekdayNames(locale, 1);
  const weekend = ((stats.weekdays[5] ?? 0n) + (stats.weekdays[6] ?? 0n)) / 2n;
  const heights = stats.weekdays.map((value) => Math.max(2, (Number(value) / Number(highest)) * 60));
  return (
    <section
      aria-labelledby="calendar-pattern"
      className="flex flex-col gap-4 rounded-[12px] border border-border bg-card p-5"
    >
      <header className="flex flex-col gap-0.5">
        <h2 id="calendar-pattern" className="text-[15px] font-semibold text-fg">
          {m.calendar_pattern_title()}
        </h2>
        <p className="text-[12px] text-subtle">{m.calendar_pattern_caption()}</p>
      </header>
      <ol className="grid grid-cols-7 items-end gap-1.5">
        {stats.weekdays.map((value, index) => (
          <li key={names[index]?.long} className="flex min-w-0 flex-col items-center gap-1">
            {/* The label is wider than its column: at either end it aligns to the chart's edge, not past it. */}
            <span
              className={
                value === highest
                  ? `text-[10px] whitespace-nowrap text-fg ${index === 0 ? 'self-start' : index === stats.weekdays.length - 1 ? 'self-end' : ''}`
                  : 'sr-only'
              }
            >
              <Money minor={value} currency={baseCurrency} context="amount" locale={locale} />
            </span>
            <svg aria-hidden="true" viewBox="0 0 10 60" preserveAspectRatio="none" className="block h-[60px] w-full">
              <rect
                x="0"
                y={60 - (heights[index] as number)}
                width="10"
                height={heights[index] as number}
                className={index >= 5 ? 'fill-violet' : 'fill-surface-5'}
              />
            </svg>
            <span className="text-[11px] text-subtle">{names[index]?.short}</span>
          </li>
        ))}
      </ol>
      {weekendRatio === null ? null : (
        <p className="flex gap-2 rounded-[10px] border border-border bg-surface-2 p-3 text-[12px] text-muted-fg">
          <PiggyBank aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
          <span>
            <RichMessage
              message={m.calendar_pattern_weekend}
              slots={{
                amount: <Money minor={weekend} currency={baseCurrency} context="amount" locale={locale} />,
                times: new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(weekendRatio),
              }}
            />
          </span>
        </p>
      )}
    </section>
  );
}
