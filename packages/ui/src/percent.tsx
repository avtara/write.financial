// SPDX-License-Identifier: AGPL-3.0-only
import { MINUS, type Locale } from '@wf/domain/money';

export interface PercentProps {
  /** A ratio: `0.365` renders as `36,50%` (id) or `36.50%` (en). */
  value: number;
  locale: Locale;
  /** Always show the sign, for changes such as `+4,10%` and `−9,80%`. */
  signed?: boolean;
  className?: string;
}

/** Percentages carry two decimals, everywhere (PRD §7.1: decimal comma or point, U+2212 minus). */
export const PERCENT_DECIMALS = 2 as const;

/**
 * PRD §7.1 percentages: decimal comma (id) or point (en), rounded to nearest, always two decimals, and the U+2212
 * minus. Percentages stay visible in privacy mode (design section 12).
 */
export function Percent({ value, locale, signed = false, className = '' }: PercentProps) {
  if (!Number.isFinite(value)) throw new RangeError(`Percent needs a finite ratio, got ${String(value)}`);
  const text = new Intl.NumberFormat(locale, {
    style: 'percent',
    minimumFractionDigits: PERCENT_DECIMALS,
    maximumFractionDigits: PERCENT_DECIMALS,
    signDisplay: signed ? 'exceptZero' : 'auto',
  })
    .format(value)
    .replace('-', MINUS);
  return <span className={`font-mono tabular-nums whitespace-nowrap ${className}`}>{text}</span>;
}
