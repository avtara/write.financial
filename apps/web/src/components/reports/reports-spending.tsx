// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Pengeluaran" (PDF page 3, design `STgHg`): the categories against their budget line (spent/limit, the bar, and
 * "lewat Rp600.000"), the merchants ranking, the tag chips, and the accounts with their in/out. Everything comes
 * from the snapshot, so no live budget or category lookup is needed here.
 */
import type { ReportView } from '@wf/db/reports';
import type { Locale } from '@wf/i18n/locale';
import { m } from '@wf/i18n/messages';
import { Money } from '@wf/ui/money';
import { Percent } from '@wf/ui/percent';
import { RichMessage } from '../rich-message.tsx';
import { BudgetBar } from '../budget/budget-bar.tsx';
import { REPORTS_CURRENCY } from './reports-model.ts';

export interface SpendingSectionProps {
  readonly view: ReportView;
  readonly locale: Locale;
}

export function SpendingSection({ view, locale }: SpendingSectionProps) {
  const { categories, merchants, tags, accounts } = view.sections;
  return (
    <section
      aria-labelledby="reports-spending"
      className="flex flex-col gap-4 rounded-[12px] border border-border bg-card px-6 py-5"
    >
      <h2 id="reports-spending" className="text-[15px] font-semibold text-fg">
        {m.reports_section_spending()}
      </h2>
      {categories.length === 0 ? null : (
        <ul className="flex flex-col">
          {categories.map((line, index) => (
            <li key={index} className="flex flex-col gap-1.5 border-border py-2.5 not-first:border-t">
              <div className="flex items-baseline justify-between gap-3 text-[12.5px]">
                <span className="text-fg">{line.name ?? m.overview_flow_uncategorized()}</span>
                <span className="flex items-baseline gap-2">
                  <Money
                    minor={line.spentMinor}
                    currency={REPORTS_CURRENCY}
                    context="table"
                    locale={locale}
                    className="text-fg"
                  />
                  {line.limitMinor === null ? null : (
                    <span className="text-subtle">
                      / <Money minor={line.limitMinor} currency={REPORTS_CURRENCY} context="table" locale={locale} />
                    </span>
                  )}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <BudgetBar
                  usedBps={line.usedBps}
                  tone={line.overMinor > 0n ? 'over' : 'ok'}
                  idealBps={null}
                  className="flex-1"
                />
                {line.overMinor > 0n ? (
                  <span className="text-[11.5px] text-red-fg">
                    <RichMessage
                      message={m.budget_line_over}
                      slots={{
                        amount: (
                          <Money minor={line.overMinor} currency={REPORTS_CURRENCY} context="amount" locale={locale} />
                        ),
                      }}
                    />
                  </span>
                ) : null}
                {line.usedBps === null ? (
                  <Percent value={line.shareBps / 10_000} locale={locale} className="text-[11.5px] text-subtle" />
                ) : (
                  <Percent value={line.usedBps / 10_000} locale={locale} className="text-[11.5px] text-muted-fg" />
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {merchants.length === 0 ? null : (
        <div className="flex flex-col gap-2 border-t border-border pt-3">
          <h3 className="text-[13px] font-semibold text-fg">{m.reports_merchants_title()}</h3>
          <ul className="flex flex-col">
            {merchants.map((line, index) => (
              <li
                key={index}
                className="flex items-baseline justify-between gap-3 border-border py-2 text-[12.5px] not-first:border-t"
              >
                <span className="min-w-0 truncate text-fg">{line.merchant}</span>
                <span className="flex shrink-0 items-baseline gap-3 text-subtle">
                  {m.reports_tx_count({ count: line.count })}
                  <Percent value={line.shareBps / 10_000} locale={locale} />
                  <Money
                    minor={line.totalMinor}
                    currency={REPORTS_CURRENCY}
                    context="table"
                    locale={locale}
                    className="text-fg"
                  />
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {tags.length === 0 ? null : (
        <div className="flex flex-col gap-2 border-t border-border pt-3">
          <h3 className="text-[13px] font-semibold text-fg">{m.reports_tags_title()}</h3>
          <ul className="flex flex-wrap gap-2">
            {tags.map((line, index) => (
              <li
                key={index}
                className="flex items-baseline gap-1.5 rounded-full bg-tint-06 px-2.5 py-1 text-[12.5px] text-fg"
              >
                <span className="text-subtle">#</span>
                {line.name}
                <Money
                  minor={line.totalMinor}
                  currency={REPORTS_CURRENCY}
                  context="amount"
                  locale={locale}
                  className="text-[11.5px] text-muted-fg"
                />
              </li>
            ))}
          </ul>
        </div>
      )}
      {accounts.length === 0 ? null : (
        <div className="flex flex-col gap-2 border-t border-border pt-3">
          <h3 className="text-[13px] font-semibold text-fg">{m.reports_section_accounts_tags()}</h3>
          <ul className="flex flex-col">
            {accounts.map((line, index) => (
              <li
                key={index}
                className="flex items-baseline justify-between gap-3 border-border py-2 text-[12.5px] not-first:border-t"
              >
                <span className="min-w-0 truncate text-fg">{line.name}</span>
                <span className="flex shrink-0 items-baseline gap-3">
                  <Money
                    minor={line.inMinor}
                    currency={REPORTS_CURRENCY}
                    context="delta"
                    locale={locale}
                    className="text-[12.5px]"
                  />
                  <Money
                    minor={-line.outMinor}
                    currency={REPORTS_CURRENCY}
                    context="delta"
                    locale={locale}
                    className="text-[12.5px]"
                  />
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
