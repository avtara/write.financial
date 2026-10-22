// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A goal's detail panel (design 13 `q9T3oQ`, sinking funds design 06 `McGzv`): saved of target with progress,
 * emergency-fund months and the estimate ("Tercapai Nov 2027"), where the money is ("Disimpan di", each source's
 * value and share), its recurring contributions ("Tiap tgl 1 · perlu konfirmasi", from → to, per month), and
 * "Riwayat setoran" from Transactions (`getGoalHistory`), with "Pakai dana", "Ubah", "Tarik dana", and "Setor manual".
 */
import { Link } from '@tanstack/react-router';
import type { AccountView } from '@wf/db/accounts';
import { ratioBps } from '@wf/domain/budget';
import { goalSnapshot } from '@wf/domain/goals';
import { monthsBetween, type LocalDate, type YearMonth } from '@wf/domain/period';
import type { Locale } from '@wf/i18n/locale';
import { m } from '@wf/i18n/messages';
import { formatDate } from '@wf/ui/dates';
import { Money } from '@wf/ui/money';
import { PageState } from '@wf/ui/page-state';
import { Percent } from '@wf/ui/percent';
import { Sheet } from '@wf/ui/sheet';
import {
  ArrowDownToLine,
  ArrowLeftRight,
  ArrowUpFromLine,
  ArrowUpRight,
  CircleCheck,
  Clock,
  Pencil,
  Receipt,
  Repeat,
  RotateCcw,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import type { GoalMovement } from '../../lib/goal-movements.ts';
import { ledgerErrorMessage } from '../../lib/ledger-errors.ts';
import { getGoalHistory, type GoalSummary } from '../../server/fn/goals.ts';
import { CategoryIcon } from '../category-icon.tsx';
import { periodLabel } from '../dashboard/dashboard-format.ts';
import { Button } from '../form.tsx';
import { RichMessage } from '../rich-message.tsx';
import { formatUnits } from '../investments/investments-model.ts';
import { GoalBar, type GoalActions } from './goal-list.tsx';
import { formatMonths, goalState } from './goals-model.ts';

type History =
  | { readonly status: 'loading' }
  | { readonly status: 'failed'; readonly message: string }
  | { readonly status: 'ready'; readonly movements: readonly GoalMovement[] };

export interface GoalDetailProps {
  readonly goal: GoalSummary | null;
  readonly accounts: readonly AccountView[];
  readonly today: LocalDate;
  readonly locale: Locale;
  readonly onOpenChange: (open: boolean) => void;
  readonly actions: GoalActions & { readonly pay: (goal: GoalSummary) => void };
}

function SectionTitle({ children, aside }: { readonly children: ReactNode; readonly aside?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <h3 className="text-[11.5px] font-medium tracking-wide text-muted-fg uppercase">{children}</h3>
      {aside}
    </div>
  );
}

export function GoalDetail({ goal, accounts, today, locale, onOpenChange, actions }: GoalDetailProps) {
  const active = goal?.status === 'active';
  return (
    <Sheet
      open={goal !== null}
      onOpenChange={onOpenChange}
      title={goal?.name ?? ''}
      {...(goal === null ? {} : { description: subtitle(goal, today, locale) })}
      closeLabel={m.goals_close()}
      footer={
        goal === null ? null : active ? (
          <>
            <Button
              size="sm"
              variant="secondary"
              className="whitespace-nowrap"
              onClick={() => {
                actions.pay(goal);
              }}
            >
              <Receipt aria-hidden="true" className="size-3.5" />
              {m.goals_action_pay()}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              className="whitespace-nowrap"
              onClick={() => {
                actions.edit(goal);
              }}
            >
              <Pencil aria-hidden="true" className="size-3.5" />
              {m.goals_action_edit()}
            </Button>
            <span className="flex-1" />
            <Button
              size="sm"
              variant="secondary"
              className="whitespace-nowrap"
              disabled={goal.sources.length === 0}
              onClick={() => {
                actions.withdraw(goal);
              }}
            >
              <ArrowUpFromLine aria-hidden="true" className="size-3.5" />
              {m.goals_action_withdraw()}
            </Button>
            <Button
              size="sm"
              className="whitespace-nowrap"
              onClick={() => {
                actions.deposit(goal);
              }}
            >
              <ArrowDownToLine aria-hidden="true" className="size-3.5" />
              {goal.kind === 'sinking' ? m.goals_action_set_aside_now() : m.goals_action_deposit()}
            </Button>
          </>
        ) : (
          <>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                actions.reopen(goal);
              }}
            >
              <RotateCcw aria-hidden="true" className="size-3.5" />
              {m.goals_action_reopen()}
            </Button>
            <span className="flex-1" />
            <Button
              size="sm"
              disabled={goal.sources.length === 0}
              onClick={() => {
                actions.moveRemainder(goal);
              }}
            >
              <ArrowLeftRight aria-hidden="true" className="size-3.5" />
              {m.goals_action_move()}
            </Button>
          </>
        )
      }
    >
      {goal === null ? null : <DetailBody goal={goal} accounts={accounts} locale={locale} actions={actions} />}
    </Sheet>
  );
}

/** "Target 3× pengeluaran bulanan", "Tenggat Jun 2027", or a sinking fund's "Jatuh tempo Mar 2027 · 5 bulan lagi". */
function subtitle(goal: GoalSummary, today: LocalDate, locale: Locale): string {
  if (goal.targetMode === 'monthly_expenses' && goal.targetMonths !== null) {
    return m.goals_detail_target_dynamic({ count: goal.targetMonths });
  }
  if (goal.deadlineMonth === null)
    return goal.kind === 'sinking' ? m.goals_kind_sinking() : m.goals_detail_no_deadline();
  const month = periodLabel(goal.deadlineMonth, locale);
  if (goal.kind !== 'sinking') return m.goals_detail_deadline({ month });
  const left = monthsBetween(today.slice(0, 7) as YearMonth, goal.deadlineMonth);
  return left > 0 ? m.goals_detail_due_in({ month, count: left }) : m.goals_detail_due({ month });
}

function DetailBody({
  goal,
  accounts,
  locale,
  actions,
}: Omit<GoalDetailProps, 'goal' | 'onOpenChange' | 'today'> & { readonly goal: GoalSummary }) {
  // Reloaded when the goal changes (a deposit updates its saved amount).
  const key = `${goal.id}:${String(goal.savedMinor)}`;
  const [loaded, setLoaded] = useState<{ readonly key: string; readonly history: History } | null>(null);
  const history: History = loaded?.key === key ? loaded.history : { status: 'loading' };
  const snapshot = goalSnapshot(goalState(goal));
  const accountOf = (id: string) => accounts.find((account) => account.id === id);
  const shares = new Map(goal.sources.map((source) => [source.id, ratioBps(source.valueMinor, goal.savedMinor)]));
  const name = (id: string) => accountOf(id)?.displayName ?? '—';

  useEffect(() => {
    let current = true;
    void getGoalHistory({ data: { id: goal.id } }).then(
      (result) => {
        if (!current) return;
        setLoaded({
          key,
          history: result.ok
            ? { status: 'ready', movements: result.value }
            : { status: 'failed', message: ledgerErrorMessage(result.code, locale) },
        });
      },
      () => {
        if (current) setLoaded({ key, history: { status: 'failed', message: m.goals_history_failed() } });
      },
    );
    return () => {
      current = false;
    };
  }, [key, goal.id, locale]);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline gap-2">
          <CategoryIcon icon={goal.icon} color={goal.color} size="lg" />
          <Money
            minor={goal.savedMinor}
            currency={goal.currency}
            context="amount"
            locale={locale}
            className="text-[26px] font-medium tracking-[-0.5px] text-fg"
          />
          <span className="text-[13px] text-subtle">
            <RichMessage
              message={m.goals_of_target}
              slots={{
                amount: <Money minor={goal.targetMinor} currency={goal.currency} context="amount" locale={locale} />,
              }}
            />
          </span>
        </div>
        <GoalBar color={goal.color} progressBps={snapshot.progressBps} size="lg" />
        <div className="flex items-center justify-between gap-2 text-[12.5px]">
          <span className="text-muted-fg">
            {snapshot.progressBps === null ? (
              '—'
            ) : (
              <Percent value={snapshot.progressBps / 10_000} decimals={0} locale={locale} />
            )}
            {snapshot.coverageBps === null
              ? null
              : ` · ${m.goals_detail_coverage({ months: formatMonths(snapshot.coverageBps, locale) })}`}
          </span>
          {snapshot.reached ? (
            <span className="flex items-center gap-1 text-green-fg">
              <CircleCheck aria-hidden="true" className="size-3.5" />
              {m.goals_badge_reached()}
            </span>
          ) : snapshot.estimate === null ? null : (
            <span className={snapshot.onTrack === false ? 'text-amber-fg' : 'text-green-fg'}>
              {m.goals_detail_estimate({ month: periodLabel(snapshot.estimate, locale) })}
            </span>
          )}
        </div>
        {goal.kind === 'sinking' ? (
          <dl className="grid grid-cols-3 gap-2">
            <div className="flex flex-col gap-0.5 rounded-[10px] border border-border p-2.5">
              <dt className="text-[11.5px] text-subtle">{m.goals_detail_per_month()}</dt>
              <dd className="text-[13px] font-medium text-fg">
                <Money minor={goal.monthlyPlanMinor} currency={goal.currency} context="amount" locale={locale} />
              </dd>
            </div>
            <div className="flex flex-col gap-0.5 rounded-[10px] border border-border p-2.5">
              <dt className="text-[11.5px] text-subtle">{m.goals_detail_missing()}</dt>
              <dd className="text-[13px] font-medium text-fg">
                <Money minor={snapshot.remainingMinor} currency={goal.currency} context="amount" locale={locale} />
              </dd>
            </div>
            <div className="flex flex-col gap-0.5 rounded-[10px] border border-border p-2.5">
              <dt className="text-[11.5px] text-subtle">{m.goals_detail_stored()}</dt>
              <dd className="truncate text-[13px] font-medium text-fg">
                {goal.sources[0]?.accountName ?? (goal.accountId === null ? '—' : name(goal.accountId))}
              </dd>
            </div>
          </dl>
        ) : null}
      </div>

      {goal.kind === 'sinking' ? null : (
        <section className="flex flex-col gap-2">
          <SectionTitle>{m.goals_detail_sources()}</SectionTitle>
          {goal.sources.length === 0 && goal.assetSources.length === 0 ? (
            <p className="text-[12.5px] text-muted-fg">{m.goals_detail_sources_empty()}</p>
          ) : null}
          {goal.assetSources.length === 0 ? null : (
            <ul className="flex flex-col rounded-[10px] border border-border">
              {goal.assetSources.map((source) => (
                <li key={source.id} className="flex items-center gap-3 border-b border-border p-3 last:border-b-0">
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-[13px] font-medium text-fg">{source.symbol}</span>
                    <span className="text-[11.5px] text-subtle">
                      {source.mode === 'whole'
                        ? m.goals_asset_whole()
                        : m.goals_asset_share({
                            percent: String(source.bps / 100).replace('.', locale === 'id' ? ',' : '.'),
                          })}{' '}
                      · {m.goals_asset_units({ units: formatUnits(source.units, locale, 3) })} ·{' '}
                      {m.goals_asset_market()}
                    </span>
                  </span>
                  <Money
                    minor={source.valueMinor}
                    currency={goal.currency}
                    context="amount"
                    locale={locale}
                    className="text-[13px] text-fg"
                  />
                </li>
              ))}
            </ul>
          )}
          {goal.sources.length === 0 ? null : (
            <ul className="flex flex-col rounded-[10px] border border-border">
              {goal.sources.map((source) => {
                const last4 = accountOf(source.accountId)?.last4 ?? null;
                const share = shares.get(source.id) ?? null;
                return (
                  <li key={source.id} className="flex items-center gap-3 border-b border-border p-3 last:border-b-0">
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-[13px] font-medium text-fg">{source.accountName}</span>
                      <span className="text-[11.5px] text-subtle">
                        {[
                          last4 === null ? null : `•• ${last4}`,
                          source.mode === 'whole' ? m.goals_source_whole() : m.goals_source_fixed(),
                        ]
                          .filter((part) => part !== null)
                          .join(' · ')}
                      </span>
                    </span>
                    <span className="flex flex-col items-end">
                      <Money
                        minor={source.valueMinor}
                        currency={goal.currency}
                        context="amount"
                        locale={locale}
                        className="text-[13px] text-fg"
                      />
                      {share === null ? null : (
                        <Percent
                          value={share / 10_000}
                          decimals={0}
                          locale={locale}
                          className="text-[11px] text-subtle"
                        />
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      <section className="flex flex-col gap-2">
        <SectionTitle
          aside={
            goal.status === 'active' ? (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  actions.plans(goal);
                }}
              >
                <Pencil aria-hidden="true" className="size-3.5" />
                {m.goals_detail_plans_edit()}
              </Button>
            ) : undefined
          }
        >
          {m.goals_detail_plans()}
        </SectionTitle>
        {goal.plans.length === 0 ? (
          <p className="text-[12.5px] text-muted-fg">{m.goals_plans_empty()}</p>
        ) : (
          <ul className="flex flex-col rounded-[10px] border border-border">
            {goal.plans.map((plan) => (
              <li key={plan.id} className="flex items-center gap-3 border-b border-border p-3 last:border-b-0">
                <Repeat aria-hidden="true" className="size-4 shrink-0 text-blue-fg" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-[13px] font-medium text-fg">
                    {plan.monthDay === null ? m.goals_plan_monthly() : m.goals_plan_day({ day: plan.monthDay })}
                    {' · '}
                    {plan.active ? m.goals_plan_confirm() : m.goals_plan_paused()}
                  </span>
                  <span className="truncate text-[11.5px] text-subtle">
                    {name(plan.fromAccountId)} → {name(plan.toAccountId)}
                  </span>
                </span>
                <span className="text-right text-[13px] text-fg">
                  <Money minor={plan.amountMinor} currency={goal.currency} context="amount" locale={locale} />
                  <span className="block text-[11px] text-subtle">{m.goals_per_month_suffix()}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <SectionTitle
          aside={
            goal.tag === null ? undefined : (
              <Link
                to="/transactions"
                search={{ tag: goal.tag }}
                className="inline-flex items-center gap-1 text-[12px] text-blue-fg hover:underline focus-visible:outline-2 focus-visible:outline-ring"
              >
                {m.goals_detail_open_transactions()}
                <ArrowUpRight aria-hidden="true" className="size-3.5" />
              </Link>
            )
          }
        >
          {m.goals_detail_history()}
        </SectionTitle>
        {history.status === 'loading' ? (
          <PageState kind="loading" title={m.goals_history_loading()} />
        ) : history.status === 'failed' ? (
          <p role="alert" className="text-[12.5px] text-red-fg">
            {history.message}
          </p>
        ) : history.movements.length === 0 ? (
          <p className="text-[12.5px] text-muted-fg">{m.goals_history_empty()}</p>
        ) : (
          <ul className="flex flex-col rounded-[10px] border border-border">
            {history.movements.map((movement) => {
              const upcoming = movement.status !== 'recorded';
              return (
                <li key={movement.key} className="flex items-center gap-3 border-b border-border p-3 last:border-b-0">
                  <span className="w-12 shrink-0 font-mono text-[12px] text-muted-fg">
                    {formatDate(movement.date, locale, 'day')}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="flex items-center gap-1.5 truncate text-[13px] text-fg">
                      {upcoming ? <Clock aria-hidden="true" className="size-3.5 text-subtle" /> : null}
                      {movement.name ??
                        (movement.amountMinor < 0n ? m.goals_movement_withdraw() : m.goals_movement_deposit())}
                    </span>
                    <span className="truncate text-[11.5px] text-subtle">
                      {[
                        upcoming
                          ? m.goals_history_next()
                          : movement.kind === 'plan'
                            ? m.goals_history_scheduled_transfer()
                            : m.goals_history_transfer(),
                        `${name(movement.fromAccountId)} → ${movement.toAccountId === null ? '—' : name(movement.toAccountId)}`,
                        goal.tag === null || movement.kind === 'plan' ? null : `#${goal.tag}`,
                      ]
                        .filter((part) => part !== null)
                        .join(' · ')}
                    </span>
                  </span>
                  <Money
                    minor={movement.amountMinor}
                    currency={goal.currency}
                    context="delta"
                    locale={locale}
                    className={`text-[13px] ${upcoming ? 'opacity-60' : ''}`}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
