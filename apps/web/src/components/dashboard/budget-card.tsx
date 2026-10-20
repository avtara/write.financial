// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Anggaran Kategori" (FR-D2, design `iUqiN`; "Anggaran Minggu Ini" `tBbvD`, "Anggaran 2026" `g9BK2`): the budget
 * lines against the limit of what the dashboard shows (the period's, a week's share, or the periods of the year so
 * far), the fullest first, with "1 lewat batas". Without a budget it leads to Anggaran.
 */
import { Link } from '@tanstack/react-router';
import type { CategoryView } from '@wf/db/categories';
import type { Dashboard } from '@wf/db/dashboard';
import type { Locale } from '@wf/i18n/locale';
import { m } from '@wf/i18n/messages';
import { ArrowRight, TriangleAlert } from 'lucide-react';
import { categoryName } from '../../lib/ledger-labels.ts';
import { BudgetBar } from '../budget/budget-bar.tsx';
import { Amount, BudgetFormatProvider } from '../budget/budget-format.tsx';
import { lineTone } from '../budget/budget-model.ts';
import { CategoryIcon } from '../category-icon.tsx';

export interface BudgetCardProps {
  readonly dashboard: Dashboard;
  readonly categories: readonly CategoryView[];
  readonly locale: Locale;
}

/** Lines shown; the rest are on Anggaran. */
const MAX_LINES = 6;

export function BudgetCard({ dashboard, categories, locale }: BudgetCardProps) {
  const byId = new Map(categories.map((category) => [category.id, category]));
  const { budget, scope } = dashboard;
  const lines = (budget?.lines ?? [])
    .filter((line) => byId.has(line.categoryId))
    // `Number(null)` is 0: a line without a limit sorts as unused.
    .toSorted((a, b) => Number(b.usedBps) - Number(a.usedBps))
    .slice(0, MAX_LINES);
  const title =
    scope === 'week'
      ? m.overview_budget_title_week()
      : scope === 'year'
        ? m.overview_budget_title_year({ year: dashboard.ranges.full.from.slice(0, 4) })
        : m.overview_budget_title();
  const caption =
    scope === 'week'
      ? m.overview_budget_caption_week()
      : scope === 'year'
        ? m.overview_budget_caption_year()
        : m.overview_budget_caption();
  return (
    <BudgetFormatProvider value={{ currency: dashboard.baseCurrency, locale }}>
      <section
        aria-labelledby="overview-budget"
        className="flex flex-col gap-4 rounded-[12px] border border-border bg-card px-6 py-5"
      >
        <div className="flex items-start gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <h2 id="overview-budget" className="text-[15px] font-semibold text-fg">
              {title}
            </h2>
            <p className="text-[12.5px] text-muted-fg">{caption}</p>
          </div>
          {budget === null || budget.overCount === 0 ? null : (
            <span className="inline-flex items-center gap-1.5 rounded-[6px] bg-red-tint-2 px-2 py-1 text-[11.5px] text-red-fg">
              <TriangleAlert aria-hidden="true" className="size-3" />
              {m.overview_budget_over({ count: budget.overCount })}
            </span>
          )}
        </div>
        {lines.length === 0 ? (
          <div className="flex flex-1 flex-col items-start justify-center gap-3 py-4">
            <p className="text-[13px] text-subtle">{m.overview_budget_empty()}</p>
            <Link
              to="/budget"
              className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-border px-3 text-[12.5px] text-fg hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
            >
              {m.overview_budget_set()}
              <ArrowRight aria-hidden="true" className="size-3.5" />
            </Link>
          </div>
        ) : (
          <ul className="flex flex-col gap-4">
            {lines.map((line) => {
              const category = byId.get(line.categoryId) as CategoryView;
              const tone = lineTone(line);
              return (
                <li key={line.categoryId} className="flex flex-col gap-2">
                  <span className="flex items-center gap-2 text-[13px]">
                    <CategoryIcon icon={category.icon} color={category.color} size="sm" />
                    <span className="min-w-0 flex-1 truncate text-fg">{categoryName(category)}</span>
                    <span className="font-mono text-[12px] text-subtle">
                      <span className={tone === 'over' ? 'text-red-fg' : 'text-fg'}>
                        <Amount valueMinor={line.spentMinor} />
                      </span>
                      {' / '}
                      <Amount valueMinor={line.limitMinor} bare />
                    </span>
                  </span>
                  <BudgetBar usedBps={line.usedBps} tone={tone} idealBps={null} />
                </li>
              );
            })}
          </ul>
        )}
        {lines.length === 0 ? null : (
          <Link
            to="/budget"
            className="mt-auto inline-flex items-center gap-1.5 self-start rounded-[6px] text-[12.5px] text-muted-fg hover:text-fg focus-visible:outline-2 focus-visible:outline-ring"
          >
            {m.overview_budget_all()}
            <ArrowRight aria-hidden="true" className="size-3.5" />
          </Link>
        )}
      </section>
    </BudgetFormatProvider>
  );
}
