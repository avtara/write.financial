// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Tabungan" (FR-G1, G3, G4, FR-B6; design 13): the header with the month and "Setoran rutin" / "Tujuan baru", the
 * KPI strip, the goals with their tabs and menus, the month's contributions, the sinking funds, the detail panel, and
 * every dialog. Deposits and withdrawals are labeled transfers; recurring contributions only reach Transactions
 * through the Review queue. Every change reloads the route's data; completing offers "Urungkan".
 */
import { useNavigate, useRouter } from '@tanstack/react-router';
import type { AccountView } from '@wf/db/accounts';
import type { GoalView } from '@wf/db/goals';
import { depositPreview } from '@wf/domain/goals';
import { dateInMonth, shiftMonth, type YearMonth } from '@wf/domain/period';
import { m } from '@wf/i18n/messages';
import { ConfirmDialog } from '@wf/ui/confirm-dialog';
import { formatMonth } from '@wf/ui/dates';
import { Money } from '@wf/ui/money';
import { Percent } from '@wf/ui/percent';
import { toast } from '@wf/ui/toast';
import { ChevronLeft, ChevronRight, Plus, Repeat } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { ratioBps } from '@wf/domain/budget';
import { ledgerErrorMessage } from '../../lib/ledger-errors.ts';
import {
  completeGoal,
  depositToGoal,
  moveGoalRemainder,
  removeGoal,
  reopenGoal,
  setGoalPlanActive,
  withdrawFromGoal,
  type GoalSummary,
  type GoalsOverview,
} from '../../server/fn/goals.ts';
import { monthName } from '../dashboard/dashboard-format.ts';
import { Button } from '../form.tsx';
import { useRecordTransaction } from '../ledger/record-transaction.tsx';
import { wallTime, zonedInstant } from '../ledger/transaction-draft.ts';
import { PageHeader } from '../page-header.tsx';
import { usePreferences } from '../preferences.tsx';
import { RichMessage } from '../rich-message.tsx';
import { CompleteDialog, DepositDialog, RemainderDialog, WithdrawDialog, type MoveInput } from './goal-dialogs.tsx';
import { GoalDetail } from './goal-detail.tsx';
import { GoalForm, type GoalTemplate } from './goal-form.tsx';
import { GoalList, type GoalActions, type GoalTab } from './goal-list.tsx';
import { GoalPlans } from './goal-plans.tsx';
import { GoalsEmpty } from './goals-empty.tsx';
import { GoalsKpis } from './goals-kpis.tsx';
import { goalState, type GoalSort } from './goals-model.ts';
import { MonthContributions } from './month-contributions.tsx';
import { SinkingForm } from './sinking-form.tsx';
import { SinkingFunds } from './sinking-funds.tsx';

export interface GoalsPageProps {
  readonly overview: GoalsOverview;
  readonly accounts: readonly AccountView[];
  readonly timeZone: string;
  /** `?goal=<id>`: its detail opens. */
  readonly initialGoalId?: string | undefined;
  /** `?new`: the form opens. */
  readonly initialNew?: boolean;
  /** `?remainder=<id>` (the Record sheet's "Pindahkan sisa"): its dialog opens. */
  readonly initialRemainderId?: string | undefined;
  /** Clears the search params once they have been used. */
  readonly onConsumeSearch: () => void;
  readonly onMonthChange: (month: YearMonth) => void;
}

type Result<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly code: string };

export function GoalsPage({
  overview,
  accounts,
  timeZone,
  initialGoalId,
  initialNew = false,
  initialRemainderId,
  onConsumeSearch,
  onMonthChange,
}: GoalsPageProps) {
  const router = useRouter();
  const navigate = useNavigate();
  const { preferences } = usePreferences();
  const { locale, platform } = preferences;
  const record = useRecordTransaction();
  const { goals, today, month, baseCurrency } = overview;
  const currentMonth = today.slice(0, 7) as YearMonth;
  const [tab, setTab] = useState<GoalTab>('active');
  const [sort, setSort] = useState<GoalSort>('deadline');
  const [showSinking, setShowSinking] = useState(true);
  const [form, setForm] = useState<{ readonly goal?: GoalSummary; readonly template?: GoalTemplate } | null>(
    initialNew ? {} : null,
  );
  const [sinkingOpen, setSinkingOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(initialGoalId ?? null);
  const [depositId, setDepositId] = useState<string | null>(null);
  const [withdrawId, setWithdrawId] = useState<string | null>(null);
  const [completeId, setCompleteId] = useState<string | null>(null);
  const [remainderId, setRemainderId] = useState<string | null>(initialRemainderId ?? null);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [plans, setPlans] = useState<{ readonly goalId: string | null } | null>(null);
  const byId = (id: string | null) => goals.find((goal) => goal.id === id) ?? null;

  // The search can change while the page stays: open what it asks for, then drop it from the URL.
  const [search, setSearch] = useState({ goal: initialGoalId, isNew: initialNew, remainder: initialRemainderId });
  if (search.goal !== initialGoalId || search.isNew !== initialNew || search.remainder !== initialRemainderId) {
    setSearch({ goal: initialGoalId, isNew: initialNew, remainder: initialRemainderId });
    if (initialGoalId !== undefined) setDetailId(initialGoalId);
    if (initialNew) setForm({});
    if (initialRemainderId !== undefined) setRemainderId(initialRemainderId);
  }
  useEffect(() => {
    if (initialGoalId !== undefined || initialNew || initialRemainderId !== undefined) onConsumeSearch();
    // onConsumeSearch is a fresh closure each render; the search values are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialGoalId, initialNew, initialRemainderId]);

  const refresh = () => router.invalidate();
  const failed = (code: string) => {
    toast({ tone: 'error', title: ledgerErrorMessage(code, locale) });
  };
  const accountName = (id: string) => accounts.find((account) => account.id === id)?.displayName ?? '—';

  /** Runs a change: an error toast on failure, else `success` and a reload. */
  const run = async <T,>(pending: Promise<Result<T>>, success: (value: T) => void): Promise<boolean> => {
    const result = await pending.catch(() => null);
    if (result === null) {
      toast({ tone: 'error', title: m.goals_save_failed() });
      return false;
    }
    if (!result.ok) {
      failed(result.code);
      return false;
    }
    success(result.value);
    await refresh();
    return true;
  };

  const reopen = (goal: GoalView, resumePlanIds: readonly string[]) =>
    run(reopenGoal({ data: { id: goal.id, resumePlanIds: [...resumePlanIds] } }), () => {
      toast({ tone: 'info', title: m.goals_toast_reopened({ name: goal.name }) });
    });

  const setPlansActive = async (goal: GoalSummary, active: boolean) => {
    const changing = goal.plans.filter((plan) => plan.active !== active);
    for (const plan of changing) {
      const result = await setGoalPlanActive({ data: { planId: plan.id, active } }).catch(() => null);
      if (result === null || !result.ok) {
        if (result === null) toast({ tone: 'error', title: m.goals_save_failed() });
        else failed(result.code);
        await refresh();
        return;
      }
    }
    toast({
      tone: 'success',
      title: active ? m.goals_toast_resumed({ name: goal.name }) : m.goals_toast_paused({ name: goal.name }),
      action: {
        label: m.goals_undo(),
        onClick: () => {
          void (async () => {
            for (const plan of changing) await setGoalPlanActive({ data: { planId: plan.id, active: !active } });
            await refresh();
          })();
        },
      },
    });
    await refresh();
  };

  const actions: GoalActions & { readonly pay: (goal: GoalSummary) => void } = {
    open: (goal) => {
      setDetailId(goal.id);
    },
    deposit: (goal) => {
      setDepositId(goal.id);
    },
    withdraw: (goal) => {
      setWithdrawId(goal.id);
    },
    plans: (goal) => {
      setPlans({ goalId: goal.id });
    },
    setPlansActive: (goal, active) => {
      void setPlansActive(goal, active);
    },
    complete: (goal) => {
      setCompleteId(goal.id);
    },
    edit: (goal) => {
      setForm({ goal });
    },
    remove: (goal) => {
      setRemoveId(goal.id);
    },
    reopen: (goal) => {
      void reopen(goal, []);
    },
    moveRemainder: (goal) => {
      setRemainderId(goal.id);
    },
    pay: (goal) => {
      setDetailId(null);
      const source = goal.sources.find((candidate) => candidate.mode === 'fixed') ?? goal.sources[0];
      record.open({
        type: 'expense',
        goalId: goal.id,
        description: goal.name,
        ...(source === undefined ? {} : { accountId: source.accountId }),
      });
    },
  };

  const move = async (kind: 'deposit' | 'withdraw', goal: GoalSummary, input: MoveInput): Promise<string | null> => {
    const now = new Date();
    const data = {
      id: goal.id,
      clientId: input.clientId,
      occurredAt: zonedInstant(input.date, wallTime(now, timeZone), timeZone),
      fromAccountId: input.fromAccountId,
      toAccountId: input.toAccountId,
      amountMinor: input.amountMinor,
      note: input.note.trim() === '' ? null : input.note.trim(),
    };
    const result = await (kind === 'deposit' ? depositToGoal({ data }) : withdrawFromGoal({ data })).catch(() => null);
    if (result === null) return m.goals_save_failed();
    if (!result.ok) return ledgerErrorMessage(result.code, locale);
    const reached = kind === 'deposit' && depositPreview(goalState(goal), input.amountMinor).reachesTarget;
    if (kind === 'deposit') setDepositId(null);
    else setWithdrawId(null);
    toast({
      tone: 'success',
      title: kind === 'deposit' ? m.goals_toast_deposited() : m.goals_toast_withdrawn(),
      description: (
        <>
          <Money minor={input.amountMinor} currency={goal.currency} context="amount" locale={locale} />
          {' · '}
          {m.goals_toast_transfer_body({ from: accountName(input.fromAccountId), to: accountName(input.toAccountId) })}
        </>
      ),
      action: {
        label: m.goals_toast_view(),
        onClick: () => {
          void navigate({ to: '/transactions', search: { tx: result.value.transactionId } });
        },
      },
    });
    await refresh();
    if (reached) setCompleteId(goal.id);
    return null;
  };

  const complete = async (goal: GoalSummary, stopPlans: boolean) => {
    await run(completeGoal({ data: { id: goal.id, stopPlans } }), ({ stoppedPlanIds }) => {
      setCompleteId(null);
      setDetailId(null);
      const stopped = goal.plans
        .filter((plan) => stoppedPlanIds.includes(plan.id))
        .reduce((sum, plan) => sum + plan.amountMinor, 0n);
      toast.undo({
        title: m.goals_toast_completed({ name: goal.name }),
        description: (
          <>
            {m.goals_toast_completed_body()}
            {stopped === 0n ? null : (
              <>
                {' · '}
                <RichMessage
                  message={m.goals_toast_completed_stopped}
                  slots={{
                    amount: <Money minor={stopped} currency={goal.currency} context="amount" locale={locale} />,
                  }}
                />
              </>
            )}
          </>
        ),
        undoLabel: m.goals_undo(),
        onUndo: () => {
          void reopen(goal, stoppedPlanIds);
        },
      });
    });
  };

  const moveRemainder = async (goal: GoalSummary, toGoalId: string | null) => {
    await run(moveGoalRemainder({ data: { id: goal.id, toGoalId } }), (changed) => {
      setRemainderId(null);
      const target = changed.find((candidate) => candidate.id === toGoalId);
      const pct = target === undefined ? null : ratioBps(target.savedMinor, target.targetMinor);
      toast({
        tone: 'success',
        title: target === undefined ? m.goals_toast_released() : m.goals_toast_moved({ name: target.name }),
        ...(target === undefined
          ? {}
          : {
              description: (
                <RichMessage
                  message={m.goals_toast_moved_body}
                  slots={{
                    name: target.name,
                    amount: (
                      <Money minor={target.savedMinor} currency={target.currency} context="amount" locale={locale} />
                    ),
                    target: (
                      <Money minor={target.targetMinor} currency={target.currency} context="amount" locale={locale} />
                    ),
                    pct: pct === null ? '—' : <Percent value={pct / 10_000} decimals={0} locale={locale} />,
                  }}
                />
              ),
            }),
      });
    });
  };

  const active = goals.filter((goal) => goal.status === 'active');
  const monthLabel = formatMonth(dateInMonth(month, 1), locale);
  const removing = byId(removeId);
  const newButton: ReactNode = (
    <Button
      size="sm"
      onClick={() => {
        setForm({});
      }}
    >
      <Plus aria-hidden="true" className="size-3.5" />
      {m.goals_new()}
    </Button>
  );

  return (
    <>
      <PageHeader
        breadcrumb={[m.breadcrumb_finance(), m.nav_goals()]}
        title={m.nav_goals()}
        description={
          goals.length === 0
            ? m.goals_header_empty({ month: monthName(month, locale, 'long') })
            : `${m.goals_header_active({ count: active.length })} · ${monthLabel}`
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex h-8 items-center rounded-[8px] border border-border">
              <button
                type="button"
                aria-label={m.goals_month_previous()}
                onClick={() => {
                  onMonthChange(shiftMonth(month, -1));
                }}
                className="flex h-full w-8 items-center justify-center text-muted-fg hover:text-fg focus-visible:outline-2 focus-visible:outline-ring"
              >
                <ChevronLeft aria-hidden="true" className="size-3.5" />
              </button>
              <span className="px-2 text-[12.5px] font-medium text-fg" aria-live="polite">
                {monthLabel}
              </span>
              <button
                type="button"
                aria-label={m.goals_month_next()}
                disabled={month >= currentMonth}
                onClick={() => {
                  onMonthChange(shiftMonth(month, 1));
                }}
                className="flex h-full w-8 items-center justify-center text-muted-fg hover:text-fg focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-40"
              >
                <ChevronRight aria-hidden="true" className="size-3.5" />
              </button>
            </div>
            {goals.length === 0 ? null : (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  setPlans({ goalId: null });
                }}
              >
                <Repeat aria-hidden="true" className="size-3.5" />
                {m.goals_plans_button()}
              </Button>
            )}
            {newButton}
          </div>
        }
      />

      <div className="flex flex-col gap-4">
        <GoalsKpis overview={overview} locale={locale} />
        {goals.length === 0 ? (
          <GoalsEmpty
            averageSpendingMinor={overview.averageSpendingMinor}
            currency={baseCurrency}
            locale={locale}
            onCreate={(template) => {
              setForm(template === undefined ? {} : { template });
            }}
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
            <GoalList
              goals={goals}
              accounts={accounts}
              currentMonth={currentMonth}
              locale={locale}
              tab={tab}
              onTabChange={setTab}
              sort={sort}
              onSortChange={setSort}
              showSinking={showSinking}
              onShowSinkingChange={setShowSinking}
              actions={actions}
            />
            <div className="grid min-w-0 grid-cols-1 content-start gap-4 md:max-xl:grid-cols-2">
              <MonthContributions overview={overview} accounts={accounts} locale={locale} />
              <SinkingFunds
                overview={overview}
                accounts={accounts}
                locale={locale}
                onOpen={actions.open}
                onNew={() => {
                  setSinkingOpen(true);
                }}
              />
            </div>
          </div>
        )}
      </div>

      <GoalForm
        open={form !== null}
        goal={form?.goal}
        template={form?.template}
        goals={goals}
        accounts={accounts}
        baseCurrency={baseCurrency}
        today={today}
        averageSpendingMinor={overview.averageSpendingMinor}
        payday={overview.payday}
        locale={locale}
        onOpenChange={() => {
          setForm(null);
        }}
        onSaved={(saved, created) => {
          setForm(null);
          toast({
            tone: 'success',
            title: created ? m.goals_toast_created({ name: saved.name }) : m.goals_toast_updated({ name: saved.name }),
          });
          void refresh();
        }}
      />
      <SinkingForm
        open={sinkingOpen}
        overview={overview}
        accounts={accounts}
        locale={locale}
        onOpenChange={setSinkingOpen}
        onSaved={(saved) => {
          setSinkingOpen(false);
          toast({ tone: 'success', title: m.goals_toast_created({ name: saved.name }) });
          void refresh();
        }}
      />
      <GoalDetail
        goal={byId(detailId)}
        accounts={accounts}
        today={today}
        locale={locale}
        onOpenChange={() => {
          setDetailId(null);
        }}
        actions={actions}
      />
      <DepositDialog
        goal={byId(depositId)}
        goals={goals}
        accounts={accounts}
        today={today}
        locale={locale}
        platform={platform}
        onOpenChange={() => {
          setDepositId(null);
        }}
        onSubmit={(goal, input) => move('deposit', goal, input)}
      />
      <WithdrawDialog
        goal={byId(withdrawId)}
        goals={goals}
        accounts={accounts}
        today={today}
        locale={locale}
        platform={platform}
        onOpenChange={() => {
          setWithdrawId(null);
        }}
        onSubmit={(goal, input) => move('withdraw', goal, input)}
      />
      <CompleteDialog
        goal={byId(completeId)}
        today={today}
        locale={locale}
        onOpenChange={() => {
          setCompleteId(null);
        }}
        onComplete={complete}
      />
      <RemainderDialog
        goal={byId(remainderId)}
        goals={goals}
        locale={locale}
        onOpenChange={() => {
          setRemainderId(null);
        }}
        onMove={moveRemainder}
      />
      <GoalPlans
        open={plans !== null}
        goalId={plans?.goalId ?? null}
        overview={overview}
        accounts={accounts}
        locale={locale}
        onOpenChange={() => {
          setPlans(null);
        }}
        onChanged={() => {
          void refresh();
        }}
      />
      {removing === null ? null : (
        <ConfirmDialog
          open
          onOpenChange={() => {
            setRemoveId(null);
          }}
          title={m.goals_remove_title({ name: removing.name })}
          description={m.goals_remove_description()}
          confirmLabel={m.goals_menu_remove()}
          cancelLabel={m.goals_form_cancel()}
          variant="destructive"
          onConfirm={() => {
            setRemoveId(null);
            setDetailId(null);
            void run(removeGoal({ data: { id: removing.id } }), () => {
              toast({ tone: 'success', title: m.goals_toast_removed({ name: removing.name }) });
            });
          }}
        />
      )}
    </>
  );
}
