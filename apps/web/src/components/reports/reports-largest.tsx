// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Transaksi terbesar" (PDF page 4, design `ZWRR8`): the largest transactions with each share of the spending, and
 * the summary line "6 transaksi = 40% dari pengeluaran".
 */
import type { ReportView } from '@wf/db/reports';
import type { Locale } from '@wf/i18n/locale';
import { m } from '@wf/i18n/messages';
import { formatDate } from '@wf/ui/dates';
import { Money } from '@wf/ui/money';
import { Percent } from '@wf/ui/percent';
import { RichMessage } from '../rich-message.tsx';
import { REPORTS_CURRENCY } from './reports-model.ts';

export interface LargestSectionProps {
  readonly view: ReportView;
  readonly locale: Locale;
}

export function LargestSection({ view, locale }: LargestSectionProps) {
  const { largest, largestShareBps } = view.sections;
  return (
    <section
      aria-labelledby="reports-largest"
      className="flex flex-col gap-3 rounded-[12px] border border-border bg-card px-6 py-5"
    >
      <h2 id="reports-largest" className="text-[15px] font-semibold text-fg">
        {m.reports_largest_title()}
      </h2>
      <ul className="flex flex-col">
        {largest.map((line, index) => (
          <li key={index} className="flex items-baseline gap-3 border-border py-2 text-[12.5px] not-first:border-t">
            <span className="min-w-0 flex-1 truncate text-fg">
              {line.description}
              {line.merchant === null ? null : <span className="text-subtle"> · {line.merchant}</span>}
            </span>
            <span className="shrink-0 font-mono text-[11.5px] text-subtle tabular-nums">
              {formatDate(line.date, locale, 'day')}
            </span>
            <Money
              minor={line.amountMinor}
              currency={REPORTS_CURRENCY}
              context="table"
              locale={locale}
              className="shrink-0 text-fg"
            />
            <Percent
              value={line.shareBps / 10_000}
              locale={locale}
              className="w-14 shrink-0 text-right text-[11.5px] text-subtle"
            />
          </li>
        ))}
      </ul>
      {largestShareBps === null ? null : (
        <p className="text-[12.5px] text-muted-fg">
          <RichMessage
            message={m.reports_largest_share}
            slots={{
              count: String(largest.length),
              pct: <Percent value={largestShareBps / 10_000} locale={locale} />,
            }}
          />
        </p>
      )}
    </section>
  );
}
