// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The top of the budget page (design `E86u2e`, September `Z8qibf`, transition `Gb4iH`): the period switcher, the
 * remaining hero with % used against the ideal for day N, the safe daily limit, the end-of-period projection, the
 * over-limit categories, the Needs/Wants card, and the next transition period's banner.
 */
import type { BudgetStatus } from '@wf/db/budgets';
import type { PeriodsOverview, PeriodView } from '@wf/db/periods';
import { formatPeriodLabel, type Period } from '@wf/domain/period';
import { m } from '@wf/i18n/messages';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@wf/ui/dropdown-menu';
import { formatDate } from '@wf/ui/dates';
import { CalendarClock, ChevronLeft, ChevronRight, CircleAlert, CircleCheck, Gauge } from 'lucide-react';
import type { ReactNode } from 'react';
import { categoryGroupLabel, categoryName } from '../../lib/ledger-labels.ts';
import { RichMessage } from '../rich-message.tsx';
import { BudgetBar } from './budget-bar.tsx';
import { Amount, Pct, useBudgetFormat } from './budget-format.tsx';

const CARD = 'rounded-[14px] border border-border bg-card';
const NAV_BUTTON =
  'flex size-8 items-center justify-center rounded-[7px] text-muted-fg hover:bg-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-40';

/** "1 Okt – 31 Okt". */
export function PeriodRange({ period }: { period: Pick<Period, 'start' | 'end'> }) {
  const { locale } = useBudgetFormat();
  return (
    <>
      {formatDate(period.start, locale, 'day')} – {formatDate(period.end, locale, 'day')}
    </>
  );
}

/** "‹ Oktober 2026 ›" with every period row in a menu (FR-P1 switcher). */
export function PeriodSwitcher({
  period,
  periods,
  onChange,
}: {
  period: PeriodView;
  periods: PeriodsOverview;
  onChange: (periodId: string) => void;
}) {
  const { locale } = useBudgetFormat();
  // Rows are newest first.
  const index = periods.periods.findIndex((row) => row.id === period.id);
  const newer = index > 0 ? periods.periods[index - 1] : undefined;
  const older = periods.periods[index + 1];
  const go = (row: PeriodView | undefined) => {
    if (row?.id) onChange(row.id);
  };
  return (
    <div className="flex h-[34px] items-center rounded-[9px] border border-border px-0.5">
      <button
        type="button"
        aria-label={m.budget_period_previous()}
        disabled={older === undefined}
        onClick={() => {
          go(older);
        }}
        className={NAV_BUTTON}
      >
        <ChevronLeft aria-hidden="true" className="size-4" />
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={m.budget_period_choose({ period: formatPeriodLabel(period.label, locale, 'monthYear') })}
          className="h-8 rounded-[7px] px-2.5 text-[13.5px] font-medium text-fg hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
        >
          {formatPeriodLabel(period.label, locale, 'monthYear')}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center" className="w-[260px]">
          <DropdownMenuGroup>
            <DropdownMenuRadioGroup value={period.id ?? ''} onValueChange={onChange}>
              {periods.periods.map((row) => (
                <DropdownMenuRadioItem key={row.id} value={row.id ?? ''}>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span>{formatPeriodLabel(row.label, locale, 'monthYear')}</span>
                    <span className="text-[11.5px] text-subtle">
                      <PeriodRange period={row} /> ·{' '}
                      {row.status === 'closed'
                        ? m.budget_period_closed()
                        : row.id === periods.current.id
                          ? m.budget_period_running()
                          : row.kind === 'transition'
                            ? m.budget_period_transition()
                            : m.budget_period_open()}
                    </span>
                  </span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <button
        type="button"
        aria-label={m.budget_period_next()}
        disabled={newer === undefined}
        onClick={() => {
          go(newer);
        }}
        className={NAV_BUTTON}
      >
        <ChevronRight aria-hidden="true" className="size-4" />
      </button>
    </div>
  );
}

/** "Berikutnya: periode transisi 1–24 November" (FR-P2 (a), design `Gb4iH`). */
export function TransitionBanner({ transition }: { transition: NonNullable<BudgetStatus['nextTransition']> }) {
  const { locale } = useBudgetFormat();
  const { period } = transition;
  return (
    <section
      aria-label={m.budget_transition_label()}
      className="flex items-start gap-3 rounded-[12px] border border-amber-tint-3 bg-amber-tint-1 px-4 py-3"
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-[8px] bg-amber-tint-2 text-amber-fg">
        <CalendarClock aria-hidden="true" className="size-4" />
      </span>
      <div className="flex flex-col gap-0.5">
        <h2 className="text-[13.5px] font-semibold text-fg">
          {m.budget_transition_title({
            range: `${String(Number(period.start.slice(8)))}–${String(Number(period.end.slice(8)))}`,
            month: formatPeriodLabel(period.label, locale, 'month'),
          })}
        </h2>
        <p className="text-[12.5px] text-muted-fg">
          <RichMessage
            message={m.budget_transition_body}
            slots={{
              days: String(period.days),
              from: <Amount valueMinor={transition.limitMinor} />,
              to: <Amount valueMinor={transition.proratedMinor} />,
            }}
          />
        </p>
      </div>
    </section>
  );
}

function Kpi({ label, value, note, tone }: { label: string; value: ReactNode; note: ReactNode; tone?: 'red' }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-[12px] text-subtle">{label}</span>
      <span className={`text-[19px] font-medium ${tone === 'red' ? 'text-red-fg' : 'text-fg'}`}>{value}</span>
      <span className={`text-[11.5px] ${tone === 'red' ? 'text-red-fg-soft' : 'text-subtle'}`}>{note}</span>
    </div>
  );
}

/** The remaining hero (open period) or "Hasil September" (closed period, FR-P3). */
export function BudgetHero({ status }: { status: BudgetStatus }) {
  const { locale } = useBudgetFormat();
  const { totals, period, readOnly } = status;
  const month = formatPeriodLabel(period.label, locale, 'month');
  const over = status.lines.filter((line) => line.state === 'over');
  const overMinor = over.reduce((total, line) => total - line.remainingMinor, 0n);
  const ahead = !readOnly && totals.pace === 'ahead';
  const tone = totals.remainingMinor < 0n ? 'over' : ahead ? 'warning' : 'ok';
  return (
    <section aria-labelledby="budget-hero-title" className={`${CARD} flex flex-col gap-5 px-6 py-5`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="budget-hero-title" className="text-[13px] text-muted-fg">
            {readOnly ? m.budget_hero_result({ month }) : m.budget_hero_remaining({ month })}
          </h2>
          <p className="flex flex-wrap items-baseline gap-x-2.5">
            <Amount valueMinor={totals.remainingMinor} className="text-[36px] leading-tight font-medium text-fg" />
            <span className="font-mono text-[13px] text-subtle">
              <RichMessage message={m.budget_hero_of} slots={{ amount: <Amount valueMinor={totals.limitMinor} /> }} />
            </span>
          </p>
        </div>
        <span
          className={`inline-flex h-6 items-center gap-1.5 rounded-[7px] border px-2 text-[12px] font-medium ${ahead ? 'border-amber-tint-3 bg-amber-tint-1 text-amber-fg' : 'border-green-tint-3 bg-green-tint-1 text-green-fg'}`}
        >
          {ahead ? (
            <Gauge aria-hidden="true" className="size-3.5" />
          ) : (
            <CircleCheck aria-hidden="true" className="size-3.5" />
          )}
          {ahead ? m.budget_pace_ahead() : m.budget_pace_on_track()}
        </span>
      </div>
      <div className="flex flex-col gap-2">
        <BudgetBar usedBps={totals.usedBps} tone={tone} idealBps={readOnly ? null : totals.idealBps} size="lg" />
        <p className="text-center text-[11.5px] text-muted-fg">
          {readOnly ? (
            <RichMessage message={m.budget_hero_done} slots={{ used: <Pct bps={totals.usedBps} /> }} />
          ) : (
            <RichMessage message={m.budget_hero_today} slots={{ ideal: <Pct bps={totals.idealBps} /> }} />
          )}
        </p>
        <ul className="flex flex-wrap gap-x-5 gap-y-1 text-[12px] text-muted-fg">
          <li className="flex items-center gap-1.5">
            <span aria-hidden="true" className="size-2 rounded-[2px] bg-amber" />
            <RichMessage
              message={m.budget_legend_spent}
              slots={{ amount: <Amount valueMinor={totals.spentMinor} /> }}
            />
          </li>
          <li className="flex items-center gap-1.5">
            <span aria-hidden="true" className="size-2 rounded-[2px] bg-surface-3" />
            <RichMessage
              message={m.budget_legend_left}
              slots={{ amount: <Amount valueMinor={totals.remainingMinor} /> }}
            />
          </li>
        </ul>
      </div>
      <div className="grid grid-cols-2 gap-4 border-t border-border pt-4 lg:grid-cols-4">
        <Kpi
          label={m.budget_kpi_spent()}
          value={<Amount valueMinor={totals.spentMinor} />}
          note={
            readOnly && totals.unbudgetedSpentMinor > 0n ? (
              <RichMessage
                message={m.budget_kpi_spent_unbudgeted}
                slots={{
                  used: <Pct bps={totals.usedBps} />,
                  amount: <Amount valueMinor={totals.unbudgetedSpentMinor} />,
                }}
              />
            ) : readOnly ? (
              <Pct bps={totals.usedBps} />
            ) : (
              <RichMessage
                message={m.budget_kpi_spent_note}
                slots={{ used: <Pct bps={totals.usedBps} />, ideal: <Pct bps={totals.idealBps} /> }}
              />
            )
          }
        />
        {readOnly ? (
          <Kpi
            label={m.budget_kpi_leftover()}
            value={<Amount valueMinor={status.close.leftoverMinor} />}
            note={m.budget_kpi_leftover_note()}
          />
        ) : (
          <Kpi
            label={m.budget_kpi_safe_daily()}
            value={<Amount valueMinor={totals.safeDailyMinor} />}
            note={m.budget_kpi_safe_daily_note({ count: totals.daysLeft })}
          />
        )}
        {readOnly ? null : (
          <Kpi
            label={m.budget_kpi_projection()}
            value={<Amount valueMinor={totals.projectionMinor} />}
            note={
              totals.projectedOverMinor > 0n ? (
                <RichMessage
                  message={m.budget_kpi_projection_over}
                  slots={{ amount: <Amount valueMinor={totals.projectedOverMinor} /> }}
                />
              ) : (
                m.budget_kpi_projection_within()
              )
            }
            {...(totals.projectedOverMinor > 0n ? { tone: 'red' as const } : {})}
          />
        )}
        <Kpi
          label={m.budget_kpi_over()}
          value={m.budget_kpi_over_count({ count: over.length })}
          note={
            over.length === 0 ? (
              m.budget_kpi_over_none()
            ) : over.length === 1 ? (
              <RichMessage
                message={m.budget_kpi_over_one}
                slots={{
                  name: categoryName(over[0] as (typeof over)[number]),
                  amount: <Amount valueMinor={overMinor} />,
                }}
              />
            ) : (
              <RichMessage message={m.budget_kpi_over_many} slots={{ amount: <Amount valueMinor={overMinor} /> }} />
            )
          }
          {...(over.length > 0 ? { tone: 'red' as const } : {})}
        />
      </div>
    </section>
  );
}

const GROUP_FILL: Readonly<Record<string, string>> = {
  needs: 'fill-blue',
  wants: 'fill-violet',
  financial: 'fill-cyan',
};
const GROUP_DOT: Readonly<Record<string, string>> = { needs: 'bg-blue', wants: 'bg-violet', financial: 'bg-cyan' };

/** "Kebutuhan & Keinginan · Terpakai dari batas Oktober". */
export function BudgetGroupsCard({ status }: { status: BudgetStatus }) {
  const { locale } = useBudgetFormat();
  const month = formatPeriodLabel(status.period.label, locale, 'month');
  const overCount = status.groups.reduce((total, group) => total + group.overCount, 0);
  const groups = status.groups.map((group) => ({ ...group, leftMinor: group.limitMinor - group.spentMinor }));
  return (
    <section aria-labelledby="budget-groups-title" className={`${CARD} flex flex-col gap-4 px-6 py-5`}>
      <div className="flex flex-col gap-0.5">
        <h2 id="budget-groups-title" className="text-[15px] font-semibold text-fg">
          {m.budget_groups_title()}
        </h2>
        <p className="text-[12.5px] text-muted-fg">{m.budget_groups_description({ month })}</p>
      </div>
      <ul className="flex flex-col gap-4">
        {groups.map((group) => {
          const over = group.leftMinor < 0n;
          return (
            <li key={group.group} className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2 text-[13.5px] font-medium text-fg">
                <span className="flex items-center gap-2">
                  <span aria-hidden="true" className={`size-2 rounded-full ${GROUP_DOT[group.group] ?? 'bg-subtle'}`} />
                  {categoryGroupLabel(group.group)}
                </span>
                <Pct bps={group.usedBps} />
              </div>
              <BudgetBar
                usedBps={group.usedBps}
                tone="ok"
                idealBps={null}
                fillClassName={GROUP_FILL[group.group] ?? 'fill-subtle'}
              />
              <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 text-[12px]">
                <span className="font-mono whitespace-nowrap text-muted-fg">
                  <Amount valueMinor={group.spentMinor} bare /> / <Amount valueMinor={group.limitMinor} bare />
                </span>
                <span
                  className={`whitespace-nowrap ${over ? 'text-red-fg' : group.overCount > 0 ? 'text-amber-fg' : 'text-subtle'}`}
                >
                  {over ? (
                    <RichMessage
                      message={m.budget_line_over}
                      slots={{ amount: <Amount valueMinor={-group.leftMinor} /> }}
                    />
                  ) : (
                    <RichMessage
                      message={m.budget_line_left}
                      slots={{ amount: <Amount valueMinor={group.leftMinor} /> }}
                    />
                  )}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
      <p className="flex items-center gap-1.5 border-t border-border pt-3 text-[12px] text-muted-fg">
        {overCount > 0 ? (
          <CircleAlert aria-hidden="true" className="size-3.5 text-red-fg" />
        ) : (
          <CircleCheck aria-hidden="true" className="size-3.5 text-green-fg" />
        )}
        {m.budget_groups_over({ count: overCount })}
      </p>
    </section>
  );
}
