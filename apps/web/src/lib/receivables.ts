// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Pure helpers of the Receivables tab and the split bill (FR-U7, FR-L5): the badge and avatar of a receivable, the
 * "Piutang" and "Jatuh tempo terdekat" KPIs, the partial-payment chips, the people's shares of a split bill, and its
 * "SETELAH DISIMPAN" impact on the budget and the safe daily limit, and what the dialogs share (accounts to lend
 * from, the date trigger, the moment of a date, the reminder clock).
 */
import type { AccountView } from '@wf/db/accounts';
import type { ReceivablesOverview, ReceivableView } from '@wf/db/receivables';
import { safeDailyLimit } from '@wf/domain/budget';
import { countDays, type LocalDate } from '@wf/domain/period';
import { splitBill, type SplitMethod } from '@wf/domain/receivables';
import type { Locale } from '@wf/i18n/locale';
import { m } from '@wf/i18n/messages';
import { formatDate } from '@wf/ui/dates';
import { wallTime, zonedInstant } from '../components/ledger/transaction-draft.ts';
import type { SplitBillContext } from '../server/fn/receivables.ts';

/** Days left before a receivable is due that make its badge amber ("3 hari lagi"). */
export const DUE_SOON_DAYS = 7;

/** "Sebagian", or the countdown to the due date (negative = overdue); `null` without a due date. */
export type ReceivableBadge =
  | { readonly kind: 'partial' }
  | { readonly kind: 'due'; readonly days: number; readonly tone: 'neutral' | 'soon' | 'overdue' };

export function receivableBadge(receivable: ReceivableView, today: LocalDate): ReceivableBadge | null {
  if (receivable.status === 'partial') return { kind: 'partial' };
  if (receivable.dueDate === null) return null;
  const days = countDays(today, receivable.dueDate) - 1;
  return { kind: 'due', days, tone: days < 0 ? 'overdue' : days <= DUE_SOON_DAYS ? 'soon' : 'neutral' };
}

/** Avatar tints of people, picked by name so a person keeps theirs (Nadia violet, Raka Pratama blue in KZZZy). */
const AVATARS = [
  'bg-violet-tint-2 text-violet',
  'bg-blue-tint-2 text-blue-fg',
  'bg-green-tint-2 text-green-fg',
  'bg-amber-tint-2 text-amber-fg',
  'bg-red-tint-2 text-red-fg',
] as const;

export function avatarClass(name: string): string {
  let hash = 0;
  for (let index = 0; index < name.length; index += 1) hash = (hash * 31 + name.charCodeAt(index)) % 1_000_003;
  return AVATARS[hash % AVATARS.length] as string;
}

/** The "Piutang" KPI note and the receivable due soonest ("Jatuh tempo terdekat" when no debt is due). */
export interface ReceivableKpis {
  /** Distinct people with an active receivable ("2 orang"). */
  readonly people: number;
  /** The earliest due date from today, with the receivables due then. */
  readonly nearest: {
    readonly date: LocalDate;
    readonly days: number;
    readonly count: number;
    readonly name: string;
    readonly remainingMinor: bigint;
    readonly currency: string;
  } | null;
}

export function receivableKpis(overview: Pick<ReceivablesOverview, 'active'>, today: LocalDate): ReceivableKpis {
  const upcoming = overview.active.filter((row) => row.dueDate !== null && row.dueDate >= today);
  const date = upcoming.reduce<LocalDate | null>(
    (min, row) => (min === null || (row.dueDate as LocalDate) < min ? row.dueDate : min),
    null,
  );
  const due = upcoming.filter((row) => row.dueDate === date);
  const first = due[0];
  return {
    people: new Set(overview.active.map((row) => row.counterparty)).size,
    nearest:
      date === null || first === undefined
        ? null
        : {
            date,
            days: countDays(today, date) - 1,
            count: due.length,
            name: first.counterparty,
            remainingMinor: first.remainingMinor,
            currency: first.currency,
          },
  };
}

/**
 * "Terima pembayaran" partial chips: a third and two thirds of what is left, rounded down to `stepMinor` (Rp300.000 →
 * Rp100.000, Rp200.000); none that would be zero or the whole remainder.
 */
export function partialChips(remainingMinor: bigint, stepMinor: bigint): bigint[] {
  const chips = [1n, 2n]
    .map((thirds) => ((remainingMinor * thirds) / 3n / stepMinor) * stepMinor)
    .filter((amount) => amount > 0n && amount < remainingMinor);
  return [...new Set(chips)];
}

/** A person of a split bill as typed: the user ("Kamu") first. */
export interface SplitPerson {
  readonly name: string;
  /** "Nominal". */
  readonly amountMinor: bigint | null;
  /** "Persen", as typed (`50`, `33,5`). */
  readonly percent: string;
}

/** An item of a "Per item" split: its amount and who shares it (indexes into the people). */
export interface SplitItemDraft {
  readonly amountMinor: bigint | null;
  readonly people: readonly number[];
}

/** Percent typed with a comma or a dot and up to two decimals → basis points; `null` when it is not one. */
export function parsePercentBps(text: string): number | null {
  const match = /^(\d{1,3})(?:[.,](\d{1,2}))?$/.exec(text.trim());
  if (match === null) return null;
  const bps = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  return bps > 10_000 ? null : bps;
}

/** The shares of a split bill, or why there are none yet. */
export type SplitShares =
  | { readonly ok: true; readonly amounts: bigint[] }
  | { readonly ok: false; readonly reason: 'incomplete' | 'mismatch'; readonly differenceMinor: bigint };

/**
 * Each person's share of `totalMinor` (Σ = total exactly, `@wf/domain/receivables.splitBill`): equal, by the typed
 * amounts (must add up to the total), by percent (must add up to 100%), or per item (the rest of the total — tax,
 * service, discount — shared in proportion).
 */
export function splitShares(
  totalMinor: bigint,
  method: SplitMethod,
  people: readonly SplitPerson[],
  items: readonly SplitItemDraft[],
): SplitShares {
  if (method === 'equal') return { ok: true, amounts: splitBill(totalMinor, { method, people: people.length }) };
  if (method === 'amount') {
    if (people.some((person) => person.amountMinor === null))
      return { ok: false, reason: 'incomplete', differenceMinor: 0n };
    const amounts = people.map((person) => person.amountMinor as bigint);
    const sum = amounts.reduce((total, amount) => total + amount, 0n);
    return sum === totalMinor
      ? { ok: true, amounts }
      : { ok: false, reason: 'mismatch', differenceMinor: totalMinor - sum };
  }
  if (method === 'percent') {
    const bps = people.map((person) => parsePercentBps(person.percent));
    if (bps.some((value) => value === null)) return { ok: false, reason: 'incomplete', differenceMinor: 0n };
    const sum = (bps as number[]).reduce((total, value) => total + value, 0);
    if (sum !== 10_000) {
      return { ok: false, reason: 'mismatch', differenceMinor: (totalMinor * BigInt(10_000 - sum)) / 10_000n };
    }
    return { ok: true, amounts: splitBill(totalMinor, { method, bps: bps as number[] }) };
  }
  const complete = items.every((item) => item.amountMinor !== null && item.amountMinor > 0n && item.people.length > 0);
  if (items.length === 0 || !complete) return { ok: false, reason: 'incomplete', differenceMinor: 0n };
  return {
    ok: true,
    amounts: splitBill(totalMinor, {
      method,
      people: people.length,
      items: items.map((item) => ({ amountMinor: item.amountMinor as bigint, people: item.people })),
    }),
  };
}

/** A before → after row of the split preview. */
export interface ImpactRow {
  readonly beforeMinor: bigint;
  readonly afterMinor: bigint;
}

/**
 * "SETELAH DISIMPAN" of a split bill (IGHyP): recorded whole vs. split, the bill's category in the budget period, the
 * month's spending, the safe daily limit (only when the category is budgeted), and the receivables. Rows the bill does
 * not touch (another month, an unbudgeted category) are `null`.
 */
export interface SplitImpact {
  readonly category: ImpactRow | null;
  readonly month: ImpactRow | null;
  readonly safeDaily: ImpactRow | null;
  readonly receivables: ImpactRow;
}

export function splitImpact(
  context: SplitBillContext,
  bill: {
    readonly date: LocalDate;
    readonly categoryId: string | null;
    readonly totalMinor: bigint;
    readonly ownMinor: bigint;
  },
): SplitImpact {
  const othersMinor = bill.totalMinor - bill.ownMinor;
  const { budget } = context;
  const scope = budget === null || bill.date < budget.start || bill.date > budget.end ? null : budget;
  const line = scope?.lines.find((candidate) => candidate.categoryId === bill.categoryId);
  return {
    category:
      line === undefined
        ? null
        : { beforeMinor: line.spentMinor + bill.totalMinor, afterMinor: line.spentMinor + bill.ownMinor },
    month:
      bill.date.slice(0, 7) === context.month.label
        ? {
            beforeMinor: context.month.expenseMinor + bill.totalMinor,
            afterMinor: context.month.expenseMinor + bill.ownMinor,
          }
        : null,
    safeDaily:
      scope === null || line === undefined
        ? null
        : {
            beforeMinor: safeDailyLimit(scope.remainingMinor - bill.totalMinor, scope.daysLeft, scope.stepMinor),
            afterMinor: safeDailyLimit(scope.remainingMinor - bill.ownMinor, scope.daysLeft, scope.stepMinor),
          },
    receivables: { beforeMinor: context.receivablesMinor, afterMinor: context.receivablesMinor + othersMinor },
  };
}

/** Accounts money can be lent from: not credit cards or investments. */
export function lendingAccounts(accounts: readonly AccountView[]): AccountView[] {
  return accounts.filter(
    (account) => account.status === 'active' && account.type !== 'credit_card' && account.type !== 'investment',
  );
}

/** "Hari ini" or the date, as the dialogs' date triggers show it. */
export function dateLabel(date: LocalDate, today: LocalDate, locale: Locale): string {
  const formatted = formatDate(date, locale, 'day');
  return date === today ? `${m.receivables_today()}, ${formatted}` : formatted;
}

/** The moment of `date`: now on today, midday on another day. */
export function momentOf(date: LocalDate, today: LocalDate, timeZone: string): Date {
  return zonedInstant(date, date === today ? wallTime(new Date(), timeZone) : '12:00', timeZone);
}

/** `09:00` as the locale writes it (`09.00`). */
export function reminderClock(time: string, locale: Locale): string {
  return locale === 'id' ? time.replace(':', '.') : time;
}
