// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import type { LocalDate } from './period.ts';
import {
  APPROX_STEP_MINOR,
  CANCEL_MODES,
  DETECTION_AMOUNT_TOLERANCE_PERCENT,
  DETECTION_DAY_TOLERANCE,
  DETECTION_MIN_CHARGES,
  DETECTION_MIN_MONTHS,
  InvalidSubscriptionError,
  PAUSE_REMIND_DAYS,
  SUBSCRIPTION_CYCLES,
  SUBSCRIPTION_STATUSES,
  USAGE_RATINGS,
  approxMinor,
  cancelPlan,
  cancelledSavings,
  couldSave,
  cycleRule,
  detectSubscriptions,
  detectionImpact,
  effectiveStatus,
  merchantKey,
  pausePlan,
  priceIncrease,
  remainingInMonth,
  skippedBills,
  subscriptionTotals,
  trialFirstBill,
  type Bill,
  type DetectionTransaction,
  type PricedSubscription,
  type SubscriptionState,
} from './subscriptions.ts';

const d = (value: string): LocalDate => value as LocalDate;
const TODAY = d('2026-10-15');

/** The seed's active subscriptions (design/digest/07-langganan.md). */
const ACTIVE: readonly (PricedSubscription & { name: string; day: string })[] = [
  { name: 'Netflix', priceMinor: 186_000n, cycle: 'monthly', day: '2026-10-18' },
  { name: 'Spotify', priceMinor: 86_900n, cycle: 'monthly', day: '2026-10-20' },
  { name: 'YouTube Premium', priceMinor: 59_000n, cycle: 'monthly', day: '2026-10-22' },
  { name: 'ChatGPT', priceMinor: 329_000n, cycle: 'monthly', day: '2026-10-28' },
  { name: 'Fit Hub', priceMinor: 199_000n, cycle: 'monthly', day: '2026-10-03' },
  { name: 'iCloud+', priceMinor: 45_000n, cycle: 'monthly', day: '2026-10-09' },
  { name: 'Niagahoster', priceMinor: 660_900n, cycle: 'yearly', day: '2026-10-05' },
];

function errorReason(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(InvalidSubscriptionError);
    expect((error as Error).name).toBe('InvalidSubscriptionError');
    expect((error as Error).message).toBe(`Invalid subscription: ${(error as InvalidSubscriptionError).reason}`);
    return (error as InvalidSubscriptionError).reason;
  }
  throw new Error('expected a throw');
}

describe('constants', () => {
  it('exposes enums and tunables', () => {
    expect(SUBSCRIPTION_CYCLES).toEqual(['weekly', 'monthly', 'yearly']);
    expect(SUBSCRIPTION_STATUSES).toEqual(['active', 'paused', 'cancelled']);
    expect(CANCEL_MODES).toEqual(['after_next_bill', 'now']);
    expect(USAGE_RATINGS).toEqual(['often', 'sometimes', 'rarely']);
    expect(APPROX_STEP_MINOR).toBe(10_000n);
    expect(PAUSE_REMIND_DAYS).toBe(3);
    expect(DETECTION_MIN_CHARGES).toBe(3);
    expect(DETECTION_MIN_MONTHS).toBe(2);
    expect(DETECTION_DAY_TOLERANCE).toBe(3);
    expect(DETECTION_AMOUNT_TOLERANCE_PERCENT).toBe(20n);
  });
});

describe('cycleRule', () => {
  it('builds monthly, weekly and yearly rules from the anchor', () => {
    expect(cycleRule(d('2026-10-18'), 'monthly')).toEqual({
      freq: 'monthly',
      interval: 1,
      startOn: '2026-10-18',
      weekday: null,
      monthDay: 18,
      end: { type: 'never' },
    });
    expect(cycleRule(d('2026-10-05'), 'yearly')).toEqual({
      freq: 'yearly',
      interval: 1,
      startOn: '2026-10-05',
      weekday: null,
      monthDay: null,
      end: { type: 'never' },
    });
    expect(cycleRule(d('2026-11-02'), 'weekly')).toMatchObject({ freq: 'weekly', weekday: 1, monthDay: null });
    expect(cycleRule(d('2026-10-18'), 'weekly').weekday).toBe(7);
    expect(cycleRule(d('2026-10-17'), 'weekly').weekday).toBe(6);
  });
});

describe('subscriptionTotals', () => {
  it('golden: 904.900 / 11.519.700 / ≈ 11.520.000', () => {
    expect(subscriptionTotals(ACTIVE)).toEqual({
      monthlyMinor: 904_900n,
      yearlyMinor: 11_519_700n,
      approxYearlyMinor: 11_520_000n,
    });
  });

  it('spreads weekly prices over months (×52/12, half-up)', () => {
    expect(subscriptionTotals([{ priceMinor: 1n, cycle: 'weekly' }])).toEqual({
      monthlyMinor: 4n,
      yearlyMinor: 52n,
      approxYearlyMinor: 0n,
    });
    expect(subscriptionTotals([{ priceMinor: 2n, cycle: 'weekly' }]).monthlyMinor).toBe(9n);
    expect(
      subscriptionTotals([
        { priceMinor: 1n, cycle: 'weekly' },
        { priceMinor: 1n, cycle: 'weekly' },
        { priceMinor: 100n, cycle: 'monthly' },
      ]),
    ).toEqual({ monthlyMinor: 109n, yearlyMinor: 1_304n, approxYearlyMinor: 0n });
    expect(subscriptionTotals([])).toEqual({ monthlyMinor: 0n, yearlyMinor: 0n, approxYearlyMinor: 0n });
  });
});

describe('approxMinor', () => {
  it('rounds half-up to Rp10.000', () => {
    expect(approxMinor(2_232_000n)).toBe(2_230_000n);
    expect(approxMinor(3_948_000n)).toBe(3_950_000n);
    expect(approxMinor(4_999n)).toBe(0n);
    expect(approxMinor(5_000n)).toBe(10_000n);
    expect(approxMinor(20_000n)).toBe(20_000n);
  });
});

describe('remainingInMonth', () => {
  const bills: Bill[] = [
    { dueDate: d('2026-10-03'), amountMinor: 199_000n, status: 'confirmed' },
    { dueDate: d('2026-10-05'), amountMinor: 660_900n, status: 'confirmed' },
    { dueDate: d('2026-10-09'), amountMinor: 45_000n, status: 'unconfirmed' },
    { dueDate: d('2026-10-28'), amountMinor: 329_000n, status: 'scheduled' },
    { dueDate: d('2026-10-18'), amountMinor: 186_000n, status: 'scheduled' },
    { dueDate: d('2026-10-22'), amountMinor: 59_000n, status: 'scheduled' },
    { dueDate: d('2026-10-20'), amountMinor: 86_900n, status: 'scheduled' },
    { dueDate: d('2026-11-03'), amountMinor: 199_000n, status: 'scheduled' },
  ];

  it('golden: Okt 660.900 · 4 tagihan · 18–28 Okt (9 Okt unconfirmed not counted)', () => {
    expect(remainingInMonth(bills, TODAY)).toEqual({
      totalMinor: 660_900n,
      count: 4,
      firstDue: '2026-10-18',
      lastDue: '2026-10-28',
    });
  });

  it('counts unpaid bills due today, skips paid/skipped ones and other months', () => {
    expect(
      remainingInMonth(
        [
          { dueDate: d('2026-10-15'), amountMinor: 1n, status: 'due_review' },
          { dueDate: d('2026-10-16'), amountMinor: 10n, status: 'unconfirmed' },
          { dueDate: d('2026-10-17'), amountMinor: 100n, status: 'skipped' },
          { dueDate: d('2026-10-18'), amountMinor: 1_000n, status: 'confirmed' },
          { dueDate: d('2025-10-20'), amountMinor: 10_000n, status: 'scheduled' },
        ],
        TODAY,
      ),
    ).toEqual({ totalMinor: 11n, count: 2, firstDue: '2026-10-15', lastDue: '2026-10-16' });
  });

  it('is empty without bills', () => {
    expect(remainingInMonth([], TODAY)).toEqual({ totalMinor: 0n, count: 0, firstDue: null, lastDue: null });
  });
});

describe('skippedBills / cancelledSavings', () => {
  it('golden: paused Headspace since 1 Sep → 2 bills, 140.000', () => {
    expect(skippedBills(70_000n, 'monthly', d('2026-09-01'), TODAY)).toEqual({ count: 2, savedMinor: 140_000n });
  });

  it('counts bills up to and including today', () => {
    expect(skippedBills(70_000n, 'monthly', d('2026-09-15'), TODAY)).toEqual({ count: 2, savedMinor: 140_000n });
    expect(skippedBills(70_000n, 'monthly', d('2026-10-16'), TODAY)).toEqual({ count: 0, savedMinor: 0n });
    expect(skippedBills(10n, 'weekly', d('2026-10-01'), TODAY)).toEqual({ count: 3, savedMinor: 30n });
    expect(skippedBills(10n, 'yearly', d('2024-10-15'), TODAY)).toEqual({ count: 3, savedMinor: 30n });
  });

  it('golden: Canva Pro 665.000 + Apple Music 330.000 + Gojek Plus 200.000 = 1.195.000', () => {
    expect(
      cancelledSavings(
        [
          { priceMinor: 95_000n, cycle: 'monthly', endsOn: d('2026-03-31') },
          { priceMinor: 55_000n, cycle: 'monthly', endsOn: d('2026-04-30') },
          { priceMinor: 25_000n, cycle: 'monthly', endsOn: d('2026-02-28') },
        ],
        TODAY,
      ),
    ).toEqual({
      totalMinor: 1_195_000n,
      items: [
        { count: 7, savedMinor: 665_000n },
        { count: 6, savedMinor: 330_000n },
        { count: 8, savedMinor: 200_000n },
      ],
    });
    expect(cancelledSavings([], TODAY)).toEqual({ totalMinor: 0n, items: [] });
  });

  it('starts counting the day after endsOn', () => {
    expect(cancelledSavings([{ priceMinor: 5n, cycle: 'monthly', endsOn: d('2026-10-14') }], TODAY).items).toEqual([
      { count: 1, savedMinor: 5n },
    ]);
    expect(cancelledSavings([{ priceMinor: 5n, cycle: 'monthly', endsOn: d('2026-10-15') }], TODAY).totalMinor).toBe(
      0n,
    );
  });
});

describe('trialFirstBill', () => {
  it('first bill = start + length; the trial ends the day before', () => {
    expect(trialFirstBill(d('2026-10-20'), { days: 7 })).toEqual({
      trialEndsOn: '2026-10-26',
      firstBillOn: '2026-10-27',
    });
    expect(trialFirstBill(d('2026-10-20'), { days: 14 })).toEqual({
      trialEndsOn: '2026-11-02',
      firstBillOn: '2026-11-03',
    });
    expect(trialFirstBill(d('2026-10-20'), { days: 1 })).toEqual({
      trialEndsOn: '2026-10-20',
      firstBillOn: '2026-10-21',
    });
    expect(trialFirstBill(d('2026-10-20'), { months: 1 })).toEqual({
      trialEndsOn: '2026-11-19',
      firstBillOn: '2026-11-20',
    });
    expect(trialFirstBill(d('2026-12-31'), { months: 2 })).toEqual({
      trialEndsOn: '2027-02-27',
      firstBillOn: '2027-02-28',
    });
    expect(trialFirstBill(d('2027-12-31'), { months: 2 }).firstBillOn).toBe('2028-02-29');
    expect(trialFirstBill(d('2026-01-31'), { months: 1 }).firstBillOn).toBe('2026-02-28');
    expect(trialFirstBill(d('2026-01-15'), { months: 12 }).firstBillOn).toBe('2027-01-15');
    expect(trialFirstBill(d('0099-12-15'), { months: 1 }).firstBillOn).toBe('0100-01-15');
  });

  it('custom end date', () => {
    expect(trialFirstBill(d('2026-10-20'), { until: d('2026-11-05') })).toEqual({
      trialEndsOn: '2026-11-05',
      firstBillOn: '2026-11-06',
    });
    expect(trialFirstBill(d('2026-10-20'), { until: d('2026-10-20') }).firstBillOn).toBe('2026-10-21');
  });

  it('rejects empty or backwards trials', () => {
    expect(errorReason(() => trialFirstBill(d('2026-10-20'), { until: d('2026-10-19') }))).toBe('trial');
    expect(errorReason(() => trialFirstBill(d('2026-10-20'), { days: 0 }))).toBe('trial');
    expect(errorReason(() => trialFirstBill(d('2026-10-20'), { days: 1.5 }))).toBe('trial');
    expect(errorReason(() => trialFirstBill(d('2026-10-20'), { months: 0 }))).toBe('trial');
  });
});

describe('pausePlan', () => {
  it('golden: Netflix 1 month → aktif lagi 18 Nov, −186.000, remind 15 Nov', () => {
    expect(pausePlan(d('2026-10-18'), 'monthly', 186_000n, { months: 1 })).toEqual({
      pausedUntil: '2026-11-18',
      skippedCount: 1,
      savedMinor: 186_000n,
      remindOn: '2026-11-15',
    });
  });

  it('golden: Netflix 2 months → aktif lagi 18 Des, −372.000', () => {
    expect(pausePlan(d('2026-10-18'), 'monthly', 186_000n, { months: 2 }, 1)).toEqual({
      pausedUntil: '2026-12-18',
      skippedCount: 2,
      savedMinor: 372_000n,
      remindOn: '2026-12-17',
    });
  });

  it('custom date, no reminder, weekly cycles', () => {
    expect(pausePlan(d('2026-10-18'), 'monthly', 10n, { until: d('2026-10-19') }, null)).toEqual({
      pausedUntil: '2026-10-19',
      skippedCount: 1,
      savedMinor: 10n,
      remindOn: null,
    });
    expect(pausePlan(d('2026-11-02'), 'weekly', 10n, { until: d('2026-11-16') }).skippedCount).toBe(2);
    expect(pausePlan(d('2026-11-02'), 'weekly', 10n, { until: d('2026-11-17') }).skippedCount).toBe(3);
  });

  it('rejects resume dates on or before the next bill', () => {
    expect(errorReason(() => pausePlan(d('2026-10-18'), 'monthly', 10n, { until: d('2026-10-18') }))).toBe('pause');
    expect(errorReason(() => pausePlan(d('2026-10-18'), 'monthly', 10n, { until: d('2026-10-01') }))).toBe('pause');
  });
});

describe('cancelPlan', () => {
  it('after the next bill keeps it; now ends today and drops it', () => {
    expect(cancelPlan(d('2026-10-22'), 'after_next_bill', TODAY)).toEqual({
      endsOn: '2026-10-22',
      keepsNextBill: true,
    });
    expect(cancelPlan(d('2026-10-22'), 'now', TODAY)).toEqual({ endsOn: '2026-10-15', keepsNextBill: false });
  });
});

describe('effectiveStatus', () => {
  const base: SubscriptionState = { status: 'active', pausedUntil: null, endsOn: null, cancelMode: null };

  it('uses the stored status without dates', () => {
    expect(effectiveStatus(base, TODAY)).toBe('active');
    expect(effectiveStatus({ ...base, status: 'paused' }, TODAY)).toBe('paused');
    expect(effectiveStatus({ ...base, status: 'cancelled' }, TODAY)).toBe('cancelled');
  });

  it('is paused while pausedUntil > today', () => {
    expect(effectiveStatus({ ...base, status: 'paused', pausedUntil: d('2026-10-16') }, TODAY)).toBe('paused');
    expect(effectiveStatus({ ...base, status: 'paused', pausedUntil: d('2026-10-15') }, TODAY)).toBe('active');
    expect(effectiveStatus({ ...base, pausedUntil: d('2026-12-01') }, TODAY)).toBe('paused');
  });

  it('is cancelled after endsOn (from endsOn when cancelled now)', () => {
    const after = { ...base, status: 'cancelled', cancelMode: 'after_next_bill' } as const;
    expect(effectiveStatus({ ...after, endsOn: d('2026-10-15') }, TODAY)).toBe('active');
    expect(effectiveStatus({ ...after, endsOn: d('2026-10-14') }, TODAY)).toBe('cancelled');
    expect(effectiveStatus({ ...after, endsOn: d('2026-10-16'), pausedUntil: d('2026-11-01') }, TODAY)).toBe('paused');
    const now = { ...base, status: 'cancelled', cancelMode: 'now' } as const;
    expect(effectiveStatus({ ...now, endsOn: d('2026-10-15') }, TODAY)).toBe('cancelled');
    expect(effectiveStatus({ ...now, endsOn: d('2026-10-16') }, TODAY)).toBe('active');
    expect(effectiveStatus({ ...now, endsOn: d('2026-10-14'), pausedUntil: d('2026-11-01') }, TODAY)).toBe('cancelled');
  });
});

describe('priceIncrease', () => {
  it('golden: ChatGPT 299.000 → 329.000 = +30.000, 1003 bps', () => {
    expect(
      priceIncrease([
        { date: d('2026-09-28'), amountMinor: 329_000n },
        { date: d('2026-07-28'), amountMinor: 299_000n },
        { date: d('2026-08-28'), amountMinor: 299_000n },
      ]),
    ).toEqual({
      previousMinor: 299_000n,
      currentMinor: 329_000n,
      increaseMinor: 30_000n,
      increaseBps: 1003,
      since: '2026-09-28',
    });
  });

  it('rounds basis points half-up', () => {
    expect(
      priceIncrease([
        { date: d('2026-01-01'), amountMinor: 20_000n },
        { date: d('2026-02-01'), amountMinor: 20_001n },
      ])?.increaseBps,
    ).toBe(1);
    expect(
      priceIncrease([
        { date: d('2026-01-01'), amountMinor: 30_000n },
        { date: d('2026-02-01'), amountMinor: 30_001n },
      ])?.increaseBps,
    ).toBe(0);
  });

  it('is null without an increase or history', () => {
    expect(priceIncrease([])).toBeNull();
    expect(priceIncrease([{ date: d('2026-01-01'), amountMinor: 1n }])).toBeNull();
    const flat = [
      { date: d('2026-02-01'), amountMinor: 5n },
      { date: d('2026-01-01'), amountMinor: 5n },
    ];
    expect(priceIncrease(flat)).toBeNull();
    expect(
      priceIncrease([
        { date: d('2026-02-01'), amountMinor: 4n },
        { date: d('2026-01-01'), amountMinor: 5n },
      ]),
    ).toBeNull();
    expect(
      priceIncrease([
        { date: d('2026-01-01'), amountMinor: 6n },
        { date: d('2026-01-01'), amountMinor: 5n },
      ]),
    ).toBeNull();
  });
});

describe('couldSave', () => {
  it('golden: YouTube rated rarely → 708.000/yr', () => {
    const youtube = { id: 'yt', priceMinor: 59_000n, cycle: 'monthly', usageRating: 'rarely' } as const;
    const suggestions = couldSave([
      youtube,
      { id: 'nf', priceMinor: 186_000n, cycle: 'monthly', usageRating: 'often' },
      { id: 'sp', priceMinor: 86_900n, cycle: 'monthly', usageRating: null },
      { id: 'hs', priceMinor: 660_900n, cycle: 'yearly', usageRating: 'rarely' },
      { id: 'wk', priceMinor: 10n, cycle: 'weekly', usageRating: 'rarely' },
      { id: 'so', priceMinor: 1n, cycle: 'monthly', usageRating: 'sometimes' },
    ]);
    expect(suggestions[0]?.subscription).toBe(youtube);
    expect(suggestions.map((s) => [s.subscription.id, s.yearlyMinor])).toEqual([
      ['yt', 708_000n],
      ['hs', 660_900n],
      ['wk', 520n],
    ]);
  });
});

describe('merchantKey', () => {
  it('normalizes case, accents, punctuation and spaces', () => {
    expect(merchantKey('  Google*One  ')).toBe('google one');
    expect(merchantKey('Café   Société!!')).toBe('cafe societe');
    expect(merchantKey('VIDIO.COM')).toBe('vidio com');
    expect(merchantKey('ＮＥＴＦＬＩＸ')).toBe('netflix');
    expect(merchantKey('Spotify-2')).toBe('spotify 2');
    expect(merchantKey('!!!')).toBe('');
  });
});

describe('detectSubscriptions', () => {
  const tx = (
    merchant: string,
    localDate: string,
    amountMinor: bigint,
    extra: Partial<DetectionTransaction> = {},
  ): DetectionTransaction => ({
    merchant,
    localDate: d(localDate),
    amountMinor,
    currency: 'IDR',
    accountId: 'acc-gopay',
    categoryId: 'cat-hiburan',
    ...extra,
  });
  const bca = { accountId: 'acc-bca', categoryId: 'cat-penyimpanan' };
  const golden: DetectionTransaction[] = [
    tx('Makan siang', '2026-07-20', 50_000n),
    tx('Google One', '2026-08-05', 26_900n, bca),
    tx('Vidio', '2026-08-12', 39_000n),
    tx('Netflix', '2026-08-18', 186_000n),
    tx('Google One', '2026-09-05', 26_900n, bca),
    tx('Vidio', '2026-09-13', 39_000n, { accountId: 'acc-old' }),
    tx('Netflix', '2026-09-18', 186_000n),
    tx('Google One', '2026-10-05', 26_900n, bca),
    tx('VIDIO', '2026-10-12', 39_000n),
    tx('Netflix', '2026-10-18', 186_000n),
  ];
  const known = new Set(['netflix']);

  it('golden: Vidio ±12 and Google One 5, newest first', () => {
    expect(detectSubscriptions(golden, { today: TODAY, known })).toEqual([
      {
        merchantKey: 'vidio',
        merchant: 'VIDIO',
        dayOfMonth: 12,
        amountMinor: 39_000n,
        currency: 'IDR',
        occurrences: 3,
        lastSeenOn: '2026-10-12',
        accountId: 'acc-gopay',
        categoryId: 'cat-hiburan',
      },
      {
        merchantKey: 'google one',
        merchant: 'Google One',
        dayOfMonth: 5,
        amountMinor: 26_900n,
        currency: 'IDR',
        occurrences: 3,
        lastSeenOn: '2026-10-05',
        accountId: 'acc-bca',
        categoryId: 'cat-penyimpanan',
      },
    ]);
    expect(detectSubscriptions(golden, { today: TODAY, known: new Set() }).map((c) => c.merchantKey)).toEqual([
      'netflix',
      'vidio',
      'google one',
    ]);
  });

  it('needs two months of data', () => {
    expect(detectSubscriptions([], { today: TODAY, known })).toEqual([]);
    // The earliest charge (15 Aug) must be at least two months before today.
    const span = [tx('S', '2026-08-15', 10n), tx('S', '2026-09-15', 10n), tx('S', '2026-10-15', 10n)];
    expect(detectSubscriptions(span, { today: TODAY, known })).toHaveLength(1);
    expect(detectSubscriptions(span, { today: d('2026-10-14'), known })).toEqual([]);
    expect(detectSubscriptions(span, { today: d('2026-12-31'), known })).toHaveLength(1);
    expect(detectSubscriptions(span, { today: d('2026-10-31'), known })).toHaveLength(1);
  });

  it('requires three charges in distinct months', () => {
    const sameMonth = [
      tx('S', '2026-07-01', 10n),
      tx('S', '2026-09-10', 10n),
      tx('S', '2026-10-09', 10n),
      tx('S', '2026-10-10', 10n),
    ];
    expect(detectSubscriptions(sameMonth, { today: TODAY, known })).toEqual([]);
    expect(
      detectSubscriptions([...sameMonth, tx('S', '2026-08-11', 10n)], { today: TODAY, known })[0]?.occurrences,
    ).toBe(3);
  });

  it('matches days within ±3 and amounts within ±20% of the latest charge, same currency', () => {
    const run = (charges: DetectionTransaction[]) =>
      detectSubscriptions([tx('pad', '2026-01-01', 1n), ...charges], { today: TODAY, known }).length;
    const latest = tx('S', '2026-10-10', 100n);
    expect(run([tx('S', '2026-08-07', 100n), tx('S', '2026-09-13', 100n), latest])).toBe(1);
    expect(run([tx('S', '2026-08-06', 100n), tx('S', '2026-09-13', 100n), latest])).toBe(0);
    expect(run([tx('S', '2026-08-10', 100n), tx('S', '2026-09-14', 100n), latest])).toBe(0);
    expect(run([tx('S', '2026-08-10', 80n), tx('S', '2026-09-10', 120n), latest])).toBe(1);
    expect(run([tx('S', '2026-08-10', 79n), tx('S', '2026-09-10', 100n), latest])).toBe(0);
    expect(run([tx('S', '2026-08-10', 100n), tx('S', '2026-09-10', 121n), latest])).toBe(0);
    expect(run([tx('S', '2026-08-10', 100n, { currency: 'USD' }), tx('S', '2026-09-10', 100n), latest])).toBe(0);
  });

  it('ignores refunds, unnamed merchants and known subscriptions', () => {
    const series = (merchant: string, amount: bigint) => [
      tx(merchant, '2026-07-10', amount),
      tx(merchant, '2026-08-10', amount),
      tx(merchant, '2026-09-10', amount),
    ];
    expect(detectSubscriptions([...series('S', 0n)], { today: TODAY, known })).toEqual([]);
    expect(detectSubscriptions([...series('S', -5n)], { today: TODAY, known })).toEqual([]);
    expect(detectSubscriptions([...series('***', 5n)], { today: TODAY, known })).toEqual([]);
    expect(detectSubscriptions([...series('Netflix!', 5n)], { today: TODAY, known })).toEqual([]);
    expect(detectSubscriptions([...series('S', 5n), tx('S', '2026-06-01', -5n)], { today: TODAY, known })).toEqual([
      expect.objectContaining({ merchantKey: 's', lastSeenOn: '2026-09-10', categoryId: 'cat-hiburan' }),
    ]);
  });
});

describe('detectionImpact', () => {
  it('golden: 904.900 + Vidio + Google One = 970.800 (+65.900)', () => {
    expect(detectionImpact(904_900n, [{ amountMinor: 39_000n }, { amountMinor: 26_900n }])).toEqual({
      totalMinor: 970_800n,
      addedMinor: 65_900n,
    });
    expect(detectionImpact(5n, [])).toEqual({ totalMinor: 5n, addedMinor: 0n });
  });
});
