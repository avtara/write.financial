// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The budget screens' amounts and percentages: the base currency and locale come from one context, so every figure
 * is a short `<Amount valueMinor={…} />` (through `<Money>`, privacy mode included) or `<Pct bps={…} />`.
 */
import type { Locale } from '@wf/i18n/locale';
import { Money } from '@wf/ui/money';
import { Percent } from '@wf/ui/percent';
import { createContext, use, type ReactNode } from 'react';

export interface BudgetFormat {
  readonly currency: string;
  readonly locale: Locale;
}

const BudgetFormatContext = createContext<BudgetFormat>({ currency: 'IDR', locale: 'id' });

export function BudgetFormatProvider({ value, children }: { value: BudgetFormat; children: ReactNode }) {
  return <BudgetFormatContext value={value}>{children}</BudgetFormatContext>;
}

export function useBudgetFormat(): BudgetFormat {
  return use(BudgetFormatContext);
}

/**
 * An amount in the base currency: `amount` with the symbol ("Rp2.250.000"), `table` without it ("3.500.000", the
 * "/ limit" part of a row).
 */
export function Amount({
  valueMinor,
  bare = false,
  className,
}: {
  valueMinor: bigint;
  bare?: boolean;
  className?: string;
}) {
  const { currency, locale } = useBudgetFormat();
  return (
    <Money
      minor={valueMinor}
      currency={currency}
      context={bare ? 'table' : 'amount'}
      locale={locale}
      className={`${bare ? '!inline' : ''} ${className ?? ''}`}
    />
  );
}

/** Basis points as a whole percentage ("88%"); `null` (no limit) renders as "—". */
export function Pct({ bps, className }: { bps: number | null; className?: string }) {
  const { locale } = useBudgetFormat();
  if (bps === null) return <span className={className}>—</span>;
  return (
    <Percent value={bps / 10_000} locale={locale} decimals={0} {...(className === undefined ? {} : { className })} />
  );
}
