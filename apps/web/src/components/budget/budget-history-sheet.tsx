// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Riwayat perubahan anggaran" (FR-B1, design `Cb4oT`): the total per month (each version applies until the next one;
 * the month after the current one is "otomatis"), and per version "BERLAKU MULAI …" with each changed line
 * (Rp3.500.000 → Rp3.700.000, "Kategori baru", removed), filterable by category.
 */
import type { BudgetHistoryChange, BudgetHistoryEntry } from '@wf/db/budgets';
import type { CategoryView } from '@wf/db/categories';
import { formatPeriodLabel, type YearMonth } from '@wf/domain/period';
import { m } from '@wf/i18n/messages';
import { formatTime } from '@wf/ui/dates';
import { PageState } from '@wf/ui/page-state';
import { Sheet } from '@wf/ui/sheet';
import { ArrowRight, Pencil, Plus, Sparkles, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { categoryName } from '../../lib/ledger-labels.ts';
import { ledgerErrorMessage } from '../../lib/ledger-errors.ts';
import { getBudgetHistory } from '../../server/fn/budget.ts';
import { CategoryIcon } from '../category-icon.tsx';
import { Select } from '../form.tsx';
import type { Result } from '../../server/access.ts';
import { settle } from '../setup/result.ts';
import { Amount, useBudgetFormat } from './budget-format.tsx';

/** The month after `label` (`2026-12` → `2027-01`). */
function nextMonth(label: YearMonth): YearMonth {
  const year = Number(label.slice(0, 4));
  const month = Number(label.slice(5, 7));
  return (
    month === 12 ? `${String(year + 1)}-01` : `${String(year)}-${String(month + 1).padStart(2, '0')}`
  ) as YearMonth;
}

/** Each month from the first version to the one after `current`, with the total of the version in force. */
export function monthlyTotals(entries: readonly BudgetHistoryEntry[], current: YearMonth) {
  const oldestFirst = entries.toReversed();
  const first = oldestFirst[0];
  if (first === undefined) return [];
  const last = nextMonth(current);
  const months: { label: YearMonth; totalMinor: bigint; automatic: boolean }[] = [];
  for (let label = first.effectiveFrom; label <= last; label = nextMonth(label)) {
    const inForce = oldestFirst.findLast((entry) => entry.effectiveFrom <= label) as BudgetHistoryEntry;
    months.push({ label, totalMinor: inForce.totalMinor, automatic: label > current && inForce.effectiveFrom < label });
  }
  return months;
}

/** A change with its signed difference (+200.000, −500.000, the whole limit for an added or removed line). */
function withDelta(change: BudgetHistoryChange) {
  return { ...change, deltaMinor: (change.toMinor ?? 0n) - (change.fromMinor ?? 0n) };
}

export interface BudgetHistorySheetProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly categories: readonly CategoryView[];
  /** The label of the period shown on the page (highlighted). */
  readonly current: YearMonth;
  readonly timeZone: string;
}

function History({
  entries,
  categories,
  current,
  timeZone,
}: Omit<BudgetHistorySheetProps, 'open' | 'onOpenChange'> & { entries: BudgetHistoryEntry[] }) {
  const { locale } = useBudgetFormat();
  const [filter, setFilter] = useState('');
  const byId = new Map(categories.map((category) => [category.id, category]));
  const totals = monthlyTotals(entries, current);
  const max = totals.reduce((top, month) => (month.totalMinor > top ? month.totalMinor : top), 1n);
  const months = totals.map((month) => ({ ...month, height: Math.max(Number((month.totalMinor * 56n) / max), 4) }));
  const changeCount = entries.reduce((total, entry) => total + (entry.changes?.length ?? 1), 0);
  const changed = [...new Set(entries.flatMap((entry) => entry.changes?.map((change) => change.categoryId) ?? []))];
  const shownMonth = months.find((month) => month.label === current);
  const stamp = (at: Date) =>
    `${new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone }).format(at)} · ${formatTime(at, timeZone, locale)}`;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <div className="w-[200px]">
          <Select
            size="sm"
            aria-label={m.budget_history_filter()}
            value={filter}
            onChange={(event) => {
              setFilter(event.target.value);
            }}
          >
            <option value="">{m.budget_history_all()}</option>
            {changed.map((id) => {
              const category = byId.get(id);
              return category === undefined ? null : (
                <option key={id} value={id}>
                  {categoryName(category)}
                </option>
              );
            })}
          </Select>
        </div>
        <span className="text-[12px] text-subtle">{m.budget_history_count({ count: changeCount })}</span>
      </div>
      {shownMonth === undefined ? null : (
        <section aria-label={m.budget_history_totals()} className="flex flex-col gap-3">
          <div className="flex items-end justify-between gap-3">
            <div className="flex flex-col">
              <span className="text-[12px] text-subtle">{m.budget_history_totals()}</span>
              <Amount valueMinor={shownMonth.totalMinor} className="text-[20px] font-medium text-fg" />
            </div>
            <span className="text-[12px] text-subtle">{m.budget_history_until_changed()}</span>
          </div>
          <ol className="grid grid-flow-col gap-2 [grid-auto-columns:minmax(0,1fr)]">
            {months.map((month) => {
              const { height } = month;
              return (
                <li key={month.label} className="flex flex-col items-center gap-1">
                  <Amount valueMinor={month.totalMinor} bare className="text-[10.5px] text-subtle" />
                  <svg aria-hidden="true" viewBox="0 0 40 56" preserveAspectRatio="none" className="h-14 w-full">
                    <rect
                      y={56 - height}
                      width="40"
                      height={height}
                      rx="3"
                      className={month.label === current ? 'fill-blue' : 'fill-surface-3'}
                    />
                  </svg>
                  <span className={`text-[11px] ${month.label === current ? 'font-semibold text-fg' : 'text-subtle'}`}>
                    {formatPeriodLabel(month.label, locale, 'month').slice(0, 3)}
                    {month.automatic ? ` · ${m.budget_history_automatic()}` : ''}
                  </span>
                </li>
              );
            })}
          </ol>
        </section>
      )}
      <ol className="flex flex-col gap-5">
        {entries.map((entry) => {
          const changes = (entry.changes ?? [])
            .filter((change) => filter === '' || change.categoryId === filter)
            .map(withDelta);
          if (entry.changes !== null && changes.length === 0) return null;
          if (entry.changes === null && filter !== '') return null;
          return (
            <li key={entry.versionId} className="flex flex-col">
              <h3 className="flex items-center justify-between border-b border-border pb-2 text-[11px] font-medium text-subtle uppercase">
                <span>
                  {m.budget_history_effective({ month: formatPeriodLabel(entry.effectiveFrom, locale, 'monthYear') })}
                </span>
                <span className="font-mono normal-case">
                  {m.budget_history_total()} <Amount valueMinor={entry.totalMinor} />
                </span>
              </h3>
              <ul className="flex flex-col divide-y divide-border">
                {entry.changes === null ? (
                  <li className="flex items-center gap-3 py-3">
                    <span className="flex size-7 items-center justify-center rounded-[7px] bg-surface-3 text-muted-fg">
                      <Sparkles aria-hidden="true" className="size-3.5" />
                    </span>
                    <div className="flex flex-1 flex-col">
                      <span className="text-[13px] font-medium text-fg">{m.budget_history_created()}</span>
                      <span className="text-[12px] text-subtle">
                        {m.budget_history_created_count({ count: entry.lineCount })}
                      </span>
                    </div>
                    <span className="text-[11.5px] text-subtle">{stamp(entry.createdAt)}</span>
                  </li>
                ) : (
                  changes.map((change) => {
                    const category = byId.get(change.categoryId);
                    const { deltaMinor } = change;
                    const Icon = change.change === 'added' ? Plus : change.change === 'removed' ? Trash2 : Pencil;
                    return (
                      <li key={change.categoryId} className="flex items-center gap-3 py-3">
                        {category === undefined ? (
                          <span className="size-7" />
                        ) : (
                          <CategoryIcon icon={category.icon} color={category.color} size="sm" />
                        )}
                        <div className="flex min-w-0 flex-1 flex-col">
                          <span className="flex items-center gap-1.5 text-[13px] font-medium text-fg">
                            {category === undefined ? m.budget_history_deleted_category() : categoryName(category)}
                            <Icon aria-hidden="true" className="size-3 text-subtle" />
                          </span>
                          <span className="flex items-center gap-1 font-mono text-[11.5px] text-subtle">
                            {change.change === 'added' ? (
                              <>
                                {m.budget_history_added()} · <Amount valueMinor={change.toMinor ?? 0n} />
                              </>
                            ) : change.change === 'removed' ? (
                              <>
                                {m.budget_history_removed()} · <Amount valueMinor={change.fromMinor ?? 0n} />
                              </>
                            ) : (
                              <>
                                <Amount valueMinor={change.fromMinor ?? 0n} />
                                <ArrowRight aria-hidden="true" className="size-3" />
                                <Amount valueMinor={change.toMinor ?? 0n} />
                              </>
                            )}
                          </span>
                        </div>
                        <div className="flex flex-col items-end">
                          <span
                            className={`font-mono text-[12px] ${deltaMinor >= 0n ? 'text-green-fg' : 'text-red-fg'}`}
                          >
                            {deltaMinor >= 0n ? '+' : '−'}
                            <Amount valueMinor={deltaMinor >= 0n ? deltaMinor : -deltaMinor} bare />
                          </span>
                          <span className="text-[11.5px] text-subtle">{stamp(change.at)}</span>
                        </div>
                      </li>
                    );
                  })
                )}
              </ul>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** Loads the history when the sheet opens (its content mounts then). */
function HistoryLoader(props: Omit<BudgetHistorySheetProps, 'open' | 'onOpenChange'>) {
  const { locale } = useBudgetFormat();
  const [loaded, setLoaded] = useState<Result<BudgetHistoryEntry[]> | null>(null);
  useEffect(() => {
    let live = true;
    void settle(() => getBudgetHistory()).then((result) => {
      if (live) setLoaded(result);
    });
    return () => {
      live = false;
    };
  }, []);
  if (loaded === null) return <PageState kind="loading" title={m.budget_history_loading()} />;
  if (!loaded.ok) {
    return (
      <PageState kind="error" title={m.budget_history_failed()} description={ledgerErrorMessage(loaded.code, locale)} />
    );
  }
  if (loaded.value.length === 0) return <PageState kind="empty" title={m.budget_history_empty()} />;
  const first = loaded.value.at(-1) as BudgetHistoryEntry;
  return (
    <>
      <p className="-mt-3 mb-5 text-[13px] text-muted-fg">
        {m.budget_history_since({ month: formatPeriodLabel(first.effectiveFrom, locale, 'monthYear') })}
      </p>
      <History entries={loaded.value} {...props} />
    </>
  );
}

export function BudgetHistorySheet({ open, onOpenChange, ...props }: BudgetHistorySheetProps) {
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={m.budget_history_title()}
      closeLabel={m.budget_close()}
    >
      {open ? <HistoryLoader {...props} /> : null}
    </Sheet>
  );
}
