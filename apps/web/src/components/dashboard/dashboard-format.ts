// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The Overview's words around the numbers (FR-D1): the greeting by the time of day, what the page summarises
 * ("Ini ringkasan uangmu periode 1–15 Oktober 2026."), the period button ("Okt 2026", "12–18 Okt", "2026"), and the
 * like-for-like comparison under each KPI ("vs Sep", "vs Sen–Kam lalu", "vs 2025").
 */
import type { Dashboard } from '@wf/db/dashboard';
import type { DateRange } from '@wf/domain/dashboard';
import type { LocalDate, YearMonth } from '@wf/domain/period';
import type { Locale } from '@wf/i18n/locale';
import { m } from '@wf/i18n/messages';

const INTL_LOCALE: Readonly<Record<Locale, string>> = { id: 'id-ID', en: 'en-US' };

/** A calendar date at UTC midnight, for `Intl` with `timeZone: 'UTC'`. */
const utc = (date: LocalDate): Date => new Date(`${date}T00:00:00Z`);

/** `formatRange` with the design's plain spaces around the dash (ICU uses thin ones). */
function range(from: LocalDate, to: LocalDate, locale: Locale, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], { ...options, timeZone: 'UTC' })
    .formatRange(utc(from), utc(to))
    .replace(/[\u2009\u202f]/g, ' ');
}

/** "Selamat pagi" 04.00–10.59, "siang" 11.00–14.59, "sore" 15.00–17.59, "malam" from 18.00. */
export function greeting(now: Date, timeZone: string, name: string): string {
  const hour = Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone }).format(now));
  if (hour >= 4 && hour < 11) return m.overview_greeting_morning({ name });
  if (hour >= 11 && hour < 15) return m.overview_greeting_midday({ name });
  if (hour >= 15 && hour < 18) return m.overview_greeting_afternoon({ name });
  return m.overview_greeting_evening({ name });
}

/** `1–15 Oktober 2026` / `October 1 – 15, 2026`. */
export function longRange({ from, to }: DateRange, locale: Locale): string {
  return range(from, to, locale, { day: 'numeric', month: 'long', year: 'numeric' });
}

/** `14 Sep – 13 Okt` (the year only outside `today`'s). */
export function shortRange({ from, to }: DateRange, locale: Locale, today: LocalDate): string {
  const year = from.startsWith(today.slice(0, 4)) && to.startsWith(today.slice(0, 4)) ? undefined : 'numeric';
  return range(from, to, locale, { day: 'numeric', month: 'short', ...(year === undefined ? {} : { year }) });
}

/** `Okt 2026` for a period label. */
export function periodLabel(label: YearMonth, locale: Locale): string {
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(
    utc(`${label}-01` as LocalDate),
  );
}

/** `Okt` / `Oktober` for a period label. */
export function monthName(label: YearMonth, locale: Locale, width: 'short' | 'long' = 'short'): string {
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], { month: width, timeZone: 'UTC' }).format(
    utc(`${label}-01` as LocalDate),
  );
}

/** `Rab` / `Wed`. */
export function weekdayName(date: LocalDate, locale: Locale): string {
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], { weekday: 'short', timeZone: 'UTC' }).format(utc(date));
}

/** `Rabu, 14 Oktober` / `Wednesday, October 14`. */
export function dayTitle(date: LocalDate, locale: Locale): string {
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(utc(date));
}

/** The header's sentence under the greeting. */
export function summaryLine(dashboard: Dashboard, locale: Locale): string {
  const { ranges, summary } = dashboard;
  switch (dashboard.scope) {
    case 'week':
      return m.overview_summary_week({ range: longRange(ranges.full, locale) });
    case 'year':
      return m.overview_summary_year({
        year: ranges.full.from.slice(0, 4),
        months: range(ranges.current.from, ranges.current.to, locale, { month: 'long' }),
      });
    case 'range':
      return m.overview_summary_range({
        range: longRange(ranges.full, locale),
        days: summary.days,
        periods: summary.periodCount,
      });
    case 'month':
      return m.overview_summary_month({ range: longRange(ranges.current, locale) });
  }
}

/** What the period button reads: `Okt 2026`, `12–18 Okt`, `2026` (a range has the range picker instead). */
export function periodButtonLabel(dashboard: Dashboard, locale: Locale): string {
  if (dashboard.scope === 'year') return dashboard.ranges.full.from.slice(0, 4);
  if (dashboard.scope === 'month' && dashboard.period !== null) return periodLabel(dashboard.period.label, locale);
  return shortRange(dashboard.ranges.full, locale, dashboard.today);
}

/**
 * FR-D1 "vs …" under the KPIs: the previous period's month ("vs Sep"), last week's same days ("vs Sen–Kam lalu",
 * "vs mgg lalu" once the week is complete), last year ("vs 2025"), or the days before a range ("vs 15 Agu – 13 Sep").
 */
export function comparisonLabel(dashboard: Dashboard, locale: Locale): string {
  const { previous, current, full } = dashboard.ranges;
  switch (dashboard.scope) {
    case 'month':
      return m.overview_vs({ what: monthName(previous.to.slice(0, 7) as YearMonth, locale) });
    case 'week':
      return current.to === full.to
        ? m.overview_vs_last_week()
        : m.overview_vs_last_days({
            from: weekdayName(previous.from, locale),
            to: weekdayName(previous.to, locale),
          });
    case 'year':
      return m.overview_vs({ what: previous.from.slice(0, 4) });
    case 'range':
      return m.overview_vs({ what: shortRange(previous, locale, dashboard.today) });
  }
}

/** After a flow: "bulan ini" / "minggu ini" / "tahun ini", "di Sep" / "di 2025" for past ones, "di rentang ini". */
export function scopeSuffix(dashboard: Dashboard, locale: Locale): string {
  const { full } = dashboard.ranges;
  const now = full.from <= dashboard.today && dashboard.today <= full.to;
  switch (dashboard.scope) {
    case 'week':
      return m.overview_this_week();
    case 'year':
      return now ? m.overview_this_year() : m.overview_in({ what: full.from.slice(0, 4) });
    case 'range':
      return m.overview_in_range();
    case 'month':
      return now
        ? m.overview_this_month()
        : m.overview_in({ what: monthName(full.to.slice(0, 7) as YearMonth, locale) });
  }
}
