// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Setoran {bulan}" (design 13 `kf0UJ`): the month's contributions, each with its date, what it is ("Kantong
 * darurat", "Sisihkan dana tidak rutin", "Setor manual"), from → to and the goals it feeds, the amount, and whether it
 * is recorded, waiting in "Perlu ditinjau", or still scheduled. Every one of them is a Transfer in Transactions.
 */
import { Link } from '@tanstack/react-router';
import type { AccountView } from '@wf/db/accounts';
import type { YearMonth } from '@wf/domain/period';
import type { Locale } from '@wf/i18n/locale';
import { m } from '@wf/i18n/messages';
import { Money } from '@wf/ui/money';
import { ArrowUpRight, CalendarClock, Link2 } from 'lucide-react';
import type { GoalMovement, MovementStatus } from '../../lib/goal-movements.ts';
import type { GoalsOverview } from '../../server/fn/goals.ts';
import { CategoryIcon } from '../category-icon.tsx';
import { monthName } from '../dashboard/dashboard-format.ts';
import { Chip } from './goal-list.tsx';

const STATUS: Readonly<Record<MovementStatus, { label: () => string; className: string }>> = {
  recorded: { label: m.goals_status_recorded, className: 'bg-green-tint-2 text-green-fg' },
  review: { label: m.goals_status_review, className: 'bg-amber-tint-2 text-amber-fg' },
  scheduled: { label: m.goals_status_scheduled, className: 'border border-border text-text-secondary' },
  skipped: { label: m.goals_status_skipped, className: 'border border-border text-subtle' },
};

/** "Kantong darurat" / "Setor manual" / "Tarik dana" and "BCA Tahapan → Bank Jago · Dana Darurat". */
export function movementText(
  movement: GoalMovement,
  goalNames: ReadonlyMap<string, string>,
  accounts: readonly AccountView[],
): { readonly title: string; readonly detail: string } {
  const name = (id: string | null) => accounts.find((account) => account.id === id)?.displayName ?? '—';
  const goals = movement.shares.map((share) => goalNames.get(share.goalId) ?? '—').join(', ');
  const title =
    movement.kind === 'plan'
      ? (movement.name ?? goals)
      : movement.amountMinor < 0n
        ? m.goals_movement_withdraw()
        : m.goals_movement_deposit();
  return { title, detail: [`${name(movement.fromAccountId)} → ${name(movement.toAccountId)}`, goals].join(' · ') };
}

export function MonthContributions({
  overview,
  accounts,
  locale,
}: {
  readonly overview: GoalsOverview;
  readonly accounts: readonly AccountView[];
  readonly locale: Locale;
}) {
  const { movements, month, goals } = overview;
  const byId = new Map(goals.map((goal) => [goal.id, goal]));
  const names = new Map(goals.map((goal) => [goal.id, goal.name]));
  const plannedMinor = goals
    .filter((goal) => goal.status === 'active' && goal.currency === overview.baseCurrency)
    .reduce((sum, goal) => sum + goal.monthlyPlanMinor, 0n);
  return (
    <section
      aria-labelledby="goals-month"
      className="flex min-w-0 flex-col rounded-[12px] border border-border bg-card"
    >
      <header className="flex items-center justify-between gap-2 px-5 pt-4 pb-2">
        <h2 id="goals-month" className="text-[15px] font-semibold text-fg">
          {m.goals_kpi_month({ month: monthName(month, locale, 'long') })}
        </h2>
        <Money
          minor={plannedMinor}
          currency={overview.baseCurrency}
          context="amount"
          locale={locale}
          className="text-[13px] text-muted-fg"
        />
      </header>
      {movements.length === 0 ? (
        <p className="px-5 py-6 text-[13px] text-muted-fg">{m.goals_month_none()}</p>
      ) : (
        <ul className="px-5">
          {movements.map((movement) => {
            const { title, detail } = movementText(movement, names, accounts);
            const [first] = movement.shares;
            const goal = movement.shares.length === 1 && first !== undefined ? byId.get(first.goalId) : undefined;
            const status = STATUS[movement.status];
            return (
              <li key={movement.key} className="flex items-center gap-3 border-b border-border py-3 last:border-b-0">
                <span className="flex w-8 shrink-0 flex-col items-center text-[11px] text-subtle">
                  <span className="text-[14px] font-medium text-fg">{Number(movement.date.slice(8))}</span>
                  {monthName(movement.date.slice(0, 7) as YearMonth, locale)}
                </span>
                {goal === undefined ? (
                  <span
                    aria-hidden="true"
                    className="flex size-7 shrink-0 items-center justify-center rounded-[7px] bg-violet-tint-2 text-violet"
                  >
                    <CalendarClock className="size-[14px]" />
                  </span>
                ) : (
                  <CategoryIcon icon={goal.icon} color={goal.color} />
                )}
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[13px] font-medium text-fg">{title}</span>
                  <span className="truncate text-[11.5px] text-subtle">{detail}</span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  <Money
                    minor={movement.amountMinor}
                    currency={overview.baseCurrency}
                    context={movement.status === 'recorded' ? 'delta' : 'amount'}
                    locale={locale}
                    className="text-[12.5px] text-fg"
                  />
                  <Chip className={status.className}>{status.label()}</Chip>
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <footer className="mt-auto flex items-center justify-between gap-2 border-t border-border px-5 py-3 text-[12px] text-subtle">
        <span className="flex items-center gap-1.5">
          <Link2 aria-hidden="true" className="size-3.5" />
          {m.goals_month_all()}
        </span>
        <Link
          to="/transactions"
          search={{ period: month, type: 'transfer' }}
          className="inline-flex items-center gap-1 text-blue-fg hover:underline focus-visible:outline-2 focus-visible:outline-ring"
        >
          {m.goals_month_open()}
          <ArrowUpRight aria-hidden="true" className="size-3.5" />
        </Link>
      </footer>
    </section>
  );
}
