// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import {
  EMERGENCY_FUND_MONTHS,
  GOAL_KINDS,
  GOAL_STATUSES,
  GOAL_TARGET_MODES,
  InvalidGoalError,
  contributionRule,
  depositPreview,
  dynamicTarget,
  goalSnapshot,
  payFromGoal,
  sinkingFundPlan,
  withdrawPreview,
  type GoalState,
} from './goals.ts';
import { monthsBetween, parseLocalDate, type YearMonth } from './period.ts';
import { nextOccurrences } from './recurrence.ts';

const ym = (value: string) => value as YearMonth;

/** Dana Darurat on 15 Okt 2026 (design 13: qm7zi, q9T3oQ): October's Rp3.500.000 are in, next ones in November. */
const EMERGENCY: GoalState = {
  targetMinor: 54_000_000n,
  savedMinor: 11_125_000n,
  deadline: ym('2027-11'),
  monthlyMinor: 3_500_000n,
  nextMonth: ym('2026-11'),
  monthlySpendingMinor: 18_000_000n,
};

/** Perpanjang STNK (biM3a): Rp680.000 of Rp850.000, Rp43.000 on the 25th, deadline Feb 2027. */
const STNK: GoalState = {
  targetMinor: 850_000n,
  savedMinor: 680_000n,
  deadline: ym('2027-02'),
  monthlyMinor: 43_000n,
  nextMonth: ym('2026-11'),
  monthlySpendingMinor: null,
};

function expectGoalError(run: () => unknown, reason: string): void {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(InvalidGoalError);
    expect(error).toBeInstanceOf(RangeError);
    expect((error as InvalidGoalError).reason).toBe(reason);
    expect((error as InvalidGoalError).name).toBe('InvalidGoalError');
    expect((error as InvalidGoalError).message).toBe(`Invalid goal: ${reason}`);
    return;
  }
  throw new Error('expected an InvalidGoalError');
}

describe('goal enums', () => {
  it('lists kinds, target modes and statuses', () => {
    expect(GOAL_KINDS).toEqual(['savings', 'sinking']);
    expect(GOAL_TARGET_MODES).toEqual(['fixed', 'monthly_expenses']);
    expect(GOAL_STATUSES).toEqual(['active', 'completed', 'used']);
    expect(EMERGENCY_FUND_MONTHS).toBe(3);
  });
});

describe('dynamicTarget (FR-G1 "3× pengeluaran bulanan")', () => {
  it('golden: 3 × Rp18.000.000 = Rp54.000.000', () => {
    expect(dynamicTarget(18_000_000n)).toBe(54_000_000n);
  });

  it('takes another multiple', () => {
    expect(dynamicTarget(18_000_000n, 6)).toBe(108_000_000n);
    expect(dynamicTarget(18_000_000n, 1)).toBe(18_000_000n);
  });

  it.each([0, -1, 1.5])('rejects %s months', (months) => {
    expectGoalError(() => dynamicTarget(1n, months), 'months');
  });
});

describe('sinkingFundPlan (FR-B6, PRD §7.2 monthly contribution)', () => {
  const plan = (targetMinor: bigint, savedMinor: bigint, from: string, deadline: string) =>
    sinkingFundPlan({ targetMinor, savedMinor, from: ym(from), deadline: ym(deadline), stepMinor: 1_000n });

  it('golden: Laptop kerja Rp18.000.000 by Juni 2027 → 8× Rp2.250.000 (Nov 2026 – Jun 2027)', () => {
    expect(plan(18_000_000n, 0n, '2026-11', '2027-06')).toEqual({ count: 8, monthlyMinor: 2_250_000n });
  });

  it('golden: Dana tidak rutin on the 25th = 867.000 + 240.000 + 43.000 = Rp1.150.000', () => {
    const liburan = plan(8_000_000n, 2_800_000n, '2026-10', '2027-03');
    const servis = plan(1_200_000n, 720_000n, '2026-11', '2026-12');
    const stnk = plan(850_000n, 680_000n, '2026-11', '2027-02');
    expect(liburan).toEqual({ count: 6, monthlyMinor: 867_000n });
    expect(servis).toEqual({ count: 2, monthlyMinor: 240_000n });
    expect(stnk).toEqual({ count: 4, monthlyMinor: 43_000n });
    expect(liburan.monthlyMinor + servis.monthlyMinor + stnk.monthlyMinor).toBe(1_150_000n);
  });

  it('rounds up to the step so the deadline is met', () => {
    expect(plan(1_000_001n, 0n, '2026-11', '2026-11')).toEqual({ count: 1, monthlyMinor: 1_001_000n });
    expect(
      sinkingFundPlan({
        targetMinor: 100n,
        savedMinor: 0n,
        from: ym('2026-11'),
        deadline: ym('2027-01'),
        stepMinor: 1n,
      }),
    ).toEqual({
      count: 3,
      monthlyMinor: 34n,
    });
  });

  it('asks for the rest at once when the deadline has passed', () => {
    expect(plan(1_200_000n, 720_000n, '2027-01', '2026-12')).toEqual({ count: 1, monthlyMinor: 480_000n });
  });

  it('needs nothing once the target is reached', () => {
    expect(plan(850_000n, 850_000n, '2026-11', '2027-02')).toEqual({ count: 4, monthlyMinor: 0n });
    expect(plan(850_000n, 900_000n, '2026-11', '2027-02')).toEqual({ count: 4, monthlyMinor: 0n });
  });
});

describe('goalSnapshot (FR-G3)', () => {
  it('golden: Dana Darurat 21%, 0,6 bulan, Nov 2027 on plan', () => {
    expect(goalSnapshot(EMERGENCY)).toEqual({
      savedMinor: 11_125_000n,
      remainingMinor: 42_875_000n,
      progressBps: 2060,
      reached: false,
      estimate: '2027-11',
      onTrack: true,
      coverageBps: 6181,
    });
  });

  it('golden: Perpanjang STNK 80%, kurang Rp170.000, reached in Feb 2027', () => {
    expect(goalSnapshot(STNK)).toEqual({
      savedMinor: 680_000n,
      remainingMinor: 170_000n,
      progressBps: 8000,
      reached: false,
      estimate: '2027-02',
      onTrack: true,
      coverageBps: null,
    });
  });

  it('estimates the month of the contribution that reaches the target', () => {
    expect(goalSnapshot({ ...STNK, monthlyMinor: 170_000n }).estimate).toBe('2026-11');
    expect(goalSnapshot({ ...STNK, monthlyMinor: 169_999n }).estimate).toBe('2026-12');
    expect(goalSnapshot({ ...STNK, monthlyMinor: 85_000n }).estimate).toBe('2026-12');
  });

  it('is behind plan when the estimate is after the deadline', () => {
    expect(goalSnapshot({ ...STNK, monthlyMinor: 42_000n })).toMatchObject({ estimate: '2027-03', onTrack: false });
    expect(goalSnapshot({ ...STNK, deadline: ym('2027-01') })).toMatchObject({ estimate: '2027-02', onTrack: false });
  });

  it('has no plan verdict without a deadline or without contributions', () => {
    expect(goalSnapshot({ ...STNK, deadline: null })).toMatchObject({ estimate: '2027-02', onTrack: null });
    expect(goalSnapshot({ ...STNK, monthlyMinor: 0n })).toMatchObject({ estimate: null, onTrack: null });
    expect(goalSnapshot({ ...STNK, monthlyMinor: -1n })).toMatchObject({ estimate: null, onTrack: null });
  });

  it('is reached at the target and may run past it as a reserve', () => {
    expect(goalSnapshot({ ...STNK, savedMinor: 850_000n })).toEqual({
      savedMinor: 850_000n,
      remainingMinor: 0n,
      progressBps: 10_000,
      reached: true,
      estimate: null,
      onTrack: null,
      coverageBps: null,
    });
    expect(goalSnapshot({ ...STNK, savedMinor: 900_000n })).toMatchObject({
      remainingMinor: 0n,
      progressBps: 10_588,
      reached: true,
    });
  });

  it('has no progress without a target (dynamic target before any spending)', () => {
    expect(goalSnapshot({ ...EMERGENCY, targetMinor: 0n, monthlySpendingMinor: 0n })).toMatchObject({
      progressBps: null,
      reached: true,
      coverageBps: null,
    });
  });
});

describe('depositPreview / withdrawPreview (FR-G3)', () => {
  it('golden PCgK1: deposit Rp1.000.000 → 21% → 22%, Nov 2027 → Okt 2027, 0,6 → 0,7 bulan', () => {
    const preview = depositPreview(EMERGENCY, 1_000_000n);
    expect(preview.before).toEqual(goalSnapshot(EMERGENCY));
    expect(preview.after).toMatchObject({
      savedMinor: 12_125_000n,
      progressBps: 2245,
      estimate: '2027-10',
      coverageBps: 6736,
      onTrack: true,
    });
    expect(preview.reachesTarget).toBe(false);
  });

  it('golden nVb1Q: withdraw Rp2.000.000 → 21% → 17%, 0,6 → 0,5 bulan', () => {
    const preview = withdrawPreview(EMERGENCY, 2_000_000n);
    // The design shows "Nov 2027 → Des 2027"; 44.875.000 / 3.500.000 = 12,8 → 13 contributions from Nov 2026 is still
    // Nov 2027, consistent with the 21% → 22% / Okt 2027 deposit preview.
    expect(preview.after).toMatchObject({
      savedMinor: 9_125_000n,
      progressBps: 1690,
      coverageBps: 5069,
      estimate: '2027-11',
    });
    expect(preview.reachesTarget).toBe(false);
  });

  it('golden biM3a: the last Rp170.000 into Perpanjang STNK reaches the target (80% → 100%)', () => {
    const preview = depositPreview(STNK, 170_000n);
    expect(preview.before.remainingMinor).toBe(170_000n);
    expect(preview.after).toMatchObject({ progressBps: 10_000, reached: true, estimate: null });
    expect(preview.reachesTarget).toBe(true);
    // rbvBr "4 bulan lebih cepat dari rencana Feb 2027".
    expect(monthsBetween(ym('2026-10'), STNK.deadline as YearMonth)).toBe(4);
  });

  it('golden m535GI: moving the Rp38.000 leftover — Servis motor 60% → 63%, Liburan Bali 35% → 35%', () => {
    const servis = { ...STNK, targetMinor: 1_200_000n, savedMinor: 720_000n, monthlyMinor: 240_000n };
    const liburan = { ...STNK, targetMinor: 8_000_000n, savedMinor: 2_800_000n, monthlyMinor: 867_000n };
    expect(depositPreview(servis, 38_000n)).toMatchObject({
      before: { progressBps: 6000 },
      after: { savedMinor: 758_000n, progressBps: 6317 },
    });
    expect(depositPreview(liburan, 38_000n)).toMatchObject({
      before: { progressBps: 3500 },
      after: { savedMinor: 2_838_000n, progressBps: 3548 },
    });
  });

  it('does not report reaching a target that was already reached', () => {
    expect(depositPreview({ ...STNK, savedMinor: 850_000n }, 1n).reachesTarget).toBe(false);
  });

  it('withdraws everything but not more', () => {
    expect(withdrawPreview(STNK, 680_000n).after).toMatchObject({ savedMinor: 0n, progressBps: 0 });
    expectGoalError(() => withdrawPreview(STNK, 680_001n), 'withdraw');
  });

  it.each([0n, -1n])('rejects an amount of %s', (amount) => {
    expectGoalError(() => depositPreview(STNK, amount), 'amount');
    expectGoalError(() => withdrawPreview(STNK, amount), 'amount');
  });
});

describe('payFromGoal (FR-G4 "Bayar dari tujuan")', () => {
  it('golden itVPf: Samsat Rp812.000 from Perpanjang STNK Rp850.000 leaves Rp38.000', () => {
    expect(payFromGoal(850_000n, 812_000n)).toEqual({
      fromGoalMinor: 812_000n,
      fromFreeMinor: 0n,
      leftoverMinor: 38_000n,
    });
  });

  it('uses the whole goal and the free balance for the rest', () => {
    expect(payFromGoal(850_000n, 850_000n)).toEqual({ fromGoalMinor: 850_000n, fromFreeMinor: 0n, leftoverMinor: 0n });
    expect(payFromGoal(850_000n, 900_000n)).toEqual({
      fromGoalMinor: 850_000n,
      fromFreeMinor: 50_000n,
      leftoverMinor: 0n,
    });
  });

  it('pays everything from the free balance when the goal holds nothing', () => {
    expect(payFromGoal(0n, 100n)).toEqual({ fromGoalMinor: 0n, fromFreeMinor: 100n, leftoverMinor: 0n });
    expect(payFromGoal(-50n, 100n)).toEqual({ fromGoalMinor: 0n, fromFreeMinor: 100n, leftoverMinor: 0n });
  });

  it.each([0n, -1n])('rejects an expense of %s', (amount) => {
    expectGoalError(() => payFromGoal(850_000n, amount), 'amount');
  });
});

describe('contributionRule (FR-G1 "Setoran rutin bulanan")', () => {
  it('golden q0jRa: "Tiap tgl 25", Nov 2026 – Jun 2027 → 8× setoran', () => {
    const rule = contributionRule({ day: 25, from: ym('2026-11'), until: ym('2027-06') });
    expect(rule).toEqual({
      freq: 'monthly',
      interval: 1,
      startOn: '2026-11-25',
      weekday: null,
      monthDay: 25,
      end: { type: 'after', count: 8 },
    });
    const dates = nextOccurrences(rule, { from: parseLocalDate('2026-10-15') });
    expect(dates).toHaveLength(8);
    expect(dates[0]).toBe('2026-11-25');
    expect(dates.at(-1)).toBe('2027-06-25');
  });

  it('runs until changed without an end month, and clamps the first date', () => {
    expect(contributionRule({ day: 31, from: ym('2027-02'), until: null })).toMatchObject({
      startOn: '2027-02-28',
      monthDay: 31,
      end: { type: 'never' },
    });
    expect(contributionRule({ day: 1, from: ym('2026-11'), until: ym('2026-11') })).toMatchObject({
      startOn: '2026-11-01',
      end: { type: 'after', count: 1 },
    });
  });

  it.each([0, 32, 1.5])('rejects day %s', (day) => {
    expectGoalError(() => contributionRule({ day, from: ym('2026-11'), until: null }), 'plan');
  });

  it('rejects an end before the start', () => {
    expectGoalError(() => contributionRule({ day: 25, from: ym('2026-11'), until: ym('2026-10') }), 'plan');
  });
});
