// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The Overview header (FR-D1, FR-S7, design `iUqiN`, `FCcZd`, `IKIBD`): the greeting, what the page sums up, the
 * Minggu / Bulan / Tahun switch (links: the scope lives in the URL), the period picker (a period's months with their
 * spending in millions, "Bulan ini", "Bulan lalu", "Rentang khusus…"), the custom range picker with "30 hari ·
 * melintasi 2 periode", "Memperbarui ringkasan…" while another span loads, and "Catat Transaksi N".
 */
import { Link, useNavigate } from '@tanstack/react-router';
import type { Dashboard } from '@wf/db/dashboard';
import type { PeriodsOverview } from '@wf/db/periods';
import { addDays, countDays, type YearMonth } from '@wf/domain/period';
import { weekStartOf } from '@wf/domain/dashboard';
import { formatNumber } from '@wf/i18n/format';
import type { Locale } from '@wf/i18n/locale';
import { m } from '@wf/i18n/messages';
import { KbdHint } from '@wf/ui/kbd-hint';
import { Popover, PopoverContent, PopoverTrigger } from '@wf/ui/popover';
import { usePrivacy } from '@wf/ui/privacy';
import { RangePicker } from '@wf/ui/range-picker';
import {
  CalendarDays,
  CalendarRange,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  LayoutGrid,
  LoaderCircle,
  Plus,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import type { DashboardSearch } from '../../lib/dashboard-search.ts';
import { rangeParamOf } from '../../lib/transactions-search.ts';
import { getDashboard } from '../../server/fn/budget.ts';
import { Button } from '../form.tsx';
import { useRecordTransaction } from '../ledger/record-transaction.tsx';
import { PageHeader } from '../page-header.tsx';
import { usePreferences } from '../preferences.tsx';
import { monthName, periodButtonLabel } from './dashboard-format.ts';

export interface DashboardHeaderProps {
  readonly title: string;
  readonly description: ReactNode;
  /** `null` while loading or without data: the switch and pickers still work, on today's spans. */
  readonly dashboard: Dashboard | null;
  readonly periods: PeriodsOverview | null;
  /** "Catat Transaksi" needs an active account. */
  readonly canRecord: boolean;
  readonly refreshing: boolean;
  /** "Atur dashboard" (FR-D3); absent where the layout cannot be changed (offline, no data, already editing). */
  readonly onCustomize?: () => void;
}

const SEGMENT =
  'inline-flex items-center rounded-[6px] px-3 py-[5px] text-[12.5px] text-muted-fg hover:text-fg focus-visible:outline-2 focus-visible:outline-ring aria-[current=page]:bg-muted aria-[current=page]:font-medium aria-[current=page]:text-fg';
const TRIGGER =
  'inline-flex h-[33px] items-center gap-2 rounded-[8px] border border-border bg-card px-2.5 text-[13px] text-fg hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring';
const OPTION =
  'flex w-full items-center gap-2.5 rounded-[6px] px-2 py-1.5 text-left text-[12.5px] text-fg hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring aria-[current=page]:bg-muted';

export function DashboardHeader({
  title,
  description,
  dashboard,
  periods,
  canRecord,
  refreshing,
  onCustomize,
}: DashboardHeaderProps) {
  const { preferences } = usePreferences();
  const record = useRecordTransaction();
  const scope = dashboard?.scope ?? 'month';
  return (
    <PageHeader
      breadcrumb={[m.breadcrumb_finance(), m.nav_overview()]}
      title={title}
      description={description}
      secondaryActions={
        onCustomize === undefined ? [] : [{ label: m.dashboard_customize(), icon: LayoutGrid, onSelect: onCustomize }]
      }
      actions={
        <div className="flex flex-wrap items-center gap-2">
          {refreshing ? (
            <span
              role="status"
              className="inline-flex h-[33px] items-center gap-2 rounded-[8px] border border-border bg-card px-2.5 text-[12.5px] text-fg"
            >
              <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" />
              {m.overview_refreshing()}
            </span>
          ) : null}
          <nav aria-label={m.overview_scope_label()}>
            <ul className="inline-flex gap-0.5 rounded-[8px] border border-border bg-card p-[3px]">
              {(
                [
                  ['week', m.overview_scope_week(), { scope: 'week' }],
                  ['month', m.overview_scope_month(), {}],
                  ['year', m.overview_scope_year(), { scope: 'year' }],
                ] as const
              ).map(([value, label, search]) => (
                <li key={value}>
                  <Link
                    to="/"
                    search={search}
                    // The router marks only the exact URL; a month of another period is still "Bulan".
                    activeOptions={{ exact: true, includeSearch: true }}
                    aria-current={scope === value ? 'page' : undefined}
                    className={SEGMENT}
                  >
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          {dashboard === null || periods === null ? null : <PeriodControl dashboard={dashboard} periods={periods} />}
          {canRecord ? (
            <Button
              size="sm"
              onClick={() => {
                record.open();
              }}
            >
              <Plus aria-hidden="true" className="size-3.5" />
              {m.record_open()}
              <KbdHint keys={['N']} platform={preferences.platform} className="ml-1" />
            </Button>
          ) : null}
        </div>
      }
    />
  );
}

/** Spending per period label of a year, from the year's dashboard trend. */
type YearTotals = Readonly<Record<string, bigint>>;

function PeriodControl({ dashboard, periods }: { dashboard: Dashboard; periods: PeriodsOverview }) {
  const { preferences } = usePreferences();
  const { locale } = preferences;
  const navigate = useNavigate();
  const { today } = dashboard;
  const go = (search: DashboardSearch) => void navigate({ to: '/', search });
  const rows = periods.periods;

  if (dashboard.scope === 'range') {
    const { from, to } = dashboard.ranges.full;
    const weekFrom = weekStartOf(today, 'monday');
    const previous = rows[1];
    return (
      <RangePicker
        value={{ start: from, end: to }}
        onValueChange={(next) => {
          go({ range: rangeParamOf(next.start, next.end) });
        }}
        presets={[
          { label: m.overview_picker_this_week(), range: { start: weekFrom, end: today } },
          { label: m.overview_picker_this_month(), range: { start: periods.current.start, end: today } },
          ...(previous === undefined
            ? []
            : [{ label: m.overview_picker_last_month(), range: { start: previous.start, end: previous.end } }]),
          { label: m.transactions_filter_date_7days(), range: { start: addDays(today, -6), end: today } },
        ]}
        summary={(chosen) =>
          m.transactions_filter_date_summary({
            days: countDays(chosen.start, chosen.end),
            periods: rows.filter((period) => period.start <= chosen.end && period.end >= chosen.start).length,
          })
        }
        today={today}
        locale={locale}
        labels={{
          previousMonth: m.calendar_previous_month(),
          nextMonth: m.calendar_next_month(),
          start: m.transactions_filter_date_start(),
          end: m.transactions_filter_date_end(),
          apply: m.transactions_filter_date_apply(),
          cancel: m.record_cancel(),
        }}
        aria-label={m.overview_range_label()}
      />
    );
  }
  return <PeriodPopover dashboard={dashboard} periods={periods} locale={locale} go={go} />;
}

interface PeriodPopoverProps {
  readonly dashboard: Dashboard;
  readonly periods: PeriodsOverview;
  readonly locale: Locale;
  readonly go: (search: DashboardSearch) => void;
}

function PeriodPopover({ dashboard, periods, locale, go }: PeriodPopoverProps) {
  const { hidden } = usePrivacy();
  const { today, scope } = dashboard;
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(Number((dashboard.period?.label ?? today).slice(0, 4)));
  const [totals, setTotals] = useState<Readonly<Record<number, YearTotals>>>({});
  const rows = periods.periods;
  const labels = new Set<string>(rows.map((period) => period.label));
  const thisYear = Number(today.slice(0, 4));

  const load = (wanted: number) => {
    if (totals[wanted] !== undefined) return;
    void getDashboard({ data: { scope: 'year', year: wanted } }).then((result) => {
      if (!result.ok) return;
      const byLabel = Object.fromEntries(
        result.value.trend.periods.map((period) => [period.label, period.expenseMinor]),
      );
      setTotals((previous) => ({ ...previous, [wanted]: byLabel }));
    });
  };
  const choose = (search: DashboardSearch) => {
    setOpen(false);
    go(search);
  };
  const lastPeriod = rows[1];
  const lastWeek = weekStartOf(addDays(today, -7), 'monday');
  const shortcuts: { label: string; aside: string; search: DashboardSearch }[] =
    scope === 'week'
      ? [
          { label: m.overview_picker_this_week(), aside: '', search: { scope: 'week' } },
          {
            label: m.overview_picker_last_week(),
            aside: '',
            search: { range: rangeParamOf(lastWeek, addDays(lastWeek, 6)) },
          },
        ]
      : scope === 'year'
        ? [
            { label: m.overview_picker_this_year(), aside: String(thisYear), search: { scope: 'year' } },
            {
              label: m.overview_picker_last_year(),
              aside: String(thisYear - 1),
              search: { scope: 'year', year: thisYear - 1 },
            },
          ]
        : [
            { label: m.overview_picker_this_month(), aside: monthName(periods.current.label, locale), search: {} },
            ...(lastPeriod === undefined
              ? []
              : [
                  {
                    label: m.overview_picker_last_month(),
                    aside: monthName(lastPeriod.label, locale),
                    search: { period: lastPeriod.label },
                  },
                ]),
          ];
  const yearTotals = totals[year];
  const custom = dashboard.ranges.current;
  // The year's months: whether a period row exists, and its spending in millions ("16,5").
  const months = Array.from({ length: 12 }, (_, index) => {
    const label = `${String(year)}-${String(index + 1).padStart(2, '0')}` as YearMonth;
    const spentMinor = yearTotals?.[label];
    const available = labels.has(label);
    const millions =
      spentMinor === undefined || !available
        ? '—'
        : hidden
          ? '••'
          : formatNumber(Number(spentMinor) / 1e6, locale, { maximumFractionDigits: 1 });
    return { label, available, millions };
  });

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next && scope === 'month') load(year);
      }}
    >
      <PopoverTrigger
        aria-label={`${m.overview_picker_label()}: ${periodButtonLabel(dashboard, locale)}`}
        className={TRIGGER}
      >
        <CalendarDays aria-hidden="true" className="size-3.5 text-muted-fg" />
        {periodButtonLabel(dashboard, locale)}
        <ChevronDown aria-hidden="true" className="size-3.5 text-subtle" />
      </PopoverTrigger>
      <PopoverContent align="end" className="flex w-[296px] flex-col p-1.5" aria-label={m.overview_picker_label()}>
        {scope === 'month' ? (
          <div className="flex flex-col gap-2 border-b border-border px-1.5 pt-1 pb-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[13px] font-semibold text-fg">{year}</span>
              <span className="flex gap-1">
                <button
                  type="button"
                  aria-label={m.overview_picker_previous_year()}
                  className="flex size-6 items-center justify-center rounded-[6px] text-muted-fg hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
                  onClick={() => {
                    setYear(year - 1);
                    load(year - 1);
                  }}
                >
                  <ChevronLeft aria-hidden="true" className="size-3.5" />
                </button>
                <button
                  type="button"
                  aria-label={m.overview_picker_next_year()}
                  disabled={year >= thisYear}
                  className="flex size-6 items-center justify-center rounded-[6px] text-muted-fg hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-40"
                  onClick={() => {
                    setYear(year + 1);
                    load(year + 1);
                  }}
                >
                  <ChevronRight aria-hidden="true" className="size-3.5" />
                </button>
              </span>
            </div>
            <ul className="grid grid-cols-3 gap-1">
              {months.map(({ label, available, millions }) => {
                return (
                  <li key={label}>
                    <button
                      type="button"
                      disabled={!available}
                      aria-current={dashboard.period?.label === label ? 'page' : undefined}
                      onClick={() => {
                        choose(label === periods.current.label ? {} : { period: label });
                      }}
                      className="flex w-full flex-col items-center rounded-[7px] py-1.5 text-[12.5px] text-fg hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring disabled:text-subtle disabled:hover:bg-transparent aria-[current=page]:bg-fg aria-[current=page]:text-primary-fg"
                    >
                      {monthName(label, locale)}
                      <span aria-hidden="true" className="font-mono text-[10.5px] opacity-70">
                        {millions}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
        <ul className="flex flex-col gap-0.5 py-1">
          {shortcuts.map((shortcut) => (
            <li key={shortcut.label}>
              <button
                type="button"
                className={OPTION}
                onClick={() => {
                  choose(shortcut.search);
                }}
              >
                <CalendarDays aria-hidden="true" className="size-3.5 text-muted-fg" />
                <span className="flex-1">{shortcut.label}</span>
                <span className="font-mono text-[11px] text-subtle">{shortcut.aside}</span>
              </button>
            </li>
          ))}
          <li>
            <button
              type="button"
              className={OPTION}
              onClick={() => {
                choose({ range: rangeParamOf(custom.from, custom.to) });
              }}
            >
              <CalendarRange aria-hidden="true" className="size-3.5 text-muted-fg" />
              <span className="flex-1">{m.overview_picker_custom()}</span>
              <ChevronRight aria-hidden="true" className="size-3.5 text-subtle" />
            </button>
          </li>
        </ul>
        {scope === 'month' ? (
          <p className="border-t border-border px-2 pt-2 pb-1 text-[11px] text-subtle">{m.overview_picker_note()}</p>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
