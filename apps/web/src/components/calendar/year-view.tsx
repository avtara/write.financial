// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The calendar's year (FR-C1, design `Ncucu`, `cQI15`): "Keluar", "Masuk", "Ditabung" with the share of income,
 * "Bulan termahal" and "Hari termahal"; twelve mini heatmaps (each opens its month; surplus days green, months to
 * come dimmed); and "Tren bulanan": income vs spending per month with the share saved.
 */
import { Link } from '@tanstack/react-router';
import type { DayGroup } from '@wf/db/transaction-query';
import type { LocalDate } from '@wf/domain/period';
import type { Locale } from '@wf/i18n/locale';
import { m } from '@wf/i18n/messages';
import { formatDate, weekdayNames } from '@wf/ui/dates';
import { Money } from '@wf/ui/money';
import { Percent } from '@wf/ui/percent';
import { calendarMonths, costliestDay } from '../dashboard/calendar-model.ts';
import { RichMessage } from '../rich-message.tsx';
import { SignedMoney } from '../transactions/transaction-row.tsx';
import { calendarSearch } from './calendar-header.tsx';
import { Kpi, KpiStrip } from './calendar-kpi.tsx';
import { yearMonths } from './calendar-model.ts';

const HEAT: readonly string[] = ['fill-surface-3', 'fill-red-tint-2', 'fill-red-tint-3', 'fill-red-tint-4', 'fill-red'];

export interface YearViewProps {
  readonly year: number;
  readonly days: readonly DayGroup[];
  readonly today: LocalDate;
  readonly baseCurrency: string;
  readonly locale: Locale;
}

export function YearView({ year, days, today, baseCurrency, locale }: YearViewProps) {
  const months = yearMonths(year, days, today);
  const grids = calendarMonths(
    { from: `${String(year)}-01-01` as LocalDate, to: `${String(year)}-12-31` as LocalDate },
    days,
    today,
  );
  const inMinor = months.reduce((total, month) => total + month.inMinor, 0n);
  const outMinor = months.reduce((total, month) => total + month.outMinor, 0n);
  const counted = months.filter((month) => !month.future && month.outMinor > 0n);
  const costliestMonth = counted.toSorted((a, b) => Number(b.outMinor - a.outMinor))[0];
  // Paydays are surplus days, not costly ones.
  const costliest = costliestDay(days.filter((day) => day.inMinor <= day.outMinor));
  const monthName = (month: string, style: 'long' | 'short') =>
    new Intl.DateTimeFormat(locale, { month: style, timeZone: 'UTC' }).format(new Date(`${month}-01T00:00:00Z`));
  const money = (minor: bigint) => <Money minor={minor} currency={baseCurrency} context="amount" locale={locale} />;
  const average = counted.length === 0 ? null : money(outMinor / BigInt(counted.length));
  const saved = money(inMinor - outMinor);
  const savedShare = inMinor === 0n ? null : Number(inMinor - outMinor) / Number(inMinor);
  const costliestMonthAmount = costliestMonth === undefined ? null : money(costliestMonth.outMinor);
  const costliestDayAmount = costliest === null ? null : money(costliest.outMinor);
  const highest = months.reduce(
    (max, month) => [month.inMinor, month.outMinor, max].reduce((a, b) => (a > b ? a : b)),
    1n,
  );
  const bar = (value: bigint) => Math.max(value === 0n ? 0 : 2, (Number(value) / Number(highest)) * 100);
  const trend = months.map((month) => ({ month, in: bar(month.inMinor), out: bar(month.outMinor) }));
  const initials = weekdayNames(locale, 1).map((name) => name.short.slice(0, 1));

  return (
    <div className="flex flex-col gap-4">
      <KpiStrip columns={5}>
        <Kpi
          label={m.calendar_year_out({ year })}
          value={<SignedMoney amountMinor={-outMinor} currency={baseCurrency} locale={locale} />}
          note={
            <>
              {average === null ? null : <RichMessage message={m.calendar_year_average} slots={{ amount: average }} />}
            </>
          }
        />
        <Kpi
          label={m.calendar_year_in({ year })}
          value={<SignedMoney amountMinor={inMinor} currency={baseCurrency} locale={locale} />}
        />
        <Kpi
          label={m.calendar_year_saved()}
          value={saved}
          note={
            <>
              {savedShare === null ? null : (
                <>
                  <Percent value={savedShare} locale={locale} /> {m.calendar_year_of_income()}
                </>
              )}
            </>
          }
        />
        <Kpi
          label={m.calendar_year_costliest_month()}
          value={costliestMonth === undefined ? '—' : monthName(costliestMonth.month, 'long')}
          note={<>{costliestMonthAmount}</>}
        />
        <Kpi
          label={m.calendar_year_costliest_day()}
          value={costliest === null ? '—' : formatDate(costliest.date, locale, 'day')}
          note={<>{costliestDayAmount}</>}
        />
      </KpiStrip>

      <ol
        aria-label={m.calendar_year_months({ year })}
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
      >
        {grids.map((grid, index) => {
          const totals = months[index];
          const current = totals?.current === true;
          return (
            <li key={grid.label}>
              <Link
                to="/calendar"
                search={calendarSearch('month', `${grid.label}-01` as LocalDate, today)}
                data-future={grid.future ? 'true' : undefined}
                aria-current={current ? 'date' : undefined}
                className="flex flex-col gap-2 rounded-[12px] border border-border bg-card p-4 hover:border-border-strong focus-visible:outline-2 focus-visible:outline-ring aria-[current=date]:border-fg data-[future=true]:opacity-60"
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 text-[13.5px] font-semibold text-fg">
                    {monthName(grid.label, 'long')}
                    {current ? (
                      <span className="rounded-[4px] bg-blue px-1 text-[9.5px] font-normal text-on-accent">
                        {m.calendar_year_running()}
                      </span>
                    ) : null}
                  </span>
                  {grid.future || grid.outMinor === 0n ? (
                    <span className="font-mono text-[11.5px] text-subtle">—</span>
                  ) : (
                    <SignedMoney
                      amountMinor={-grid.outMinor}
                      currency={baseCurrency}
                      locale={locale}
                      className="text-[11.5px] text-subtle"
                    />
                  )}
                </span>
                <span aria-hidden="true" className="grid grid-cols-7 text-center text-[9.5px] text-subtle">
                  {initials.map((initial, column) => (
                    <span key={column}>{initial}</span>
                  ))}
                </span>
                <svg aria-hidden="true" viewBox={`0 0 70 ${String(grid.weeks.length * 10)}`} className="block w-full">
                  {grid.weeks.flatMap((week, row) =>
                    week.map((day, column) =>
                      day.inRange ? (
                        <rect
                          key={day.date}
                          x={column * 10 + 0.75}
                          y={row * 10 + 0.75}
                          width="8.5"
                          height="8.5"
                          rx="1.5"
                          className={day.surplus ? 'fill-green' : day.future ? 'fill-surface-2' : HEAT[day.heat]}
                        />
                      ) : null,
                    ),
                  )}
                </svg>
              </Link>
            </li>
          );
        })}
      </ol>

      <section
        aria-labelledby="calendar-trend"
        className="flex flex-col gap-4 rounded-[12px] border border-border bg-card p-5"
      >
        <header className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex flex-col gap-0.5">
            <h2 id="calendar-trend" className="text-[15px] font-semibold text-fg">
              {m.calendar_year_trend({ year })}
            </h2>
            <p className="text-[12px] text-subtle">{m.calendar_year_trend_caption()}</p>
          </div>
          <ul className="flex gap-3 text-[11.5px] text-muted-fg">
            <li className="flex items-center gap-1.5">
              <span aria-hidden="true" className="size-2 rounded-[2px] bg-surface-5" />
              {m.calendar_layer_income()}
            </li>
            <li className="flex items-center gap-1.5">
              <span aria-hidden="true" className="size-2 rounded-[2px] bg-red" />
              {m.calendar_layer_spending()}
            </li>
          </ul>
        </header>
        <ol className="grid grid-cols-12 items-end gap-1.5">
          {trend.map(({ month, in: received, out: spent }) => (
            <li key={month.month} className="flex min-w-0 flex-col items-center gap-1">
              <svg
                aria-hidden="true"
                viewBox="0 0 20 100"
                preserveAspectRatio="none"
                className="block h-[120px] w-full"
              >
                <rect x="1" y={100 - received} width="8" height={received} className="fill-surface-5" />
                <rect x="11" y={100 - spent} width="8" height={spent} className="fill-red" />
              </svg>
              <span className={`text-[11px] ${month.current ? 'font-semibold text-fg' : 'text-subtle'}`}>
                {monthName(month.month, 'short')}
              </span>
              <span className="font-mono text-[10.5px] text-subtle">
                {month.savedRatio === null || month.future ? '—' : <Percent value={month.savedRatio} locale={locale} />}
              </span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
