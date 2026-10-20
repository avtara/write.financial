// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Monthly periods (FR-P1–P3): materialized `periods` rows, the start-day change with its preview (FR-P2 (a) "Mulai
 * periode berikutnya" and (b) "Hitung ulang periode berjalan"), and the period lock the M3 period close calls
 * (`periods.lock`, the worker's only write here).
 *
 * Rows are contiguous from the first one created: each next row is `periodAfter` the last one with the current
 * start day, so option (a) only changes the start day and the next row becomes the transition period. Option (b)
 * reshapes the open period at once; when it moves the start earlier it may reach into the previous period, which is
 * trimmed when open and left as it is when closed (its numbers are final). Dates before the first row and after the
 * last one get computed periods (`id: null`).
 */
import {
  addDays,
  countDays,
  detectPayday,
  periodAfter,
  periodFor,
  periodStartDay,
  periodsBetween,
  prorateLimit,
  recalculatedPeriods,
  type LocalDate,
  type Period,
  type PeriodStartDay,
  type YearMonth,
} from '@wf/domain/period';
import type { DateRange } from '@wf/domain/dashboard';
import { and, asc, desc, eq, gt, gte, isNull, lte, sql } from 'drizzle-orm';
import { withUser, type Database, type Transaction } from './db.ts';
import { localDateOf, userContextIn } from './ledger-core.ts';
import { versionInForceIn } from './budget-core.ts';
import { LedgerError } from './ledger-errors.ts';
import { categories, periods, postings, transactions, userPreferences } from './schema.ts';

export interface PeriodView extends Period {
  /** `null` for a computed period that has no row (before the first row, or still to come). */
  readonly id: string | null;
  readonly status: 'open' | 'closed';
  readonly closedAt: Date | null;
}

export type PeriodMode = 'fixed_day' | 'follow_payday';

/** FR-P2: (a) `next_period` keeps the current period and starts with a transition; (b) `recalculate` reshapes it. */
export type StartDayApply = 'next_period' | 'recalculate';

export interface StartDayChange {
  /** 1–28. */
  readonly day: number;
  readonly apply: StartDayApply;
  /** Stored with the day; "Ikuti gajian" proposes {@link StartDayPreview.paydayDay}. */
  readonly mode?: PeriodMode;
}

export interface MovedTransaction {
  readonly id: string;
  readonly localDate: LocalDate;
  readonly merchant: string | null;
  readonly description: string | null;
  /** |principal| in the base currency. */
  readonly amountMinor: bigint;
}

export interface StartDayPreview {
  readonly apply: StartDayApply;
  /** The currency of the transition totals and the moved amounts. */
  readonly baseCurrency: string;
  readonly fromDay: PeriodStartDay;
  readonly toDay: PeriodStartDay;
  /** Day the salary usually arrives (FR-P1/P2 "Gaji PT Kinarya biasanya masuk tgl 1"); `null` without salary. */
  readonly paydayDay: PeriodStartDay | null;
  /** The open period today, before the change. */
  readonly current: PeriodView;
  /** From the period containing today on, after the change (three periods). */
  readonly periods: Period[];
  /** The first transition period among {@link periods} and its prorated budget total (18.750.000 → 15.000.000). */
  readonly transition: { readonly period: Period; readonly limitMinor: bigint; readonly proratedMinor: bigint } | null;
  /** `recalculate`: transactions up to today that change period (25–30 Sep into Oktober), largest first. */
  readonly moved: { readonly count: number; readonly largest: MovedTransaction[] };
}

export interface PeriodsOverview {
  readonly startDay: PeriodStartDay;
  readonly baseCurrency: string;
  readonly mode: PeriodMode;
  readonly today: LocalDate;
  /** The open period containing today. */
  readonly current: PeriodView;
  /** Every period row, newest first. */
  readonly periods: PeriodView[];
  /** The next two periods to come (computed; the first may be a transition). */
  readonly upcoming: Period[];
}

/** FR-P1 "Saran dari transaksi": the payday the latest salary incomes (category "Gaji") suggest. */
export interface Payday {
  /** Their most frequent day of the month, capped at 28; `null` without salary. */
  readonly day: PeriodStartDay | null;
  /** The payer of the latest one ("PT Kinarya"), when recorded. */
  readonly merchant: string | null;
  /** Salary incomes looked at (the latest six). */
  readonly count: number;
}

export interface PeriodsRepository {
  /** Materializes the periods up to today; the period switcher (FR-P1, Section 14 `DLnov`). */
  list: (userId: string) => Promise<PeriodsOverview>;
  /** @throws {LedgerError} `NOT_FOUND` */
  get: (userId: string, id: string) => Promise<PeriodView>;
  /** Periods overlapping `range` in order, rows and computed ones (FR-S7 "melintasi N periode"). */
  covering: (userId: string, range: DateRange) => Promise<PeriodView[]>;
  /** What {@link changeStartDay} would do, without changing anything. @throws {LedgerError} `INVALID_PERIOD` */
  previewStartDay: (userId: string, change: StartDayChange) => Promise<StartDayPreview>;
  /** FR-P2: applies the change and returns the preview it applied. @throws {LedgerError} `INVALID_PERIOD` */
  changeStartDay: (userId: string, change: StartDayChange) => Promise<StartDayPreview>;
  /** FR-P1 "Ikuti gajian": the payday derived from the latest salary incomes (recurrences arrive in M3). */
  payday: (userId: string) => Promise<Payday>;
  /**
   * FR-P3/P4 (period close, M3 worker): marks an ended period closed and materializes the periods up to today.
   * Idempotent: `locked` is `false` when it was already closed.
   * @throws {LedgerError} `NOT_FOUND`, `INVALID_PERIOD` (the period has not ended)
   */
  lock: (userId: string, periodId: string) => Promise<{ readonly locked: boolean }>;
}

const VIEW = {
  id: periods.id,
  label: periods.label,
  start: periods.startDate,
  end: periods.endDate,
  days: periods.days,
  kind: periods.kind,
  status: periods.status,
  closedAt: periods.closedAt,
};

export interface PeriodSettings {
  readonly startDay: PeriodStartDay;
  readonly mode: PeriodMode;
  readonly timezone: string;
  readonly today: LocalDate;
  /** The currency of every amount in a preview or overview. */
  readonly baseCurrency: string;
}

/** Start day and mode (defaults before the first preference change), time zone, today in it, and the base currency. */
export async function settingsIn(tx: Transaction, userId: string, now: Date): Promise<PeriodSettings> {
  const { timezone, baseCurrency } = await userContextIn(tx, userId);
  const [row] = await tx
    .select({ startDay: userPreferences.periodStartDay, mode: userPreferences.periodMode })
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId));
  return {
    startDay: row?.startDay ?? (1 as PeriodStartDay),
    mode: row?.mode ?? 'fixed_day',
    timezone,
    today: localDateOf(now, timezone),
    baseCurrency,
  };
}

function insertIn(tx: Transaction, userId: string, period: Period) {
  return tx
    .insert(periods)
    .values({
      userId,
      label: period.label,
      startDate: period.start,
      endDate: period.end,
      days: period.days,
      kind: period.kind,
    })
    .onConflictDoNothing({ target: [periods.userId, periods.startDate] });
}

/** Creates the rows up to the period containing `today` (the first row is the period of `today`). */
export async function ensureIn(tx: Transaction, userId: string, today: LocalDate, startDay: PeriodStartDay) {
  const [last] = await tx.select(VIEW).from(periods).orderBy(desc(periods.startDate)).limit(1);
  let end = last?.end;
  if (end === undefined) {
    const first = periodFor(today, startDay);
    await insertIn(tx, userId, first);
    end = first.end;
  }
  while (end < today) {
    const next = periodAfter({ end }, startDay);
    await insertIn(tx, userId, next);
    end = next.end;
  }
}

/** The period row `id`. @throws {LedgerError} `NOT_FOUND` */
export async function periodIn(tx: Transaction, id: string): Promise<PeriodView> {
  const [row] = await tx.select(VIEW).from(periods).where(eq(periods.id, id));
  if (row === undefined) throw new LedgerError('NOT_FOUND', 'No such period');
  return row;
}

/** The open row containing `date` (rows exist up to today after {@link ensureIn}), else the latest starting one. */
export async function periodOnIn(tx: Transaction, date: LocalDate): Promise<PeriodView | undefined> {
  const [row] = await tx
    .select(VIEW)
    .from(periods)
    .where(and(lte(periods.startDate, date), gte(periods.endDate, date)))
    .orderBy(sql`${periods.status} = 'open' desc`, desc(periods.startDate))
    .limit(1);
  return row;
}

/** The rows and computed periods overlapping `range`, in order. */
export async function coveringIn(tx: Transaction, range: DateRange, startDay: PeriodStartDay): Promise<PeriodView[]> {
  const rows = await tx.select(VIEW).from(periods).orderBy(asc(periods.startDate));
  const computed = (period: Period): PeriodView => ({ ...period, id: null, status: 'open', closedAt: null });
  const first = rows[0];
  const last = rows.at(-1);
  const before: PeriodView[] = [];
  if (first === undefined || range.from < first.start) {
    const to = first === undefined || range.to < first.start ? range.to : addDays(first.start, -1);
    for (const period of periodsBetween(range.from, to, startDay)) {
      const end = first !== undefined && period.end >= first.start ? addDays(first.start, -1) : period.end;
      before.push(
        computed({ ...period, end, days: countDays(period.start, end), label: end.slice(0, 7) as YearMonth }),
      );
    }
  }
  const after: PeriodView[] = [];
  if (last !== undefined) {
    let end = last.end;
    while (end < range.to) {
      const next = periodAfter({ end }, startDay);
      if (next.end >= range.from) after.push(computed(next));
      end = next.end;
    }
  }
  return [...before, ...rows.filter((row) => row.start <= range.to && row.end >= range.from), ...after];
}

/** Σ limits of the budget version in force for `label`, as is and prorated over `days` (transition periods). */
async function budgetTotalsIn(tx: Transaction, label: YearMonth, days: number) {
  const lines = (await versionInForceIn(tx, label))?.lines ?? [];
  return {
    limitMinor: lines.reduce((total, line) => total + line.limitMinor, 0n),
    proratedMinor: lines.reduce((total, line) => total + prorateLimit(line.limitMinor, days), 0n),
  };
}

/** The latest salary incomes (built-in category "Gaji"), newest first. */
async function salariesIn(tx: Transaction): Promise<{ localDate: LocalDate; merchant: string | null }[]> {
  return tx
    .select({ localDate: transactions.localDate, merchant: transactions.merchant })
    .from(transactions)
    .innerJoin(categories, eq(categories.id, transactions.categoryId))
    .where(and(eq(categories.name, 'system:salary'), isNull(transactions.deletedAt)))
    .orderBy(desc(transactions.localDate))
    .limit(6);
}

interface Plan {
  readonly preview: StartDayPreview;
  /** `recalculate`: the periods replacing the current row (domain {@link recalculatedPeriods}). */
  readonly replacement: Period[];
}

async function planIn(tx: Transaction, userId: string, change: StartDayChange, now: Date): Promise<Plan> {
  let toDay: PeriodStartDay;
  try {
    toDay = periodStartDay(change.day);
  } catch {
    throw new LedgerError('INVALID_PERIOD', 'The start day must be 1–28');
  }
  const settings = await settingsIn(tx, userId, now);
  // Only the mode may change ("Ikuti gajian" on the payday already in use); then nothing is reshaped.
  const sameDay = toDay === settings.startDay;
  if (sameDay && (change.mode ?? settings.mode) === settings.mode) {
    throw new LedgerError('INVALID_PERIOD', 'The start day is unchanged');
  }
  const apply: StartDayApply = sameDay ? 'next_period' : change.apply;
  const { today } = settings;
  await ensureIn(tx, userId, today, settings.startDay);
  const current = (await periodOnIn(tx, today)) as PeriodView;
  const replacement = apply === 'recalculate' ? recalculatedPeriods(current, toDay, today) : [current];
  const containing = replacement.at(-1) as Period;
  const following = periodAfter(containing, toDay);
  const shown = [...replacement, following, periodAfter(following, toDay)].slice(0, 3);
  const transitionPeriod = shown.find((period) => period.kind === 'transition') ?? null;

  let moved: StartDayPreview['moved'] = { count: 0, largest: [] };
  if (apply === 'recalculate') {
    const inOld = sql`${transactions.localDate} between ${current.start} and ${current.end}`;
    const inNew = sql`${transactions.localDate} between ${containing.start} and ${containing.end}`;
    const amount = sql`max(abs(${postings.amountBaseMinor}))`;
    const rows = await tx
      .select({
        id: transactions.id,
        localDate: transactions.localDate,
        merchant: transactions.merchant,
        description: transactions.description,
        amountMinor: amount.mapWith(BigInt),
        count: sql<number>`(count(*) over ())::int`,
      })
      .from(transactions)
      .innerJoin(postings, and(eq(postings.transactionId, transactions.id), eq(postings.role, 'principal')))
      .where(and(isNull(transactions.deletedAt), lte(transactions.localDate, today), sql`(${inOld}) <> (${inNew})`))
      .groupBy(transactions.id)
      .orderBy(desc(amount), asc(transactions.localDate))
      .limit(3);
    moved = {
      count: rows[0]?.count ?? 0,
      largest: rows.map(({ id, localDate, merchant, description, amountMinor }) => ({
        id,
        localDate,
        merchant,
        description,
        amountMinor,
      })),
    };
  }

  return {
    replacement,
    preview: {
      apply,
      baseCurrency: settings.baseCurrency,
      fromDay: settings.startDay,
      toDay,
      paydayDay: detectPayday((await salariesIn(tx)).map((row) => row.localDate)),
      current,
      periods: shown,
      transition:
        transitionPeriod === null
          ? null
          : {
              period: transitionPeriod,
              ...(await budgetTotalsIn(tx, transitionPeriod.label, transitionPeriod.days)),
            },
      moved,
    },
  };
}

function setPeriod(period: Period) {
  return {
    label: period.label,
    startDate: period.start,
    endDate: period.end,
    days: period.days,
    kind: period.kind,
    updatedAt: new Date(),
  };
}

export function createPeriods(db: Database, options: { readonly now?: () => Date } = {}): PeriodsRepository {
  const now = options.now ?? (() => new Date());

  return {
    list: (userId) =>
      withUser(db, userId, async (tx) => {
        const { startDay, mode, today, baseCurrency } = await settingsIn(tx, userId, now());
        await ensureIn(tx, userId, today, startDay);
        const rows = await tx.select(VIEW).from(periods).orderBy(desc(periods.startDate));
        const next = periodAfter(rows[0] as PeriodView, startDay);
        return {
          startDay,
          baseCurrency,
          mode,
          today,
          current: (await periodOnIn(tx, today)) as PeriodView,
          periods: rows,
          upcoming: [next, periodAfter(next, startDay)],
        };
      }),

    get: (userId, id) => withUser(db, userId, (tx) => periodIn(tx, id)),

    covering: (userId, range) =>
      withUser(db, userId, async (tx) => {
        const { startDay, today } = await settingsIn(tx, userId, now());
        await ensureIn(tx, userId, today, startDay);
        return coveringIn(tx, range, startDay);
      }),

    previewStartDay: (userId, change) =>
      withUser(db, userId, async (tx) => (await planIn(tx, userId, change, now())).preview),

    changeStartDay: (userId, change) =>
      withUser(db, userId, async (tx) => {
        const { preview, replacement } = await planIn(tx, userId, change, now());
        const { current } = preview;
        // Rows still to come follow the new start day (`ensureIn` recreates them when their time comes).
        await tx.delete(periods).where(gt(periods.startDate, current.end));
        if (preview.apply === 'recalculate') {
          const [first, second] = replacement as [Period, Period | undefined];
          if (first.start < current.start) {
            const [previous] = await tx
              .select(VIEW)
              .from(periods)
              .where(
                and(eq(periods.status, 'open'), gte(periods.endDate, first.start), lte(periods.startDate, first.start)),
              )
              .orderBy(desc(periods.startDate))
              .limit(1);
            // The current row starts after `first.start`, so it is never the previous one.
            if (previous !== undefined) {
              if (previous.start === first.start) {
                throw new LedgerError('INVALID_PERIOD', 'The previous period would become empty');
              }
              const end = addDays(first.start, -1);
              await tx
                .update(periods)
                .set(
                  setPeriod({
                    ...previous,
                    end,
                    days: countDays(previous.start, end),
                    label: end.slice(0, 7) as YearMonth,
                  }),
                )
                .where(eq(periods.id, previous.id));
            }
          }
          await tx
            .update(periods)
            .set(setPeriod(first))
            .where(eq(periods.id, current.id as string));
          if (second !== undefined) await insertIn(tx, userId, second);
        }
        const preference = {
          periodStartDay: preview.toDay,
          ...(change.mode === undefined ? {} : { periodMode: change.mode }),
        };
        await tx
          .insert(userPreferences)
          .values({ ...preference, userId })
          .onConflictDoUpdate({ target: userPreferences.userId, set: { ...preference, updatedAt: new Date() } });
        return preview;
      }),

    payday: (userId) =>
      withUser(db, userId, async (tx) => {
        const salaries = await salariesIn(tx);
        return {
          day: detectPayday(salaries.map((row) => row.localDate)),
          merchant: salaries[0]?.merchant ?? null,
          count: salaries.length,
        };
      }),

    lock: (userId, periodId) =>
      withUser(db, userId, async (tx) => {
        const period = await periodIn(tx, periodId);
        const { startDay, today } = await settingsIn(tx, userId, now());
        if (period.end >= today) throw new LedgerError('INVALID_PERIOD', 'The period has not ended yet');
        const locked = await tx
          .update(periods)
          .set({ status: 'closed', closedAt: now(), updatedAt: now() })
          .where(and(eq(periods.id, periodId), eq(periods.status, 'open')))
          .returning({ id: periods.id });
        await ensureIn(tx, userId, today, startDay);
        return { locked: locked.length > 0 };
      }),
  };
}
