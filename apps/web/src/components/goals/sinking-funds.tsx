// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Dana tidak rutin" (FR-B6, design 06 `j6G7bA` / `McGzv`): the sinking funds, each with its due month, saved of
 * target, and the monthly amount set aside for it (computed when it was made: what is missing over the months left,
 * rounded up), their total per month, the payday transfer that sets it aside ("Sisihkan tiap tgl 25"), and "Dana baru".
 */
import type { AccountView } from '@wf/db/accounts';
import { goalSnapshot } from '@wf/domain/goals';
import type { Locale } from '@wf/i18n/locale';
import { m } from '@wf/i18n/messages';
import { Money } from '@wf/ui/money';
import { Plus } from 'lucide-react';
import type { GoalSummary, GoalsOverview } from '../../server/fn/goals.ts';
import { CategoryIcon } from '../category-icon.tsx';
import { periodLabel } from '../dashboard/dashboard-format.ts';
import { Button } from '../form.tsx';
import { RichMessage } from '../rich-message.tsx';
import { GoalBar } from './goal-list.tsx';
import { goalState } from './goals-model.ts';

export interface SinkingFundsProps {
  readonly overview: GoalsOverview;
  readonly accounts: readonly AccountView[];
  readonly locale: Locale;
  readonly onOpen: (goal: GoalSummary) => void;
  readonly onNew: () => void;
}

export function SinkingFunds({ overview, accounts, locale, onOpen, onNew }: SinkingFundsProps) {
  const funds = overview.goals.filter((goal) => goal.kind === 'sinking' && goal.status === 'active');
  const total = funds.reduce((sum, goal) => sum + goal.monthlyPlanMinor, 0n);
  const { setAside } = overview;
  const name = (id: string) => accounts.find((account) => account.id === id)?.displayName ?? '—';
  return (
    <section
      aria-labelledby="goals-sinking"
      className="flex min-w-0 flex-col rounded-[12px] border border-border bg-card"
    >
      <header className="flex items-start justify-between gap-2 px-5 pt-4 pb-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 id="goals-sinking" className="text-[15px] font-semibold text-fg">
            {m.goals_sinking_title()}
          </h2>
          <p className="text-[12px] text-subtle">
            {setAside === null || setAside.monthDay === null
              ? m.goals_sinking_description()
              : m.goals_sinking_set_aside({
                  day: setAside.monthDay,
                  from: name(setAside.fromAccountId),
                  to: name(setAside.toAccountId),
                })}
          </p>
        </div>
        <Button size="sm" variant="secondary" className="shrink-0 whitespace-nowrap" onClick={onNew}>
          <Plus aria-hidden="true" className="size-3.5" />
          {m.goals_sinking_new()}
        </Button>
      </header>
      {funds.length === 0 ? (
        <p className="px-5 py-6 text-[13px] text-muted-fg">{m.goals_sinking_empty()}</p>
      ) : (
        <ul className="px-5">
          {funds.map((goal) => {
            const snapshot = goalSnapshot(goalState(goal));
            return (
              <li key={goal.id} className="border-b border-border last:border-b-0">
                <button
                  type="button"
                  onClick={() => {
                    onOpen(goal);
                  }}
                  className="flex w-full items-center gap-3 py-3 text-left hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <CategoryIcon icon={goal.icon} color={goal.color} />
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-[13px] font-medium text-fg">{goal.name}</span>
                      <span className="shrink-0 text-[12px] text-muted-fg">
                        <RichMessage
                          message={m.goals_per_month}
                          slots={{
                            amount: (
                              <Money
                                minor={goal.monthlyPlanMinor}
                                currency={goal.currency}
                                context="amount"
                                locale={locale}
                                className="text-fg"
                              />
                            ),
                          }}
                        />
                      </span>
                    </span>
                    <GoalBar color={goal.color} progressBps={snapshot.progressBps} />
                    <span className="flex flex-wrap items-baseline justify-between gap-x-2 text-[11px] text-subtle">
                      <span className="whitespace-nowrap">
                        <Money minor={goal.savedMinor} currency={goal.currency} context="amount" locale={locale} />
                        {' / '}
                        <Money minor={goal.targetMinor} currency={goal.currency} context="amount" locale={locale} />
                      </span>
                      {goal.deadlineMonth === null ? null : (
                        <span className="whitespace-nowrap">
                          {m.goals_sinking_due({ month: periodLabel(goal.deadlineMonth, locale) })}
                        </span>
                      )}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {funds.length === 0 ? null : (
        <footer className="mt-auto flex items-center justify-between gap-2 border-t border-border px-5 py-3 text-[12.5px] text-muted-fg">
          <span>{m.goals_sinking_total()}</span>
          <span className="text-fg">
            <RichMessage
              message={m.goals_per_month}
              slots={{
                amount: <Money minor={total} currency={overview.baseCurrency} context="amount" locale={locale} />,
              }}
            />
          </span>
        </footer>
      )}
    </section>
  );
}
