// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Schedules (wf_app): recurring transactions and contributions (FR-T6, FR-L8), subscriptions (FR-SUB1–SUB6), detected
 * subscription candidates (FR-SUB4), and the calendar's scheduled events (FR-C2). Nothing here writes the ledger:
 * occurrences become transactions only through the Review queue (`@wf/db/review`). Every change to a rule prunes the
 * future `scheduled` occurrences it affects and materializes them again (`@wf/db/occurrences`).
 */
import { convert, type FxRate } from '@wf/domain/fx';
import { addDays, countDays, type LocalDate } from '@wf/domain/period';
import {
  checkRecurrence,
  type InvalidRecurrenceError,
  nextOccurrences,
  RECURRENCE_FREQS,
  type IsoWeekday,
  type RecurrenceEnd,
  type RecurrenceFreq,
  type RecurrenceRule,
} from '@wf/domain/recurrence';
import {
  cancelledSavings,
  cancelPlan,
  couldSave,
  cycleRule,
  detectionImpact,
  effectiveStatus,
  type InvalidSubscriptionError,
  pausePlan,
  priceIncrease,
  remainingInMonth,
  SUBSCRIPTION_CYCLES,
  subscriptionTotals,
  trialFirstBill,
  USAGE_RATINGS,
  type CancelMode,
  type DetectionImpact,
  type PauseLength,
  type PriceIncrease,
  type RemainingBills,
  type SubscriptionCycle,
  type SubscriptionStatus,
  type SubscriptionTotals,
  type TrialLength,
  type UsageRating,
} from '@wf/domain/subscriptions';
import { MAX_TAGS_PER_TRANSACTION, toBase } from '@wf/domain/transactions';
import { and, asc, desc, eq, gte, inArray, isNull, lte, ne, sql, type SQL } from 'drizzle-orm';
import { firstRow, withUser, type Database, type Transaction } from './db.ts';
import { viewsIn } from './accounts.ts';
import { referenceRateIn } from './fx-rates.ts';
import { LedgerError } from './ledger-errors.ts';
import { userContextIn } from './ledger-core.ts';
import {
  decodeTemplate,
  encodeTemplate,
  MATERIALIZE_DAYS,
  materializeIn,
  pruneFutureIn,
  recurrenceDueDates,
  recurrenceRuleOf,
  subscriptionDueDates,
  templateAmount,
  userClockIn,
  type RecurrenceTemplate,
  type ScheduleSourceType,
} from './occurrences.ts';
import {
  accounts,
  categories,
  detectedRecurring,
  goals,
  type OCCURRENCE_STATUSES,
  postings,
  recurrences,
  scheduledOccurrences,
  subscriptions,
  transactions,
} from './schema.ts';

export type OccurrenceStatus = (typeof OCCURRENCE_STATUSES)[number];

/** The earliest occurrence that is neither confirmed nor skipped (`occurrenceId` null when not stored yet). */
export interface NextOccurrence {
  readonly occurrenceId: string | null;
  readonly dueDate: LocalDate;
  readonly status: OccurrenceStatus;
}

export interface RecurrenceInput {
  readonly template: RecurrenceTemplate;
  readonly freq: RecurrenceFreq;
  /** Every N weeks/months/years (1–99, default 1). */
  readonly interval?: number;
  /** The first occurrence; anchors the interval (yearly: its month and day). */
  readonly startOn: LocalDate;
  /** Weekly only (default: the weekday of `startOn`). */
  readonly weekday?: IsoWeekday | null;
  /** Monthly only, 1–31 clamped to the month end (default: the day of `startOn`). */
  readonly monthDay?: number | null;
  readonly end: RecurrenceEnd;
  /** Days before the due date for the 09.00 reminder (FR-T6 H-1 = 1, 0–30); `null` = none. */
  readonly remindOffsetDays: number | null;
}

export interface RecurrenceView {
  readonly id: string;
  readonly template: RecurrenceTemplate;
  /** Currency of the template's paying (or receiving) account. */
  readonly currency: string;
  readonly freq: RecurrenceFreq;
  readonly interval: number;
  readonly startOn: LocalDate;
  readonly weekday: IsoWeekday | null;
  readonly monthDay: number | null;
  readonly end: RecurrenceEnd;
  readonly remindOffsetDays: number | null;
  readonly status: 'active' | 'stopped';
  readonly stoppedAt: Date | null;
  /** FR-T6 preview: the next three due dates from today (none once stopped). */
  readonly preview: LocalDate[];
  readonly nextDue: NextOccurrence | null;
  readonly occurrences: { readonly confirmed: number; readonly skipped: number; readonly open: number };
  readonly createdAt: Date;
}

export interface SubscriptionInput {
  /** 1–40 characters after trimming. */
  readonly name: string;
  readonly plan?: string | null;
  readonly icon?: string | null;
  readonly logoKey?: string | null;
  readonly description?: string | null;
  /** > 0, in `currency`. */
  readonly priceMinor: bigint;
  readonly currency: string;
  readonly cycle: SubscriptionCycle;
  /** The next bill; replaced by the trial's first bill when `trial` is set. */
  readonly nextBillingDate: LocalDate;
  readonly payFromAccountId: string;
  /** An expense category, or `null`. */
  readonly categoryId: string | null;
  /** 0–30 days, default 3; `null` = no reminder. */
  readonly remindDaysBefore?: number | null;
  readonly startedOn: LocalDate;
  /** Free trial from `startedOn` (FR-SUB1: 7/14 days, 1 month, or until a date); `null` = none. */
  readonly trial?: TrialLength | null;
}

export interface SubscriptionView {
  readonly id: string;
  readonly name: string;
  readonly plan: string | null;
  readonly icon: string | null;
  readonly logoKey: string | null;
  readonly description: string | null;
  readonly priceMinor: bigint;
  readonly currency: string;
  readonly cycle: SubscriptionCycle;
  readonly nextBillingDate: LocalDate;
  readonly payFromAccountId: string;
  readonly categoryId: string | null;
  readonly remindDaysBefore: number | null;
  readonly startedOn: LocalDate;
  readonly trialEndsOn: LocalDate | null;
  /** As stored; a pause or cancel takes effect by date (see `effectiveStatus`). */
  readonly status: SubscriptionStatus;
  readonly effectiveStatus: SubscriptionStatus;
  readonly pausedOn: LocalDate | null;
  readonly pausedUntil: LocalDate | null;
  readonly pauseRemindDays: number | null;
  readonly cancelMode: CancelMode | null;
  readonly endsOn: LocalDate | null;
  readonly cancelledAt: Date | null;
  readonly usageRating: UsageRating | null;
  readonly ratedAt: Date | null;
  readonly nextReviewOn: LocalDate | null;
  /** Monthly equivalent in `currency` (yearly cycles count 0, weekly × 52 / 12). */
  readonly monthlyMinor: bigint;
  readonly yearlyMinor: bigint;
  readonly nextBill: NextOccurrence | null;
  readonly priceIncrease: PriceIncrease | null;
  /** Confirmed bills with a live transaction. */
  readonly paidCount: number;
  /** Their amounts in the paying accounts' currencies. */
  readonly totalPaidMinor: bigint;
  readonly createdAt: Date;
}

export type MonthBillStatus = 'will_charge' | 'paid' | 'unconfirmed';

/** FR-SUB2 monthly schedule: one bill of this calendar month. */
export interface MonthBill {
  readonly occurrenceId: string;
  readonly subscriptionId: string;
  readonly name: string;
  readonly icon: string | null;
  readonly dueDate: LocalDate;
  readonly amountMinor: bigint;
  readonly currency: string;
  readonly status: MonthBillStatus;
}

export interface CategoryShare {
  readonly categoryId: string | null;
  readonly count: number;
  readonly monthlyMinor: bigint;
  readonly yearlyMinor: bigint;
  /** Share of the yearly cost of all active subscriptions. */
  readonly shareBps: number;
}

/** FR-SUB2 page; figures that mix subscriptions are in the base currency. */
export interface SubscriptionsOverview {
  readonly today: LocalDate;
  readonly baseCurrency: string;
  readonly subscriptions: SubscriptionView[];
  readonly counts: Readonly<Record<SubscriptionStatus, number>>;
  /** Over the effectively active subscriptions. */
  readonly totals: SubscriptionTotals;
  readonly remainingThisMonth: RemainingBills;
  readonly monthSchedule: MonthBill[];
  /** FR-SUB5 "Bisa dihemat": active subscriptions rated rarely used. */
  readonly couldSave: { readonly subscriptionId: string; readonly yearlyMinor: bigint }[];
  readonly priceIncreases: ({ readonly subscriptionId: string } & PriceIncrease)[];
  /** "Total dihemat" by cancelled subscriptions. */
  readonly cancelledSavedMinor: bigint;
  readonly byCategory: CategoryShare[];
  /** Currencies without a rate to the base currency; their subscriptions are left out of the figures. */
  readonly missingRates: string[];
}

export interface BillingCharge {
  readonly occurrenceId: string;
  readonly dueDate: LocalDate;
  readonly transactionId: string;
  readonly localDate: LocalDate;
  /** Paid amount in the account currency. */
  readonly amountMinor: bigint;
  readonly accountId: string;
  readonly confirmedAt: Date;
}

export interface BillingHistory {
  /** Newest first. */
  readonly charges: BillingCharge[];
  readonly count: number;
  readonly totalPaidMinor: bigint;
  readonly priceIncrease: PriceIncrease | null;
}

export interface ChangeAccountResult {
  /** The first bill not yet in review, which the new account pays; `null` without one. */
  readonly effectiveFrom: LocalDate | null;
  /** FR-SUB3/SUB6: the new account's balance does not cover that bill (`null` when it does or cannot be judged). */
  readonly insufficient: { readonly balanceMinor: bigint; readonly shortMinor: bigint } | null;
}

export interface DetectedView {
  readonly id: string;
  readonly merchant: string;
  readonly merchantKey: string;
  readonly dayOfMonth: number;
  readonly amountMinor: bigint;
  readonly currency: string;
  readonly occurrences: number;
  readonly lastSeenOn: LocalDate;
  readonly accountId: string | null;
  readonly categoryId: string | null;
}

export interface DetectedOverview {
  readonly candidates: DetectedView[];
  /** Monthly total of the active subscriptions if every candidate were added. */
  readonly impact: DetectionImpact;
}

/** FR-C2 calendar event; scheduled events never affect balances. */
export interface ScheduledItem {
  /** `null` for dates beyond the materialized horizon (computed from the rule). */
  readonly occurrenceId: string | null;
  readonly sourceType: ScheduleSourceType;
  readonly sourceId: string;
  /** Subscription name, or the recurrence's description / merchant. */
  readonly name: string | null;
  readonly icon: string | null;
  readonly dueDate: LocalDate;
  readonly expectedMinor: bigint;
  readonly currency: string;
  readonly status: OccurrenceStatus;
  readonly transactionId: string | null;
  readonly accountId: string;
  readonly direction: 'out' | 'in' | 'transfer';
}

export interface SchedulesRepository {
  listRecurrences: (userId: string, options?: { readonly status?: 'active' | 'stopped' }) => Promise<RecurrenceView[]>;
  /** @throws {LedgerError} `INVALID_RECURRENCE` */
  createRecurrence: (userId: string, input: RecurrenceInput) => Promise<RecurrenceView>;
  /** Replaces the rule and template; future `scheduled` occurrences are rebuilt. @throws {LedgerError} `NOT_FOUND`, `INVALID_RECURRENCE` */
  updateRecurrence: (userId: string, id: string, input: RecurrenceInput) => Promise<RecurrenceView>;
  /** FR-L8: deletes future scheduled occurrences (and their reminders); past transactions stay. @throws {LedgerError} `NOT_FOUND` */
  stopRecurrence: (userId: string, id: string) => Promise<{ deletedOccurrences: number }>;
  /** "Urungkan": active again, occurrences rebuilt (idempotent). @throws {LedgerError} `NOT_FOUND` */
  undoStopRecurrence: (userId: string, id: string) => Promise<RecurrenceView>;

  listSubscriptions: (
    userId: string,
    options?: { readonly status?: SubscriptionStatus },
  ) => Promise<SubscriptionsOverview>;
  /** @throws {LedgerError} `NOT_FOUND` */
  getSubscription: (userId: string, id: string) => Promise<SubscriptionView>;
  /** @throws {LedgerError} `INVALID_SUBSCRIPTION` */
  createSubscription: (userId: string, input: SubscriptionInput) => Promise<SubscriptionView>;
  /** @throws {LedgerError} `NOT_FOUND`, `INVALID_SUBSCRIPTION` */
  updateSubscription: (userId: string, id: string, patch: Partial<SubscriptionInput>) => Promise<SubscriptionView>;
  /** Deletes the subscription and its unconfirmed occurrences; confirmed history rows stay. @throws {LedgerError} `NOT_FOUND` */
  deleteSubscription: (userId: string, id: string) => Promise<{ deletedOccurrences: number }>;
  /** @throws {LedgerError} `NOT_FOUND`, `INVALID_SUBSCRIPTION` */
  changeAccount: (userId: string, id: string, accountId: string) => Promise<ChangeAccountResult>;
  /** FR-SUB3 pause from the next bill. @throws {LedgerError} `NOT_FOUND`, `INVALID_SUBSCRIPTION` */
  pause: (
    userId: string,
    id: string,
    length: PauseLength,
    options: { readonly remindDaysBefore: number | null },
  ) => Promise<SubscriptionView>;
  /** @throws {LedgerError} `NOT_FOUND`, `INVALID_SUBSCRIPTION` */
  cancel: (userId: string, id: string, mode: CancelMode) => Promise<SubscriptionView>;
  /** Clears a pause or cancel (idempotent). @throws {LedgerError} `NOT_FOUND` */
  reactivate: (userId: string, id: string) => Promise<SubscriptionView>;
  /** FR-SUB5; asks again a month later. @throws {LedgerError} `NOT_FOUND`, `INVALID_SUBSCRIPTION` */
  rateUsage: (userId: string, id: string, rating: UsageRating) => Promise<SubscriptionView>;
  /** @throws {LedgerError} `NOT_FOUND` */
  billingHistory: (userId: string, id: string) => Promise<BillingHistory>;

  listDetected: (userId: string) => Promise<DetectedOverview>;
  /** "Tambahkan" / "Tambah semua". @throws {LedgerError} `NOT_FOUND`, `INVALID_SUBSCRIPTION` */
  addDetected: (userId: string, ids: readonly string[]) => Promise<{ subscriptionIds: string[] }>;
  /** "Bukan langganan". */
  dismissDetected: (userId: string, ids: readonly string[]) => Promise<{ dismissed: number }>;

  /** Calendar events in `from`–`to` (≤ 366 days). @throws {LedgerError} `INVALID_PERIOD` */
  listScheduled: (
    userId: string,
    range: { readonly from: LocalDate; readonly to: LocalDate },
  ) => Promise<ScheduledItem[]>;
}

export interface SchedulesOptions {
  readonly now?: () => Date;
}

const NAME_MAX = 40;
const REMIND_MAX = 30;
const RANGE_MAX_DAYS = 366;
const DEFAULT_REMIND_DAYS = 3;
const PREVIEW_COUNT = 3;
const CURRENCY = /^[A-Z]{3}$/;
const OPEN_STATUSES = ['scheduled', 'due_review', 'unconfirmed'] as const;
const BPS = 10_000n;

type RecurrenceRow = typeof recurrences.$inferSelect;
type SubscriptionRow = typeof subscriptions.$inferSelect;

function isRemindDays(value: number | null): boolean {
  return value === null || (Number.isInteger(value) && value >= 0 && value <= REMIND_MAX);
}

/** Trimmed `value`, `null` when blank. */
function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
}

function earlier(a: LocalDate, b: LocalDate): LocalDate {
  return a < b ? a : b;
}

/** ISO weekday of a date (1 Monday – 7 Sunday). */
function weekdayOf(date: LocalDate): IsoWeekday {
  return (((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7) + 1) as IsoWeekday;
}

/** The earliest date on or after `from` of the billing cycle anchored at `anchor` (which may be later than `from`). */
function cycleDateOnOrAfter(anchor: LocalDate, cycle: SubscriptionCycle, from: LocalDate): LocalDate {
  const rule = cycleRule(anchor, cycle);
  if (cycle !== 'yearly') return nextOccurrences({ ...rule, startOn: from }, { from, count: 1 })[0] as LocalDate;
  // Yearly rules take their month and day from `startOn`: start a year before `from` on the anchor's date (29 Feb:
  // in the latest leap year, so the rule keeps clamping to 28 Feb in the other years).
  const monthDay = anchor.slice(5);
  let year = Number(from.slice(0, 4)) - 1;
  if (monthDay === '02-29') {
    year += 1;
    while (new Date(Date.UTC(year, 1, 29)).getUTCMonth() !== 1) year -= 1;
  }
  const startOn = `${String(year).padStart(4, '0')}-${monthDay}` as LocalDate;
  return nextOccurrences({ ...rule, startOn }, { from, count: 1 })[0] as LocalDate;
}

/** The same day next month (clamped to the month end). */
function oneMonthAfter(date: LocalDate): LocalDate {
  const rule: RecurrenceRule = {
    freq: 'monthly',
    interval: 1,
    startOn: date,
    weekday: null,
    monthDay: Number(date.slice(8, 10)),
    end: { type: 'never' },
  };
  return nextOccurrences(rule, { from: addDays(date, 1), count: 1 })[0] as LocalDate;
}

function invalidRecurrence(message: string): LedgerError {
  return new LedgerError('INVALID_RECURRENCE', message);
}

function invalidSubscription(message: string): LedgerError {
  return new LedgerError('INVALID_SUBSCRIPTION', message);
}

/** Usable (live, active) accounts among `ids`, with their currency. */
async function activeAccountsIn(tx: Transaction, ids: readonly string[]): Promise<Map<string, string>> {
  const rows = await tx
    .select({ id: accounts.id, currency: accounts.currency })
    .from(accounts)
    .where(and(inArray(accounts.id, [...new Set(ids)]), eq(accounts.status, 'active')));
  return new Map(rows.map((row) => [row.id, row.currency]));
}

async function isCategoryIn(tx: Transaction, id: string, kinds: readonly ('expense' | 'income' | 'fee')[]) {
  const [row] = await tx
    .select({ id: categories.id })
    .from(categories)
    .where(
      and(
        eq(categories.id, id),
        isNull(categories.deletedAt),
        isNull(categories.archivedAt),
        inArray(categories.kind, [...kinds]),
      ),
    );
  return row !== undefined;
}

/** The template validated against the user's accounts, categories, and goals, with text trimmed. */
async function checkTemplateIn(tx: Transaction, template: RecurrenceTemplate): Promise<RecurrenceTemplate> {
  const tags = template.tags ?? [];
  if (tags.length > MAX_TAGS_PER_TRANSACTION) throw invalidRecurrence('Too many tags');
  const description = clean(template.description);
  if (template.type !== 'transfer') {
    if (template.amountMinor <= 0n) throw invalidRecurrence('Amount must be positive');
    if ((await activeAccountsIn(tx, [template.accountId])).size === 0) throw invalidRecurrence('Unknown account');
    if (template.categoryId !== null && !(await isCategoryIn(tx, template.categoryId, [template.type]))) {
      throw invalidRecurrence('Unknown category');
    }
    return { ...template, description, merchant: clean(template.merchant), tags };
  }
  if (template.sentMinor <= 0n || template.receivedMinor <= 0n) throw invalidRecurrence('Amount must be positive');
  if (template.fromAccountId === template.toAccountId) throw invalidRecurrence('Same account');
  const found = await activeAccountsIn(tx, [template.fromAccountId, template.toAccountId]);
  if (found.size !== 2) throw invalidRecurrence('Unknown account');
  if (found.get(template.fromAccountId) === found.get(template.toAccountId)) {
    if (template.sentMinor !== template.receivedMinor) throw invalidRecurrence('Received differs within one currency');
  }
  const { fee } = template;
  if (fee) {
    if (fee.minor <= 0n) throw invalidRecurrence('Fee must be positive');
    if (!(await isCategoryIn(tx, fee.categoryId, ['fee', 'expense']))) throw invalidRecurrence('Unknown category');
  }
  const allocations = template.allocations ?? [];
  if (allocations.length > 0) {
    if (allocations.some((part) => part.amountMinor <= 0n)) throw invalidRecurrence('Allocation must be positive');
    const total = allocations.reduce((sum, part) => sum + part.amountMinor, 0n);
    if (total > template.sentMinor) throw invalidRecurrence('Allocations exceed the amount');
    const goalIds = [...new Set(allocations.map((part) => part.goalId))];
    const rows = await tx.select({ id: goals.id }).from(goals).where(inArray(goals.id, goalIds));
    if (rows.length !== goalIds.length || goalIds.length !== allocations.length) {
      throw invalidRecurrence('Unknown or repeated goal');
    }
  }
  return { ...template, description, fee: fee ?? null, tags, allocations };
}

type RecurrenceValues = Omit<typeof recurrences.$inferInsert, 'userId'>;

/** Validated column values of a recurrence input. */
async function recurrenceValuesIn(tx: Transaction, input: RecurrenceInput): Promise<RecurrenceValues> {
  if (!RECURRENCE_FREQS.includes(input.freq)) throw invalidRecurrence('Unknown frequency');
  const rule: RecurrenceRule = {
    freq: input.freq,
    interval: input.interval ?? 1,
    startOn: input.startOn,
    weekday: input.freq === 'weekly' ? (input.weekday ?? weekdayOf(input.startOn)) : null,
    monthDay: input.freq === 'monthly' ? (input.monthDay ?? Number(input.startOn.slice(8, 10))) : null,
    end: input.end,
  };
  try {
    checkRecurrence(rule);
  } catch (error) {
    // A pure validator: it only throws `InvalidRecurrenceError`.
    throw invalidRecurrence((error as InvalidRecurrenceError).message);
  }
  if (!isRemindDays(input.remindOffsetDays)) throw invalidRecurrence('Reminder offset must be 0–30 days');
  const template = await checkTemplateIn(tx, input.template);
  return {
    template: encodeTemplate(template),
    freq: rule.freq,
    interval: rule.interval,
    startOn: rule.startOn,
    weekday: rule.weekday,
    monthDay: rule.monthDay,
    endType: rule.end.type,
    endCount: rule.end.type === 'after' ? rule.end.count : null,
    remindOffsetDays: input.remindOffsetDays,
  };
}

interface OccurrenceStats {
  readonly counts: Map<string, Map<OccurrenceStatus, number>>;
  readonly next: Map<string, NextOccurrence>;
}

async function occurrenceStatsIn(
  tx: Transaction,
  sourceType: ScheduleSourceType,
  ids: readonly string[],
): Promise<OccurrenceStats> {
  const counts = new Map<string, Map<OccurrenceStatus, number>>();
  const next = new Map<string, NextOccurrence>();
  if (ids.length === 0) return { counts, next };
  const scope = and(eq(scheduledOccurrences.sourceType, sourceType), inArray(scheduledOccurrences.sourceId, [...ids]));
  const grouped = await tx
    .select({
      sourceId: scheduledOccurrences.sourceId,
      status: scheduledOccurrences.status,
      count: sql<number>`count(*)::int`.mapWith(Number),
    })
    .from(scheduledOccurrences)
    .where(scope)
    .groupBy(scheduledOccurrences.sourceId, scheduledOccurrences.status);
  for (const row of grouped) {
    const bySource = counts.get(row.sourceId) ?? new Map<OccurrenceStatus, number>();
    bySource.set(row.status, row.count);
    counts.set(row.sourceId, bySource);
  }
  const open = await tx
    .selectDistinctOn([scheduledOccurrences.sourceId], {
      sourceId: scheduledOccurrences.sourceId,
      occurrenceId: scheduledOccurrences.id,
      dueDate: scheduledOccurrences.dueDate,
      status: scheduledOccurrences.status,
    })
    .from(scheduledOccurrences)
    .where(and(scope, inArray(scheduledOccurrences.status, [...OPEN_STATUSES])))
    .orderBy(scheduledOccurrences.sourceId, asc(scheduledOccurrences.dueDate));
  for (const { sourceId, ...occurrence } of open) next.set(sourceId, occurrence);
  return { counts, next };
}

async function recurrenceViewsIn(tx: Transaction, today: LocalDate, where: SQL | undefined): Promise<RecurrenceView[]> {
  const rows = await tx
    .select()
    .from(recurrences)
    .where(where)
    .orderBy(asc(recurrences.createdAt), asc(recurrences.id));
  const templates = rows.map((row) => decodeTemplate(row.template));
  const currencies = await accountCurrenciesIn(
    tx,
    templates.map((template) => templateAmount(template).accountId),
  );
  const stats = await occurrenceStatsIn(
    tx,
    'recurrence',
    rows.map((row) => row.id),
  );
  return rows.map((row, index) => {
    const template = templates[index] as RecurrenceTemplate;
    const preview =
      row.status === 'stopped'
        ? []
        : nextOccurrences(recurrenceRuleOf(row), {
            from: row.startOn > today ? row.startOn : today,
            count: PREVIEW_COUNT,
          });
    const counts = stats.counts.get(row.id);
    const count = (status: OccurrenceStatus) => counts?.get(status) ?? 0;
    const stored = stats.next.get(row.id);
    const computed = preview[0];
    return {
      id: row.id,
      template,
      currency: currencies.get(templateAmount(template).accountId) as string,
      freq: row.freq,
      interval: row.interval,
      startOn: row.startOn,
      weekday: row.weekday as IsoWeekday | null,
      monthDay: row.monthDay,
      end: recurrenceRuleOf(row).end,
      remindOffsetDays: row.remindOffsetDays,
      status: row.status,
      stoppedAt: row.stoppedAt,
      preview,
      nextDue:
        stored ?? (computed === undefined ? null : { occurrenceId: null, dueDate: computed, status: 'scheduled' }),
      occurrences: {
        confirmed: count('confirmed'),
        skipped: count('skipped'),
        open: count('scheduled') + count('due_review') + count('unconfirmed'),
      },
      createdAt: row.createdAt,
    };
  });
}

/** Account currencies (any status) by id. */
async function accountCurrenciesIn(tx: Transaction, ids: readonly string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await tx
    .select({ id: accounts.id, currency: accounts.currency })
    .from(accounts)
    .where(inArray(accounts.id, [...new Set(ids)]));
  return new Map(rows.map((row) => [row.id, row.currency]));
}

interface ChargeRow extends BillingCharge {
  readonly subscriptionId: string;
}

/** Confirmed bills of `ids` whose transaction is live, newest first. */
async function chargesIn(tx: Transaction, ids: readonly string[]): Promise<ChargeRow[]> {
  if (ids.length === 0) return [];
  return tx
    .select({
      subscriptionId: scheduledOccurrences.sourceId,
      occurrenceId: scheduledOccurrences.id,
      dueDate: scheduledOccurrences.dueDate,
      transactionId: transactions.id,
      localDate: transactions.localDate,
      amountMinor: sql<bigint>`(-${postings.amountMinor})::bigint`.mapWith(BigInt),
      accountId: postings.accountId,
      confirmedAt: transactions.confirmedByUserAt,
    })
    .from(scheduledOccurrences)
    .innerJoin(
      transactions,
      and(eq(transactions.id, scheduledOccurrences.transactionId), isNull(transactions.deletedAt)),
    )
    .innerJoin(postings, and(eq(postings.transactionId, transactions.id), eq(postings.role, 'principal')))
    .where(
      and(
        eq(scheduledOccurrences.sourceType, 'subscription'),
        inArray(scheduledOccurrences.sourceId, [...ids]),
        eq(scheduledOccurrences.status, 'confirmed'),
      ),
    )
    .orderBy(desc(scheduledOccurrences.dueDate), desc(scheduledOccurrences.id));
}

function historyOf(charges: readonly ChargeRow[]): BillingHistory {
  return {
    charges: charges.map((charge) => ({
      occurrenceId: charge.occurrenceId,
      dueDate: charge.dueDate,
      transactionId: charge.transactionId,
      localDate: charge.localDate,
      amountMinor: charge.amountMinor,
      accountId: charge.accountId,
      confirmedAt: charge.confirmedAt,
    })),
    count: charges.length,
    totalPaidMinor: charges.reduce((sum, charge) => sum + charge.amountMinor, 0n),
    priceIncrease: priceIncrease(charges.map((charge) => ({ date: charge.dueDate, amountMinor: charge.amountMinor }))),
  };
}

async function subscriptionViewsIn(
  tx: Transaction,
  today: LocalDate,
  rows: readonly SubscriptionRow[],
): Promise<SubscriptionView[]> {
  const ids = rows.map((row) => row.id);
  const stats = await occurrenceStatsIn(tx, 'subscription', ids);
  const charges = await chargesIn(tx, ids);
  return rows.map((row) => {
    const history = historyOf(charges.filter((charge) => charge.subscriptionId === row.id));
    const totals = subscriptionTotals([row]);
    return {
      id: row.id,
      name: row.name,
      plan: row.plan,
      icon: row.icon,
      logoKey: row.logoKey,
      description: row.description,
      priceMinor: row.priceMinor,
      currency: row.currency,
      cycle: row.cycle,
      nextBillingDate: row.nextBillingDate,
      payFromAccountId: row.payFromAccountId,
      categoryId: row.categoryId,
      remindDaysBefore: row.remindDaysBefore,
      startedOn: row.startedOn,
      trialEndsOn: row.trialEndsOn,
      status: row.status,
      effectiveStatus: effectiveStatus(row, today),
      pausedOn: row.pausedOn,
      pausedUntil: row.pausedUntil,
      pauseRemindDays: row.pauseRemindDays,
      cancelMode: row.cancelMode,
      endsOn: row.endsOn,
      cancelledAt: row.cancelledAt,
      usageRating: row.usageRating,
      ratedAt: row.ratedAt,
      nextReviewOn: row.nextReviewOn,
      monthlyMinor: totals.monthlyMinor,
      yearlyMinor: totals.yearlyMinor,
      nextBill: stats.next.get(row.id) ?? null,
      priceIncrease: history.priceIncrease,
      paidCount: history.count,
      totalPaidMinor: history.totalPaidMinor,
      createdAt: row.createdAt,
    };
  });
}

type SubscriptionValues = Omit<typeof subscriptions.$inferInsert, 'userId'>;

/** Validated column values of a complete subscription input. */
async function subscriptionValuesIn(tx: Transaction, input: SubscriptionInput): Promise<SubscriptionValues> {
  const name = clean(input.name);
  if (name === null || name.length > NAME_MAX) throw invalidSubscription('Name must be 1–40 characters');
  const plan = clean(input.plan);
  if (plan !== null && plan.length > NAME_MAX) throw invalidSubscription('Plan must be at most 40 characters');
  if (input.priceMinor <= 0n) throw invalidSubscription('Price must be positive');
  if (!CURRENCY.test(input.currency)) throw invalidSubscription('Invalid currency');
  if (!SUBSCRIPTION_CYCLES.includes(input.cycle)) throw invalidSubscription('Unknown cycle');
  const remindDaysBefore = input.remindDaysBefore === undefined ? DEFAULT_REMIND_DAYS : input.remindDaysBefore;
  if (!isRemindDays(remindDaysBefore)) throw invalidSubscription('Reminder must be 0–30 days');
  if ((await activeAccountsIn(tx, [input.payFromAccountId])).size === 0) throw invalidSubscription('Unknown account');
  if (input.categoryId !== null && !(await isCategoryIn(tx, input.categoryId, ['expense']))) {
    throw invalidSubscription('Unknown category');
  }
  let nextBillingDate = input.nextBillingDate;
  let trialEndsOn: LocalDate | null = null;
  if (input.trial) {
    try {
      const plan = trialFirstBill(input.startedOn, input.trial);
      trialEndsOn = plan.trialEndsOn;
      nextBillingDate = plan.firstBillOn;
    } catch (error) {
      // A pure validator: it only throws `InvalidSubscriptionError`.
      throw invalidSubscription((error as InvalidSubscriptionError).message);
    }
  }
  if (nextBillingDate < input.startedOn) throw invalidSubscription('The next bill is before the start');
  return {
    name,
    plan,
    icon: clean(input.icon),
    logoKey: clean(input.logoKey),
    description: clean(input.description),
    priceMinor: input.priceMinor,
    currency: input.currency,
    cycle: input.cycle,
    nextBillingDate,
    payFromAccountId: input.payFromAccountId,
    categoryId: input.categoryId,
    remindDaysBefore,
    startedOn: input.startedOn,
    trialEndsOn,
  };
}

/** The current input of a stored subscription (for patches). */
function inputOf(row: SubscriptionRow): SubscriptionInput {
  return {
    name: row.name,
    plan: row.plan,
    icon: row.icon,
    logoKey: row.logoKey,
    description: row.description,
    priceMinor: row.priceMinor,
    currency: row.currency,
    cycle: row.cycle,
    nextBillingDate: row.nextBillingDate,
    payFromAccountId: row.payFromAccountId,
    categoryId: row.categoryId,
    remindDaysBefore: row.remindDaysBefore,
    startedOn: row.startedOn,
  };
}

async function lockedRecurrenceIn(tx: Transaction, id: string): Promise<RecurrenceRow> {
  const [row] = await tx.select().from(recurrences).where(eq(recurrences.id, id)).for('update');
  if (row === undefined) throw new LedgerError('NOT_FOUND', 'No such recurrence');
  return row;
}

async function lockedSubscriptionIn(tx: Transaction, id: string): Promise<SubscriptionRow> {
  const [row] = await tx.select().from(subscriptions).where(eq(subscriptions.id, id)).for('update');
  if (row === undefined) throw new LedgerError('NOT_FOUND', 'No such subscription');
  return row;
}

/** Rates from `currencies` to `baseCurrency`; currencies without one are reported. */
async function ratesIn(
  tx: Transaction,
  baseCurrency: string,
  currencies: Iterable<string>,
): Promise<{ rates: FxRate[]; missing: Set<string> }> {
  const rates: FxRate[] = [];
  const missing = new Set<string>();
  for (const currency of new Set(currencies)) {
    if (currency === baseCurrency) continue;
    const rate = await referenceRateIn(tx, currency, baseCurrency);
    if (rate === null) missing.add(currency);
    else rates.push(rate);
  }
  return { rates, missing };
}

export function createSchedules(db: Database, options: SchedulesOptions = {}): SchedulesRepository {
  const now = options.now ?? (() => new Date());

  const recurrenceViewIn = async (tx: Transaction, today: LocalDate, id: string) =>
    (await recurrenceViewsIn(tx, today, eq(recurrences.id, id)))[0] as RecurrenceView;

  const subscriptionViewIn = async (tx: Transaction, today: LocalDate, id: string) => {
    const rows = await tx.select().from(subscriptions).where(eq(subscriptions.id, id));
    if (rows.length === 0) throw new LedgerError('NOT_FOUND', 'No such subscription');
    return (await subscriptionViewsIn(tx, today, rows))[0] as SubscriptionView;
  };

  /** Rebuilds the future `scheduled` occurrences of a subscription after a change. */
  const rebuildSubscriptionIn = async (
    tx: Transaction,
    userId: string,
    row: Pick<SubscriptionRow, 'id' | 'nextBillingDate'>,
    today: LocalDate,
    at: Date,
  ) => {
    const source = { type: 'subscription', id: row.id } as const;
    await pruneFutureIn(tx, userId, source, earlier(row.nextBillingDate, today));
    await materializeIn(tx, userId, { now: at, source });
  };

  return {
    listRecurrences: (userId, listOptions = {}) =>
      withUser(db, userId, async (tx) => {
        const { today } = await userClockIn(tx, userId, now());
        return recurrenceViewsIn(
          tx,
          today,
          listOptions.status === undefined ? undefined : eq(recurrences.status, listOptions.status),
        );
      }),

    createRecurrence: (userId, input) =>
      withUser(db, userId, async (tx) => {
        const at = now();
        const { today } = await userClockIn(tx, userId, at);
        const values = await recurrenceValuesIn(tx, input);
        const inserted = await tx
          .insert(recurrences)
          .values({ ...values, userId })
          .returning({ id: recurrences.id });
        const { id } = firstRow(inserted, 'recurrences');
        await materializeIn(tx, userId, { now: at, source: { type: 'recurrence', id } });
        return recurrenceViewIn(tx, today, id);
      }),

    updateRecurrence: (userId, id, input) =>
      withUser(db, userId, async (tx) => {
        const at = now();
        const { today } = await userClockIn(tx, userId, at);
        await lockedRecurrenceIn(tx, id);
        const values = await recurrenceValuesIn(tx, input);
        await tx
          .update(recurrences)
          .set({ ...values, updatedAt: at })
          .where(eq(recurrences.id, id));
        const source = { type: 'recurrence', id } as const;
        await pruneFutureIn(tx, userId, source, today);
        await materializeIn(tx, userId, { now: at, source });
        return recurrenceViewIn(tx, today, id);
      }),

    stopRecurrence: (userId, id) =>
      withUser(db, userId, async (tx) => {
        const at = now();
        const { today } = await userClockIn(tx, userId, at);
        const row = await lockedRecurrenceIn(tx, id);
        if (row.status === 'active') {
          await tx
            .update(recurrences)
            .set({ status: 'stopped', stoppedAt: at, updatedAt: at })
            .where(eq(recurrences.id, id));
        }
        const deletedOccurrences = await pruneFutureIn(tx, userId, { type: 'recurrence', id }, today);
        return { deletedOccurrences };
      }),

    undoStopRecurrence: (userId, id) =>
      withUser(db, userId, async (tx) => {
        const at = now();
        const { today } = await userClockIn(tx, userId, at);
        const row = await lockedRecurrenceIn(tx, id);
        if (row.status === 'stopped') {
          await tx
            .update(recurrences)
            .set({ status: 'active', stoppedAt: null, updatedAt: at })
            .where(eq(recurrences.id, id));
        }
        await materializeIn(tx, userId, { now: at, source: { type: 'recurrence', id } });
        return recurrenceViewIn(tx, today, id);
      }),

    listSubscriptions: (userId, listOptions = {}) =>
      withUser(db, userId, async (tx) => {
        const { today } = await userClockIn(tx, userId, now());
        const { baseCurrency } = await userContextIn(tx, userId);
        const rows = await tx
          .select()
          .from(subscriptions)
          .orderBy(asc(subscriptions.nextBillingDate), asc(subscriptions.name), asc(subscriptions.id));
        const views = await subscriptionViewsIn(tx, today, rows);
        const { rates, missing } = await ratesIn(
          tx,
          baseCurrency,
          views.map((view) => view.currency),
        );
        const valued = views.filter((view) => !missing.has(view.currency));
        const base = (minor: bigint, currency: string) => toBase({ minor, currency }, { baseCurrency, rates });
        const priced = (view: SubscriptionView) => ({ ...view, priceMinor: base(view.priceMinor, view.currency) });
        const active = valued.filter((view) => view.effectiveStatus === 'active').map(priced);
        const counts: Record<SubscriptionStatus, number> = { active: 0, paused: 0, cancelled: 0 };
        for (const view of views) counts[view.effectiveStatus] += 1;

        const month = await tx
          .select({
            occurrenceId: scheduledOccurrences.id,
            subscriptionId: scheduledOccurrences.sourceId,
            dueDate: scheduledOccurrences.dueDate,
            amountMinor: scheduledOccurrences.expectedMinor,
            currency: scheduledOccurrences.currency,
            status: scheduledOccurrences.status,
          })
          .from(scheduledOccurrences)
          .where(
            and(
              eq(scheduledOccurrences.sourceType, 'subscription'),
              sql`to_char(${scheduledOccurrences.dueDate}, 'YYYY-MM') = ${today.slice(0, 7)}`,
              ne(scheduledOccurrences.status, 'skipped'),
            ),
          )
          .orderBy(asc(scheduledOccurrences.dueDate), asc(scheduledOccurrences.id));
        const byId = new Map(views.map((view) => [view.id, view]));
        const monthSchedule: MonthBill[] = month.map((bill) => {
          const view = byId.get(bill.subscriptionId) as SubscriptionView;
          return {
            occurrenceId: bill.occurrenceId,
            subscriptionId: bill.subscriptionId,
            name: view.name,
            icon: view.icon,
            dueDate: bill.dueDate,
            amountMinor: bill.amountMinor,
            currency: bill.currency,
            status: bill.status === 'confirmed' ? 'paid' : bill.status === 'scheduled' ? 'will_charge' : 'unconfirmed',
          };
        });

        const totals = subscriptionTotals(active);
        const shares = new Map<string | null, SubscriptionView[]>();
        for (const view of active) shares.set(view.categoryId, [...(shares.get(view.categoryId) ?? []), view]);
        const byCategory = [...shares].map(([categoryId, group]) => {
          const groupTotals = subscriptionTotals(group);
          return {
            categoryId,
            count: group.length,
            monthlyMinor: groupTotals.monthlyMinor,
            yearlyMinor: groupTotals.yearlyMinor,
            shareBps: Number((groupTotals.yearlyMinor * BPS) / totals.yearlyMinor),
          };
        });
        byCategory.sort((a, b) => Number(b.yearlyMinor - a.yearlyMinor));
        const cancelled = valued
          .filter((view) => view.effectiveStatus === 'cancelled')
          .map((view) => ({ ...priced(view), endsOn: view.endsOn as LocalDate }));

        return {
          today,
          baseCurrency,
          subscriptions:
            listOptions.status === undefined
              ? views
              : views.filter((view) => view.effectiveStatus === listOptions.status),
          counts,
          totals,
          remainingThisMonth: remainingInMonth(
            month
              .filter((bill) => !missing.has(bill.currency))
              .map((bill) => ({ ...bill, amountMinor: base(bill.amountMinor, bill.currency) })),
            today,
          ),
          monthSchedule,
          couldSave: couldSave(active).map((saving) => ({
            subscriptionId: saving.subscription.id,
            yearlyMinor: saving.yearlyMinor,
          })),
          priceIncreases: views.flatMap((view) =>
            view.priceIncrease === null ? [] : [{ subscriptionId: view.id, ...view.priceIncrease }],
          ),
          cancelledSavedMinor: cancelledSavings(cancelled, today).totalMinor,
          byCategory,
          missingRates: [...missing].sort(),
        };
      }),

    getSubscription: (userId, id) =>
      withUser(db, userId, async (tx) => {
        const { today } = await userClockIn(tx, userId, now());
        return subscriptionViewIn(tx, today, id);
      }),

    createSubscription: (userId, input) =>
      withUser(db, userId, async (tx) => {
        const at = now();
        const { today } = await userClockIn(tx, userId, at);
        const values = await subscriptionValuesIn(tx, input);
        const inserted = await tx
          .insert(subscriptions)
          .values({ ...values, userId })
          .returning({ id: subscriptions.id });
        const { id } = firstRow(inserted, 'subscriptions');
        await materializeIn(tx, userId, { now: at, source: { type: 'subscription', id } });
        return subscriptionViewIn(tx, today, id);
      }),

    updateSubscription: (userId, id, patch) =>
      withUser(db, userId, async (tx) => {
        const at = now();
        const { today } = await userClockIn(tx, userId, at);
        const row = await lockedSubscriptionIn(tx, id);
        // Keys sent as `undefined` keep the stored value (`null` clears).
        const defined = Object.fromEntries(
          Object.entries(patch as Record<string, unknown>).filter(([, value]) => value !== undefined),
        );
        const merged: SubscriptionInput = { ...inputOf(row), ...defined };
        const values = await subscriptionValuesIn(tx, merged);
        // Without a new trial the stored one stays (`trial: null` clears it).
        const trialEndsOn = patch.trial === undefined ? row.trialEndsOn : values.trialEndsOn;
        await tx
          .update(subscriptions)
          .set({ ...values, trialEndsOn, updatedAt: at })
          .where(eq(subscriptions.id, id));
        const reschedule =
          values.nextBillingDate !== row.nextBillingDate ||
          values.cycle !== row.cycle ||
          trialEndsOn !== row.trialEndsOn ||
          values.remindDaysBefore !== row.remindDaysBefore;
        if (reschedule) {
          await rebuildSubscriptionIn(tx, userId, row, today, at);
        } else if (values.priceMinor !== row.priceMinor || values.currency !== row.currency) {
          await tx
            .update(scheduledOccurrences)
            .set({ expectedMinor: values.priceMinor, currency: values.currency, updatedAt: at })
            .where(
              and(
                eq(scheduledOccurrences.sourceType, 'subscription'),
                eq(scheduledOccurrences.sourceId, id),
                eq(scheduledOccurrences.status, 'scheduled'),
              ),
            );
        }
        return subscriptionViewIn(tx, today, id);
      }),

    deleteSubscription: (userId, id) =>
      withUser(db, userId, async (tx) => {
        await lockedSubscriptionIn(tx, id);
        const deleted = await tx
          .delete(scheduledOccurrences)
          .where(
            and(
              eq(scheduledOccurrences.sourceType, 'subscription'),
              eq(scheduledOccurrences.sourceId, id),
              ne(scheduledOccurrences.status, 'confirmed'),
            ),
          )
          .returning({ id: scheduledOccurrences.id });
        await tx.delete(subscriptions).where(eq(subscriptions.id, id));
        return { deletedOccurrences: deleted.length };
      }),

    changeAccount: (userId, id, accountId) =>
      withUser(db, userId, async (tx) => {
        const at = now();
        const row = await lockedSubscriptionIn(tx, id);
        const [account] = (await viewsIn(tx, userId, and(eq(accounts.id, accountId), eq(accounts.status, 'active'))))
          .views;
        if (account === undefined) throw invalidSubscription('Unknown account');
        await tx
          .update(subscriptions)
          .set({ payFromAccountId: accountId, updatedAt: at })
          .where(eq(subscriptions.id, id));
        const [stored] = await tx
          .select({ dueDate: scheduledOccurrences.dueDate, amountMinor: scheduledOccurrences.expectedMinor })
          .from(scheduledOccurrences)
          .where(
            and(
              eq(scheduledOccurrences.sourceType, 'subscription'),
              eq(scheduledOccurrences.sourceId, id),
              eq(scheduledOccurrences.status, 'scheduled'),
            ),
          )
          .orderBy(asc(scheduledOccurrences.dueDate))
          .limit(1);
        if (stored === undefined || account.type === 'credit_card') {
          return { effectiveFrom: stored?.dueDate ?? null, insufficient: null };
        }
        const effectiveFrom = stored.dueDate;
        let billMinor = stored.amountMinor;
        if (row.currency !== account.currency) {
          const rate = await referenceRateIn(tx, row.currency, account.currency);
          if (rate === null) return { effectiveFrom, insufficient: null };
          billMinor = convert({ minor: billMinor, currency: row.currency }, account.currency, rate);
        }
        const shortMinor = billMinor - account.balanceMinor;
        return {
          effectiveFrom,
          insufficient: shortMinor > 0n ? { balanceMinor: account.balanceMinor, shortMinor } : null,
        };
      }),

    pause: (userId, id, length, pauseOptions) =>
      withUser(db, userId, async (tx) => {
        const at = now();
        const { today } = await userClockIn(tx, userId, at);
        const row = await lockedSubscriptionIn(tx, id);
        if (effectiveStatus(row, today) === 'cancelled') throw invalidSubscription('Cancelled');
        if (!isRemindDays(pauseOptions.remindDaysBefore)) throw invalidSubscription('Reminder must be 0–30 days');
        let pausedUntil: LocalDate;
        try {
          ({ pausedUntil } = pausePlan(
            row.nextBillingDate,
            row.cycle,
            row.priceMinor,
            length,
            pauseOptions.remindDaysBefore,
          ));
        } catch (error) {
          throw invalidSubscription((error as InvalidSubscriptionError).message);
        }
        const values = {
          status: 'paused' as const,
          pausedOn: today,
          pausedUntil,
          pauseRemindDays: pauseOptions.remindDaysBefore,
          nextBillingDate: pausedUntil,
          cancelMode: null,
          endsOn: null,
          cancelledAt: null,
          updatedAt: at,
        };
        await tx.update(subscriptions).set(values).where(eq(subscriptions.id, id));
        await rebuildSubscriptionIn(tx, userId, row, today, at);
        return subscriptionViewIn(tx, today, id);
      }),

    cancel: (userId, id, mode) =>
      withUser(db, userId, async (tx) => {
        const at = now();
        const { today } = await userClockIn(tx, userId, at);
        const row = await lockedSubscriptionIn(tx, id);
        if (row.status === 'cancelled') throw invalidSubscription('Already cancelled');
        const plan = cancelPlan(row.nextBillingDate, mode, today);
        await tx
          .update(subscriptions)
          .set({
            status: 'cancelled',
            cancelMode: mode,
            endsOn: plan.endsOn,
            cancelledAt: at,
            pausedOn: null,
            pausedUntil: null,
            pauseRemindDays: null,
            updatedAt: at,
          })
          .where(eq(subscriptions.id, id));
        const from = plan.keepsNextBill ? addDays(plan.endsOn, 1) : earlier(row.nextBillingDate, today);
        await pruneFutureIn(tx, userId, { type: 'subscription', id }, from);
        return subscriptionViewIn(tx, today, id);
      }),

    reactivate: (userId, id) =>
      withUser(db, userId, async (tx) => {
        const at = now();
        const { today } = await userClockIn(tx, userId, at);
        const row = await lockedSubscriptionIn(tx, id);
        if (row.status !== 'active') {
          let nextBillingDate = row.nextBillingDate;
          if (row.status === 'paused' && (row.pausedUntil as LocalDate) > today) {
            // Resuming early: the next bill of the same cycle from today.
            nextBillingDate = cycleDateOnOrAfter(row.pausedUntil as LocalDate, row.cycle, today);
          } else if (nextBillingDate < today) {
            const [open] = await tx
              .select({ id: scheduledOccurrences.id })
              .from(scheduledOccurrences)
              .where(
                and(
                  eq(scheduledOccurrences.sourceType, 'subscription'),
                  eq(scheduledOccurrences.sourceId, id),
                  eq(scheduledOccurrences.dueDate, nextBillingDate),
                  inArray(scheduledOccurrences.status, [...OPEN_STATUSES]),
                ),
              );
            if (open === undefined) nextBillingDate = cycleDateOnOrAfter(nextBillingDate, row.cycle, today);
          }
          await tx
            .update(subscriptions)
            .set({
              status: 'active',
              nextBillingDate,
              pausedOn: null,
              pausedUntil: null,
              pauseRemindDays: null,
              cancelMode: null,
              endsOn: null,
              cancelledAt: null,
              updatedAt: at,
            })
            .where(eq(subscriptions.id, id));
          await rebuildSubscriptionIn(
            tx,
            userId,
            { id, nextBillingDate: earlier(nextBillingDate, row.nextBillingDate) },
            today,
            at,
          );
        }
        return subscriptionViewIn(tx, today, id);
      }),

    rateUsage: (userId, id, rating) =>
      withUser(db, userId, async (tx) => {
        const at = now();
        const { today } = await userClockIn(tx, userId, at);
        if (!USAGE_RATINGS.includes(rating)) throw invalidSubscription('Unknown rating');
        await lockedSubscriptionIn(tx, id);
        await tx
          .update(subscriptions)
          .set({ usageRating: rating, ratedAt: at, nextReviewOn: oneMonthAfter(today), updatedAt: at })
          .where(eq(subscriptions.id, id));
        return subscriptionViewIn(tx, today, id);
      }),

    billingHistory: (userId, id) =>
      withUser(db, userId, async (tx) => {
        const [row] = await tx.select({ id: subscriptions.id }).from(subscriptions).where(eq(subscriptions.id, id));
        if (row === undefined) throw new LedgerError('NOT_FOUND', 'No such subscription');
        return historyOf(await chargesIn(tx, [id]));
      }),

    listDetected: (userId) =>
      withUser(db, userId, async (tx) => {
        const { today } = await userClockIn(tx, userId, now());
        const rows = await tx
          .select({
            id: detectedRecurring.id,
            merchant: detectedRecurring.merchant,
            merchantKey: detectedRecurring.merchantKey,
            dayOfMonth: detectedRecurring.dayOfMonth,
            amountMinor: detectedRecurring.amountMinor,
            currency: detectedRecurring.currency,
            occurrences: detectedRecurring.occurrences,
            lastSeenOn: detectedRecurring.lastSeenOn,
            accountId: detectedRecurring.accountId,
            categoryId: detectedRecurring.categoryId,
          })
          .from(detectedRecurring)
          .where(eq(detectedRecurring.status, 'new'))
          .orderBy(desc(detectedRecurring.lastSeenOn), asc(detectedRecurring.merchantKey));
        const active = (await tx.select().from(subscriptions)).filter(
          (row) => effectiveStatus(row, today) === 'active',
        );
        return { candidates: rows, impact: detectionImpact(subscriptionTotals(active).monthlyMinor, rows) };
      }),

    addDetected: (userId, ids) =>
      withUser(db, userId, async (tx) => {
        const at = now();
        const { today } = await userClockIn(tx, userId, at);
        if (ids.length === 0) return { subscriptionIds: [] };
        const rows = await tx
          .select()
          .from(detectedRecurring)
          .where(and(inArray(detectedRecurring.id, [...ids]), eq(detectedRecurring.status, 'new')))
          .for('update');
        if (rows.length !== new Set(ids).size) throw new LedgerError('NOT_FOUND', 'No such candidate');
        const subscriptionIds: string[] = [];
        for (const candidate of rows) {
          if (candidate.accountId === null) throw invalidSubscription('The candidate has no account');
          const anchor = addDays(candidate.lastSeenOn, 1);
          const rule: RecurrenceRule = {
            freq: 'monthly',
            interval: 1,
            startOn: anchor,
            weekday: null,
            monthDay: candidate.dayOfMonth,
            end: { type: 'never' },
          };
          const nextBillingDate = nextOccurrences(rule, { from: anchor > today ? anchor : today, count: 1 })[0];
          const values = await subscriptionValuesIn(tx, {
            name: candidate.merchant.trim().slice(0, NAME_MAX),
            priceMinor: candidate.amountMinor,
            currency: candidate.currency,
            cycle: 'monthly',
            nextBillingDate: nextBillingDate as LocalDate,
            payFromAccountId: candidate.accountId,
            categoryId: candidate.categoryId,
            startedOn: candidate.lastSeenOn,
          });
          const inserted = await tx
            .insert(subscriptions)
            .values({ ...values, userId })
            .returning({ id: subscriptions.id });
          const { id } = firstRow(inserted, 'subscriptions');
          await tx
            .update(detectedRecurring)
            .set({ status: 'added', subscriptionId: id, updatedAt: at })
            .where(eq(detectedRecurring.id, candidate.id));
          await materializeIn(tx, userId, { now: at, source: { type: 'subscription', id } });
          subscriptionIds.push(id);
        }
        return { subscriptionIds };
      }),

    dismissDetected: (userId, ids) =>
      withUser(db, userId, async (tx) => {
        if (ids.length === 0) return { dismissed: 0 };
        const rows = await tx
          .update(detectedRecurring)
          .set({ status: 'dismissed', updatedAt: now() })
          .where(and(inArray(detectedRecurring.id, [...ids]), eq(detectedRecurring.status, 'new')))
          .returning({ id: detectedRecurring.id });
        return { dismissed: rows.length };
      }),

    listScheduled: (userId, range) =>
      withUser(db, userId, async (tx) => {
        if (range.from > range.to || countDays(range.from, range.to) > RANGE_MAX_DAYS) {
          throw new LedgerError('INVALID_PERIOD', 'The range must be 1–366 days');
        }
        const { today } = await userClockIn(tx, userId, now());
        const recurrenceRows = await tx.select().from(recurrences);
        const subscriptionRows = await tx.select().from(subscriptions);
        const templates = new Map(recurrenceRows.map((row) => [row.id, decodeTemplate(row.template)]));
        const currencies = await accountCurrenciesIn(
          tx,
          [...templates.values()].map((template) => templateAmount(template).accountId),
        );
        const categoryIds = [...templates.values()].flatMap((template) =>
          template.type !== 'transfer' && template.categoryId !== null ? [template.categoryId] : [],
        );
        const icons = new Map(
          categoryIds.length === 0
            ? []
            : (
                await tx
                  .select({ id: categories.id, icon: categories.icon })
                  .from(categories)
                  .where(inArray(categories.id, categoryIds))
              ).map((row) => [row.id, row.icon]),
        );
        type Source = Pick<ScheduledItem, 'name' | 'icon' | 'accountId' | 'direction'> & {
          readonly expectedMinor: bigint;
          readonly currency: string;
        };
        const sources = new Map<string, Source>();
        for (const row of recurrenceRows) {
          const template = templates.get(row.id) as RecurrenceTemplate;
          const { accountId, amountMinor } = templateAmount(template);
          sources.set(row.id, {
            // Decoded templates always carry `merchant` (`null` when blank).
            name: template.description ?? (template.type === 'transfer' ? null : (template.merchant as string | null)),
            icon:
              template.type === 'transfer' || template.categoryId === null
                ? null
                : (icons.get(template.categoryId) ?? null),
            accountId,
            direction: template.type === 'transfer' ? 'transfer' : template.type === 'income' ? 'in' : 'out',
            expectedMinor: amountMinor,
            currency: currencies.get(accountId) as string,
          });
        }
        for (const row of subscriptionRows) {
          sources.set(row.id, {
            name: row.name,
            icon: row.icon,
            accountId: row.payFromAccountId,
            direction: 'out',
            expectedMinor: row.priceMinor,
            currency: row.currency,
          });
        }

        const stored = await tx
          .select()
          .from(scheduledOccurrences)
          .where(
            and(
              inArray(scheduledOccurrences.sourceType, ['recurrence', 'subscription']),
              gte(scheduledOccurrences.dueDate, range.from),
              lte(scheduledOccurrences.dueDate, range.to),
            ),
          );
        const items: ScheduledItem[] = [];
        for (const row of stored) {
          const source = sources.get(row.sourceId);
          if (source === undefined) continue; // A deleted subscription's confirmed history.
          items.push({
            occurrenceId: row.id,
            sourceType: row.sourceType as ScheduleSourceType,
            sourceId: row.sourceId,
            name: source.name,
            icon: source.icon,
            dueDate: row.dueDate,
            expectedMinor: row.expectedMinor,
            currency: row.currency,
            status: row.status,
            transactionId: row.transactionId,
            accountId: source.accountId,
            direction: source.direction,
          });
        }
        const beyond = addDays(today, MATERIALIZE_DAYS + 1);
        if (range.to >= beyond) {
          const start = range.from > beyond ? range.from : beyond;
          const computed = (sourceType: ScheduleSourceType, sourceId: string, dueDate: LocalDate) => {
            const source = sources.get(sourceId) as Source;
            items.push({
              occurrenceId: null,
              sourceType,
              sourceId,
              name: source.name,
              icon: source.icon,
              dueDate,
              expectedMinor: source.expectedMinor,
              currency: source.currency,
              status: 'scheduled',
              transactionId: null,
              accountId: source.accountId,
              direction: source.direction,
            });
          };
          for (const row of recurrenceRows) {
            for (const due of recurrenceDueDates(row, start, range.to)) computed('recurrence', row.id, due);
          }
          for (const row of subscriptionRows) {
            for (const due of subscriptionDueDates(row, start, range.to)) computed('subscription', row.id, due);
          }
        }
        return items.sort(
          (a, b) =>
            a.dueDate.localeCompare(b.dueDate) ||
            (a.name ?? '').localeCompare(b.name ?? '') ||
            a.sourceId.localeCompare(b.sourceId),
        );
      }),
  };
}
