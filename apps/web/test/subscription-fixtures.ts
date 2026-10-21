// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The design persona's subscriptions page on 15 Okt 2026 (design section 07, seed `DESIGN_SEED`): 7 active
 * (Rp904.900/bulan), Headspace paused, Canva cancelled, this month's schedule, and two detected candidates.
 */
import type { DetectedOverview, MonthBill, SubscriptionsOverview, SubscriptionView } from '@wf/db/schedules';
import type { LocalDate, YearMonth } from '@wf/domain/period';
import { subscription } from './dashboard-fixtures.ts';
import { categoryId } from './ledger-fixtures.ts';

const d = (value: string) => value as LocalDate;
const FUN = categoryId('system:entertainment');

const next = (id: string, dueDate: string, status: 'scheduled' | 'unconfirmed' = 'scheduled') => ({
  occurrenceId: `occ-${id}-${dueDate}`,
  dueDate: d(dueDate),
  status,
});

export const S_NETFLIX = subscription({
  id: 'netflix',
  name: 'Netflix',
  plan: 'Premium 4K',
  icon: 'tv',
  priceMinor: 186_000n,
  categoryId: FUN,
  nextBillingDate: d('2026-10-18'),
  nextBill: next('netflix', '2026-10-18'),
  usageRating: 'sometimes',
  ratedAt: new Date('2026-10-01T02:00:00Z'),
  nextReviewOn: d('2026-11-01'),
  remindDaysBefore: 1,
  paidCount: 9,
  totalPaidMinor: 1_674_000n,
});
export const S_SPOTIFY = subscription({
  id: 'spotify',
  name: 'Spotify',
  plan: 'Family',
  icon: 'music',
  priceMinor: 86_900n,
  categoryId: FUN,
  payFromAccountId: 'acc-ovo',
  nextBillingDate: d('2026-10-20'),
  nextBill: next('spotify', '2026-10-20'),
  usageRating: 'often',
  ratedAt: new Date('2026-10-01T02:00:00Z'),
  nextReviewOn: d('2026-11-01'),
  startedOn: d('2026-06-20'),
});
export const S_YOUTUBE = subscription({
  id: 'youtube',
  name: 'YouTube Premium',
  plan: 'Individu',
  icon: 'music',
  priceMinor: 59_000n,
  categoryId: FUN,
  nextBillingDate: d('2026-10-22'),
  nextBill: next('youtube', '2026-10-22'),
  remindDaysBefore: null,
});
export const S_CHATGPT = subscription({
  id: 'chatgpt',
  name: 'ChatGPT',
  plan: 'Plus',
  icon: 'bot',
  priceMinor: 329_000n,
  payFromAccountId: 'acc-jago',
  nextBillingDate: d('2026-10-28'),
  nextBill: next('chatgpt', '2026-10-28'),
  usageRating: 'often',
  ratedAt: new Date('2026-10-01T02:00:00Z'),
  nextReviewOn: d('2026-11-01'),
  startedOn: d('2025-03-28'),
  priceIncrease: {
    previousMinor: 299_000n,
    currentMinor: 329_000n,
    increaseMinor: 30_000n,
    increaseBps: 1003,
    since: d('2026-09-28'),
  },
  paidCount: 20,
  totalPaidMinor: 6_040_000n,
});
export const S_GYM = subscription({
  id: 'gym',
  name: 'Fit Hub',
  plan: 'Gym bulanan',
  priceMinor: 199_000n,
  nextBillingDate: d('2026-11-03'),
  nextBill: next('gym', '2026-11-03'),
  usageRating: 'rarely',
  ratedAt: new Date('2026-10-01T02:00:00Z'),
  nextReviewOn: d('2026-11-01'),
});
export const S_ICLOUD = subscription({
  id: 'icloud',
  name: 'iCloud+',
  plan: '200 GB',
  icon: 'cloud',
  priceMinor: 45_000n,
  nextBillingDate: d('2026-10-09'),
  nextBill: next('icloud', '2026-10-09', 'unconfirmed'),
  usageRating: 'often',
  ratedAt: new Date('2026-10-01T02:00:00Z'),
  nextReviewOn: d('2026-11-01'),
});
export const S_HOSTING = subscription({
  id: 'hosting',
  name: 'Niagahoster',
  plan: 'Hosting + domain',
  icon: 'server',
  priceMinor: 660_900n,
  cycle: 'yearly',
  monthlyMinor: 0n,
  yearlyMinor: 660_900n,
  nextBillingDate: d('2027-10-05'),
  usageRating: 'often',
  ratedAt: new Date('2026-10-01T02:00:00Z'),
  nextReviewOn: d('2026-11-01'),
});
export const S_HEADSPACE = subscription({
  id: 'headspace',
  name: 'Headspace',
  priceMinor: 70_000n,
  status: 'paused',
  effectiveStatus: 'paused',
  pausedOn: d('2026-09-01'),
  pausedUntil: d('2026-12-01'),
  nextBillingDate: d('2026-12-01'),
  nextBill: next('headspace', '2026-12-01'),
});
export const S_CANVA = subscription({
  id: 'canva',
  name: 'Canva Pro',
  priceMinor: 95_000n,
  status: 'cancelled',
  effectiveStatus: 'cancelled',
  cancelMode: 'after_next_bill',
  endsOn: d('2026-03-31'),
  nextBillingDate: d('2026-04-01'),
});

export const ACTIVE: readonly SubscriptionView[] = [
  S_ICLOUD,
  S_NETFLIX,
  S_SPOTIFY,
  S_YOUTUBE,
  S_CHATGPT,
  S_GYM,
  S_HOSTING,
];

const bill = (
  view: SubscriptionView,
  dueDate: string,
  status: MonthBill['status'],
  amountMinor = view.priceMinor,
): MonthBill => ({
  occurrenceId: `occ-${view.id}-${dueDate}`,
  subscriptionId: view.id,
  name: view.name,
  icon: view.icon,
  dueDate: d(dueDate),
  amountMinor,
  currency: view.currency,
  status,
});

export function seedOverview(patch: Partial<SubscriptionsOverview> = {}): SubscriptionsOverview {
  return {
    today: d('2026-10-15'),
    baseCurrency: 'IDR',
    subscriptions: [S_CANVA, ...ACTIVE, S_HEADSPACE],
    counts: { active: 7, paused: 1, cancelled: 1 },
    totals: { monthlyMinor: 904_900n, yearlyMinor: 11_519_700n, approxYearlyMinor: 11_520_000n },
    remainingThisMonth: { totalMinor: 660_900n, count: 4, firstDue: d('2026-10-18'), lastDue: d('2026-10-28') },
    monthSchedule: [
      bill(S_GYM, '2026-10-03', 'paid'),
      bill(S_HOSTING, '2026-10-05', 'paid'),
      bill(S_ICLOUD, '2026-10-09', 'unconfirmed'),
      bill(S_NETFLIX, '2026-10-18', 'will_charge'),
      bill(S_SPOTIFY, '2026-10-20', 'will_charge'),
      bill(S_YOUTUBE, '2026-10-22', 'will_charge'),
      bill(S_CHATGPT, '2026-10-28', 'will_charge'),
    ],
    couldSave: [{ subscriptionId: 'gym', yearlyMinor: 2_388_000n }],
    priceIncreases: [
      { subscriptionId: 'chatgpt', ...(S_CHATGPT.priceIncrease as NonNullable<SubscriptionView['priceIncrease']>) },
    ],
    cancelledSavedMinor: 665_000n,
    byCategory: [
      { categoryId: null, count: 4, monthlyMinor: 573_000n, yearlyMinor: 7_536_900n, shareBps: 6543 },
      { categoryId: FUN, count: 3, monthlyMinor: 331_900n, yearlyMinor: 3_982_800n, shareBps: 3457 },
    ],
    missingRates: [],
    history: [
      { month: '2026-05' as YearMonth, monthlyMinor: 729_000n, added: [], increased: [] },
      { month: '2026-06' as YearMonth, monthlyMinor: 815_900n, added: ['spotify'], increased: [] },
      { month: '2026-07' as YearMonth, monthlyMinor: 815_900n, added: [], increased: [] },
      { month: '2026-08' as YearMonth, monthlyMinor: 815_900n, added: [], increased: [] },
      { month: '2026-09' as YearMonth, monthlyMinor: 904_900n, added: ['youtube'], increased: ['chatgpt'] },
      { month: '2026-10' as YearMonth, monthlyMinor: 904_900n, added: [], increased: [] },
    ],
    ...patch,
  };
}

export function detectedOverview(patch: Partial<DetectedOverview> = {}): DetectedOverview {
  return {
    candidates: [
      {
        id: 'det-vidio',
        merchant: 'Vidio',
        merchantKey: 'vidio',
        dayOfMonth: 12,
        amountMinor: 39_000n,
        currency: 'IDR',
        occurrences: 3,
        lastSeenOn: d('2026-10-12'),
        accountId: 'acc-ovo',
        categoryId: FUN,
      },
      {
        id: 'det-google',
        merchant: 'Google One',
        merchantKey: 'google one',
        dayOfMonth: 5,
        amountMinor: 26_900n,
        currency: 'IDR',
        occurrences: 3,
        lastSeenOn: d('2026-10-05'),
        accountId: null,
        categoryId: null,
      },
    ],
    impact: { totalMinor: 970_800n, addedMinor: 65_900n },
    ...patch,
  };
}
