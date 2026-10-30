// SPDX-License-Identifier: AGPL-3.0-only
/**
 * One month of a year's heatmap (design `Ncucu`): its name ("Oktober · berjalan"), what it spent, the weekday
 * initials, and a tile per day — red by how much went out, green where more came in, dimmed ahead. The Calendar page
 * and the Overview's calendar card both draw their year with it; each wraps it in its own link.
 */
import type { Locale } from '@wf/i18n/locale';
import { m } from '@wf/i18n/messages';
import { weekdayNames } from '@wf/ui/dates';
import type { CalendarMonth } from '../dashboard/calendar-model.ts';
import { SignedMoney } from '../transactions/transaction-row.tsx';

/** Day tiles by heat level (0 = nothing spent … 4 = the costliest days). */
const HEAT: readonly string[] = ['fill-surface-3', 'fill-red-tint-2', 'fill-red-tint-3', 'fill-red-tint-4', 'fill-red'];

/** The same colours as swatches, for a legend under the months. */
export const MINI_MONTH_SWATCH = {
  heat: ['bg-surface-3', 'bg-red-tint-2', 'bg-red-tint-3', 'bg-red-tint-4', 'bg-red'] as readonly string[],
  surplus: 'bg-green',
};

/** The card around a month; `aria-current="date"` outlines the running one, `data-future` dims it. */
export const MINI_MONTH_CARD =
  'flex h-full flex-col gap-2 rounded-[12px] border border-border bg-card p-4 aria-[current=date]:border-fg data-[future=true]:opacity-60';

/** Hover and focus for a month that links somewhere. */
export const MINI_MONTH_LINK = 'hover:border-border-strong focus-visible:outline-2 focus-visible:outline-ring';

export interface MiniMonthProps {
  readonly month: CalendarMonth;
  /** The month today is in ("berjalan"). */
  readonly current: boolean;
  readonly baseCurrency: string;
  readonly locale: Locale;
}

/** The inside of a month card; wrap it in a link or a `div` with {@link MINI_MONTH_CARD}. */
export function MiniMonth({ month, current, baseCurrency, locale }: MiniMonthProps) {
  const name = new Intl.DateTimeFormat(locale, { month: 'long', timeZone: 'UTC' }).format(
    new Date(`${month.label}-01T00:00:00Z`),
  );
  const initials = weekdayNames(locale, 1).map((weekday) => weekday.short.slice(0, 1));
  return (
    <>
      <span className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[13.5px] font-semibold text-fg">
          {name}
          {current ? (
            <span className="rounded-[4px] bg-blue px-1 text-[9.5px] font-normal text-on-accent">
              {m.calendar_year_running()}
            </span>
          ) : null}
        </span>
        {month.future || month.outMinor === 0n ? (
          <span className="font-mono text-[11.5px] text-subtle">—</span>
        ) : (
          <SignedMoney
            amountMinor={-month.outMinor}
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
      <svg aria-hidden="true" viewBox={`0 0 70 ${String(month.weeks.length * 10)}`} className="block w-full">
        {month.weeks.flatMap((week, row) =>
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
    </>
  );
}
