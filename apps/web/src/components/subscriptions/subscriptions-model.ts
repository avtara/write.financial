// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What the subscriptions page (FR-SUB2–SUB6) derives from the overview and the accounts: the header line, the
 * warnings (a bill due tomorrow, overdue unconfirmed bills, paying accounts that cannot cover this month's bills),
 * the monthly usage review, the "Bisa dihemat" items, and the per-subscription savings of paused and cancelled ones.
 */
import type { AccountView } from '@wf/db/accounts';
import type { MonthBill, SubscriptionsOverview, SubscriptionView } from '@wf/db/schedules';
import { addDays, countDays, type LocalDate } from '@wf/domain/period';
import { skippedBills, type SkippedBills } from '@wf/domain/subscriptions';
import { PALETTE_COLORS, type ColorToken } from '../../lib/colors.ts';

/** Whole days from `today` to `date` (0 = today, negative = past). */
export function daysFrom(today: LocalDate, date: LocalDate): number {
  return date >= today ? countDays(today, date) - 1 : 1 - countDays(date, today);
}

/** A stable avatar colour per subscription (they have none of their own). */
export function avatarColor(id: string): ColorToken {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) % 9973;
  return PALETTE_COLORS[hash % PALETTE_COLORS.length] as ColorToken;
}

/** Bills of this month still to be charged (from today on), as "Sisa tagihan" counts them. */
export function upcomingBills(overview: Pick<SubscriptionsOverview, 'monthSchedule' | 'today'>): MonthBill[] {
  return overview.monthSchedule.filter((bill) => bill.status === 'will_charge' && bill.dueDate >= overview.today);
}

/** "6 aktif · 4 tagihan tersisa bulan ini · berikutnya Netflix, 3 hari lagi". */
export function headerSummary(overview: SubscriptionsOverview): {
  readonly active: number;
  readonly remaining: number;
  readonly next: { readonly name: string; readonly days: number } | null;
} {
  const next = overview.subscriptions
    .flatMap((subscription) =>
      subscription.effectiveStatus === 'active' &&
      subscription.nextBill !== null &&
      subscription.nextBill.dueDate >= overview.today
        ? [{ name: subscription.name, due: subscription.nextBill.dueDate }]
        : [],
    )
    .toSorted((a, b) => a.due.localeCompare(b.due))[0];
  return {
    active: overview.counts.active,
    remaining: overview.remainingThisMonth.count,
    next: next === undefined ? null : { name: next.name, days: daysFrom(overview.today, next.due) },
  };
}

/** FR-SUB6 "Pengingat H-1": active subscriptions billed tomorrow. */
export function dueTomorrow(overview: SubscriptionsOverview): SubscriptionView[] {
  const tomorrow = addDays(overview.today, 1);
  return overview.subscriptions.filter(
    (subscription) =>
      subscription.effectiveStatus === 'active' &&
      subscription.nextBill?.dueDate === tomorrow &&
      subscription.nextBill.status === 'scheduled',
  );
}

/** FR-SUB6 "Tagihan belum dikonfirmasi": stored bills past their date that nobody confirmed yet. */
export function overdueBills(overview: SubscriptionsOverview): {
  readonly subscription: SubscriptionView;
  readonly occurrenceId: string;
  readonly dueDate: LocalDate;
}[] {
  return overview.subscriptions.flatMap((subscription) => {
    const bill = subscription.nextBill;
    return bill !== null &&
      bill.occurrenceId !== null &&
      bill.dueDate < overview.today &&
      (bill.status === 'unconfirmed' || bill.status === 'due_review')
      ? [{ subscription, occurrenceId: bill.occurrenceId, dueDate: bill.dueDate }]
      : [];
  });
}

export interface Shortfall {
  readonly account: AccountView;
  /** The first of {@link bills}: its date and subscription head the warning. */
  readonly first: { readonly subscription: SubscriptionView; readonly bill: MonthBill };
  /** This month's remaining bills the account pays, in its currency, oldest first. */
  readonly bills: readonly { readonly subscription: SubscriptionView; readonly bill: MonthBill }[];
  readonly totalMinor: bigint;
  /** What the balance lacks for all of them. */
  readonly shortMinor: bigint;
}

/**
 * FR-SUB6 "Saldo tidak cukup": paying accounts whose balance does not cover this month's remaining bills (in the
 * account's currency; credit cards and bills converted when charged are not judged). Accounts that do are `covered`.
 */
export function balanceCheck(
  overview: SubscriptionsOverview,
  accounts: readonly AccountView[],
): { readonly short: Shortfall[]; readonly covered: AccountView[] } {
  const byId = new Map(overview.subscriptions.map((subscription) => [subscription.id, subscription]));
  const grouped = new Map<string, Shortfall['bills'][number][]>();
  for (const bill of upcomingBills(overview)) {
    const subscription = byId.get(bill.subscriptionId);
    if (subscription === undefined) continue;
    grouped.set(subscription.payFromAccountId, [
      ...(grouped.get(subscription.payFromAccountId) ?? []),
      { subscription, bill },
    ]);
  }
  const short: Shortfall[] = [];
  const covered: AccountView[] = [];
  for (const [accountId, bills] of grouped) {
    const account = accounts.find((candidate) => candidate.id === accountId);
    if (account === undefined || account.type === 'credit_card') continue;
    const same = bills.filter(({ bill }) => bill.currency === account.currency);
    const [first] = same;
    if (first === undefined) continue;
    const totalMinor = same.reduce((total, { bill }) => total + bill.amountMinor, 0n);
    if (account.balanceMinor >= totalMinor) covered.push(account);
    else short.push({ account, first, bills: same, totalMinor, shortMinor: totalMinor - account.balanceMinor });
  }
  return { short, covered };
}

/** Whether the user still has to rate `subscription` this month (never rated, or asked again by now). */
export function needsRating(subscription: SubscriptionView, today: LocalDate): boolean {
  return (
    subscription.usageRating === null || (subscription.nextReviewOn !== null && subscription.nextReviewOn <= today)
  );
}

/** FR-SUB5 "Review bulanan": "6 / 7 dinilai" and the subscription asked about now. */
export function usageReview(overview: SubscriptionsOverview): {
  readonly rated: number;
  readonly total: number;
  readonly next: SubscriptionView | null;
} {
  const active = overview.subscriptions.filter((subscription) => subscription.effectiveStatus === 'active');
  const open = active.filter((subscription) => needsRating(subscription, overview.today));
  return { rated: active.length - open.length, total: active.length, next: open[0] ?? null };
}

/** FR-SUB5 "Fungsi dobel": active subscriptions sharing an icon (what they are for), two or more per icon. */
export function overlaps(overview: SubscriptionsOverview): { readonly icon: string; readonly names: string[] }[] {
  const byIcon = new Map<string, string[]>();
  for (const subscription of overview.subscriptions) {
    if (subscription.effectiveStatus !== 'active' || subscription.icon === null) continue;
    byIcon.set(subscription.icon, [...(byIcon.get(subscription.icon) ?? []), subscription.name]);
  }
  return [...byIcon].filter(([, names]) => names.length > 1).map(([icon, names]) => ({ icon, names }));
}

/** What a paused subscription saved since it was paused, or a cancelled one since it ended ("hemat Rp140.000"). */
export function savedSoFar(subscription: SubscriptionView, today: LocalDate): SkippedBills {
  const { effectiveStatus, pausedOn, endsOn } = subscription;
  if (effectiveStatus === 'paused' && pausedOn !== null && pausedOn <= today) {
    return skippedBills(subscription.priceMinor, subscription.cycle, pausedOn, today);
  }
  if (effectiveStatus === 'cancelled' && endsOn !== null) {
    return skippedBills(subscription.priceMinor, subscription.cycle, addDays(endsOn, 1), today);
  }
  return { count: 0, savedMinor: 0n };
}

/** Whole calendar months between two dates ("7 bulan lalu"). */
export function monthsBetween(from: LocalDate, to: LocalDate): number {
  const months =
    (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + Number(to.slice(5, 7)) - Number(from.slice(5, 7));
  return to.slice(8) < from.slice(8) ? months - 1 : months;
}
