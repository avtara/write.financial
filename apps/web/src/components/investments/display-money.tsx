// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Amounts of the "Investasi" page in the chosen display currency (FR-I3 IDR/USD toggle): a base-currency amount, or
 * its quote-currency twin when that is what the row is priced in ("US$825,69 · ≈ Rp13.500.000"), or everything in
 * dollars at today's rate in USD mode. Always rendered through `<Money>` (privacy mode).
 */
import type { MoneyContext } from '@wf/domain/money';
import type { Locale } from '@wf/i18n/locale';
import { m } from '@wf/i18n/messages';
import { Money } from '@wf/ui/money';
import { toUsd } from './investments-model.ts';

/** How amounts are shown: `usdRate` set = USD mode (1 USD = rate base). */
export interface AmountDisplay {
  readonly base: string;
  readonly usdRate: string | null;
  readonly locale: Locale;
}

export interface DisplayMoneyProps {
  readonly baseMinor: bigint;
  /** The same amount in the row's quote currency, when it has one. */
  readonly quoteMinor?: bigint | undefined;
  readonly quoteCurrency?: string | undefined;
  readonly display: AmountDisplay;
  readonly context?: MoneyContext;
  readonly className?: string;
}

export function DisplayMoney({
  baseMinor,
  quoteMinor,
  quoteCurrency,
  display,
  context = 'amount',
  className = '',
}: DisplayMoneyProps) {
  const { base, usdRate, locale } = display;
  if (usdRate !== null) {
    const usdMinor = quoteCurrency === 'USD' && quoteMinor !== undefined ? quoteMinor : toUsd(baseMinor, base, usdRate);
    return <Money minor={usdMinor} currency="USD" context={context} locale={locale} className={className} />;
  }
  if (quoteMinor !== undefined && quoteCurrency !== undefined && quoteCurrency !== base) {
    return (
      <Money minor={quoteMinor} currency={quoteCurrency} context={context} locale={locale} className={className} />
    );
  }
  return <Money minor={baseMinor} currency={base} context={context} locale={locale} className={className} />;
}

/** "≈ Rp13.500.000" under a quote-currency amount (base mode only), or nothing. */
export function ApproxBase({
  baseMinor,
  currency,
  display,
}: {
  readonly baseMinor: bigint;
  readonly currency: string | null;
  readonly display: AmountDisplay;
}) {
  if (display.usdRate !== null || currency === null || currency === display.base) return null;
  return (
    <span className="text-[11px] text-subtle">
      {m.invest_approx()} <Money minor={baseMinor} currency={display.base} context="amount" locale={display.locale} />
    </span>
  );
}
