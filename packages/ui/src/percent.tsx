// SPDX-License-Identifier: AGPL-3.0-only
import { MINUS, type Locale } from '@wf/domain/money';

export interface PercentProps {
  /** A ratio: `0.365` renders as `36,5%` (id) or `36.5%` (en). */
  value: number;
  locale: Locale;
  /**
   * Most decimals to show; trailing zeros are dropped. The design uses 1 for rates and changes (`36,5%`,
   * `+4,1%`) and 0 for progress (`1.300.000 / 1.500.000` → `87%`).
   */
  decimals?: 0 | 1 | 2;
  /** Always show the sign, for changes such as `+4,1%` and `−9,8%`. */
  signed?: boolean;
  className?: string;
}

/**
 * PRD §7.1 percentages: decimal comma (id) or point (en), rounded to nearest, no decimals when whole, and
 * the U+2212 minus. Percentages stay visible in privacy mode (design section 12).
 */
export function Percent({ value, locale, decimals = 1, signed = false, className = '' }: PercentProps) {
  if (!Number.isFinite(value)) throw new RangeError(`Percent needs a finite ratio, got ${String(value)}`);
  const text = new Intl.NumberFormat(locale, {
    style: 'percent',
    maximumFractionDigits: decimals,
    signDisplay: signed ? 'exceptZero' : 'auto',
  })
    .format(value)
    .replace('-', MINUS);
  return <span className={`font-mono tabular-nums whitespace-nowrap ${className}`}>{text}</span>;
}
