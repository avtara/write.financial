// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Pengeluaran per Kategori" (FR-D2 small multiples, design `iUqiN`): one tile per budgeted or spent category with its
 * bar against the limit (the white mark is today's ideal), "3.200.000 / 3.500.000", and the budget note ("sisa
 * Rp19.000/hari", "lewat Rp400.000", "lunas", "belum terpakai"); categories without a budget show their share of
 * the spending. The header splits the spending by group (Kebutuhan, Keinginan, …). A tile opens its transactions.
 */
import { Link } from '@tanstack/react-router';
import type { BudgetStatus } from '@wf/db/budgets';
import type { CategoryView } from '@wf/db/categories';
import type { Dashboard } from '@wf/db/dashboard';
import type { CategoryGroup } from '@wf/domain/categories';
import type { Locale } from '@wf/i18n/locale';
import { m } from '@wf/i18n/messages';
import { Money } from '@wf/ui/money';
import { ArrowRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { transactionsDatesOf } from '../../lib/dashboard-search.ts';
import { categoryGroupLabel, categoryName } from '../../lib/ledger-labels.ts';
import { BudgetBar } from '../budget/budget-bar.tsx';
import { Amount, BudgetFormatProvider, Pct } from '../budget/budget-format.tsx';
import { LineNote } from '../budget/budget-list.tsx';
import { lineTone, type BudgetTone } from '../budget/budget-model.ts';
import { RichMessage } from '../rich-message.tsx';

export interface CategorySpendingCardProps {
  readonly dashboard: Dashboard;
  /** The budget of the period shown (month scope), for the notes; `null` for other scopes. */
  readonly budget: BudgetStatus | null;
  readonly categories: readonly CategoryView[];
  readonly locale: Locale;
  /** "Oktober 2026", "12–18 Okt". */
  readonly caption: string;
}

interface Tile {
  readonly key: string;
  readonly categoryId: string | null;
  readonly name: string;
  readonly fixed: boolean;
  readonly spentMinor: bigint;
  readonly limitMinor: bigint | null;
  readonly usedBps: number | null;
  readonly tone: BudgetTone;
  readonly idealBps: number | null;
  readonly note: ReactNode;
}

const PCT_TONE: Readonly<Record<BudgetTone, string>> = {
  over: 'text-red-fg',
  warning: 'text-amber-fg',
  ok: 'text-muted-fg',
  idle: 'text-muted-fg',
};

const GROUP_BAR: Readonly<Record<string, string>> = {
  needs: 'fill-blue',
  wants: 'fill-violet',
  financial: 'fill-amber',
};

export function CategorySpendingCard({ dashboard, budget, categories, locale, caption }: CategorySpendingCardProps) {
  const currency = dashboard.baseCurrency;
  const byId = new Map(categories.map((category) => [category.id, category]));
  const nameOf = (id: string | null) => {
    const category = id === null ? undefined : byId.get(id);
    return category === undefined ? m.overview_flow_uncategorized() : categoryName(category);
  };
  const tiles: Tile[] = [];
  if (budget !== null) {
    for (const line of budget.lines) {
      tiles.push({
        key: line.categoryId,
        categoryId: line.categoryId,
        name: categoryName(line),
        fixed: line.isFixed,
        spentMinor: line.spentMinor,
        limitMinor: line.limitMinor,
        usedBps: line.usedBps,
        tone: lineTone(line),
        idealBps: budget.readOnly || line.isFixed ? null : budget.totals.idealBps,
        note: <LineNote line={line} readOnly={budget.readOnly} />,
      });
    }
  } else {
    for (const line of dashboard.budget?.lines ?? []) {
      tiles.push({
        key: line.categoryId,
        categoryId: line.categoryId,
        name: nameOf(line.categoryId),
        fixed: false,
        spentMinor: line.spentMinor,
        limitMinor: line.limitMinor,
        usedBps: line.usedBps,
        tone: lineTone(line),
        idealBps: null,
        note:
          line.state === 'over' ? (
            <span className="text-red-fg">
              <RichMessage
                message={m.budget_line_over}
                slots={{ amount: <Amount valueMinor={line.spentMinor - line.limitMinor} /> }}
              />
            </span>
          ) : line.state === 'unused' ? (
            m.budget_line_unused()
          ) : (
            <RichMessage
              message={m.budget_line_left}
              slots={{ amount: <Amount valueMinor={line.limitMinor - line.spentMinor} /> }}
            />
          ),
      });
    }
  }
  const budgeted = new Set(tiles.map((tile) => tile.categoryId));
  for (const row of dashboard.categories) {
    if (budgeted.has(row.categoryId)) continue;
    tiles.push({
      key: row.categoryId ?? 'uncategorized',
      categoryId: row.categoryId,
      name: nameOf(row.categoryId),
      fixed: false,
      spentMinor: row.totalMinor,
      limitMinor: null,
      usedBps: row.shareBps,
      tone: 'idle',
      idealBps: null,
      note: <RichMessage message={m.overview_categories_share} slots={{ share: <Pct bps={row.shareBps} /> }} />,
    });
  }

  const groupTotals = new Map<CategoryGroup, bigint>();
  for (const expense of dashboard.flow.expenses) {
    groupTotals.set(expense.group, (groupTotals.get(expense.group) ?? 0n) + expense.amountMinor);
  }
  const spentMinor = [...groupTotals.values()].reduce((total, value) => total + value, 0n);
  const dates = transactionsDatesOf(dashboard);
  // Each group's segment of the 0–1000 bar.
  let offset = 0;
  const segments = [...groupTotals].map(([group, amountMinor]) => {
    const length = (Number(amountMinor) / Number(spentMinor)) * 1000;
    const segment = { group, amountMinor, x: offset, width: Math.max(length - 4, 2) };
    offset += length;
    return segment;
  });

  return (
    <BudgetFormatProvider value={{ currency, locale }}>
      <section
        aria-labelledby="overview-categories"
        className="flex flex-col rounded-[12px] border border-border bg-card"
      >
        <div className="flex flex-wrap items-center gap-4 px-6 pt-5 pb-4">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <h2 id="overview-categories" className="text-[15px] font-semibold text-fg">
              {m.overview_categories_title()}
            </h2>
            <p className="text-[12.5px] text-muted-fg">
              {m.overview_categories_caption({ count: tiles.length, caption })}
            </p>
          </div>
          {segments.length > 0 ? (
            <div className="flex w-[320px] flex-col gap-1.5 max-md:w-full">
              <svg aria-hidden="true" viewBox="0 0 1000 6" preserveAspectRatio="none" className="block h-1.5 w-full">
                {segments.map((segment) => (
                  <rect
                    key={segment.group}
                    x={segment.x}
                    width={segment.width}
                    height="6"
                    rx="3"
                    className={GROUP_BAR[segment.group] ?? 'fill-neutral-mid'}
                  />
                ))}
              </svg>
              <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-subtle">
                {segments.map((segment) => (
                  <li key={segment.group} className="flex items-center gap-1.5">
                    {categoryGroupLabel(segment.group)}
                    <Money
                      minor={segment.amountMinor}
                      currency={currency}
                      context="amount"
                      locale={locale}
                      className="text-fg"
                    />
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <Link
            to="/budget"
            className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-border px-3 text-[12.5px] text-fg hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
          >
            {m.nav_budget()}
            <ArrowRight aria-hidden="true" className="size-3.5" />
          </Link>
        </div>
        {tiles.length === 0 ? (
          <p className="px-6 pb-6 text-[13px] text-subtle">{m.overview_categories_empty()}</p>
        ) : (
          <ul className="grid grid-cols-2 gap-x-6 px-6 pb-3 md:grid-cols-3 xl:grid-cols-5">
            {tiles.map((tile) => (
              <li key={tile.key} className="border-t border-border">
                <Link
                  to="/transactions"
                  search={
                    tile.categoryId === null
                      ? { ...dates, uncategorized: true }
                      : { ...dates, category: tile.categoryId }
                  }
                  className="flex flex-col gap-2 rounded-[6px] py-3.5 focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-[13px] font-medium text-fg">{tile.name}</span>
                    {tile.fixed ? (
                      <span className="text-[9.5px] font-medium tracking-[0.06em] text-subtle uppercase">
                        {m.overview_categories_fixed()}
                      </span>
                    ) : null}
                    <Pct bps={tile.usedBps} className={`ml-auto font-mono text-[11.5px] ${PCT_TONE[tile.tone]}`} />
                  </span>
                  <BudgetBar
                    usedBps={tile.usedBps}
                    tone={tile.tone}
                    idealBps={tile.idealBps}
                    {...(tile.limitMinor === null ? { fillClassName: 'fill-neutral-mid' } : {})}
                  />
                  <span className="flex flex-wrap items-baseline justify-between gap-x-2 text-[11.5px]">
                    <span className="font-mono text-[12px] text-fg">
                      <Amount valueMinor={tile.spentMinor} bare />
                      {tile.limitMinor === null ? null : (
                        <>
                          {' / '}
                          <Amount valueMinor={tile.limitMinor} bare />
                        </>
                      )}
                    </span>
                    <span className="text-subtle">{tile.note}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </BudgetFormatProvider>
  );
}
