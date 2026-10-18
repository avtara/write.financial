// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Locale-aware display formatting (PRD §7.1, §9 i18n). Money formatting lives in `@wf/domain/money`
 * and is re-exported unchanged, so UI code has one import for every formatter.
 */
import { MINUS } from '@wf/domain/money';
import type { Locale } from './locale.ts';

export { formatMoney, MINUS } from '@wf/domain/money';
export type { FormatMoneyOptions, MoneyContext } from '@wf/domain/money';

/** `en` follows US conventions, matching `@wf/domain/money`: `42,810,000`, `Sep 25, 2026`. */
const INTL_LOCALE: Readonly<Record<Locale, string>> = { id: 'id-ID', en: 'en-US' };

export interface FormatNumberOptions {
  /** Default 0. */
  minimumFractionDigits?: number;
  /** Default 3 for numbers, 1 for percentages. */
  maximumFractionDigits?: number;
  /** Show `+` for positive values as well (flows, differences). Zero is never signed. */
  signed?: boolean;
}

/** Formats with `Intl`, using U+2212 instead of a hyphen for the minus sign (PRD §7.1). */
function formatWith(value: number, locale: Locale, options: Intl.NumberFormatOptions): string {
  if (!Number.isFinite(value)) throw new RangeError(`Cannot format a non-finite number: ${value}`);
  return new Intl.NumberFormat(INTL_LOCALE[locale], options)
    .formatToParts(value)
    .map((part) => (part.type === 'minusSign' ? MINUS : part.value))
    .join('');
}

/** `1234567.5` → `1.234.567,5` (id) / `1,234,567.5` (en). Negative values use U+2212. */
export function formatNumber(value: number, locale: Locale, options: FormatNumberOptions = {}): string {
  const { minimumFractionDigits, maximumFractionDigits, signed = false } = options;
  return formatWith(value, locale, {
    minimumFractionDigits,
    maximumFractionDigits,
    signDisplay: signed ? 'exceptZero' : 'negative',
  });
}

/**
 * Formats a ratio as a percentage (PRD §7.1): `0.365` → `36,5%` (id) / `36.5%` (en);
 * whole values drop the decimals: `0.87` → `87%`.
 */
export function formatPercent(ratio: number, locale: Locale, options: FormatNumberOptions = {}): string {
  const { minimumFractionDigits = 0, maximumFractionDigits = 1, signed = false } = options;
  return formatWith(ratio, locale, {
    style: 'percent',
    minimumFractionDigits,
    maximumFractionDigits,
    signDisplay: signed ? 'exceptZero' : 'negative',
  });
}

export interface FormatDateOptions {
  /** Default `true`. Leave it out where the context makes it obvious: `25 Sep – 24 Okt`. */
  year?: boolean;
  /**
   * IANA time zone to show the date in. Default `UTC`, which is right for calendar dates
   * (`LocalDate` → `new Date(`${date}T00:00:00Z`)`); pass the user's zone for instants.
   */
  timeZone?: string;
}

function dateFormat(locale: Locale, options: FormatDateOptions): Intl.DateTimeFormat {
  const { year = true, timeZone = 'UTC' } = options;
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], {
    day: 'numeric',
    month: 'short',
    year: year ? 'numeric' : undefined,
    timeZone,
  });
}

/** `25 Okt 2026` (id) / `Oct 25, 2026` (en). */
export function formatDate(date: Date, locale: Locale, options: FormatDateOptions = {}): string {
  return dateFormat(locale, options).format(date);
}

/**
 * Formats an inclusive date range the way the design writes it: `25 Sep – 24 Okt 2026`,
 * `1–31 Okt 2026`, `25 Nov 2026 – 25 Okt 2027` (id); `Sep 25 – Oct 24, 2026` (en).
 * ICU puts thin spaces around the dash; the design uses normal spaces.
 */
export function formatDateRange(start: Date, end: Date, locale: Locale, options: FormatDateOptions = {}): string {
  if (end.getTime() < start.getTime()) {
    throw new RangeError(`Date range ends before it starts: ${start.toISOString()} – ${end.toISOString()}`);
  }
  return dateFormat(locale, options)
    .formatRange(start, end)
    .replace(/[\u2009\u202f]/g, ' ');
}
