// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Detail kategori" (FR-B2, design `IACml`): spent against the limit with the ideal for today, what is left, the
 * category's safe daily limit and projection, the daily spending of the period against the safe daily line, the
 * three periods before ("3 bulan terakhir"), and the latest transactions. In an open period it offers "Tambah dari
 * kategori lain" (FR-B3) and "Ubah batas".
 */
import type { AccountView } from '@wf/db/accounts';
import type { BudgetLineView, BudgetStatus } from '@wf/db/budgets';
import { formatPeriodLabel } from '@wf/domain/period';
import { m } from '@wf/i18n/messages';
import { formatDate } from '@wf/ui/dates';
import { PageState } from '@wf/ui/page-state';
import { Sheet } from '@wf/ui/sheet';
import { ArrowLeftRight, Pencil } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { categoryGroupLabel, categoryName } from '../../lib/ledger-labels.ts';
import { ledgerErrorMessage } from '../../lib/ledger-errors.ts';
import type { Result } from '../../server/access.ts';
import { getBudgetCategory, type BudgetCategoryDetail } from '../../server/fn/budget.ts';
import { CategoryIcon } from '../category-icon.tsx';
import { Button } from '../form.tsx';
import { RichMessage } from '../rich-message.tsx';
import { settle } from '../setup/result.ts';
import { BudgetBar } from './budget-bar.tsx';
import { Amount, Pct, useBudgetFormat } from './budget-format.tsx';
import { barLength, lineTone } from './budget-model.ts';

const CHART_HEIGHT = 80;
const BAR_STEP = 10;

/** Daily bars (SVG attributes only, CSP-safe): over the safe daily limit in amber, under it in blue. */
function DailyChart({ detail, line, label }: { detail: BudgetCategoryDetail; line: BudgetLineView; label: string }) {
  const safe = line.safeDailyMinor;
  const top = detail.daily.reduce((max, day) => (day.outMinor > max ? day.outMinor : max), safe ?? 1n) || 1n;
  const scale = (value: bigint) => Number((value * BigInt(CHART_HEIGHT)) / top);
  const width = detail.daily.length * BAR_STEP;
  const safeY = safe === null ? null : CHART_HEIGHT - scale(safe);
  const bars = detail.daily.map((day) => ({
    date: day.date,
    height: Math.max(scale(day.outMinor), day.outMinor > 0n ? 2 : 1),
    empty: day.outMinor === 0n,
    high: safe !== null && day.outMinor > safe,
  }));
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${String(width)} ${String(CHART_HEIGHT)}`}
      preserveAspectRatio="none"
      className="block h-20 w-full"
    >
      {bars.map(({ date, height, empty, high }, index) => {
        return (
          <rect
            key={date}
            x={index * BAR_STEP + 1.5}
            y={CHART_HEIGHT - height}
            width={BAR_STEP - 3}
            height={height}
            rx="1"
            className={empty ? 'fill-surface-3' : high ? 'fill-amber' : 'fill-blue'}
          />
        );
      })}
      {safeY === null ? null : (
        <line
          x1="0"
          x2={width}
          y1={safeY}
          y2={safeY}
          strokeDasharray="4 3"
          className="stroke-subtle"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
        />
      )}
    </svg>
  );
}

function Tile({
  label,
  value,
  note,
  red = false,
}: {
  label: string;
  value: ReactNode;
  note: ReactNode;
  red?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-[10px] border border-border px-3 py-2.5">
      <span className="text-[11.5px] text-subtle">{label}</span>
      <span className={`text-[15px] font-medium ${red ? 'text-red-fg' : 'text-fg'}`}>{value}</span>
      <span className={`text-[11px] ${red ? 'text-red-fg-soft' : 'text-subtle'}`}>{note}</span>
    </div>
  );
}

export interface BudgetCategorySheetProps {
  readonly line: BudgetLineView | null;
  readonly status: BudgetStatus;
  readonly accounts: readonly AccountView[];
  readonly onClose: () => void;
  readonly onCover: (line: BudgetLineView) => void;
  readonly onEditLimit: (line: BudgetLineView) => void;
}

function Detail({
  line,
  status,
  accounts,
}: {
  line: BudgetLineView;
  status: BudgetStatus;
  accounts: readonly AccountView[];
}) {
  const { locale } = useBudgetFormat();
  const [loaded, setLoaded] = useState<Result<BudgetCategoryDetail> | null>(null);
  const periodId = status.period.id as string;
  useEffect(() => {
    let live = true;
    void settle(() => getBudgetCategory({ data: { periodId, categoryId: line.categoryId } })).then((result) => {
      if (live) setLoaded(result);
    });
    return () => {
      live = false;
    };
  }, [periodId, line.categoryId]);
  const { totals, readOnly, period } = status;
  const tone = lineTone(line);
  const accountName = new Map(accounts.map((account) => [account.id, account.displayName]));
  const monthBars = (month: { readonly spentMinor: bigint }) => ({
    used: Number((month.spentMinor * 10_000n) / maxMonth),
    limitAt: Number((line.limitMinor * 10_000n) / maxMonth),
  });
  const maxMonth = (loaded?.ok === true ? loaded.value.months : []).reduce(
    (top, month) => (month.spentMinor > top ? month.spentMinor : top),
    line.limitMinor > 0n ? line.limitMinor : 1n,
  );
  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div className="flex flex-col">
            <span className="text-[12px] text-subtle">{m.budget_detail_spent()}</span>
            <span className="flex items-baseline gap-1.5">
              <Amount valueMinor={line.spentMinor} className="text-[24px] font-medium text-fg" />
              <span className="font-mono text-[13px] text-subtle">
                / <Amount valueMinor={line.limitMinor} bare />
              </span>
            </span>
          </div>
          <span className="rounded-[6px] bg-amber-tint-2 px-2 py-0.5 font-mono text-[11.5px] text-amber-fg">
            {readOnly || line.isFixed ? (
              <Pct bps={line.usedBps} />
            ) : (
              <RichMessage
                message={m.budget_kpi_spent_note}
                slots={{ used: <Pct bps={line.usedBps} />, ideal: <Pct bps={totals.idealBps} /> }}
              />
            )}
          </span>
        </div>
        <BudgetBar
          usedBps={line.usedBps}
          tone={tone}
          idealBps={readOnly || line.isFixed ? null : totals.idealBps}
          size="lg"
        />
        <div className="grid grid-cols-3 gap-2">
          <Tile
            label={line.remainingMinor < 0n ? m.budget_detail_over() : m.budget_detail_left()}
            value={<Amount valueMinor={line.remainingMinor < 0n ? -line.remainingMinor : line.remainingMinor} />}
            note={readOnly ? m.budget_period_closed() : m.budget_detail_days_left({ count: totals.daysLeft })}
            red={line.remainingMinor < 0n}
          />
          <Tile
            label={m.budget_detail_daily()}
            value={line.safeDailyMinor === null ? '—' : <Amount valueMinor={line.safeDailyMinor} />}
            note={
              line.safeDailyMinor === null
                ? m.budget_detail_fixed()
                : m.budget_kpi_safe_daily_note({ count: totals.daysLeft })
            }
          />
          <Tile
            label={m.budget_detail_projection()}
            value={<Amount valueMinor={line.projectionMinor} />}
            note={
              line.projectionMinor > line.limitMinor ? (
                <RichMessage
                  message={m.budget_kpi_projection_over}
                  slots={{ amount: <Amount valueMinor={line.projectionMinor - line.limitMinor} /> }}
                />
              ) : (
                m.budget_kpi_projection_within()
              )
            }
            red={line.projectionMinor > line.limitMinor}
          />
        </div>
      </section>
      {loaded === null ? (
        <PageState kind="loading" title={m.budget_detail_loading()} />
      ) : !loaded.ok ? (
        <PageState
          kind="error"
          title={m.budget_detail_failed()}
          description={ledgerErrorMessage(loaded.code, locale)}
        />
      ) : (
        <>
          <section aria-labelledby="budget-detail-daily" className="flex flex-col gap-2 border-t border-border pt-5">
            <div className="flex items-center justify-between gap-2">
              <h3 id="budget-detail-daily" className="text-[13.5px] font-medium text-fg">
                {m.budget_detail_daily_title()}
              </h3>
              {line.safeDailyMinor === null ? null : (
                <span className="text-[11.5px] text-subtle">
                  <RichMessage
                    message={m.budget_detail_safe_line}
                    slots={{ amount: <Amount valueMinor={line.safeDailyMinor} /> }}
                  />
                </span>
              )}
            </div>
            <DailyChart detail={loaded.value} line={line} label={m.budget_detail_daily_title()} />
            <div className="flex justify-between font-mono text-[11px] text-subtle">
              <span>{formatDate(period.start, locale, 'day')}</span>
              <span>{formatDate(period.end, locale, 'day')}</span>
            </div>
          </section>
          <section aria-labelledby="budget-detail-months" className="flex flex-col gap-2 border-t border-border pt-5">
            <h3 id="budget-detail-months" className="text-[13.5px] font-medium text-fg">
              {m.budget_detail_months()}
            </h3>
            <ul className="flex flex-col gap-2">
              {loaded.value.months.map((month) => {
                const { used, limitAt } = monthBars(month);
                return (
                  <li
                    key={month.label}
                    className="grid grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-3 text-[12px]"
                  >
                    <span className="font-mono text-subtle">
                      {formatPeriodLabel(month.label, locale, 'month').slice(0, 3)}
                    </span>
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 1000 6"
                      preserveAspectRatio="none"
                      className="block h-1.5 w-full overflow-visible"
                    >
                      <rect width="1000" height="6" rx="3" className="fill-surface-3" />
                      <rect
                        width={barLength(used)}
                        height="6"
                        rx="3"
                        className={month.current ? 'fill-amber' : 'fill-neutral-bar'}
                      />
                      <rect x={Math.max(barLength(limitAt) - 2, 0)} y="-2" width="4" height="10" className="fill-fg" />
                    </svg>
                    <span className="font-mono text-fg">
                      <Amount valueMinor={month.spentMinor} />
                      {month.current && !readOnly ? (
                        <span className="text-subtle"> · {m.budget_detail_running()}</span>
                      ) : null}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
          <section
            aria-labelledby="budget-detail-transactions"
            className="flex flex-col gap-2 border-t border-border pt-5"
          >
            <h3 id="budget-detail-transactions" className="text-[13.5px] font-medium text-fg">
              {m.budget_detail_transactions({
                month: formatPeriodLabel(period.label, locale, 'month'),
                count: loaded.value.transactionCount,
              })}
            </h3>
            {loaded.value.transactions.length === 0 ? (
              <p className="text-[12.5px] text-muted-fg">{m.budget_detail_no_transactions()}</p>
            ) : (
              <ul className="flex flex-col divide-y divide-border">
                {loaded.value.transactions.map((row) => (
                  <li key={row.id} className="flex items-center gap-3 py-2.5">
                    <CategoryIcon icon={line.icon} color={line.color} size="sm" />
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-[13px] font-medium text-fg">
                        {row.merchant ?? row.description ?? categoryName(line)}
                      </span>
                      <span className="text-[11.5px] text-subtle">
                        {formatDate(row.localDate, locale, 'day')} · {accountName.get(row.accountId) ?? '—'}
                      </span>
                    </div>
                    <Amount valueMinor={row.amountBaseMinor} className="text-[13px] text-fg" />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}

export function BudgetCategorySheet({
  line,
  status,
  accounts,
  onClose,
  onCover,
  onEditLimit,
}: BudgetCategorySheetProps) {
  const { locale } = useBudgetFormat();
  const readOnly = status.readOnly;
  return (
    <Sheet
      open={line !== null}
      // Without a trigger the sheet only ever asks to close.
      onOpenChange={onClose}
      title={line === null ? '' : categoryName(line)}
      description={
        line === null
          ? ''
          : `${categoryGroupLabel(line.group)} · ${formatPeriodLabel(status.period.label, locale, 'monthYear')}`
      }
      closeLabel={m.budget_close()}
      {...(line === null || readOnly
        ? {}
        : {
            footer: (
              <div className="flex justify-between gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    onCover(line);
                  }}
                >
                  <ArrowLeftRight aria-hidden="true" className="size-3.5" />
                  {m.budget_detail_cover()}
                </Button>
                <Button
                  size="sm"
                  onClick={() => {
                    onEditLimit(line);
                  }}
                >
                  <Pencil aria-hidden="true" className="size-3.5" />
                  {m.budget_menu_edit_limit()}
                </Button>
              </div>
            ),
          })}
    >
      {line === null ? null : <Detail line={line} status={status} accounts={accounts} />}
    </Sheet>
  );
}
