// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Scheduled occurrences (plan §4.3), shared by the app (wf_app) and the worker (wf_worker): the user's clock, the
 * stored shape of a recurrence's transaction template, the due dates of recurrences and subscriptions, and
 * materializing them, non-card installments (FR-U6), and card payment due dates (FR-R7) `MATERIALIZE_DAYS` ahead.
 * Everything runs inside the caller's `withUser` transaction and never writes the ledger (D14); materializing only
 * inserts missing rows, so it is idempotent and safe as wf_worker.
 */
import { addDays, type LocalDate } from '@wf/domain/period';
import { nextOccurrences, reminderAt, type IsoWeekday, type RecurrenceRule } from '@wf/domain/recurrence';
import { cycleRule } from '@wf/domain/subscriptions';
import { and, eq, gte, inArray, isNotNull, lte, ne } from 'drizzle-orm';
import { firstRow, type Transaction } from './db.ts';
import { localDateOf, userContextIn } from './ledger-core.ts';
import { notificationSettingsIn } from './notification-settings.ts';
import {
  accounts,
  debtInstallments,
  debts,
  recurrences,
  scheduledOccurrences,
  subscriptions,
  type JsonObject,
} from './schema.ts';

/** How far ahead occurrences are stored; calendar reads beyond it are computed from the rules. */
export const MATERIALIZE_DAYS = 90;

export type ScheduleSourceType = 'recurrence' | 'subscription';

/**
 * Occurrence sources of the debts page: a non-card installment row (source = the debt; reviewed like a bill) and a
 * credit card payment due date (source = the card account; reminder only, never reviewed, expected 0).
 */
export type DebtSourceType = 'installment' | 'cc_statement';

export interface ScheduleSource {
  readonly type: ScheduleSourceType | DebtSourceType;
  readonly id: string;
}

/** H-1: installment reminders, like recurring bills. */
const INSTALLMENT_REMIND_DAYS = 1;
/** H-3: the card payment due date reminder (FR-R7). */
const CC_STATEMENT_REMIND_DAYS = 3;

/** The transaction every occurrence of a recurrence proposes (FR-T6); amounts in the account currencies. */
export type RecurrenceTemplate =
  | {
      readonly type: 'expense' | 'income';
      readonly accountId: string;
      readonly amountMinor: bigint;
      readonly categoryId: string | null;
      readonly description?: string | null;
      readonly merchant?: string | null;
      readonly tags?: readonly string[];
    }
  | {
      readonly type: 'transfer';
      readonly fromAccountId: string;
      readonly toAccountId: string;
      readonly sentMinor: bigint;
      readonly receivedMinor: bigint;
      readonly fee?: { readonly minor: bigint; readonly categoryId: string } | null;
      readonly description?: string | null;
      readonly tags?: readonly string[];
    };

/** `recurrences.template` JSON of a template (bigints as decimal strings; never a note). */
export function encodeTemplate(template: RecurrenceTemplate): JsonObject {
  const common = {
    description: template.description ?? null,
    tags: [...(template.tags ?? [])],
  };
  if (template.type !== 'transfer') {
    return {
      type: template.type,
      accountId: template.accountId,
      amountMinor: template.amountMinor.toString(),
      categoryId: template.categoryId,
      merchant: template.merchant ?? null,
      ...common,
    };
  }
  return {
    type: 'transfer',
    fromAccountId: template.fromAccountId,
    toAccountId: template.toAccountId,
    sentMinor: template.sentMinor.toString(),
    receivedMinor: template.receivedMinor.toString(),
    fee: template.fee ? { minor: template.fee.minor.toString(), categoryId: template.fee.categoryId } : null,
    ...common,
  };
}

interface StoredTemplate {
  readonly type: 'expense' | 'income' | 'transfer';
  readonly accountId: string;
  readonly amountMinor: string;
  readonly categoryId: string | null;
  readonly merchant: string | null;
  readonly fromAccountId: string;
  readonly toAccountId: string;
  readonly sentMinor: string;
  readonly receivedMinor: string;
  readonly fee: { readonly minor: string; readonly categoryId: string } | null;
  readonly description: string | null;
  readonly tags: readonly string[];
}

/** The template stored by {@link encodeTemplate}. */
export function decodeTemplate(json: JsonObject): RecurrenceTemplate {
  const stored = json as unknown as StoredTemplate;
  const common = { description: stored.description, tags: stored.tags };
  if (stored.type !== 'transfer') {
    return {
      type: stored.type,
      accountId: stored.accountId,
      amountMinor: BigInt(stored.amountMinor),
      categoryId: stored.categoryId,
      merchant: stored.merchant,
      ...common,
    };
  }
  return {
    type: 'transfer',
    fromAccountId: stored.fromAccountId,
    toAccountId: stored.toAccountId,
    sentMinor: BigInt(stored.sentMinor),
    receivedMinor: BigInt(stored.receivedMinor),
    fee: stored.fee ? { minor: BigInt(stored.fee.minor), categoryId: stored.fee.categoryId } : null,
    ...common,
  };
}

export interface TemplateAmount {
  /** The account occurrences are paid from (or into, for income). */
  readonly accountId: string;
  /** The expected amount in that account's currency. */
  readonly amountMinor: bigint;
}

/** Where a template's occurrences are paid from and how much is expected. */
export function templateAmount(template: RecurrenceTemplate): TemplateAmount {
  return template.type === 'transfer'
    ? { accountId: template.fromAccountId, amountMinor: template.sentMinor }
    : { accountId: template.accountId, amountMinor: template.amountMinor };
}

type RecurrenceRow = typeof recurrences.$inferSelect;
type SubscriptionRow = typeof subscriptions.$inferSelect;

/** The repeat rule of a stored recurrence. */
export function recurrenceRuleOf(
  row: Pick<RecurrenceRow, 'freq' | 'interval' | 'startOn' | 'weekday' | 'monthDay' | 'endType' | 'endCount'>,
): RecurrenceRule {
  return {
    freq: row.freq,
    interval: row.interval,
    startOn: row.startOn,
    weekday: row.weekday as IsoWeekday | null,
    monthDay: row.monthDay,
    end: row.endType === 'after' ? { type: 'after', count: row.endCount as number } : { type: 'never' },
  };
}

/** Due dates of an active recurrence in `from`–`until` (none once stopped). */
export function recurrenceDueDates(
  row: Pick<
    RecurrenceRow,
    'status' | 'freq' | 'interval' | 'startOn' | 'weekday' | 'monthDay' | 'endType' | 'endCount'
  >,
  from: LocalDate,
  until: LocalDate,
): LocalDate[] {
  if (row.status === 'stopped') return [];
  return nextOccurrences(recurrenceRuleOf(row), { from, until });
}

/**
 * Bill dates of a subscription in `from`–`until`, starting at `next_billing_date`: none up to the trial's last day,
 * none while paused (`paused_on` ≤ due < `paused_until`), none after `ends_on` once cancelled after the next bill,
 * and none at all once cancelled now.
 */
export function subscriptionDueDates(
  row: Pick<
    SubscriptionRow,
    'nextBillingDate' | 'cycle' | 'trialEndsOn' | 'status' | 'pausedOn' | 'pausedUntil' | 'cancelMode' | 'endsOn'
  >,
  from: LocalDate,
  until: LocalDate,
): LocalDate[] {
  if (row.status === 'cancelled' && row.cancelMode === 'now') return [];
  return nextOccurrences(cycleRule(row.nextBillingDate, row.cycle), { from, until }).filter(
    (due) =>
      (row.trialEndsOn === null || due > row.trialEndsOn) &&
      !(row.status === 'paused' && due >= (row.pausedOn as LocalDate) && due < (row.pausedUntil as LocalDate)) &&
      !(row.status === 'cancelled' && due > (row.endsOn as LocalDate)),
  );
}

/** The user's time zone and calendar date at `now`. */
export async function userClockIn(
  tx: Transaction,
  userId: string,
  now: Date,
): Promise<{ timeZone: string; today: LocalDate }> {
  const { timezone } = await userContextIn(tx, userId);
  return { timeZone: timezone, today: localDateOf(now, timezone) };
}

type NewOccurrence = typeof scheduledOccurrences.$inferInsert;

/**
 * Inserts the missing occurrences of the user's active recurrences and subscriptions, the unpaid rows of active
 * non-card debts, and the payment due dates (`cc_due_day`, monthly) of active credit cards (or only `source`) due in
 * [today, today + `MATERIALIZE_DAYS`]; a subscription's window starts at its `next_billing_date` when that is earlier,
 * so the next unpaid bill always has a row. Installments expect the row total in the debt currency; card due dates
 * expect 0. `remind_at` is the user's reminder time (Settings › Notifikasi, default 09.00) local on `due − offset`
 * (installments H-1, card due dates H-3; no reminder without an offset or for a bill already overdue). Existing rows
 * are never modified.
 */
export async function materializeIn(
  tx: Transaction,
  userId: string,
  options: { readonly now: Date; readonly source?: ScheduleSource },
): Promise<{ created: number }> {
  const { timeZone, today } = await userClockIn(tx, userId, options.now);
  const { reminderTime } = await notificationSettingsIn(tx, userId);
  const until = addDays(today, MATERIALIZE_DAYS);
  const { source } = options;
  const rows: NewOccurrence[] = [];
  const occurrence = (
    sourceType: ScheduleSource['type'],
    sourceId: string,
    dueDate: LocalDate,
    expectedMinor: bigint,
    currency: string,
    offset: number | null,
  ): NewOccurrence => ({
    userId,
    sourceType,
    sourceId,
    dueDate,
    expectedMinor,
    currency,
    remindAt: offset === null || dueDate < today ? null : reminderAt(dueDate, offset, timeZone, reminderTime),
  });

  const wants = (type: ScheduleSource['type']) => source === undefined || source.type === type;

  if (wants('recurrence')) {
    const schedules = await tx
      .select()
      .from(recurrences)
      .where(and(eq(recurrences.status, 'active'), source === undefined ? undefined : eq(recurrences.id, source.id)));
    const templates = schedules.map((row) => templateAmount(decodeTemplate(row.template)));
    const currencies = await accountCurrenciesIn(
      tx,
      templates.map((template) => template.accountId),
    );
    schedules.forEach((row, index) => {
      const { accountId, amountMinor } = templates[index] as TemplateAmount;
      const start = row.startOn > today ? row.startOn : today;
      for (const due of recurrenceDueDates(row, start, until)) {
        rows.push(
          occurrence('recurrence', row.id, due, amountMinor, currencies.get(accountId) as string, row.remindOffsetDays),
        );
      }
    });
  }
  if (wants('subscription')) {
    const subs = await tx
      .select()
      .from(subscriptions)
      .where(source === undefined ? undefined : eq(subscriptions.id, source.id));
    for (const row of subs) {
      const start = row.nextBillingDate < today ? row.nextBillingDate : today;
      for (const due of subscriptionDueDates(row, start, until)) {
        rows.push(occurrence('subscription', row.id, due, row.priceMinor, row.currency, row.remindDaysBefore));
      }
    }
  }
  if (wants('installment')) {
    const due = await tx
      .select({
        debtId: debts.id,
        currency: debts.currency,
        dueDate: debtInstallments.dueDate,
        principalMinor: debtInstallments.principalMinor,
        interestMinor: debtInstallments.interestMinor,
        feeMinor: debtInstallments.feeMinor,
      })
      .from(debtInstallments)
      .innerJoin(debts, eq(debts.id, debtInstallments.debtId))
      .where(
        and(
          ne(debts.kind, 'card_installment'),
          eq(debts.status, 'active'),
          eq(debtInstallments.status, 'scheduled'),
          gte(debtInstallments.dueDate, today),
          lte(debtInstallments.dueDate, until),
          source === undefined ? undefined : eq(debts.id, source.id),
        ),
      );
    for (const row of due) {
      const expected = row.principalMinor + row.interestMinor + row.feeMinor;
      rows.push(occurrence('installment', row.debtId, row.dueDate, expected, row.currency, INSTALLMENT_REMIND_DAYS));
    }
  }
  if (wants('cc_statement')) {
    const cards = await tx
      .select({ id: accounts.id, currency: accounts.currency, dueDay: accounts.ccDueDay })
      .from(accounts)
      .where(
        and(
          eq(accounts.type, 'credit_card'),
          eq(accounts.status, 'active'),
          isNotNull(accounts.ccDueDay),
          source === undefined ? undefined : eq(accounts.id, source.id),
        ),
      );
    for (const card of cards) {
      const rule: RecurrenceRule = {
        freq: 'monthly',
        interval: 1,
        startOn: today,
        weekday: null,
        monthDay: card.dueDay,
        end: { type: 'never' },
      };
      for (const due of nextOccurrences(rule, { from: today, until })) {
        rows.push(occurrence('cc_statement', card.id, due, 0n, card.currency, CC_STATEMENT_REMIND_DAYS));
      }
    }
  }
  if (rows.length === 0) return { created: 0 };
  const created = await tx
    .insert(scheduledOccurrences)
    .values(rows)
    .onConflictDoNothing({
      target: [scheduledOccurrences.sourceType, scheduledOccurrences.sourceId, scheduledOccurrences.dueDate],
    })
    .returning({ id: scheduledOccurrences.id });
  return { created: created.length };
}

async function accountCurrenciesIn(tx: Transaction, ids: readonly string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await tx
    .select({ id: accounts.id, currency: accounts.currency })
    .from(accounts)
    .where(inArray(accounts.id, [...new Set(ids)]));
  return new Map(rows.map((row) => [row.id, row.currency]));
}

/**
 * Deletes the `scheduled` occurrences of `source` due on or after `from` (their reminders go with them); rows already
 * in review, confirmed, or skipped stay. App only: wf_worker has no DELETE.
 */
export async function pruneFutureIn(
  tx: Transaction,
  userId: string,
  source: ScheduleSource,
  from: LocalDate,
): Promise<number> {
  const deleted = await tx
    .delete(scheduledOccurrences)
    .where(
      and(
        eq(scheduledOccurrences.userId, userId),
        eq(scheduledOccurrences.sourceType, source.type),
        eq(scheduledOccurrences.sourceId, source.id),
        eq(scheduledOccurrences.status, 'scheduled'),
        gte(scheduledOccurrences.dueDate, from),
      ),
    )
    .returning({ id: scheduledOccurrences.id });
  return deleted.length;
}

export interface PastCharge {
  readonly sourceType: ScheduleSourceType;
  readonly sourceId: string;
  readonly dueDate: LocalDate;
  /** The live transaction that paid it. */
  readonly transactionId: string;
  readonly amountMinor: bigint;
  readonly currency: string;
}

/**
 * Links an existing transaction to a schedule as a `confirmed` occurrence on `dueDate` (seed, imports of billing
 * history); a row already on that date is kept and its id returned.
 */
export async function recordPastChargeIn(
  tx: Transaction,
  userId: string,
  charge: PastCharge,
): Promise<{ id: string; created: boolean }> {
  const [created] = await tx
    .insert(scheduledOccurrences)
    .values({
      userId,
      sourceType: charge.sourceType,
      sourceId: charge.sourceId,
      dueDate: charge.dueDate,
      expectedMinor: charge.amountMinor,
      currency: charge.currency,
      status: 'confirmed',
      transactionId: charge.transactionId,
    })
    .onConflictDoNothing({
      target: [scheduledOccurrences.sourceType, scheduledOccurrences.sourceId, scheduledOccurrences.dueDate],
    })
    .returning({ id: scheduledOccurrences.id });
  if (created !== undefined) return { id: created.id, created: true };
  const existing = await tx
    .select({ id: scheduledOccurrences.id })
    .from(scheduledOccurrences)
    .where(
      and(
        eq(scheduledOccurrences.sourceType, charge.sourceType),
        eq(scheduledOccurrences.sourceId, charge.sourceId),
        eq(scheduledOccurrences.dueDate, charge.dueDate),
      ),
    );
  return { id: firstRow(existing, 'scheduled_occurrences').id, created: false };
}
