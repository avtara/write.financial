// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Kalender Pengeluaran" (FR-D2, design `iUqiN`, `tBbvD`, `g9BK2`, `jXuuE`): the spending of each day as heat
 * (Sedikit → Banyak), surplus days in green, each day's income (↑) and spending (↓) on their own lines, scheduled
 * bills on the days ahead, and the breakdown of the chosen day ("Minggu, 11 Oktober · 5 transaksi · ↓ Rp3.380.000 ·
 * 3× rata-rata"; rows in another currency with their base value below) — the costliest day first. A year
 * (or a range over two months) shows mini months instead, with the year's insights. The arrows step the whole
 * Overview to the period before / after. The day grid is one Tab stop; arrow keys move between days.
 */
import { Link } from '@tanstack/react-router';
import type { CategoryView } from '@wf/db/categories';
import type { Dashboard } from '@wf/db/dashboard';
import type { ScheduledItem } from '@wf/db/schedules';
import type { TransactionRow } from '@wf/db/transaction-query';
import { countDays, type LocalDate, type YearMonth } from '@wf/domain/period';
import { formatNumber } from '@wf/i18n/format';
import type { Locale } from '@wf/i18n/locale';
import { m } from '@wf/i18n/messages';
import { formatTime, weekdayNames } from '@wf/ui/dates';
import { Money } from '@wf/ui/money';
import { ArrowDown, ArrowLeftRight, ArrowUp, ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { DashboardSearch } from '../../lib/dashboard-search.ts';
import { RichMessage } from '../rich-message.tsx';
import { categoryName } from '../../lib/ledger-labels.ts';
import { rangeParamOf } from '../../lib/transactions-search.ts';
import { listTransactionRows } from '../../server/fn/transactions.ts';
import { MINI_MONTH_CARD, MINI_MONTH_LINK, MINI_MONTH_SWATCH, MiniMonth } from '../calendar/mini-month.tsx';
import { CategoryIcon } from '../category-icon.tsx';
import { RowAmount } from '../transactions/transaction-row.tsx';
import {
  calendarMonths,
  calendarWeeks,
  cheapestMonth,
  costliestDay,
  weekendRatio,
  type CalendarDay,
  type HeatLevel,
} from './calendar-model.ts';
import { dayTitle, monthName } from './dashboard-format.ts';

export interface CalendarCardProps {
  readonly dashboard: Dashboard;
  readonly categories: readonly CategoryView[];
  /** Bills and recurring transfers due in the range (`listScheduled`); `null` when they could not be loaded. */
  readonly scheduled: readonly ScheduledItem[] | null;
  /** Labels of the period rows (a mini month links to its Overview). */
  readonly periodLabels: readonly YearMonth[];
  readonly navigation: {
    readonly label: string;
    readonly previous: DashboardSearch | null;
    readonly next: DashboardSearch | null;
  };
  readonly locale: Locale;
  readonly timeZone: string;
}

const HEAT: Readonly<Record<HeatLevel, string>> = {
  0: 'bg-surface-2',
  1: 'bg-heat-red/30',
  2: 'bg-heat-red/55',
  3: 'bg-heat-red/80',
  4: 'bg-heat-red',
};

const NAV =
  'flex size-7 items-center justify-center rounded-[7px] border border-border text-muted-fg hover:text-fg focus-visible:outline-2 focus-visible:outline-ring aria-disabled:pointer-events-none aria-disabled:opacity-40';

/** A day's loaded transactions; none yet while they load. */
type Breakdown =
  | { readonly status: 'ready'; readonly rows: readonly TransactionRow[]; readonly total: number }
  | { readonly status: 'failed' };

function NavLink({ search, label, children }: { search: DashboardSearch | null; label: string; children: ReactNode }) {
  if (search === null) {
    return (
      <span role="link" aria-disabled="true" aria-label={label} className={NAV}>
        {children}
      </span>
    );
  }
  return (
    <Link to="/" search={search} aria-label={label} className={NAV}>
      {children}
    </Link>
  );
}

export function CalendarCard({
  dashboard,
  categories,
  scheduled,
  periodLabels,
  navigation,
  locale,
  timeZone,
}: CalendarCardProps) {
  const { ranges, today, calendar, scope } = dashboard;
  const currency = dashboard.baseCurrency;
  const months = scope === 'year' || countDays(ranges.full.from, ranges.full.to) > 62;
  const costliest = costliestDay(calendar.days);
  const [selected, setSelected] = useState<LocalDate | null>(costliest?.date ?? null);
  const [active, setActive] = useState<LocalDate>(costliest?.date ?? ranges.full.from);
  // Per date, so a slow answer for an earlier choice never shows under a later one.
  const [loaded, setLoaded] = useState<Readonly<Record<string, Breakdown>>>({});
  // Another range (the arrows, Minggu/Bulan/Tahun) starts again on its costliest day. The card itself stays mounted, so
  // the arrow just pressed keeps its place on screen.
  const rangeKey = `${ranges.full.from}-${scope}`;
  const [shownRange, setShownRange] = useState(rangeKey);
  if (shownRange !== rangeKey) {
    setShownRange(rangeKey);
    setSelected(costliest?.date ?? null);
    setActive(costliest?.date ?? ranges.full.from);
    setLoaded({});
  }
  // While a day's transactions load, its panel keeps the height it had, so the page below does not jump up and back.
  const breakdownBox = useRef<HTMLDivElement>(null);
  const breakdownHeight = useRef(0);
  const loading = !months && selected !== null && loaded[selected] === undefined;
  useLayoutEffect(() => {
    const box = breakdownBox.current;
    if (box === null) return;
    if (loading) {
      box.style.minHeight = `${String(breakdownHeight.current)}px`;
      return;
    }
    box.style.minHeight = '';
    breakdownHeight.current = box.getBoundingClientRect().height;
  });
  const grid = useRef<HTMLDivElement>(null);
  const byId = new Map(categories.map((category) => [category.id, category]));
  const billsOn = new Map<LocalDate, ScheduledItem[]>();
  for (const item of scheduled ?? []) {
    if (item.direction === 'in' || item.dueDate <= today) continue;
    billsOn.set(item.dueDate, [...(billsOn.get(item.dueDate) ?? []), item]);
  }

  useEffect(() => {
    if (selected === null || months) return;
    const keep = (breakdown: Breakdown) => {
      setLoaded((previous) => ({ ...previous, [selected]: breakdown }));
    };
    void listTransactionRows({ data: { range: rangeParamOf(selected, selected), offset: 0 } }).then(
      (result) => {
        keep(
          result.ok ? { status: 'ready', rows: result.value.rows, total: result.value.total } : { status: 'failed' },
        );
      },
      () => {
        keep({ status: 'failed' });
      },
    );
    // `shownRange`: a new range clears the loaded days, so its first day loads again even when it is the same date.
  }, [selected, months, shownRange]);

  const weeks = months ? [] : calendarWeeks(ranges.full, calendar.days, today);
  const days = weeks.flat().filter((day) => day.inRange);
  const move = (event: KeyboardEvent) => {
    const steps: Readonly<Record<string, number>> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    const index = days.findIndex((day) => day.date === active);
    let target: number;
    if (event.key in steps) target = index + (steps[event.key] as number);
    else if (event.key === 'Home') target = 0;
    else if (event.key === 'End') target = days.length - 1;
    else return;
    event.preventDefault();
    const day = days[Math.min(Math.max(target, 0), days.length - 1)] as CalendarDay;
    setActive(day.date);
    grid.current?.querySelector<HTMLButtonElement>(`[data-date="${day.date}"]`)?.focus();
  };

  const title =
    scope === 'year'
      ? m.overview_calendar_title_year({ year: ranges.full.from.slice(0, 4) })
      : m.overview_calendar_title();
  return (
    <section
      aria-labelledby="overview-calendar"
      className="@container flex flex-col gap-4 rounded-[12px] border border-border bg-card px-6 py-5"
    >
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h2 id="overview-calendar" className="text-[15px] font-semibold text-fg">
            {title}
          </h2>
          <p className="text-[12.5px] text-muted-fg">
            <RichMessage
              message={m.overview_calendar_average}
              slots={{
                amount: (
                  <Money minor={calendar.averageDailySpendMinor} currency={currency} context="amount" locale={locale} />
                ),
              }}
            />
          </p>
        </div>
        <div className="flex items-center gap-2">
          <NavLink search={navigation.previous} label={m.overview_calendar_previous()}>
            <ChevronLeft aria-hidden="true" className="size-3.5" />
          </NavLink>
          <span className="min-w-[110px] text-center text-[13px] font-medium text-fg">{navigation.label}</span>
          <NavLink search={navigation.next} label={m.overview_calendar_next()}>
            <ChevronRight aria-hidden="true" className="size-3.5" />
          </NavLink>
        </div>
      </div>

      {/* The month on the left and the chosen day beside it on a wide card; stacked on a narrow one. */}
      <div
        className={`grid gap-4 ${months ? '' : '@[860px]:grid-cols-[minmax(0,1fr)_minmax(300px,360px)] @[860px]:items-start'}`}
      >
        <div className="flex min-w-0 flex-col gap-4">
          {months ? (
            <YearView dashboard={dashboard} periodLabels={periodLabels} locale={locale} />
          ) : (
            <div ref={grid} role="grid" aria-label={title} onKeyDown={move} className="flex flex-col gap-1.5">
              <div role="row" className="grid grid-cols-7 gap-1.5">
                {weekdayNames(locale, 1).map((name) => (
                  <span key={name.short} role="columnheader" className="px-1 text-[11.5px] text-subtle">
                    <abbr title={name.long} className="no-underline">
                      {name.short}
                    </abbr>
                  </span>
                ))}
              </div>
              {weeks.map((week) => (
                <div key={week[0]?.date} role="row" className="grid grid-cols-7 gap-1.5">
                  {week.map((day) => (
                    <div key={day.date} role="gridcell" aria-selected={day.date === selected}>
                      {day.inRange ? (
                        <DayButton
                          day={day}
                          today={today}
                          tall={scope === 'week'}
                          bills={billsOn.get(day.date) ?? []}
                          selected={day.date === selected}
                          tabbable={day.date === active}
                          currency={currency}
                          locale={locale}
                          onSelect={() => {
                            setActive(day.date);
                            setSelected(day.date);
                          }}
                        />
                      ) : (
                        <span
                          aria-hidden="true"
                          className="flex h-[68px] items-start rounded-[8px] p-2 text-[12px] text-subtle"
                        >
                          {Number(day.date.slice(8))}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}

          <ul
            aria-label={m.overview_calendar_legend()}
            className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-subtle"
          >
            {/* The year draws its months with the Calendar page's tiles, so the swatches follow them there. */}
            <li className="flex items-center gap-1">
              {m.overview_calendar_little()}
              {([1, 2, 3, 4] as const).map((level) => (
                <span
                  key={level}
                  aria-hidden="true"
                  className={`size-3 rounded-[3px] ${months ? MINI_MONTH_SWATCH.heat[level] : HEAT[level]}`}
                />
              ))}
              {m.overview_calendar_lots()}
            </li>
            <li className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className={`size-3 rounded-[3px] ${months ? MINI_MONTH_SWATCH.surplus : 'bg-heat-green'}`}
              />
              {m.overview_calendar_surplus()}
            </li>
            {months ? null : (
              <li className="flex items-center gap-1.5">
                <span aria-hidden="true" className="size-1.5 rounded-full bg-red" />
                {m.overview_calendar_scheduled()}
              </li>
            )}
          </ul>
        </div>

        {months ? null : (
          // Beside the month, one height whatever the day holds (its list scrolls), so another day or week never
          // changes the page's length under the reader.
          <div ref={breakdownBox} className="min-w-0 @[860px]:h-[480px]">
            {selected === null ? (
              <p className="text-[12.5px] text-subtle">{m.overview_calendar_pick()}</p>
            ) : (
              <DayBreakdown
                date={selected}
                breakdown={loaded[selected]}
                day={days.find((day) => day.date === selected) as CalendarDay}
                costliest={costliest?.date === selected}
                averageMinor={calendar.averageDailySpendMinor}
                scope={scope}
                bills={billsOn.get(selected) ?? []}
                byId={byId}
                currency={currency}
                locale={locale}
                timeZone={timeZone}
              />
            )}
          </div>
        )}
      </div>
    </section>
  );
}

interface DayButtonProps {
  readonly day: CalendarDay;
  readonly today: LocalDate;
  readonly tall: boolean;
  readonly bills: readonly ScheduledItem[];
  readonly selected: boolean;
  readonly tabbable: boolean;
  readonly currency: string;
  readonly locale: Locale;
  readonly onSelect: () => void;
}

function DayButton({ day, today, tall, bills, selected, tabbable, currency, locale, onSelect }: DayButtonProps) {
  const isToday = day.date === today;
  const surplus = day.surplus && !day.future;
  const background = day.future ? 'bg-transparent border border-border' : surplus ? 'bg-heat-green' : HEAT[day.heat];
  const [first, ...rest] = bills;
  return (
    <button
      type="button"
      data-date={day.date}
      tabIndex={tabbable ? 0 : -1}
      onClick={onSelect}
      className={`flex w-full flex-col justify-between gap-1 rounded-[8px] p-2 text-left focus-visible:outline-2 focus-visible:outline-ring ${tall ? 'h-[104px]' : 'h-[68px]'} ${background} ${selected ? 'ring-1 ring-fg' : isToday ? 'ring-1 ring-blue' : ''}`}
    >
      {/* The day and its count first, then what the cell shows, so the name holds the visible text (WCAG 2.5.3). */}
      <span className="sr-only">
        {`${dayTitle(day.date, locale)}${day.count > 0 ? `, ${m.overview_calendar_count({ count: day.count })}` : ''}`}
      </span>
      <span className="flex items-center justify-between gap-1">
        <span className={`text-[12px] font-medium ${day.future ? 'text-subtle' : 'text-fg'}`}>
          {Number(day.date.slice(8))}
        </span>
        {isToday ? (
          <span className="rounded-[4px] bg-blue px-1 text-[9.5px] font-medium text-on-accent">
            {m.overview_calendar_today()}
          </span>
        ) : null}
      </span>
      {day.future ? (
        first === undefined ? null : (
          <span className="flex min-w-0 items-center gap-1 text-[10.5px] text-muted-fg">
            <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-red" />
            <span className="truncate">
              {first.name ?? m.overview_calendar_bill()}
              {rest.length > 0 ? ` +${String(rest.length)}` : ''}
            </span>
          </span>
        )
      ) : (
        // ↑ in and ↓ out on their own lines, also on a surplus day (its spending used to hide in the net). The
        // figures stay in the text colour: green or red text falls below 4.5:1 on the heat cells.
        <span className="flex min-w-0 flex-col gap-0.5 text-[11.5px] max-lg:text-[10px] max-lg:tracking-[-0.03em]">
          {day.inMinor > 0n ? (
            <span className="flex min-w-0 items-center gap-0.5">
              <ArrowUp aria-label={m.calendar_tip_in()} className="size-2.5 shrink-0 text-green-fg max-lg:hidden" />
              <Money
                minor={day.inMinor}
                currency={currency}
                context="table"
                locale={locale}
                className="truncate !text-left text-fg"
              />
            </span>
          ) : null}
          {day.outMinor > 0n ? (
            <span className="flex min-w-0 items-center gap-0.5">
              <ArrowDown aria-label={m.calendar_tip_out()} className="size-2.5 shrink-0 text-red-fg max-lg:hidden" />
              <Money
                minor={day.outMinor}
                currency={currency}
                context="table"
                locale={locale}
                className="truncate !text-left text-fg"
              />
            </span>
          ) : null}
        </span>
      )}
    </button>
  );
}

interface DayBreakdownProps {
  readonly date: LocalDate;
  readonly breakdown: Breakdown | undefined;
  readonly day: CalendarDay;
  readonly costliest: boolean;
  readonly averageMinor: bigint;
  readonly scope: Dashboard['scope'];
  readonly bills: readonly ScheduledItem[];
  readonly byId: ReadonlyMap<string, CategoryView>;
  readonly currency: string;
  readonly locale: Locale;
  readonly timeZone: string;
}

/** The chosen day: its totals, how it compares, and its transactions (or the bills due on it). */
function DayBreakdown({
  date,
  breakdown,
  day,
  costliest,
  averageMinor,
  scope,
  bills,
  byId,
  currency,
  locale,
  timeZone,
}: DayBreakdownProps) {
  const times = averageMinor > 0n ? Number(day.outMinor) / Number(averageMinor) : 0;
  const ready = breakdown?.status === 'ready' ? breakdown : null;
  return (
    <div aria-live="polite" className="flex h-full flex-col rounded-[10px] border border-border">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
        <h3 className="text-[13px] font-semibold text-fg">{dayTitle(date, locale)}</h3>
        <span className="text-[12px] text-subtle">{m.overview_calendar_count({ count: day.count })}</span>
        <span className="ml-auto flex items-center gap-2">
          {day.inMinor > 0n ? (
            <span className="flex items-center gap-0.5 text-[13px] font-medium text-green-fg">
              <ArrowUp aria-label={m.calendar_tip_in()} className="size-3.5 shrink-0" />
              <Money minor={day.inMinor} currency={currency} context="amount" locale={locale} />
            </span>
          ) : null}
          {day.outMinor > 0n ? (
            <span className="flex items-center gap-0.5 text-[13px] font-medium text-red-fg">
              <ArrowDown aria-label={m.calendar_tip_out()} className="size-3.5 shrink-0" />
              <Money minor={day.outMinor} currency={currency} context="amount" locale={locale} />
            </span>
          ) : null}
          {costliest ? (
            <span className="rounded-[4px] bg-amber-tint-2 px-1.5 py-px text-[11px] text-amber-fg">
              {scope === 'week' ? m.overview_calendar_costliest_week() : m.overview_calendar_costliest()}
            </span>
          ) : times >= 2 ? (
            <span className="rounded-[4px] bg-red-tint-2 px-1.5 py-px text-[11px] text-red-fg">
              {m.overview_calendar_times_average({ times: formatNumber(Math.round(times), locale) })}
            </span>
          ) : null}
        </span>
      </div>
      {day.future ? (
        <ul className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          {bills.length === 0 ? (
            <li className="px-4 py-3 text-[12.5px] text-subtle">{m.overview_calendar_nothing_due()}</li>
          ) : (
            bills.map((bill) => (
              <li key={`${bill.sourceId}-${bill.dueDate}`} className="flex items-center gap-3 px-4 py-3 text-[13px]">
                <span aria-hidden="true" className="size-1.5 rounded-full bg-red" />
                <span className="flex-1 text-fg">{bill.name ?? m.overview_calendar_bill()}</span>
                <Money
                  minor={-bill.expectedMinor}
                  currency={bill.currency}
                  context="amount"
                  locale={locale}
                  className="text-fg"
                />
              </li>
            ))
          )}
        </ul>
      ) : breakdown === undefined ? (
        <p role="status" className="px-4 py-3 text-[12.5px] text-subtle">
          {m.overview_calendar_loading()}
        </p>
      ) : ready === null ? (
        <p className="px-4 py-3 text-[12.5px] text-red-fg">{m.overview_calendar_failed()}</p>
      ) : ready.rows.length === 0 ? (
        <p className="px-4 py-3 text-[12.5px] text-subtle">{m.overview_calendar_no_transactions()}</p>
      ) : (
        <ul className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          {ready.rows.map((row) => {
            const category = row.categoryId === null ? undefined : byId.get(row.categoryId);
            return (
              <li key={row.id} className="border-b border-border last:border-b-0">
                <Link
                  to="/transactions"
                  search={{ range: rangeParamOf(date, date), tx: row.id }}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-tint-04 focus-visible:outline-2 focus-visible:outline-ring"
                >
                  {row.type === 'transfer' || category === undefined ? (
                    <span className="flex size-7 items-center justify-center rounded-[7px] bg-tint-06 text-muted-fg">
                      <ArrowLeftRight aria-hidden="true" className="size-3.5" />
                    </span>
                  ) : (
                    <CategoryIcon icon={category.icon} color={category.color} />
                  )}
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate text-[13px] text-fg">
                      {[row.merchant, row.description].filter((part) => part !== null && part !== '').join(' — ') ||
                        (category === undefined ? m.overview_flow_uncategorized() : categoryName(category))}
                    </span>
                    {/* Category and time under the title, so a row fits the side column too. */}
                    <span className="truncate text-[11.5px] text-subtle">
                      {row.type === 'transfer'
                        ? m.record_type_transfer()
                        : category === undefined
                          ? m.overview_flow_uncategorized()
                          : categoryName(category)}
                      {' · '}
                      <span className="font-mono">{formatTime(row.occurredAt, timeZone, locale)}</span>
                    </span>
                    {row.tags.length === 0 ? null : (
                      <span className="flex flex-wrap gap-1">
                        {row.tags.map((tag) => (
                          <span
                            key={tag}
                            className="rounded-[4px] border border-border px-1 font-mono text-[10.5px] text-subtle"
                          >
                            #{tag}
                          </span>
                        ))}
                      </span>
                    )}
                  </span>
                  <span className="flex shrink-0 justify-end text-right text-[13px]">
                    <RowAmount row={row} locale={locale} baseCurrency={currency} />
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

interface YearViewProps {
  readonly dashboard: Dashboard;
  readonly periodLabels: readonly YearMonth[];
  readonly locale: Locale;
}

/** Twelve mini months (design `g9BK2` "Kalender 2026") and the year's insights. */
function YearView({ dashboard, periodLabels, locale }: YearViewProps) {
  const { ranges, today, calendar } = dashboard;
  const currency = dashboard.baseCurrency;
  const months = calendarMonths(ranges.full, calendar.days, today);
  const costliest = costliestDay(calendar.days);
  const cheapest = cheapestMonth(months, today);
  const ratio = weekendRatio(ranges.current, calendar.days, today);
  return (
    <>
      <ul className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {months.map((month) => {
          const current = month.label === today.slice(0, 7);
          const body = <MiniMonth month={month} current={current} baseCurrency={currency} locale={locale} />;
          const shared = {
            'aria-current': current ? ('date' as const) : undefined,
            'data-future': month.future ? 'true' : undefined,
          };
          return (
            <li key={month.label}>
              {periodLabels.includes(month.label) ? (
                <Link
                  to="/"
                  search={{ period: month.label }}
                  {...shared}
                  className={`${MINI_MONTH_CARD} ${MINI_MONTH_LINK}`}
                >
                  {body}
                </Link>
              ) : (
                <div {...shared} className={MINI_MONTH_CARD}>
                  {body}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <dl className="grid grid-cols-2 gap-4 border-t border-border pt-4 md:grid-cols-3">
        <div className="flex flex-col gap-1">
          <dt className="text-[11.5px] text-subtle">{m.overview_calendar_costliest_day()}</dt>
          <dd className="text-[13px] font-medium text-fg">
            {costliest === null ? (
              '—'
            ) : (
              <>
                {dayTitle(costliest.date, locale)} ·{' '}
                <Money minor={costliest.outMinor} currency={currency} context="amount" locale={locale} />
              </>
            )}
          </dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className="text-[11.5px] text-subtle">{m.overview_calendar_cheapest_month()}</dt>
          <dd className="text-[13px] font-medium text-fg">
            {cheapest === null ? (
              '—'
            ) : (
              <>
                {monthName(cheapest.label, locale, 'long')} ·{' '}
                <Money minor={cheapest.outMinor} currency={currency} context="amount" locale={locale} />
              </>
            )}
          </dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className="text-[11.5px] text-subtle">{m.overview_calendar_weekend()}</dt>
          <dd className="text-[13px] font-medium text-fg">
            {ratio === null
              ? '—'
              : m.overview_calendar_weekend_value({
                  times: formatNumber(ratio, locale, { maximumFractionDigits: 1 }),
                })}
          </dd>
        </div>
      </dl>
    </>
  );
}
