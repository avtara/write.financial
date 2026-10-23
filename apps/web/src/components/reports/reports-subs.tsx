// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Langganan" (PDF page 4, design `ZWRR8`): the active subscriptions and their monthly/yearly totals with the share
 * of spending; plus "Catatan untuk periode berikutnya" (design §A.4), the facts the next period should watch —
 * over-budget categories, unconverted subscriptions, and currencies without a rate.
 */
import type { ReportView } from '@wf/db/reports';
import type { Locale } from '@wf/i18n/locale';
import { m } from '@wf/i18n/messages';
import { Money } from '@wf/ui/money';
import { Percent } from '@wf/ui/percent';
import type { ReactNode } from 'react';
import { RichMessage } from '../rich-message.tsx';
import { REPORTS_CURRENCY, notesFor, type ReportNote } from './reports-model.ts';

export interface SubsSectionProps {
  readonly view: ReportView;
  readonly locale: Locale;
}

export function SubsSection({ view, locale }: SubsSectionProps) {
  const subs = view.sections.subscriptions;
  return (
    <section
      aria-labelledby="reports-subs"
      className="flex flex-col gap-2 rounded-[12px] border border-border bg-card px-6 py-5"
    >
      <h2 id="reports-subs" className="text-[15px] font-semibold text-fg">
        {m.reports_subs_title()}
      </h2>
      <p className="text-[12.5px] text-fg">
        <RichMessage
          message={m.reports_subs_summary}
          slots={{
            active: String(subs.active),
            monthly: <Money minor={subs.monthlyMinor} currency={REPORTS_CURRENCY} context="amount" locale={locale} />,
            yearly: <Money minor={subs.yearlyMinor} currency={REPORTS_CURRENCY} context="amount" locale={locale} />,
          }}
        />
      </p>
      <div className="flex flex-wrap gap-x-3 text-[11.5px] text-subtle">
        {subs.shareBps === null ? null : <Percent value={subs.shareBps / 10_000} locale={locale} />}
        {subs.unconverted === 0 ? null : (
          <RichMessage message={m.reports_subs_unconverted} slots={{ count: String(subs.unconverted) }} />
        )}
      </div>
    </section>
  );
}

function Note({ note, locale }: { readonly note: ReportNote; readonly locale: Locale }) {
  switch (note.kind) {
    case 'overBudget':
      return (
        <>
          {note.name ?? m.overview_flow_uncategorized()}{' '}
          <span className="text-red-fg">
            <RichMessage
              message={m.budget_line_over}
              slots={{
                amount: <Money minor={note.overMinor} currency={REPORTS_CURRENCY} context="amount" locale={locale} />,
              }}
            />
          </span>
        </>
      );
    case 'subsUnconverted':
      return <RichMessage message={m.reports_subs_unconverted} slots={{ count: String(note.count) }} />;
    case 'unvalued':
      return <RichMessage message={m.reports_networth_unvalued} slots={{ currencies: note.currencies.join(', ') }} />;
  }
}

/** Hidden when there is nothing to carry over: a clean period has no notes. */
export function NotesSection({ view, locale }: SubsSectionProps): ReactNode {
  const notes = notesFor(view);
  if (notes.length === 0) return null;
  return (
    <section
      aria-labelledby="reports-notes"
      className="flex flex-col gap-3 rounded-[12px] border border-border bg-card px-6 py-5"
    >
      <h2 id="reports-notes" className="text-[15px] font-semibold text-fg">
        {m.reports_notes_next()}
      </h2>
      <ul className="flex flex-col gap-1.5 text-[12.5px] text-fg">
        {notes.map((note, index) => (
          <li key={index}>
            <Note note={note} locale={locale} />
          </li>
        ))}
      </ul>
    </section>
  );
}
