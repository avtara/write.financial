// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The goals of the report ("Posisi tujuan per 30 Sep"): saved against target with the progress, or an honest "—"
 * when no snapshot observed the goal. Without any historical observation the section says so instead of showing an
 * empty table.
 */
import type { ReportView } from '@wf/db/reports';
import type { Locale } from '@wf/i18n/locale';
import { m } from '@wf/i18n/messages';
import { formatDate } from '@wf/ui/dates';
import { Money } from '@wf/ui/money';
import { Percent } from '@wf/ui/percent';
import { RichMessage } from '../rich-message.tsx';
import { REPORTS_CURRENCY } from './reports-model.ts';

export interface GoalsSectionProps {
  readonly view: ReportView;
  readonly locale: Locale;
}

export function GoalsSection({ view, locale }: GoalsSectionProps) {
  const { goals, goalsAsOf } = view.sections;
  return (
    <section
      aria-labelledby="reports-goals"
      className="flex flex-col gap-4 rounded-[12px] border border-border bg-card px-6 py-5"
    >
      <h2 id="reports-goals" className="text-[15px] font-semibold text-fg">
        {goalsAsOf === null ? (
          m.reports_goals_unavailable()
        ) : (
          <RichMessage message={m.reports_goals_asof} slots={{ date: formatDate(goalsAsOf, locale, 'day') }} />
        )}
      </h2>
      {goals.length === 0 ? null : (
        <ul className="flex flex-col">
          {goals.map((goal, index) => (
            <li
              key={index}
              className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-border py-2.5 text-[12.5px] not-first:border-t"
            >
              <span className="text-fg">{goal.name}</span>
              <span className="flex items-baseline gap-2">
                {goal.savedMinor === null ? (
                  <span className="font-mono text-subtle">—</span>
                ) : (
                  <Money
                    minor={goal.savedMinor}
                    currency={REPORTS_CURRENCY}
                    context="amount"
                    locale={locale}
                    className="text-fg"
                  />
                )}
                <span className="text-subtle">/</span>
                <Money
                  minor={goal.targetMinor}
                  currency={REPORTS_CURRENCY}
                  context="amount"
                  locale={locale}
                  className="text-muted-fg"
                />
                {goal.progressBps === null ? null : (
                  <Percent value={goal.progressBps / 10_000} locale={locale} className="text-[11.5px] text-subtle" />
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
