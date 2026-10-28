// SPDX-License-Identifier: AGPL-3.0-only
import type { LocalDate } from '@wf/domain/period';
import { describe, expect, it } from 'vitest';
import { subscription } from '../../../test/dashboard-fixtures.ts';
import { ACCOUNTS, BCA, CARD, JAGO, OVO } from '../../../test/ledger-fixtures.ts';
import {
  S_CANVA,
  S_GYM,
  S_HEADSPACE,
  S_ICLOUD,
  S_NETFLIX,
  S_SPOTIFY,
  S_YOUTUBE,
  seedOverview,
} from '../../../test/subscription-fixtures.ts';
import {
  avatarColor,
  balanceCheck,
  billClusters,
  CLUSTER_DAYS,
  daysFrom,
  dueTomorrow,
  headerSummary,
  monthsBetween,
  needsRating,
  overdueBills,
  overlaps,
  savedSoFar,
  upcomingBills,
  usageReview,
} from './subscriptions-model.ts';

const d = (value: string) => value as LocalDate;
const TODAY = d('2026-10-15');

describe('subscriptions model', () => {
  it('counts days to and from today', () => {
    expect(daysFrom(TODAY, TODAY)).toBe(0);
    expect(daysFrom(TODAY, d('2026-10-18'))).toBe(3);
    expect(daysFrom(TODAY, d('2026-10-09'))).toBe(-6);
    expect(monthsBetween(d('2026-03-31'), TODAY)).toBe(6);
    expect(monthsBetween(d('2026-03-15'), TODAY)).toBe(7);
    expect(monthsBetween(d('2025-12-01'), TODAY)).toBe(10);
  });

  it('stacks bills at most three days after the previous one, oldest first', () => {
    const bill = (id: string, day: string) => ({ id, dueDate: d(`2026-10-${day}`) });
    const ids = (clusters: readonly (readonly { readonly id: string }[])[]) =>
      clusters.map((cluster) => cluster.map(({ id }) => id));
    expect(CLUSTER_DAYS).toBe(3);
    expect(billClusters([])).toEqual([]);
    // October's seed, out of order: 3 · 5 stack, 9 alone (4 days on), 18 · 20 · 22 chain, 28 alone; same-day bills
    // keep their order.
    expect(
      ids(
        billClusters([
          bill('chatgpt', '28'),
          bill('netflix', '18'),
          bill('gym', '03'),
          bill('icloud', '09'),
          bill('spotify', '20'),
          bill('host', '05'),
          bill('youtube', '22'),
          bill('also-22', '22'),
        ]),
      ),
    ).toEqual([['gym', 'host'], ['icloud'], ['netflix', 'spotify', 'youtube', 'also-22'], ['chatgpt']]);
  });

  it('gives each subscription a stable palette colour', () => {
    expect(avatarColor('netflix')).toBe(avatarColor('netflix'));
    expect(new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map(avatarColor)).size).toBeGreaterThan(1);
  });

  it('summarizes the header: active count, bills left, the next bill', () => {
    expect(headerSummary(seedOverview())).toEqual({ active: 7, remaining: 4, next: { name: 'Netflix', days: 3 } });
    const none = seedOverview({ subscriptions: [S_CANVA, S_ICLOUD, subscription({ id: 'x', name: 'X' })] });
    expect(headerSummary(none).next).toBeNull();
    const tie = seedOverview({ subscriptions: [S_SPOTIFY, S_NETFLIX] });
    expect(headerSummary(tie).next?.name).toBe('Netflix');
  });

  it('lists the bills still to be charged this month', () => {
    expect(upcomingBills(seedOverview()).map((bill) => bill.name)).toEqual([
      'Netflix',
      'Spotify',
      'YouTube Premium',
      'ChatGPT',
    ]);
  });

  it('finds tomorrow’s bills and overdue unconfirmed ones', () => {
    const tomorrow = seedOverview({ today: d('2026-10-17') });
    expect(dueTomorrow(tomorrow).map((view) => view.name)).toEqual(['Netflix']);
    expect(dueTomorrow(seedOverview())).toEqual([]);
    const reviewing = subscription({
      id: 'r',
      name: 'R',
      nextBill: { occurrenceId: 'o', dueDate: d('2026-10-01'), status: 'due_review' },
    });
    const unstored = subscription({
      id: 'u',
      name: 'U',
      nextBill: { occurrenceId: null, dueDate: d('2026-10-01'), status: 'unconfirmed' },
    });
    const today = subscription({
      id: 't',
      name: 'T',
      nextBill: { occurrenceId: 'o2', dueDate: TODAY, status: 'due_review' },
    });
    const scheduled = subscription({
      id: 's',
      name: 'S',
      nextBill: { occurrenceId: 'o3', dueDate: d('2026-10-01'), status: 'scheduled' },
    });
    const overview = seedOverview({ subscriptions: [S_ICLOUD, reviewing, unstored, today, scheduled, S_CANVA] });
    expect(overdueBills(overview).map((due) => [due.subscription.id, due.occurrenceId, due.dueDate])).toEqual([
      ['icloud', 'occ-icloud-2026-10-09', '2026-10-09'],
      ['r', 'o', '2026-10-01'],
    ]);
  });

  it('checks each paying account against this month’s bills it pays', () => {
    const { short, covered } = balanceCheck(seedOverview(), ACCOUNTS);
    expect(covered.map((account) => account.id)).toEqual([BCA.id, JAGO.id]);
    expect(short).toEqual([
      {
        account: OVO,
        first: { subscription: S_SPOTIFY, bill: expect.objectContaining({ name: 'Spotify' }) as unknown },
        bills: [{ subscription: S_SPOTIFY, bill: expect.objectContaining({ name: 'Spotify' }) as unknown }],
        totalMinor: 86_900n,
        shortMinor: 900n,
      },
    ]);
    // Unknown and credit-card accounts, other currencies, and bills without their subscription are not judged.
    const elsewhere = seedOverview({
      subscriptions: [
        { ...S_NETFLIX, payFromAccountId: CARD.id },
        { ...S_SPOTIFY, payFromAccountId: 'gone' },
        { ...S_YOUTUBE, currency: 'USD' },
      ],
      monthSchedule: seedOverview().monthSchedule.map((bill) =>
        bill.subscriptionId === 'youtube' ? { ...bill, currency: 'USD' } : bill,
      ),
    });
    expect(balanceCheck(elsewhere, ACCOUNTS)).toEqual({ short: [], covered: [] });
  });

  it('asks for a usage rating until rated, and again once due', () => {
    expect(needsRating(S_YOUTUBE, TODAY)).toBe(true);
    expect(needsRating(S_NETFLIX, TODAY)).toBe(false);
    expect(needsRating(S_NETFLIX, d('2026-11-01'))).toBe(true);
    expect(needsRating({ ...S_NETFLIX, nextReviewOn: null }, d('2027-01-01'))).toBe(false);
    expect(usageReview(seedOverview())).toEqual({ rated: 6, total: 7, next: S_YOUTUBE });
    expect(usageReview(seedOverview({ subscriptions: [S_NETFLIX, S_HEADSPACE] })).next).toBeNull();
  });

  it('groups active subscriptions with the same function', () => {
    expect(overlaps(seedOverview())).toEqual([{ icon: 'music', names: ['Spotify', 'YouTube Premium'] }]);
    expect(overlaps(seedOverview({ subscriptions: [S_SPOTIFY, { ...S_YOUTUBE, effectiveStatus: 'paused' }] }))).toEqual(
      [],
    );
  });

  it('adds up what paused and cancelled subscriptions saved so far', () => {
    expect(savedSoFar(S_HEADSPACE, TODAY)).toEqual({ count: 2, savedMinor: 140_000n });
    expect(savedSoFar(S_CANVA, TODAY)).toEqual({ count: 7, savedMinor: 665_000n });
    expect(savedSoFar({ ...S_HEADSPACE, pausedOn: d('2026-11-01') }, TODAY)).toEqual({ count: 0, savedMinor: 0n });
    expect(savedSoFar({ ...S_HEADSPACE, pausedOn: null }, TODAY).savedMinor).toBe(0n);
    expect(savedSoFar({ ...S_CANVA, endsOn: null }, TODAY).savedMinor).toBe(0n);
    expect(savedSoFar(S_GYM, TODAY).savedMinor).toBe(0n);
  });
});
