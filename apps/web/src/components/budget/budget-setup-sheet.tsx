// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Atur anggaran" (FR-B1, design `F0xibH`): every line's monthly limit with its 3-month average, "Isi dari rata-rata
 * 3 bulan", the expected income against what is allocated ("Sisa pemasukan"), adding and removing categories, and
 * saving as the version effective from this period ("1 perubahan · berlaku mulai Oktober 2026"). Earlier periods keep
 * their numbers; the server refuses a version that would reach a closed period (FR-P3).
 */
import type { BudgetStatus, FillSuggestion } from '@wf/db/budgets';
import type { CategoryView } from '@wf/db/categories';
import type { AlertPct } from '@wf/domain/budget';
import type { CategoryGroup } from '@wf/domain/categories';
import { formatPeriodLabel } from '@wf/domain/period';
import { m } from '@wf/i18n/messages';
import { AmountInput } from '@wf/ui/amount-input';
import { Combobox } from '@wf/ui/command';
import { Sheet } from '@wf/ui/sheet';
import { toast } from '@wf/ui/toast';
import { Plus, Shapes, Sparkles, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { categoryGroupLabel, categoryName } from '../../lib/ledger-labels.ts';
import { ledgerErrorMessage } from '../../lib/ledger-errors.ts';
import { getBudgetFill } from '../../server/fn/budget.ts';
import { saveBudgetVersion } from '../../server/fn/budget-write.ts';
import { CATEGORY_ICONS, CategoryIcon } from '../category-icon.tsx';
import { Button, Field } from '../form.tsx';
import { RichMessage } from '../rich-message.tsx';
import { settle } from '../setup/result.ts';
import { Amount, useBudgetFormat } from './budget-format.tsx';

const GROUPS = ['needs', 'wants', 'financial'] as const;
type SetupGroup = (typeof GROUPS)[number];
const GROUP_FILL: Readonly<Record<SetupGroup, string>> = {
  needs: 'fill-blue',
  wants: 'fill-violet',
  financial: 'fill-cyan',
};
const GROUP_DOT: Readonly<Record<SetupGroup, string>> = { needs: 'bg-blue', wants: 'bg-violet', financial: 'bg-cyan' };

interface SetupRow {
  readonly categoryId: string;
  readonly name: string;
  readonly builtInKey: string | null;
  readonly icon: string;
  readonly color: string;
  readonly group: CategoryGroup;
  readonly limitMinor: bigint | null;
  readonly rollover: boolean;
  readonly isFixed: boolean;
  readonly alertPct: AlertPct;
}

function initialRows(status: BudgetStatus): SetupRow[] {
  return status.lines.map((line) => ({
    categoryId: line.categoryId,
    name: line.name,
    builtInKey: line.builtInKey,
    icon: line.icon,
    color: line.color,
    group: line.group,
    limitMinor: line.baseLimitMinor,
    rollover: line.rollover,
    isFixed: line.isFixed,
    alertPct: line.alertPct,
  }));
}

export interface BudgetSetupSheetProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly status: BudgetStatus;
  readonly categories: readonly CategoryView[];
  readonly onSaved: () => void;
}

function SetupForm({ status, categories, onOpenChange, onSaved }: Omit<BudgetSetupSheetProps, 'open'>) {
  const { currency, locale } = useBudgetFormat();
  const [rows, setRows] = useState(() => initialRows(status));
  const [income, setIncome] = useState<bigint | null>(status.version?.expectedIncomeMinor ?? null);
  const [averages, setAverages] = useState<ReadonlyMap<string, bigint> | null>(null);
  const [pending, setPending] = useState(false);
  const periodId = status.period.id as string;

  useEffect(() => {
    let live = true;
    void settle(() => getBudgetFill({ data: { periodId } })).then((result) => {
      if (live && result.ok) {
        setAverages(new Map(result.value.map((row: FillSuggestion) => [row.categoryId, row.averageMinor])));
      }
    });
    return () => {
      live = false;
    };
  }, [periodId]);

  const original = new Map(status.lines.map((line) => [line.categoryId, line.baseLimitMinor]));
  const changes =
    rows.filter((row) => original.get(row.categoryId) !== row.limitMinor).length +
    status.lines.filter((line) => !rows.some((row) => row.categoryId === line.categoryId)).length;
  const allocatedMinor = rows.reduce((total, row) => total + (row.limitMinor ?? 0n), 0n);
  const groupTotal = (group: CategoryGroup) =>
    rows.filter((row) => row.group === group).reduce((total, row) => total + (row.limitMinor ?? 0n), 0n);
  const scaleMinor = income !== null && income > allocatedMinor ? income : allocatedMinor;
  const month = formatPeriodLabel(status.period.label, locale, 'monthYear');
  const invalid = rows.some((row) => row.limitMinor === null);

  const update = (categoryId: string, limitMinor: bigint | null) => {
    setRows((current) => current.map((row) => (row.categoryId === categoryId ? { ...row, limitMinor } : row)));
  };

  const addable = categories.filter(
    (category) =>
      category.kind !== 'income' && category.archivedAt === null && !rows.some((row) => row.categoryId === category.id),
  );

  const save = async () => {
    setPending(true);
    const result = await settle(() =>
      saveBudgetVersion({
        data: {
          effectiveFrom: status.period.label,
          expectedIncomeMinor: income,
          lines: rows.map((row) => ({
            categoryId: row.categoryId,
            // "Simpan anggaran" is disabled while a limit is empty (`invalid`).
            limitMinor: row.limitMinor as bigint,
            rollover: row.rollover,
            isFixed: row.isFixed,
            alertPct: row.alertPct,
          })),
        },
      }),
    );
    setPending(false);
    if (!result.ok) {
      toast({ tone: 'error', title: m.budget_setup_failed(), description: ledgerErrorMessage(result.code, locale) });
      return;
    }
    toast({ title: m.budget_setup_saved({ month }) });
    onSaved();
  };

  // The allocation bar: each group's share of the income (or of the allocation when it exceeds the income).
  const segments = GROUPS.reduce<{ group: SetupGroup; x: number; width: number }[]>((placed, group) => {
    const previous = placed.at(-1);
    const x = previous === undefined ? 0 : previous.x + previous.width;
    const width = scaleMinor === 0n ? 0 : Number((groupTotal(group) * 1000n) / scaleMinor);
    return [...placed, { group, x, width }];
  }, []);
  const rowViews = rows.map((row) => {
    const before = original.get(row.categoryId);
    return {
      row,
      averageMinor: averages?.get(row.categoryId),
      isNew: before === undefined,
      deltaMinor: before === undefined || row.limitMinor === null ? null : row.limitMinor - before,
    };
  });
  const remainingIncomeMinor = income === null ? null : income - allocatedMinor;
  return (
    <>
      <div className="flex flex-col gap-5">
        <Field label={m.budget_setup_income()} hint={m.budget_setup_income_hint()}>
          {(props) => (
            <AmountInput
              id={props.id}
              aria-describedby={props.describedBy}
              value={income}
              onValueChange={setIncome}
              currency={currency}
              locale={locale}
              size="inline"
            />
          )}
        </Field>
        <section aria-label={m.budget_setup_allocated()} className="flex flex-col gap-2">
          <div className="flex items-end justify-between gap-3">
            <div className="flex flex-col">
              <span className="text-[12px] text-subtle">{m.budget_setup_allocated()}</span>
              <Amount valueMinor={allocatedMinor} className="text-[20px] font-medium text-fg" />
            </div>
            {remainingIncomeMinor === null ? null : (
              <div className="flex flex-col items-end">
                <span className="text-[12px] text-subtle">{m.budget_setup_income_left()}</span>
                <Amount
                  valueMinor={remainingIncomeMinor}
                  className={`text-[15px] font-medium ${remainingIncomeMinor < 0n ? 'text-red-fg' : 'text-fg'}`}
                />
              </div>
            )}
          </div>
          <svg aria-hidden="true" viewBox="0 0 1000 8" preserveAspectRatio="none" className="block h-2 w-full">
            <rect width="1000" height="8" rx="4" className="fill-surface-3" />
            {segments.map(({ group, x, width }) =>
              width === 0 ? null : (
                <rect key={group} x={x} width={Math.max(width - 3, 0)} height="8" className={GROUP_FILL[group]} />
              ),
            )}
          </svg>
          <ul className="flex flex-wrap gap-x-4 text-[12px] text-muted-fg">
            {GROUPS.filter((group) => rows.some((row) => row.group === group)).map((group) => (
              <li key={group} className="flex items-center gap-1.5">
                <span aria-hidden="true" className={`size-1.5 rounded-full ${GROUP_DOT[group]}`} />
                {categoryGroupLabel(group)} <Amount valueMinor={groupTotal(group)} className="text-subtle" />
              </li>
            ))}
          </ul>
        </section>
        <div className="flex items-center justify-between gap-3 border-t border-border pt-4">
          <span className="text-[12.5px] text-muted-fg">{m.budget_setup_count({ count: rows.length })}</span>
          <Button
            variant="secondary"
            size="sm"
            disabled={averages === null || averages.size === 0}
            onClick={() => {
              setRows((current) =>
                current.map((row) => {
                  const average = averages?.get(row.categoryId);
                  return average === undefined ? row : { ...row, limitMinor: average };
                }),
              );
            }}
          >
            <Sparkles aria-hidden="true" className="size-3.5" />
            {m.budget_setup_fill()}
          </Button>
        </div>
        {GROUPS.map((group) => {
          const members = rowViews.filter((view) => view.row.group === group);
          if (members.length === 0) return null;
          return (
            <section key={group} aria-label={categoryGroupLabel(group)} className="flex flex-col">
              <h3 className="flex items-center justify-between pb-2 text-[11px] font-medium text-subtle uppercase">
                <span className="flex items-center gap-1.5">
                  <span aria-hidden="true" className={`size-1.5 rounded-full ${GROUP_DOT[group]}`} />
                  {categoryGroupLabel(group)}
                </span>
                <Amount valueMinor={groupTotal(group)} bare className="text-[12px] font-normal normal-case" />
              </h3>
              <ul className="flex flex-col divide-y divide-border">
                {members.map(({ row, averageMinor, isNew, deltaMinor }) => {
                  const name = categoryName(row);
                  return (
                    <li key={row.categoryId} className="flex items-center gap-3 py-2.5">
                      <CategoryIcon icon={row.icon} color={row.color} size="sm" />
                      <div className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-[13px] font-medium text-fg">{name}</span>
                        <span className="text-[11.5px] text-subtle">
                          {averageMinor === undefined ? (
                            isNew ? (
                              m.budget_setup_new()
                            ) : (
                              m.budget_setup_no_average()
                            )
                          ) : (
                            <RichMessage
                              message={m.budget_setup_average}
                              slots={{ amount: <Amount valueMinor={averageMinor} /> }}
                            />
                          )}
                        </span>
                      </div>
                      {deltaMinor === null || deltaMinor === 0n ? null : (
                        <span
                          className={`font-mono text-[11.5px] ${deltaMinor > 0n ? 'text-green-fg' : 'text-red-fg'}`}
                        >
                          {deltaMinor > 0n ? '+' : '−'}
                          <Amount valueMinor={deltaMinor > 0n ? deltaMinor : -deltaMinor} bare />
                        </span>
                      )}
                      <div className="w-[140px]">
                        <AmountInput
                          value={row.limitMinor}
                          onValueChange={(value) => {
                            update(row.categoryId, value);
                          }}
                          currency={currency}
                          locale={locale}
                          size="inline"
                          aria-label={m.budget_setup_limit_label({ name })}
                        />
                      </div>
                      <button
                        type="button"
                        aria-label={m.budget_setup_remove({ name })}
                        onClick={() => {
                          setRows((current) => current.filter((entry) => entry.categoryId !== row.categoryId));
                        }}
                        className="flex size-7 items-center justify-center rounded-[6px] text-subtle hover:bg-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-ring"
                      >
                        <X aria-hidden="true" className="size-3.5" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
        <Combobox
          value={null}
          onValueChange={(categoryId) => {
            const category = categories.find((entry) => entry.id === categoryId) as CategoryView;
            setRows((current) => [
              ...current,
              {
                categoryId,
                name: category.name,
                builtInKey: category.builtInKey,
                icon: category.icon,
                color: category.color,
                group: category.group,
                limitMinor: averages?.get(categoryId) ?? 0n,
                rollover: false,
                isFixed: category.isFixed,
                alertPct: 85,
              },
            ]);
          }}
          groups={GROUPS.map((group) => ({
            heading: categoryGroupLabel(group),
            options: addable
              .filter((category) => category.group === group)
              .map((category) => ({
                value: category.id,
                label: categoryName(category),
                icon: CATEGORY_ICONS[category.icon]?.glyph ?? Shapes,
              })),
          })).filter((group) => group.options.length > 0)}
          label={m.budget_add_label()}
          searchPlaceholder={m.budget_add_search()}
          emptyLabel={m.budget_add_empty()}
          contentClassName="w-[340px]"
        >
          <button
            type="button"
            className="flex h-9 items-center gap-2 self-start rounded-[7px] px-2 text-[13px] font-medium text-fg hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
          >
            <Plus aria-hidden="true" className="size-4" />
            {m.budget_setup_add()}
          </button>
        </Combobox>
      </div>
      <div className="sticky bottom-0 mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-border bg-card py-4">
        <span className="flex items-center gap-1.5 text-[12px] text-muted-fg">
          {changes > 0 ? <span aria-hidden="true" className="size-1.5 rounded-full bg-amber" /> : null}
          {m.budget_setup_changes({ count: changes, month })}
        </span>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              onOpenChange(false);
            }}
          >
            {m.settings_cancel()}
          </Button>
          <Button size="sm" pending={pending} disabled={invalid} onClick={() => void save()}>
            {m.budget_setup_save()}
          </Button>
        </div>
      </div>
    </>
  );
}

export function BudgetSetupSheet({ open, onOpenChange, status, categories, onSaved }: BudgetSetupSheetProps) {
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={m.budget_setup_title()}
      description={m.budget_setup_description()}
      closeLabel={m.budget_close()}
    >
      {open ? (
        <SetupForm status={status} categories={categories} onOpenChange={onOpenChange} onSaved={onSaved} />
      ) : null}
    </Sheet>
  );
}
