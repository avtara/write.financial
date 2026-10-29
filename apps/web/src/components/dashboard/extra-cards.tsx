// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The cards "Atur dashboard" can add (FR-D3, design `GcXr5` "Bisa ditambahkan"): "Tujuan tabungan" (each active
 * goal's progress) and "Pengingat tagihan" (unpaid bills in the next 7 days). Each links to the page that holds the
 * details; a part that failed to load says so in place. Investments live only on their own page.
 */
import { Link } from '@tanstack/react-router';
import type { GoalView } from '@wf/db/goals';
import type { ScheduledItem } from '@wf/db/schedules';
import { ratioBps } from '@wf/domain/budget';
import { addDays, countDays, type LocalDate } from '@wf/domain/period';
import type { Locale } from '@wf/i18n/locale';
import { m } from '@wf/i18n/messages';
import { formatDate } from '@wf/ui/dates';
import { Money } from '@wf/ui/money';
import type { ReactNode } from 'react';

/** Goals and bills listed; the rest are on their pages. */
const MAX_ROWS = 4;
const ROW = 'flex items-center justify-between gap-3 text-[12.5px]';

interface MiniCardProps {
  readonly id: string;
  readonly title: string;
  readonly caption: string;
  readonly to: '/investments' | '/goals' | '/calendar';
  readonly children: ReactNode;
}

function MiniCard({ id, title, caption, to, children }: MiniCardProps) {
  return (
    <section
      aria-labelledby={id}
      className="flex h-full flex-col gap-4 rounded-[12px] border border-border bg-card px-6 py-5"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 id={id} className="text-[15px] font-semibold text-fg">
            {title}
          </h2>
          <p className="text-[12.5px] text-muted-fg">{caption}</p>
        </div>
        <Link
          to={to}
          className="rounded-[6px] px-1 text-[12.5px] text-muted-fg hover:text-fg focus-visible:outline-2 focus-visible:outline-ring"
        >
          {m.overview_card_see_all()}
        </Link>
      </div>
      {children}
    </section>
  );
}

const Note = ({ children }: { children: ReactNode }) => <p className="text-[13px] text-subtle">{children}</p>;

export interface GoalsCardProps {
  /** Active goals; `null`: they could not be loaded. */
  readonly goals: readonly GoalView[] | null;
  readonly locale: Locale;
}

/** Saved ÷ target in basis points for the bar, capped at full; 0 without a target. */
const progressBps = (goal: GoalView): number => Math.min(ratioBps(goal.savedMinor, goal.targetMinor) ?? 0, 10_000);

/** "Tujuan tabungan": each active goal's saved amount against its target, in the goals' own order. */
export function GoalsCard({ goals, locale }: GoalsCardProps) {
  return (
    <MiniCard
      id="overview-card-goals"
      title={m.overview_card_goals_title()}
      caption={m.overview_card_goals_caption()}
      to="/goals"
    >
      {goals === null ? (
        <Note>{m.overview_card_failed()}</Note>
      ) : goals.length === 0 ? (
        <Note>{m.overview_card_goals_empty()}</Note>
      ) : (
        <ul className="flex flex-col gap-3">
          {goals.slice(0, MAX_ROWS).map((goal) => {
            const bps = progressBps(goal);
            return (
              <li key={goal.id} className="flex flex-col gap-1.5">
                <div className={ROW}>
                  <span className="min-w-0 truncate text-fg">{goal.name}</span>
                  <span className="shrink-0 font-mono text-muted-fg">
                    <Money minor={goal.savedMinor} currency={goal.currency} context="amount" locale={locale} />
                    {' / '}
                    <Money minor={goal.targetMinor} currency={goal.currency} context="amount" locale={locale} />
                  </span>
                </div>
                <svg
                  role="progressbar"
                  aria-label={goal.name}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(bps / 100)}
                  viewBox="0 0 10000 1"
                  preserveAspectRatio="none"
                  className="block h-1.5 w-full rounded-full"
                >
                  <rect width="10000" height="1" className="fill-surface-3" />
                  <rect width={bps} height="1" className="fill-green" />
                </svg>
              </li>
            );
          })}
        </ul>
      )}
    </MiniCard>
  );
}

/** The unpaid outgoing bills due from `today` through 6 days later, soonest first. */
export function billsAhead(items: readonly ScheduledItem[], today: LocalDate): ScheduledItem[] {
  const last = addDays(today, 6);
  return items
    .filter(
      (item) =>
        item.direction === 'out' &&
        item.transactionId === null &&
        (item.status === 'scheduled' || item.status === 'due_review' || item.status === 'unconfirmed') &&
        item.dueDate >= today &&
        item.dueDate <= last,
    )
    .toSorted((a, b) => a.dueDate.localeCompare(b.dueDate));
}

export interface BillsCardProps {
  /** The scheduled items from `today` through 6 days later; `null`: they could not be loaded. */
  readonly items: readonly ScheduledItem[] | null;
  readonly today: LocalDate;
  readonly locale: Locale;
}

/** "Pengingat tagihan": what is still to pay in the next 7 days ("3 hari lagi"). */
export function BillsCard({ items, today, locale }: BillsCardProps) {
  const bills = items === null ? null : billsAhead(items, today);
  return (
    <MiniCard
      id="overview-card-bills"
      title={m.overview_card_bills_title()}
      caption={m.overview_card_bills_caption()}
      to="/calendar"
    >
      {bills === null ? (
        <Note>{m.overview_card_failed()}</Note>
      ) : bills.length === 0 ? (
        <Note>{m.overview_card_bills_empty()}</Note>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {bills.slice(0, MAX_ROWS).map((bill) => {
            const days = countDays(today, bill.dueDate) - 1;
            return (
              <li key={`${bill.sourceId}-${bill.dueDate}`} className={ROW}>
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-fg">{bill.name ?? m.overview_card_bills_untitled()}</span>
                  <span className="text-[11.5px] text-subtle">
                    {formatDate(bill.dueDate, locale, 'day')} ·{' '}
                    {days === 0 ? m.overview_subs_due_today() : m.overview_subs_due_in({ days })}
                  </span>
                </span>
                <Money
                  minor={bill.expectedMinor}
                  currency={bill.currency}
                  context="amount"
                  locale={locale}
                  className="shrink-0 font-mono text-fg"
                />
              </li>
            );
          })}
        </ul>
      )}
    </MiniCard>
  );
}
