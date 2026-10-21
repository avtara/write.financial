// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "SETELAH DISIMPAN" (design H7g1A, ivnWw, IGHyP): what a receivable changes, one `label · before → after` row per
 * figure; an unchanged figure shows "tetap" instead of the after value.
 */
import type { Locale } from '@wf/i18n/locale';
import { m } from '@wf/i18n/messages';
import { Money } from '@wf/ui/money';
import { ArrowRight, Calculator } from 'lucide-react';
import type { ReactNode } from 'react';

export interface AfterRow {
  readonly label: string;
  readonly beforeMinor: bigint;
  /** `null` = unchanged ("tetap"). */
  readonly afterMinor: bigint | null;
  /** `amount` shows the currency symbol ("Rp140.000"), `table` only the number ("42.810.000"). */
  readonly style?: 'amount' | 'table';
  /** Colour of the after value ("Rp155.000" green, the receivables violet). */
  readonly tone?: 'green' | 'violet';
}

const TONE = { green: 'text-green-fg', violet: 'text-violet' } as const;

export interface AfterPreviewProps {
  readonly rows: readonly AfterRow[];
  readonly currency: string;
  readonly locale: Locale;
  /** Under the rows: a progress bar and its caption (ivnWw). */
  readonly children?: ReactNode;
}

export function AfterPreview({ rows, currency, locale, children }: AfterPreviewProps) {
  return (
    <section
      aria-label={m.receivables_after()}
      className="flex flex-col gap-2 rounded-[9px] border border-border bg-surface-sunken px-3 py-3"
    >
      <h3 className="flex items-center gap-1.5 text-[10.5px] font-medium tracking-[0.06em] text-subtle uppercase">
        <Calculator aria-hidden="true" className="size-3.5" />
        {m.receivables_after()}
      </h3>
      <dl className="flex flex-col gap-1.5">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center gap-2 text-[12.5px]">
            <dt className="min-w-0 flex-1 truncate text-muted-fg">{row.label}</dt>
            <dd className="flex shrink-0 items-center gap-2 font-mono text-[12px]">
              <Money
                minor={row.beforeMinor}
                currency={currency}
                context={row.style ?? 'table'}
                locale={locale}
                className="text-subtle"
              />
              <ArrowRight aria-hidden="true" className="size-3 text-subtle" />
              {row.afterMinor === null ? (
                <span className="font-sans font-medium text-subtle">{m.receivables_unchanged()}</span>
              ) : (
                <Money
                  minor={row.afterMinor}
                  currency={currency}
                  context={row.style ?? 'table'}
                  locale={locale}
                  className={`font-medium ${row.tone === undefined ? 'text-fg' : TONE[row.tone]}`}
                />
              )}
            </dd>
          </div>
        ))}
      </dl>
      {children}
    </section>
  );
}
