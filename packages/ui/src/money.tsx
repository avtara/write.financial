// SPDX-License-Identifier: AGPL-3.0-only
import { formatMoney, type Locale, type MoneyContext } from '@wf/domain/money';
import { usePrivacy } from './privacy.tsx';

export interface MoneyProps {
  /** Amount in the currency's minor unit (PRD §9: money is always a `bigint`). */
  minor: bigint;
  /** ISO 4217 code. */
  currency: string;
  /**
   * `table`: ledger cells, right-aligned, no symbol · `amount`: headline/sentence, with symbol · `delta`: signed ·
   * `signed`: signed with symbol, where currencies mix.
   */
  context: MoneyContext;
  locale: Locale;
  className?: string;
}

const LAYOUT: Readonly<Record<MoneyContext, string>> = {
  table: 'block text-right',
  amount: '',
  delta: '',
  signed: '',
};

/**
 * The only way money reaches the screen (lint: `wf/money-via-component`). Formats with the domain's
 * `formatMoney` (PRD §7.1) in Geist Mono tabular figures. Only the signed contexts (`delta`, `signed`) are colored, and
 * only while amounts are visible: in privacy mode the color would reveal the sign. When privacy mode hides the
 * amount, the visible dots are hidden from assistive technology and the provider's `hiddenLabel` is
 * announced instead, so the value never reaches the DOM.
 */
export function Money({ minor, currency, context, locale, className = '' }: MoneyProps) {
  const { hidden, hiddenLabel } = usePrivacy();
  const text = formatMoney(minor, currency, { locale, context, privacy: hidden });
  const signed = context === 'delta' || context === 'signed';
  const tone = !signed || hidden || minor === 0n ? '' : minor > 0n ? 'text-green-fg' : 'text-red-fg';
  const classes = `font-mono tabular-nums whitespace-nowrap ${LAYOUT[context]} ${tone} ${className}`;
  if (!hidden) return <span className={classes}>{text}</span>;
  return (
    <span className={classes}>
      <span aria-hidden="true">{text}</span>
      <span className="sr-only">{hiddenLabel}</span>
    </span>
  );
}
