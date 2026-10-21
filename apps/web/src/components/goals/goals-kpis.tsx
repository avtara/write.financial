// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The "Tabungan" KPI strip (design 13 `oUR7O`): "Total terkumpul" over the active goals, "Setoran {bulan}" with the
 * month's recorded contributions against the plan ("dari rencana Rp4.650.000 · sisa tgl 25"), and "Dana darurat" in
 * months of spending the emergency fund covers ("0,6 bulan · target 3 bulan pengeluaran").
 */
import { EMERGENCY_FUND_MONTHS, goalSnapshot } from '@wf/domain/goals';
import type { Locale } from '@wf/i18n/locale';
import { m } from '@wf/i18n/messages';
import { Money } from '@wf/ui/money';
import { ArrowDownToLine, Percent as PercentIcon, PiggyBank, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import type { GoalsOverview } from '../../server/fn/goals.ts';
import { BudgetBar } from '../budget/budget-bar.tsx';
import { monthName } from '../dashboard/dashboard-format.ts';
import { RichMessage } from '../rich-message.tsx';
import { emergencyGoal, formatMonths, goalState, monthSummary } from './goals-model.ts';

const VALUE = 'text-[22px] leading-tight font-medium tracking-[-0.4px]';

function Kpi({ icon: Icon, label, children }: { icon: LucideIcon; label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5 border-b border-border px-5 py-4 md:border-r md:border-b-0 md:last:border-r-0">
      <span className="flex items-center gap-1.5 text-[12.5px] text-muted-fg">
        <Icon aria-hidden="true" className="size-3.5" />
        {label}
      </span>
      {children}
    </div>
  );
}

export function GoalsKpis({ overview, locale }: { readonly overview: GoalsOverview; readonly locale: Locale }) {
  const { goals, movements, baseCurrency, month } = overview;
  const active = goals.filter((goal) => goal.status === 'active' && goal.currency === baseCurrency);
  const total = active.reduce((sum, goal) => sum + goal.savedMinor, 0n);
  const summary = monthSummary(goals, movements, baseCurrency);
  const emergency = emergencyGoal(goals);
  const coverage = emergency === null ? null : goalSnapshot(goalState(emergency)).coverageBps;
  const usedBps = summary.plannedMinor > 0n ? Number((summary.recordedMinor * 10_000n) / summary.plannedMinor) : null;
  return (
    <section
      aria-label={m.goals_kpis_label()}
      className="grid grid-cols-1 overflow-hidden rounded-[12px] border border-border bg-card md:grid-cols-3"
    >
      <Kpi icon={PiggyBank} label={m.goals_kpi_total()}>
        <Money minor={total} currency={baseCurrency} context="amount" locale={locale} className={`${VALUE} text-fg`} />
        <span className="text-[12px] text-subtle">
          {active.length === 0 ? m.goals_kpi_total_empty() : m.goals_kpi_total_sub({ count: active.length })}
        </span>
      </Kpi>
      <Kpi icon={ArrowDownToLine} label={m.goals_kpi_month({ month: monthName(month, locale, 'long') })}>
        <Money
          minor={summary.recordedMinor}
          currency={baseCurrency}
          context="amount"
          locale={locale}
          className={VALUE}
        />
        <BudgetBar usedBps={usedBps} tone="ok" idealBps={null} fillClassName="fill-blue" />
        <span className="text-[12px] text-subtle">
          {summary.plannedMinor === 0n ? (
            m.goals_kpi_month_empty()
          ) : (
            <>
              <RichMessage
                message={m.goals_kpi_month_sub}
                slots={{
                  amount: (
                    <Money minor={summary.plannedMinor} currency={baseCurrency} context="amount" locale={locale} />
                  ),
                }}
              />
              {summary.pendingDays.length === 0
                ? null
                : ` · ${m.goals_kpi_month_pending({ days: summary.pendingDays.join(' & ') })}`}
            </>
          )}
        </span>
      </Kpi>
      <Kpi icon={PercentIcon} label={m.goals_kpi_emergency()}>
        <span className={`${VALUE} font-mono ${coverage === null ? 'text-subtle' : 'text-amber-fg'}`}>
          {coverage === null ? '—' : m.goals_kpi_emergency_value({ months: formatMonths(coverage, locale) })}
        </span>
        <span className="text-[12px] text-subtle">
          {m.goals_kpi_emergency_sub({ count: emergency?.targetMonths ?? EMERGENCY_FUND_MONTHS })}
        </span>
      </Kpi>
    </section>
  );
}
