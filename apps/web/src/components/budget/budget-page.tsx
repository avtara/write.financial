// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Anggaran" (FR-B1–B5, design section 06): the header with the period switcher, "Riwayat perubahan" and "Atur
 * Anggaran", the remaining hero, the category list, the Needs/Wants card, and "Perlu perhatian", with the sheets and
 * the move dialog they open. Every write refreshes the route's data; a closed period (FR-P3) is read-only, its edit
 * controls disabled with the reason or not rendered.
 */
import { useRouter } from '@tanstack/react-router';
import type { AccountView } from '@wf/db/accounts';
import type { BudgetLineView, BudgetStatus } from '@wf/db/budgets';
import type { CategoryView } from '@wf/db/categories';
import type { PeriodsOverview } from '@wf/db/periods';
import type { CategoryGroup as SpendingGroup } from '@wf/db/transaction-query';
import { formatMoney } from '@wf/i18n/format';
import { m } from '@wf/i18n/messages';
import { EmptyState } from '@wf/ui/empty-state';
import { usePrivacy } from '@wf/ui/privacy';
import { toast } from '@wf/ui/toast';
import { History, Lock, SlidersHorizontal, Wallet } from 'lucide-react';
import { useState } from 'react';
import { categoryName } from '../../lib/ledger-labels.ts';
import { ledgerErrorMessage } from '../../lib/ledger-errors.ts';
import type { Result } from '../../server/access.ts';
import {
  dismissBudgetAlert,
  moveBudgetLeftover,
  removeBudgetLine,
  restoreBudgetAlert,
  setBudgetLine,
  undoBudgetMove,
} from '../../server/fn/budget-write.ts';
import { Button } from '../form.tsx';
import { PageHeader } from '../page-header.tsx';
import { usePreferences } from '../preferences.tsx';
import { CategoryDialog } from '../settings/category-dialog.tsx';
import { settle } from '../setup/result.ts';
import { BudgetAttention } from './budget-attention.tsx';
import { BudgetCategorySheet } from './budget-category-sheet.tsx';
import { BudgetFormatProvider } from './budget-format.tsx';
import { BudgetHistorySheet } from './budget-history-sheet.tsx';
import { BudgetList, type BudgetLineActions } from './budget-list.tsx';
import { BudgetGroupsCard, BudgetHero, PeriodSwitcher, TransitionBanner } from './budget-overview.tsx';
import { BudgetSetupSheet } from './budget-setup-sheet.tsx';
import { MoveLeftoverDialog, type MoveRequest } from './move-leftover-dialog.tsx';

export interface BudgetPageProps {
  readonly status: BudgetStatus;
  readonly periods: PeriodsOverview;
  readonly categories: readonly CategoryView[];
  readonly accounts: readonly AccountView[];
  readonly spending: readonly SpendingGroup[];
  readonly timeZone: string;
  readonly onPeriodChange: (periodId: string) => void;
}

export function BudgetPage({
  status,
  periods,
  categories,
  accounts,
  spending,
  timeZone,
  onPeriodChange,
}: BudgetPageProps) {
  const router = useRouter();
  const { preferences } = usePreferences();
  const { hidden } = usePrivacy();
  const locale = preferences.locale;
  const currency = status.baseCurrency;
  const [editingId, setEditingId] = useState<string | null>(null);
  const [move, setMove] = useState<MoveRequest | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const { readOnly, totals, period } = status;
  const periodId = period.id as string;
  const money = (minor: bigint) => formatMoney(minor, currency, { locale, context: 'amount', privacy: hidden });
  const lineOf = (categoryId: string | null) => status.lines.find((line) => line.categoryId === categoryId) ?? null;

  const refresh = () => router.invalidate();

  /** Runs a write and refreshes; on failure an error toast with the ledger message and `null`. */
  const run = async <T,>(call: () => Promise<Result<T>>, failed: string): Promise<{ value: T } | null> => {
    const result = await settle(call);
    await refresh();
    if (result.ok) return { value: result.value };
    toast({ tone: 'error', title: failed, description: ledgerErrorMessage(result.code, locale) });
    return null;
  };

  const setLine = (line: BudgetLineView, patch: Parameters<typeof setBudgetLine>[0]['data']) =>
    run(() => setBudgetLine({ data: patch }), m.budget_save_failed({ name: categoryName(line) }));

  const actions: BudgetLineActions = {
    onEditLimit: (line) => {
      setDetailId(null);
      setEditingId(line.categoryId);
    },
    onCancelEdit: () => {
      setEditingId(null);
    },
    onSaveLimit: async (line, limitMinor) => {
      if (limitMinor === line.baseLimitMinor) {
        setEditingId(null);
        return true;
      }
      const saved = await setLine(line, { periodId, categoryId: line.categoryId, limitMinor });
      if (saved === null) return false;
      setEditingId(null);
      toast({ title: m.budget_limit_saved({ name: categoryName(line), amount: money(limitMinor) }) });
      return true;
    },
    onMoveFrom: (line) => {
      setMove({ targetId: null, sources: [{ categoryId: line.categoryId, amountMinor: line.remainingMinor }] });
    },
    onDetail: (line) => {
      setDetailId(line.categoryId);
    },
    onOptions: (line, patch) => {
      void setLine(line, { periodId, categoryId: line.categoryId, ...patch }).then((saved) => {
        if (saved !== null) toast({ title: m.budget_options_saved({ name: categoryName(line) }) });
      });
    },
    onRemove: (line) => {
      const name = categoryName(line);
      void run(
        () => removeBudgetLine({ data: { periodId, categoryId: line.categoryId } }),
        m.budget_save_failed({ name }),
      ).then((removed) => {
        if (removed === null) return;
        toast.undo({
          title: m.budget_removed({ name }),
          undoLabel: m.budget_undo(),
          onUndo: () => {
            void setLine(line, {
              periodId,
              categoryId: line.categoryId,
              limitMinor: line.baseLimitMinor,
              rollover: line.rollover,
              isFixed: line.isFixed,
              alertPct: line.alertPct,
            });
          },
        });
      });
    },
  };

  const onMove = async (target: BudgetLineView, sources: { categoryId: string; amountMinor: bigint }[]) => {
    const moved = await run(
      () => moveBudgetLeftover({ data: { periodId, targetCategoryId: target.categoryId, sources } }),
      m.budget_move_failed(),
    );
    if (moved === null) return false;
    setMove(null);
    const totalMinor = sources.reduce((total, source) => total + source.amountMinor, 0n);
    toast.undo({
      title: m.budget_moved_title({ amount: money(totalMinor), name: categoryName(target) }),
      description: m.budget_moved_description({
        sources: sources
          .map((source) => `${categoryName(lineOf(source.categoryId) as BudgetLineView)} ${money(source.amountMinor)}`)
          .join(m.budget_and()),
      }),
      undoLabel: m.budget_undo(),
      onUndo: () => {
        void run(() => undoBudgetMove({ data: { moveId: moved.value.moveId } }), m.budget_move_failed()).then(
          (undone) => {
            if (undone !== null) toast({ tone: 'info', title: m.budget_move_undone() });
          },
        );
      },
    });
    return true;
  };

  const header = (
    <PageHeader
      breadcrumb={[m.breadcrumb_finance(), m.nav_budget()]}
      title={m.nav_budget()}
      description={
        readOnly ? (
          <span className="flex flex-col items-start gap-1.5">
            <span>{m.budget_closed_description()}</span>
            <span className="inline-flex h-5 items-center gap-1 rounded-[5px] bg-surface-3 px-1.5 text-[11.5px] text-muted-fg">
              <Lock aria-hidden="true" className="size-3" />
              <span id="budget-read-only">{m.budget_read_only()}</span>
            </span>
          </span>
        ) : (
          m.budget_description({ day: totals.day, days: period.days, left: totals.daysLeft })
        )
      }
      secondaryActions={[
        {
          label: m.budget_history_button(),
          icon: History,
          onSelect: () => {
            setHistoryOpen(true);
          },
        },
      ]}
      actions={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <PeriodSwitcher period={period} periods={periods} onChange={onPeriodChange} />
          <Button
            size="sm"
            disabled={readOnly}
            {...(readOnly ? { 'aria-describedby': 'budget-read-only', title: m.budget_read_only() } : {})}
            onClick={() => {
              setSetupOpen(true);
            }}
          >
            <SlidersHorizontal aria-hidden="true" className="size-3.5" />
            {m.budget_setup_button()}
          </Button>
        </div>
      }
    />
  );

  return (
    <BudgetFormatProvider value={{ currency, locale }}>
      {header}
      {status.nextTransition === null || readOnly ? null : <TransitionBanner transition={status.nextTransition} />}
      {status.lines.length === 0 ? (
        <section className="rounded-[14px] border border-border bg-card">
          <EmptyState
            icon={Wallet}
            title={readOnly ? m.budget_empty_closed() : m.budget_empty_title()}
            description={m.budget_empty_description()}
            {...(readOnly
              ? {}
              : {
                  actions: (
                    <Button
                      size="sm"
                      onClick={() => {
                        setSetupOpen(true);
                      }}
                    >
                      {m.budget_setup_button()}
                    </Button>
                  ),
                })}
          />
        </section>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="xl:col-start-1">
            <BudgetHero status={status} />
          </div>
          <aside
            aria-label={m.budget_aside_label()}
            className="grid content-start items-start gap-4 md:grid-cols-2 xl:col-start-2 xl:row-span-2 xl:row-start-1 xl:grid-cols-1"
          >
            <BudgetGroupsCard status={status} />
            {readOnly ? null : (
              <BudgetAttention
                status={status}
                onCover={(line, sources) => {
                  setMove({ targetId: line.categoryId, sources });
                }}
                onRaise={actions.onEditLimit}
                onDismiss={(line) => {
                  const name = categoryName(line);
                  void run(
                    () => dismissBudgetAlert({ data: { periodId, categoryId: line.categoryId } }),
                    m.budget_save_failed({ name }),
                  ).then((done) => {
                    if (done === null) return;
                    toast.undo({
                      title: m.budget_dismissed({ name }),
                      undoLabel: m.budget_undo(),
                      onUndo: () => {
                        void run(
                          () => restoreBudgetAlert({ data: { periodId, categoryId: line.categoryId } }),
                          m.budget_save_failed({ name }),
                        );
                      },
                    });
                  });
                }}
                onRestore={(lines) => {
                  void Promise.all(
                    lines.map((line) =>
                      settle(() => restoreBudgetAlert({ data: { periodId, categoryId: line.categoryId } })),
                    ),
                  ).then(refresh);
                }}
              />
            )}
          </aside>
          <div className="xl:col-start-1">
            <BudgetList
              lines={status.lines}
              readOnly={readOnly}
              idealBps={totals.idealBps}
              totalLimitMinor={totals.limitMinor}
              editingId={editingId}
              actions={actions}
              categories={categories}
              spending={spending}
              onAdd={(categoryId) => {
                const category = categories.find((entry) => entry.id === categoryId) as CategoryView;
                void run(
                  () => setBudgetLine({ data: { periodId, categoryId, limitMinor: 0n } }),
                  m.budget_save_failed({ name: categoryName(category) }),
                ).then((added) => {
                  if (added !== null) setEditingId(categoryId);
                });
              }}
              onCreateCategory={() => {
                setCreating(true);
              }}
            />
          </div>
        </div>
      )}
      <MoveLeftoverDialog
        request={move}
        lines={status.lines}
        totalLimitMinor={totals.limitMinor}
        onClose={() => {
          setMove(null);
        }}
        onMove={onMove}
      />
      <BudgetCategorySheet
        line={lineOf(detailId)}
        status={status}
        accounts={accounts}
        onClose={() => {
          setDetailId(null);
        }}
        onCover={(line) => {
          setDetailId(null);
          setMove({ targetId: line.categoryId, sources: [] });
        }}
        onEditLimit={actions.onEditLimit}
      />
      {readOnly ? null : (
        <BudgetSetupSheet
          open={setupOpen}
          onOpenChange={setSetupOpen}
          status={status}
          categories={categories}
          onSaved={() => {
            setSetupOpen(false);
            void refresh();
          }}
        />
      )}
      <BudgetHistorySheet
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        categories={categories}
        current={period.label}
        timeZone={timeZone}
      />
      <CategoryDialog
        open={creating}
        onOpenChange={setCreating}
        category={null}
        kind="expense"
        onSaved={(category) => {
          setCreating(false);
          void run(
            () => setBudgetLine({ data: { periodId, categoryId: category.id, limitMinor: 0n } }),
            m.budget_save_failed({ name: categoryName(category) }),
          ).then((added) => {
            if (added !== null) setEditingId(category.id);
          });
        }}
      />
    </BudgetFormatProvider>
  );
}
