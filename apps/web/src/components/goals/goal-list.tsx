// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Tujuan tabungan" (design 13 `uFKEw`, `JdZkw`, `D3nEd`, `QI76x`): the Aktif / Selesai tabs, the sort menu
 * ("Tenggat terdekat", "Progres tertinggi", "Sisa terbesar", "Nama A–Z"; "Tampilkan dana tidak rutin"), and one row
 * per goal: its icon, where its money is, saved of target, progress, the monthly contribution with its days and
 * month, a badge ("Sesuai rencana", "2 bulan lagi", "Hampir tercapai"), and the ⋮ menu with every action.
 */
import type { AccountView } from '@wf/db/accounts';
import { goalSnapshot } from '@wf/domain/goals';
import type { YearMonth } from '@wf/domain/period';
import type { Locale } from '@wf/i18n/locale';
import { m } from '@wf/i18n/messages';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@wf/ui/dropdown-menu';
import { Money } from '@wf/ui/money';
import { Percent } from '@wf/ui/percent';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@wf/ui/tabs';
import {
  ArrowDownToLine,
  ArrowUpDown,
  ArrowUpFromLine,
  ChevronDown,
  CircleCheck,
  CirclePause,
  CirclePlay,
  Ellipsis,
  Landmark,
  PanelRight,
  Pencil,
  Repeat,
  RotateCcw,
  Trash2,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { colorProps } from '../../lib/colors.ts';
import type { GoalSummary } from '../../server/fn/goals.ts';
import { BudgetBar } from '../budget/budget-bar.tsx';
import { CategoryIcon } from '../category-icon.tsx';
import { periodLabel } from '../dashboard/dashboard-format.ts';
import { RichMessage } from '../rich-message.tsx';
import {
  GOAL_SORTS,
  goalBadge,
  goalState,
  planDays,
  sortDone,
  sortGoals,
  type GoalBadge,
  type GoalSort,
} from './goals-model.ts';

export interface GoalActions {
  readonly open: (goal: GoalSummary) => void;
  readonly deposit: (goal: GoalSummary) => void;
  readonly withdraw: (goal: GoalSummary) => void;
  readonly plans: (goal: GoalSummary) => void;
  /** Pauses (`false`) or resumes (`true`) every plan of the goal. */
  readonly setPlansActive: (goal: GoalSummary, active: boolean) => void;
  readonly complete: (goal: GoalSummary) => void;
  readonly edit: (goal: GoalSummary) => void;
  readonly remove: (goal: GoalSummary) => void;
  readonly reopen: (goal: GoalSummary) => void;
  readonly moveRemainder: (goal: GoalSummary) => void;
}

export type GoalTab = 'active' | 'done';

const SORT_LABEL: Readonly<Record<GoalSort, () => string>> = {
  deadline: m.goals_sort_deadline,
  progress: m.goals_sort_progress,
  remaining: m.goals_sort_remaining,
  name: m.goals_sort_name,
};

const BADGE_TONE: Readonly<Record<GoalBadge['kind'], string>> = {
  reached: 'bg-green-tint-2 text-green-fg',
  almost: 'bg-blue-tint-2 text-blue-fg',
  soon: 'border border-border text-text-secondary',
  on_track: 'bg-green-tint-2 text-green-fg',
  behind: 'bg-amber-tint-2 text-amber-fg',
};

function badgeLabel(badge: GoalBadge): string {
  switch (badge.kind) {
    case 'reached':
      return m.goals_badge_reached();
    case 'almost':
      return m.goals_badge_almost();
    case 'soon':
      return badge.months === 0 ? m.goals_badge_this_month() : m.goals_badge_soon({ count: badge.months });
    case 'on_track':
      return m.goals_badge_on_track();
    case 'behind':
      return m.goals_badge_behind();
  }
}

/** A small rounded label (badges, source chips). */
export function Chip({
  icon: Icon,
  className = 'border border-border text-muted-fg',
  children,
}: {
  readonly icon?: LucideIcon;
  readonly className?: string;
  readonly children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-[5px] px-1.5 py-px text-[11px] whitespace-nowrap ${className}`}
    >
      {Icon === undefined ? null : <Icon aria-hidden="true" className="size-3" />}
      {children}
    </span>
  );
}

/** Where the goal's money is: "Dana tidak rutin" for sinking funds, else its account sources. */
export function SourceChips({
  goal,
  accounts,
  locale,
}: {
  readonly goal: GoalSummary;
  readonly accounts: readonly AccountView[];
  readonly locale: Locale;
}) {
  if (goal.kind === 'sinking') return <Chip icon={Wallet}>{m.goals_kind_sinking()}</Chip>;
  return (
    <>
      {goal.sources.map((source) => {
        const last4 = accounts.find((account) => account.id === source.accountId)?.last4 ?? null;
        return (
          <Chip key={source.id} icon={Landmark}>
            {source.mode === 'fixed' ? (
              <>
                {source.accountName}{' '}
                <Money minor={source.valueMinor} currency={goal.currency} context="amount" locale={locale} />
              </>
            ) : last4 === null ? (
              source.accountName
            ) : (
              `${source.accountName} •• ${last4}`
            )}
          </Chip>
        );
      })}
    </>
  );
}

/** The goal's progress bar in its color. */
export function GoalBar({
  color,
  progressBps,
  size = 'sm',
}: {
  readonly color: string;
  readonly progressBps: number | null;
  readonly size?: 'sm' | 'lg';
}) {
  return (
    <span {...colorProps(color)} className="block w-full">
      <BudgetBar
        usedBps={progressBps === null ? null : Math.min(progressBps, 10_000)}
        tone="ok"
        idealBps={null}
        size={size}
        fillClassName="fill-[var(--wf-color,var(--subtle))]"
      />
    </span>
  );
}

/** "Rp3.500.000/bulan · tgl 1 & 14 · Nov 2027" (the deadline, else the estimate). */
export function PlanLine({
  goal,
  estimate,
  locale,
}: {
  readonly goal: GoalSummary;
  readonly estimate: YearMonth | null;
  readonly locale: Locale;
}) {
  const days = planDays(goal);
  const month = goal.deadlineMonth ?? estimate;
  return (
    <span className="min-w-0 truncate">
      {goal.monthlyPlanMinor > 0n ? (
        <RichMessage
          message={m.goals_card_plan}
          slots={{
            amount: <Money minor={goal.monthlyPlanMinor} currency={goal.currency} context="amount" locale={locale} />,
            days: days.join(' & '),
          }}
        />
      ) : (
        m.goals_card_no_plan()
      )}
      {month === null ? null : ` · ${periodLabel(month, locale)}`}
    </span>
  );
}

function GoalMenu({ goal, actions }: { readonly goal: GoalSummary; readonly actions: GoalActions }) {
  const active = goal.status === 'active';
  const hasPlans = goal.plans.length > 0;
  const anyActivePlan = goal.plans.some((plan) => plan.active);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={m.goals_menu_open({ name: goal.name })}
        className="flex size-[26px] items-center justify-center rounded-[6px] text-subtle hover:bg-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-ring data-[state=open]:bg-muted"
      >
        <Ellipsis aria-hidden="true" className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[232px]">
        <DropdownMenuGroup>
          <DropdownMenuItem
            icon={PanelRight}
            onSelect={() => {
              actions.open(goal);
            }}
          >
            {m.goals_menu_detail()}
          </DropdownMenuItem>
          {active ? (
            <>
              <DropdownMenuItem
                icon={ArrowDownToLine}
                onSelect={() => {
                  actions.deposit(goal);
                }}
              >
                {m.goals_menu_deposit()}
              </DropdownMenuItem>
              <DropdownMenuItem
                icon={ArrowUpFromLine}
                disabled={goal.sources.length === 0}
                onSelect={() => {
                  actions.withdraw(goal);
                }}
              >
                {m.goals_menu_withdraw()}
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          {active ? (
            <>
              <DropdownMenuItem
                icon={Repeat}
                onSelect={() => {
                  actions.plans(goal);
                }}
              >
                {m.goals_menu_plans()}
              </DropdownMenuItem>
              {hasPlans ? (
                <DropdownMenuItem
                  icon={anyActivePlan ? CirclePause : CirclePlay}
                  onSelect={() => {
                    actions.setPlansActive(goal, !anyActivePlan);
                  }}
                >
                  {anyActivePlan ? m.goals_menu_pause() : m.goals_menu_resume()}
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem
                icon={Pencil}
                onSelect={() => {
                  actions.edit(goal);
                }}
              >
                {m.goals_menu_edit()}
              </DropdownMenuItem>
              <DropdownMenuItem
                icon={CircleCheck}
                onSelect={() => {
                  actions.complete(goal);
                }}
              >
                {m.goals_menu_complete()}
              </DropdownMenuItem>
            </>
          ) : (
            <>
              <DropdownMenuItem
                icon={RotateCcw}
                onSelect={() => {
                  actions.reopen(goal);
                }}
              >
                {m.goals_menu_reopen()}
              </DropdownMenuItem>
              <DropdownMenuItem
                icon={ArrowUpDown}
                disabled={goal.sources.length === 0}
                onSelect={() => {
                  actions.moveRemainder(goal);
                }}
              >
                {m.goals_menu_move()}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem
            icon={Trash2}
            variant="destructive"
            onSelect={() => {
              actions.remove(goal);
            }}
          >
            {m.goals_menu_remove()}
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function GoalRow({
  goal,
  accounts,
  currentMonth,
  locale,
  actions,
}: {
  readonly goal: GoalSummary;
  readonly accounts: readonly AccountView[];
  readonly currentMonth: YearMonth;
  readonly locale: Locale;
  readonly actions: GoalActions;
}) {
  const snapshot = goalSnapshot(goalState(goal));
  const active = goal.status === 'active';
  const badge = active ? goalBadge(goal, snapshot, currentMonth) : null;
  return (
    <li className="flex flex-col gap-3 border-b border-border py-4 last:border-b-0">
      <div className="flex items-start gap-3">
        <CategoryIcon icon={goal.icon} color={goal.color} size="lg" />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <button
            type="button"
            onClick={() => {
              actions.open(goal);
            }}
            className="w-fit truncate text-left text-[14px] font-medium text-fg hover:underline focus-visible:outline-2 focus-visible:outline-ring"
          >
            {goal.name}
          </button>
          <span className="flex flex-wrap gap-1.5">
            <SourceChips goal={goal} accounts={accounts} locale={locale} />
          </span>
        </div>
        <div className="flex flex-col items-end gap-px">
          <Money
            minor={goal.savedMinor}
            currency={goal.currency}
            context="amount"
            locale={locale}
            className="text-[18px] font-medium tracking-[-0.4px] text-fg"
          />
          <span className="text-[12px] text-subtle">
            <RichMessage
              message={m.goals_of_target}
              slots={{
                amount: <Money minor={goal.targetMinor} currency={goal.currency} context="amount" locale={locale} />,
              }}
            />
          </span>
        </div>
        <GoalMenu goal={goal} actions={actions} />
      </div>
      <div className="grid grid-cols-[minmax(0,220px)_auto_minmax(0,1fr)_auto] items-center gap-3 pl-12 text-[12px] text-muted-fg max-xl:grid-cols-[minmax(0,1fr)_auto] max-xl:pl-0">
        <GoalBar color={goal.color} progressBps={snapshot.progressBps} />
        <span className="font-mono text-text-secondary">
          {snapshot.progressBps === null ? (
            '—'
          ) : (
            <Percent value={snapshot.progressBps / 10_000} decimals={0} locale={locale} />
          )}
        </span>
        <span className="flex min-w-0 items-center gap-1.5">
          <Repeat aria-hidden="true" className="size-3.5 shrink-0 text-subtle" />
          <PlanLine goal={goal} estimate={snapshot.estimate} locale={locale} />
        </span>
        <span className="justify-self-end">
          {active ? (
            badge === null ? null : (
              <Chip className={BADGE_TONE[badge.kind]}>{badgeLabel(badge)}</Chip>
            )
          ) : (
            <Chip className="border border-border text-text-secondary">
              {goal.status === 'used' ? m.goals_status_used() : m.goals_status_completed()}
            </Chip>
          )}
        </span>
      </div>
    </li>
  );
}

export interface GoalListProps {
  readonly goals: readonly GoalSummary[];
  readonly accounts: readonly AccountView[];
  readonly currentMonth: YearMonth;
  readonly locale: Locale;
  readonly tab: GoalTab;
  readonly onTabChange: (tab: GoalTab) => void;
  readonly sort: GoalSort;
  readonly onSortChange: (sort: GoalSort) => void;
  readonly showSinking: boolean;
  readonly onShowSinkingChange: (show: boolean) => void;
  readonly actions: GoalActions;
}

export function GoalList({
  goals,
  accounts,
  currentMonth,
  locale,
  tab,
  onTabChange,
  sort,
  onSortChange,
  showSinking,
  onShowSinkingChange,
  actions,
}: GoalListProps) {
  const active = sortGoals(
    goals.filter((goal) => goal.status === 'active' && (showSinking || goal.kind !== 'sinking')),
    sort,
    locale,
  );
  const done = sortDone(goals.filter((goal) => goal.status !== 'active'));
  const rows = (list: readonly GoalSummary[], empty: string) =>
    list.length === 0 ? (
      <p className="px-5 py-8 text-center text-[13px] text-muted-fg">{empty}</p>
    ) : (
      <ul className="px-5">
        {list.map((goal) => (
          <GoalRow
            key={goal.id}
            goal={goal}
            accounts={accounts}
            currentMonth={currentMonth}
            locale={locale}
            actions={actions}
          />
        ))}
      </ul>
    );
  return (
    <section aria-labelledby="goals-list" className="flex min-w-0 flex-col rounded-[12px] border border-border bg-card">
      <Tabs
        value={tab}
        onValueChange={(value) => {
          onTabChange(value as GoalTab);
        }}
      >
        <header className="flex flex-wrap items-center justify-between gap-3 px-5 pt-4 pb-2">
          <h2 id="goals-list" className="text-[15px] font-semibold text-fg">
            {m.goals_list_title()}
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <TabsList label={m.goals_tabs_label()}>
              <TabsTrigger value="active">
                {m.goals_tab_active({ count: goals.filter((goal) => goal.status === 'active').length })}
              </TabsTrigger>
              <TabsTrigger value="done">{m.goals_tab_done({ count: done.length })}</TabsTrigger>
            </TabsList>
            {tab === 'active' ? (
              <DropdownMenu>
                <DropdownMenuTrigger className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-border px-2.5 text-[12.5px] text-fg hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring">
                  <ArrowUpDown aria-hidden="true" className="size-3.5 text-subtle" />
                  {SORT_LABEL[sort]()}
                  <ChevronDown aria-hidden="true" className="size-3.5 text-subtle" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-[232px]">
                  <DropdownMenuGroup>
                    <DropdownMenuLabel>{m.goals_sort_label()}</DropdownMenuLabel>
                    <DropdownMenuRadioGroup
                      value={sort}
                      onValueChange={(value) => {
                        onSortChange(value as GoalSort);
                      }}
                    >
                      {GOAL_SORTS.map((option) => (
                        <DropdownMenuRadioItem key={option} value={option}>
                          {SORT_LABEL[option]()}
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    <DropdownMenuLabel>{m.goals_view_label()}</DropdownMenuLabel>
                    <DropdownMenuCheckboxItem
                      indicator="switch"
                      checked={showSinking}
                      onCheckedChange={(checked) => {
                        onShowSinkingChange(checked);
                      }}
                    >
                      {m.goals_view_sinking()}
                    </DropdownMenuCheckboxItem>
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <span className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-border px-2.5 text-[12.5px] text-muted-fg">
                <ArrowUpDown aria-hidden="true" className="size-3.5 text-subtle" />
                {m.goals_sort_done()}
              </span>
            )}
          </div>
        </header>
        <TabsContent value="active">{rows(active, m.goals_active_empty())}</TabsContent>
        <TabsContent value="done">{rows(done, m.goals_done_empty())}</TabsContent>
      </Tabs>
    </section>
  );
}
