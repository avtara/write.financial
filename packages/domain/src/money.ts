// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Money formatting and parsing (PRD §7.1).
 *
 * Amounts are always integers in the currency's minor unit (`bigint`).
 * No floating point is used anywhere on this path.
 */

export type Locale = 'id' | 'en';

/**
 * - `table`: ledger/table cells, no currency symbol, minus sign only when negative.
 * - `amount`: headline figures and sentences, with currency symbol.
 * - `delta`: flows and differences, always signed (+/−), no currency symbol.
 */
export type MoneyContext = 'table' | 'amount' | 'delta';

export interface FormatMoneyOptions {
  locale: Locale;
  context: MoneyContext;
  /** Privacy mode: replace the digits with six dots. */
  privacy?: boolean;
}

export interface CurrencyInfo {
  code: string;
  symbol: string;
  minorDigits: number;
}

/** U+2212 MINUS SIGN, required instead of a hyphen (PRD §7.1). */
export const MINUS = '\u2212';
const PRIVACY_MASK = '••••••';

const KNOWN_CURRENCIES: Readonly<Record<string, CurrencyInfo>> = {
  IDR: { code: 'IDR', symbol: 'Rp', minorDigits: 0 },
  USD: { code: 'USD', symbol: 'US$', minorDigits: 2 },
  SGD: { code: 'SGD', symbol: 'S$', minorDigits: 2 },
  EUR: { code: 'EUR', symbol: '€', minorDigits: 2 },
};

const SEPARATORS: Readonly<Record<Locale, { group: string; decimal: string }>> = {
  id: { group: '.', decimal: ',' },
  en: { group: ',', decimal: '.' },
};

/** Returns display information for an ISO 4217 currency code. */
export function currencyInfo(code: string): CurrencyInfo {
  const upper = code.toUpperCase();
  const known = KNOWN_CURRENCIES[upper];
  if (known) return known;
  if (!/^[A-Z]{3}$/.test(upper)) {
    throw new RangeError(`Invalid currency code: ${code}`);
  }
  const { maximumFractionDigits } = new Intl.NumberFormat('en', {
    style: 'currency',
    currency: upper,
  }).resolvedOptions();
  // `maximumFractionDigits` is always resolved for `style: 'currency'`; the lib type is just wider.
  return { code: upper, symbol: `${upper} `, minorDigits: maximumFractionDigits as number };
}

function formatUnsigned(abs: bigint, minorDigits: number, locale: Locale): string {
  const { group, decimal } = SEPARATORS[locale];
  const raw = abs.toString().padStart(minorDigits + 1, '0');
  // Insert the group separator before every block of three digits counted from the right.
  const grouped = raw.slice(0, raw.length - minorDigits).replace(/\B(?=(\d{3})+(?!\d))/g, group);
  if (minorDigits === 0) return grouped;
  return `${grouped}${decimal}${raw.slice(raw.length - minorDigits)}`;
}

/** Formats an amount in minor units according to PRD §7.1. */
export function formatMoney(minor: bigint, currency: string, options: FormatMoneyOptions): string {
  const info = currencyInfo(currency);
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  const digits = options.privacy ? PRIVACY_MASK : formatUnsigned(abs, info.minorDigits, options.locale);

  switch (options.context) {
    case 'table':
      return negative && !options.privacy ? `${MINUS}${digits}` : digits;
    case 'amount':
      return `${negative && !options.privacy ? MINUS : ''}${info.symbol}${digits}`;
    case 'delta':
      if (options.privacy) return digits;
      return `${negative ? MINUS : '+'}${digits}`;
  }
}

const MULTIPLIERS: Readonly<Record<Locale, Readonly<Record<string, number>>>> = {
  id: { rb: 3, ribu: 3, k: 3, jt: 6, juta: 6, m: 9, miliar: 9 },
  en: { k: 3, m: 6, mn: 6, b: 9, bn: 9 },
};

export interface ParseMoneyOptions {
  locale: Locale;
  currency: string;
}

/**
 * Parses user input such as "25rb", "1,5jt", "25k", "1.5m", "Rp 1.234.567"
 * into minor units. Returns `null` for anything that is not an exact amount
 * in the given currency (for example too many decimals).
 */
export function parseMoneyInput(input: string, options: ParseMoneyOptions): bigint | null {
  const info = currencyInfo(options.currency);
  const { group, decimal } = SEPARATORS[options.locale];

  let text = input.toLowerCase().replace(/\s/g, '');
  let negative = false;
  if (text.startsWith('-') || text.startsWith(MINUS)) {
    negative = true;
    text = text.slice(1);
  }
  // For currencies without a design symbol the symbol is the code itself, so removing the code covers it.
  text = text.replace(info.symbol.toLowerCase(), '').replace(info.code.toLowerCase(), '');

  // Both groups always participate in a match (group 2 may be empty), hence the tuple cast.
  const match = /^([\d.,]+)([a-z]*)$/.exec(text) as [string, string, string] | null;
  if (!match) return null;
  const [, numberPart, suffix] = match;

  const shift = suffix === '' ? 0 : MULTIPLIERS[options.locale][suffix];
  if (shift === undefined) return null;
  // Both separators are punctuation, so a backslash escape is always valid in a non-unicode RegExp.
  const g = `\\${group}`;
  const d = `\\${decimal}`;
  // Canonical form for the locale: optional groups of three, optional decimal part.
  const canonical = new RegExp(`^(\\d{1,3}(?:${g}\\d{3})+|\\d+)(?:${d}(\\d+))?$`).exec(numberPart);
  // Friendly form: a single group separator not followed by exactly three digits is read as the decimal
  // point (for example "1.5jt" typed with an Indonesian locale, or "1,5m" with English).
  const friendly = canonical ? null : new RegExp(`^(\\d+)${g}(\\d{1,2}|\\d{4,})$`).exec(numberPart);
  const parsed = canonical ?? friendly;
  if (!parsed) return null;
  // Group 1 (integer digits) is mandatory in both patterns; group 2 (fraction) is optional.
  const [, integerRaw, fractionDigits = ''] = parsed as unknown as [string, string, string?];
  const integerDigits = integerRaw.split(group).join('');
  const totalShift = shift + info.minorDigits;
  // Extra fraction digits are only allowed when they are zeros ("1,2300" USD is 1.23).
  if (/[^0]/.test(fractionDigits.slice(totalShift))) return null;
  const scaledFraction = fractionDigits.slice(0, totalShift).padEnd(totalShift, '0');
  const value = BigInt(`${integerDigits}${scaledFraction}`);
  return negative ? -value : value;
}

/** Non-negative `numerator ÷ denominator` (denominator > 0) rounded half up. */
export function divideHalfUp(numerator: bigint, denominator: bigint): bigint {
  return (numerator * 2n + denominator) / (denominator * 2n);
}

/** Non-negative `numerator ÷ denominator` (denominator > 0) rounded up. */
export function divideCeil(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator - 1n) / denominator;
}

/**
 * `totalMinor` in `count` (≥ 1) equal parts, the rounding remainder in the first one (1.000.000 / 3 → 333.334,
 * 333.333, 333.333: FR-U3 installments, FR-L5 "Sama rata").
 */
export function splitEvenly(totalMinor: bigint, count: number): bigint[] {
  const base = totalMinor / BigInt(count);
  return Array.from({ length: count }, (_, index) => (index === 0 ? totalMinor - base * BigInt(count - 1) : base));
}

/**
 * `total` (any sign) split by `weightsBps` (Σ = 10 000) with the largest remainder, ties to the earlier weight; the
 * parts add up to `total` exactly (goal shares of an asset FR-G2, rebalancing targets FR-I3).
 */
export function splitByBps(total: bigint, weightsBps: readonly number[]): bigint[] {
  const magnitude = total < 0n ? -total : total;
  const parts = weightsBps.map((weight) => {
    const exact = magnitude * BigInt(weight);
    return { part: exact / 10_000n, remainder: exact % 10_000n };
  });
  let left = magnitude - parts.reduce((sum, { part }) => sum + part, 0n);
  // Largest remainder first; the sort is stable, so ties keep the weights' order.
  const byRemainder = [...parts].sort((a, b) => Number(b.remainder - a.remainder));
  for (const entry of byRemainder) {
    if (left === 0n) break;
    entry.part += 1n;
    left -= 1n;
  }
  return parts.map(({ part }) => (total < 0n ? -part : part));
}
