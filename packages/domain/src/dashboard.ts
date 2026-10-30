// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Dashboard arithmetic (PRD §6.9 FR-D1/D2, FR-S7): the Week / Month / Year ranges with their like-for-like comparison
 * ranges, the custom-range summary ("30 hari · melintasi 2 periode"), percentage changes, and the money flow (Sankey)
 * income → group → category. Amounts are `bigint` minor units in the base currency.
 */
import { ratioBps } from './budget.ts';
import type { CategoryGroup } from './categories.ts';
import { addDays, countDays, periodFor, type LocalDate, type Period, type PeriodStartDay } from './period.ts';

/** Both ends inclusive. */
export interface DateRange {
  readonly from: LocalDate;
  readonly to: LocalDate;
}

export type WeekStart = 'monday' | 'sunday';

export interface DashboardRanges {
  /** The whole week / period / year shown in the header ("12–18 Oktober 2026"). */
  readonly full: DateRange;
  /** What has happened so far: `full` up to today ("1–15 Oktober 2026"). */
  readonly current: DateRange;
  /** What `current` is compared with (FR-D1). */
  readonly previous: DateRange;
}

const earlier = (a: LocalDate, b: LocalDate): LocalDate => (a < b ? a : b);

/** The first day of the week containing `date` (`date` is a weekday of the UTC calendar, independent of the host). */
export function weekStartOf(date: LocalDate, weekStart: WeekStart): LocalDate {
  // 1970-01-01 was a Thursday: (days since epoch + 4) mod 7 = 0 on Sundays.
  const weekday = (((countDays('1970-01-01' as LocalDate, date) - 1 + 4) % 7) + 7) % 7;
  const offset = weekStart === 'sunday' ? weekday : (weekday + 6) % 7;
  return addDays(date, -offset);
}

/** FR-D1 Week: this week so far vs the same days of last week ("vs Sen–Kam lalu"). */
export function weekRanges(today: LocalDate, weekStart: WeekStart): DashboardRanges {
  const from = weekStartOf(today, weekStart);
  return {
    full: { from, to: addDays(from, 6) },
    current: { from, to: today },
    previous: { from: addDays(from, -7), to: addDays(today, -7) },
  };
}

/** FR-D1 Month: the period so far vs the whole previous period ("vs Sep"). */
export function monthRanges(period: Period, previous: Period, today: LocalDate): DashboardRanges {
  return {
    full: { from: period.start, to: period.end },
    current: { from: period.start, to: earlier(period.end, today) },
    previous: { from: previous.start, to: previous.end },
  };
}

/**
 * FR-D1 Year: the periods labelled January–December of `year` (the calendar year with start day 1) so far, vs the
 * same days of the year before ("vs 2025"): up to the same calendar day a year earlier (29 Feb → 28 Feb), so a leap
 * day in either year does not shift the comparison and a past year compares with the whole year before.
 */
export function yearRanges(year: number, startDay: PeriodStartDay, today: LocalDate): DashboardRanges {
  const yyyy = (y: number): string => String(y).padStart(4, '0');
  const bounds = (y: number): DateRange => ({
    from: periodFor(`${yyyy(y)}-01-01` as LocalDate, startDay).start,
    to: periodFor(`${yyyy(y)}-12-01` as LocalDate, startDay).end,
  });
  const full = bounds(year);
  const last = bounds(year - 1);
  const to = earlier(full.to, today);
  const yearEarlier = `${yyyy(Number(to.slice(0, 4)) - 1)}${to.slice(4).replace('-02-29', '-02-28')}` as LocalDate;
  return {
    full,
    current: { from: full.from, to },
    previous: { from: last.from, to: yearEarlier },
  };
}

/** FR-S7 custom range: the same number of days right before it. */
export function customRanges(range: DateRange): DashboardRanges {
  const days = countDays(range.from, range.to);
  return { full: range, current: range, previous: { from: addDays(range.from, -days), to: addDays(range.from, -1) } };
}

export interface RangeSummary {
  readonly days: number;
  /** Periods the range overlaps. */
  readonly periodCount: number;
}

/** FR-S7 "30 hari · melintasi 2 periode" (14 Sep – 13 Okt with periods starting on the 1st). */
export function rangeSummary(range: DateRange, periods: readonly Pick<Period, 'start' | 'end'>[]): RangeSummary {
  return {
    days: countDays(range.from, range.to),
    periodCount: periods.filter((period) => period.start <= range.to && period.end >= range.from).length,
  };
}

/** Relative change (current − previous) ÷ previous in basis points ("+4,1%"); `null` when previous is not positive. */
export function changeBps(currentMinor: bigint, previousMinor: bigint): number | null {
  return ratioBps(currentMinor - previousMinor, previousMinor);
}

export interface MoneyFlowInput {
  /** Income per category (`null` = uncategorized), positive. */
  readonly incomes: readonly { readonly categoryId: string | null; readonly amountMinor: bigint }[];
  /** Expense per category with the category's group, positive. */
  readonly expenses: readonly {
    readonly categoryId: string | null;
    readonly group: CategoryGroup;
    readonly amountMinor: bigint;
  }[];
  /** Amounts sent by transfers to each destination account in the range, positive. */
  readonly transfers: readonly { readonly accountId: string; readonly amountMinor: bigint }[];
}

export interface MoneyFlowOptions {
  /** "Tampilkan sumber < 1%"; otherwise sources below 1% of the total merge into one `other` source. */
  readonly showSmallSources: boolean;
  /**
   * "Hitung transfer antar rekening": the money that actually moved to savings and investment accounts is shown as
   * "Tabungan" (each destination, plus what stays put). Off, the income left over is named as such: a leftover is not
   * a saving, and calling it one hid that income was merely unspent.
   */
  readonly countTransfers: boolean;
}

/**
 * Node ids: `source:<categoryId|uncategorized>`, `source:other` (merged small sources), `source:deficit` (spending
 * beyond income), `total`, `group:<group>`, `group:savings` (transfers out, when counted), `group:leftover` (income
 * not spent), `category:<categoryId|uncategorized>`, `account:<accountId>`.
 */
export interface MoneyFlowNode {
  readonly id: string;
  readonly column: 0 | 1 | 2 | 3;
  readonly valueMinor: bigint;
  /** Share of the total flow (income, plus any deficit), basis points. */
  readonly shareBps: number;
}

export interface MoneyFlowLink {
  readonly from: string;
  readonly to: string;
  readonly valueMinor: bigint;
}

export interface MoneyFlow {
  readonly nodes: MoneyFlowNode[];
  readonly links: MoneyFlowLink[];
  readonly incomeMinor: bigint;
  readonly expenseMinor: bigint;
  /** income − expense when positive ("Tabungan"), else 0. */
  readonly savedMinor: bigint;
}

const SMALL_SOURCE_BPS = 100;

/**
 * FR-D2 Money flow: sources (income categories) → total → groups (Needs, Wants, …, Savings) → categories, and with
 * {@link MoneyFlowOptions.countTransfers} Savings → destination accounts; the rest is the leftover. Every node's inflow equals its
 * outflow. Zero amounts are left out.
 */
export function moneyFlow(input: MoneyFlowInput, options: MoneyFlowOptions): MoneyFlow {
  const sum = (amounts: readonly { readonly amountMinor: bigint }[]): bigint =>
    amounts.reduce((total, item) => total + item.amountMinor, 0n);
  const incomeMinor = sum(input.incomes);
  const expenseMinor = sum(input.expenses);
  const savedMinor = incomeMinor > expenseMinor ? incomeMinor - expenseMinor : 0n;
  const flowMinor = incomeMinor > expenseMinor ? incomeMinor : expenseMinor;
  const values = new Map<string, { column: MoneyFlowNode['column']; valueMinor: bigint }>();
  const links: MoneyFlowLink[] = [];
  const add = (id: string, column: MoneyFlowNode['column'], valueMinor: bigint): void => {
    values.set(id, { column, valueMinor: (values.get(id)?.valueMinor ?? 0n) + valueMinor });
  };
  /** A node's value is its inflow; sources (column 0) have only their outflow into `total`. */
  const flow = (from: string, to: string, valueMinor: bigint, column: MoneyFlowNode['column']): void => {
    if (valueMinor <= 0n) return;
    links.push({ from, to, valueMinor });
    if (column === 1) add(from, 0, valueMinor);
    add(to, column, valueMinor);
  };
  const key = (categoryId: string | null): string => categoryId ?? 'uncategorized';

  let otherMinor = 0n;
  for (const income of input.incomes) {
    const small = (ratioBps(income.amountMinor, flowMinor) ?? 0) < SMALL_SOURCE_BPS;
    if (small && !options.showSmallSources) otherMinor += income.amountMinor;
    else flow(`source:${key(income.categoryId)}`, 'total', income.amountMinor, 1);
  }
  flow('source:other', 'total', otherMinor, 1);
  flow('source:deficit', 'total', expenseMinor - incomeMinor, 1);
  for (const expense of input.expenses) {
    flow('total', `group:${expense.group}`, expense.amountMinor, 2);
    flow(`group:${expense.group}`, `category:${key(expense.categoryId)}`, expense.amountMinor, 3);
  }
  // Only money that actually left for savings or investments is "Tabungan"; the rest is income left unspent.
  const allocated = options.countTransfers
    ? input.transfers.reduce((total, transfer) => total + transfer.amountMinor, 0n)
    : 0n;
  if (allocated > 0n) {
    const moved = allocated < savedMinor ? allocated : savedMinor;
    flow('total', 'group:savings', moved, 2);
    let left = moved;
    for (const transfer of input.transfers) {
      const amountMinor = transfer.amountMinor < left ? transfer.amountMinor : left;
      flow('group:savings', `account:${transfer.accountId}`, amountMinor, 3);
      left -= amountMinor;
    }
    flow('total', 'group:leftover', savedMinor - moved, 2);
  } else {
    flow('total', 'group:leftover', savedMinor, 2);
  }

  const nodes = [...values].map(([id, { column, valueMinor }]): MoneyFlowNode => ({
    id,
    column,
    valueMinor,
    shareBps: ratioBps(valueMinor, flowMinor) ?? 0,
  }));
  nodes.sort((a, b) => a.column - b.column);
  return { nodes, links, incomeMinor, expenseMinor, savedMinor };
}
