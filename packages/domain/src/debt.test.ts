// SPDX-License-Identifier: AGPL-3.0-only
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  CC_PAYMENT_BUCKETS,
  DEBT_KINDS,
  DEFAULT_CC_PAYMENT_PRIORITY,
  DEFAULT_INTEREST_METHOD,
  HEALTHY_DEBT_RATIO_BPS,
  INTEREST_METHODS,
  InvalidDebtError,
  MAX_TENOR,
  RECALC_MODES,
  allocateCardPayment,
  debtImpact,
  debtSummary,
  installmentSchedule,
  monthlyInstallment,
  recalculateAfterPayoff,
  scheduleTotals,
  type Installment,
  type InterestMethod,
  type ScheduleInput,
} from './debt.ts';
import { addMonths, parseLocalDate } from './period.ts';

const d = parseLocalDate;

const ZERO: ScheduleInput = {
  principalMinor: 1_000_000n,
  tenor: 3,
  monthlyRateBps: 0,
  adminFeeMinor: 0n,
  method: 'flat',
  firstDue: d('2026-11-20'),
};

/** Annuity reference: Rp100.000.000 over 12 months at 1% per month → Rp8.884.879 per month. */
const MORTGAGE: ScheduleInput = {
  principalMinor: 100_000_000n,
  tenor: 12,
  monthlyRateBps: 100,
  adminFeeMinor: 0n,
  method: 'annuity',
  firstDue: d('2026-11-25'),
};

const brief = (rows: readonly Installment[]) =>
  rows.map((row) => [row.number, row.dueOn, row.principalMinor, row.interestMinor, row.feeMinor, row.totalMinor]);

function expectDebtError(run: () => unknown, reason: string): void {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(InvalidDebtError);
    expect(error).toBeInstanceOf(RangeError);
    expect((error as InvalidDebtError).reason).toBe(reason);
    expect((error as InvalidDebtError).name).toBe('InvalidDebtError');
    expect((error as InvalidDebtError).message).toBe(`Invalid debt: ${reason}`);
    return;
  }
  throw new Error('expected an InvalidDebtError');
}

describe('debt enums', () => {
  it('lists kinds, methods, modes, buckets and limits', () => {
    expect(DEBT_KINDS).toEqual(['card_installment', 'paylater', 'zero_percent', 'mortgage', 'personal_loan']);
    expect(INTEREST_METHODS).toEqual(['flat', 'annuity']);
    expect(DEFAULT_INTEREST_METHOD).toEqual({
      card_installment: 'flat',
      paylater: 'flat',
      zero_percent: 'flat',
      mortgage: 'annuity',
      personal_loan: 'annuity',
    });
    expect(RECALC_MODES).toEqual(['reduce_amount', 'shorten_tenor']);
    expect(CC_PAYMENT_BUCKETS).toEqual(['installments', 'spending']);
    expect(DEFAULT_CC_PAYMENT_PRIORITY).toEqual(['installments', 'spending']);
    expect(HEALTHY_DEBT_RATIO_BPS).toBe(3000);
    expect(MAX_TENOR).toBe(600);
  });
});

describe('installmentSchedule (FR-U2, FR-U3, D12)', () => {
  it('golden FR-U3: 0% Rp1.000.000 / 3 = 333.334 + 333.333 + 333.333, monthly on the statement day', () => {
    const schedule = installmentSchedule(ZERO);
    expect(brief(schedule)).toEqual([
      [1, '2026-11-20', 333_334n, 0n, 0n, 333_334n],
      [2, '2026-12-20', 333_333n, 0n, 0n, 333_333n],
      [3, '2027-01-20', 333_333n, 0n, 0n, 333_333n],
    ]);
    expect(schedule.map((row) => row.balanceAfterMinor)).toEqual([666_666n, 333_333n, 0n]);
  });

  it('golden v3Igd: MacBook Air M4 Rp18.999.000 in 12× 0% → Rp1.583.250, 25 Nov 2026 – 25 Okt 2027', () => {
    const schedule = installmentSchedule({
      ...ZERO,
      principalMinor: 18_999_000n,
      tenor: 12,
      firstDue: d('2026-11-25'),
    });
    expect(schedule).toHaveLength(12);
    expect(new Set(schedule.map((row) => row.totalMinor))).toEqual(new Set([1_583_250n]));
    expect(schedule[0]?.dueOn).toBe('2026-11-25');
    expect(schedule.at(-1)?.dueOn).toBe('2027-10-25');
  });

  it('flat interest: rate × principal every month, the admin fee with the first installment', () => {
    const schedule = installmentSchedule({
      ...ZERO,
      principalMinor: 3_000_000n,
      tenor: 6,
      monthlyRateBps: 175,
      adminFeeMinor: 50_000n,
    });
    expect(brief(schedule.slice(0, 2))).toEqual([
      [1, '2026-11-20', 500_000n, 52_500n, 50_000n, 602_500n],
      [2, '2026-12-20', 500_000n, 52_500n, 0n, 552_500n],
    ]);
    expect(scheduleTotals(schedule)).toEqual({
      principalMinor: 3_000_000n,
      interestMinor: 315_000n,
      feeMinor: 50_000n,
      totalMinor: 3_365_000n,
    });
  });

  it('rounds the flat interest half up', () => {
    expect(installmentSchedule({ ...ZERO, principalMinor: 150n, monthlyRateBps: 100 })[0]?.interestMinor).toBe(2n);
    expect(installmentSchedule({ ...ZERO, principalMinor: 149n, monthlyRateBps: 100 })[0]?.interestMinor).toBe(1n);
  });

  it('golden annuity (D12): Rp100.000.000, 12 × 1% → Rp8.884.879, the last one clears the rounding', () => {
    const schedule = installmentSchedule({ ...MORTGAGE, adminFeeMinor: 500_000n });
    expect(brief(schedule.slice(0, 2))).toEqual([
      [1, '2026-11-25', 7_884_879n, 1_000_000n, 500_000n, 9_384_879n],
      [2, '2026-12-25', 7_963_728n, 921_151n, 0n, 8_884_879n],
    ]);
    expect(brief(schedule.slice(-1))).toEqual([[12, '2027-10-25', 8_796_907n, 87_969n, 0n, 8_884_876n]]);
    expect(schedule[1]?.balanceAfterMinor).toBe(84_151_393n);
    expect(scheduleTotals(schedule)).toEqual({
      principalMinor: 100_000_000n,
      interestMinor: 6_618_545n,
      feeMinor: 500_000n,
      totalMinor: 107_118_545n,
    });
  });

  it('keeps every due date of an annuity whose rounded payment clears it early', () => {
    const rows = installmentSchedule({ ...MORTGAGE, principalMinor: 2n, tenor: 3, monthlyRateBps: 1 });
    expect(rows.map((row) => [row.principalMinor, row.interestMinor, row.balanceAfterMinor])).toEqual([
      [1n, 0n, 1n],
      [1n, 0n, 0n],
      [0n, 0n, 0n],
    ]);
  });

  it('an annuity at 0% is an equal split', () => {
    expect(brief(installmentSchedule({ ...ZERO, method: 'annuity' }))).toEqual(brief(installmentSchedule(ZERO)));
  });

  it('keeps month ends on short months', () => {
    const dues = installmentSchedule({ ...ZERO, firstDue: d('2027-01-31') }).map((row) => row.dueOn);
    expect(dues).toEqual(['2027-01-31', '2027-02-28', '2027-03-31']);
  });

  it('accepts a single installment and the longest tenor', () => {
    expect(brief(installmentSchedule({ ...ZERO, tenor: 1 }))).toEqual([
      [1, '2026-11-20', 1_000_000n, 0n, 0n, 1_000_000n],
    ]);
    expect(installmentSchedule({ ...ZERO, tenor: MAX_TENOR })).toHaveLength(MAX_TENOR);
  });

  it.each([0n, -1n])('rejects a principal of %s', (principalMinor) => {
    expectDebtError(() => installmentSchedule({ ...ZERO, principalMinor }), 'principal');
  });

  it.each([0, -3, 2.5, MAX_TENOR + 1])('rejects a tenor of %s', (tenor) => {
    expectDebtError(() => installmentSchedule({ ...ZERO, tenor }), 'tenor');
  });

  it.each([-1, 1.5])('rejects a rate of %s', (monthlyRateBps) => {
    expectDebtError(() => installmentSchedule({ ...ZERO, monthlyRateBps }), 'rate');
  });

  it('rejects an unknown interest method', () => {
    expectDebtError(() => installmentSchedule({ ...ZERO, method: 'simple' as InterestMethod }), 'rate');
  });

  it('rejects a negative admin fee', () => {
    expectDebtError(() => installmentSchedule({ ...ZERO, adminFeeMinor: -1n }), 'fee');
  });

  const terms = fc.record({
    principalMinor: fc.bigInt({ min: 1n, max: 10n ** 13n }),
    tenor: fc.integer({ min: 1, max: 120 }),
    monthlyRateBps: fc.integer({ min: 0, max: 500 }),
    adminFeeMinor: fc.bigInt({ min: 0n, max: 10n ** 7n }),
  });

  it('property (flat): Σ installments = principal + interest + fees, the remainder in the first', () => {
    fc.assert(
      fc.property(terms, ({ principalMinor, tenor, monthlyRateBps, adminFeeMinor }) => {
        const schedule = installmentSchedule({ ...ZERO, principalMinor, tenor, monthlyRateBps, adminFeeMinor });
        const monthlyInterest = (principalMinor * BigInt(monthlyRateBps) * 2n + 10_000n) / 20_000n;
        expect(schedule).toHaveLength(tenor);
        expect(scheduleTotals(schedule)).toEqual({
          principalMinor,
          interestMinor: monthlyInterest * BigInt(tenor),
          feeMinor: adminFeeMinor,
          totalMinor: principalMinor + monthlyInterest * BigInt(tenor) + adminFeeMinor,
        });
        const [first, ...rest] = schedule as [Installment, ...Installment[]];
        for (const row of rest) {
          expect(row.principalMinor).toBe(principalMinor / BigInt(tenor));
          expect(row.feeMinor).toBe(0n);
        }
        expect(first.principalMinor - principalMinor / BigInt(tenor)).toBeLessThan(BigInt(tenor));
        expect(schedule.at(-1)?.balanceAfterMinor).toBe(0n);
        schedule.forEach((row, index) => {
          expect(row.number).toBe(index + 1);
          expect(row.dueOn).toBe(addMonths(ZERO.firstDue, index));
        });
      }),
    );
  });

  it('property (annuity): principal fully repaid, equal payments until it is cleared, never negative', () => {
    fc.assert(
      fc.property(terms, ({ principalMinor, tenor, monthlyRateBps, adminFeeMinor }) => {
        const schedule = installmentSchedule({ ...MORTGAGE, principalMinor, tenor, monthlyRateBps, adminFeeMinor });
        const totals = scheduleTotals(schedule);
        expect(schedule).toHaveLength(tenor);
        expect(totals.principalMinor).toBe(principalMinor);
        expect(totals.feeMinor).toBe(adminFeeMinor);
        expect(totals.totalMinor).toBe(principalMinor + totals.interestMinor + adminFeeMinor);
        let balance = principalMinor;
        for (const row of schedule) {
          expect(row.principalMinor).toBeGreaterThanOrEqual(0n);
          balance -= row.principalMinor;
          expect(row.balanceAfterMinor).toBe(balance);
        }
        expect(balance).toBe(0n);
        if (monthlyRateBps > 0) {
          // Every installment before the one clearing the balance pays the same annuity.
          const regular = schedule
            .filter((row) => row.balanceAfterMinor > 0n)
            .map((row) => row.principalMinor + row.interestMinor);
          expect(new Set(regular).size).toBeLessThanOrEqual(1);
        }
      }),
    );
  });
});

describe('monthlyInstallment', () => {
  it('is the largest principal + interest, without the one-off fee', () => {
    expect(monthlyInstallment(installmentSchedule(ZERO))).toBe(333_334n);
    expect(monthlyInstallment(installmentSchedule({ ...MORTGAGE, adminFeeMinor: 500_000n }))).toBe(8_884_879n);
    expect(monthlyInstallment([])).toBe(0n);
  });
});

describe('recalculateAfterPayoff (FR-U4)', () => {
  const kulkas = installmentSchedule({ ...ZERO, principalMinor: 3_000_000n });

  it('golden A7ttc "Kurangi nominal": Rp2.000.000 paid off of 3× Rp1.000.000 → 333.334 / 333.333 / 333.333', () => {
    const rows = recalculateAfterPayoff({
      remaining: kulkas,
      paidMinor: 2_000_000n,
      mode: 'reduce_amount',
      monthlyRateBps: 0,
      method: 'flat',
    });
    expect(brief(rows)).toEqual([
      [1, '2026-11-20', 333_334n, 0n, 0n, 333_334n],
      [2, '2026-12-20', 333_333n, 0n, 0n, 333_333n],
      [3, '2027-01-20', 333_333n, 0n, 0n, 333_333n],
    ]);
  });

  it('golden qrRRV "Persingkat tenor": 1× Rp1.000.000, paid off 20 Nov', () => {
    const rows = recalculateAfterPayoff({
      remaining: kulkas,
      paidMinor: 2_000_000n,
      mode: 'shorten_tenor',
      monthlyRateBps: 0,
      method: 'flat',
    });
    expect(brief(rows)).toEqual([[1, '2026-11-20', 1_000_000n, 0n, 0n, 1_000_000n]]);
    expect(rows[0]?.balanceAfterMinor).toBe(0n);
  });

  it('shortens keeping the regular principal, the last one smaller, numbering from the first remaining', () => {
    const schedule = installmentSchedule({ ...ZERO, principalMinor: 6_000_000n, tenor: 6, monthlyRateBps: 100 });
    const rows = recalculateAfterPayoff({
      remaining: schedule.slice(1),
      paidMinor: 2_500_000n,
      mode: 'shorten_tenor',
      monthlyRateBps: 100,
      method: 'flat',
    });
    expect(brief(rows)).toEqual([
      [2, '2026-12-20', 1_000_000n, 25_000n, 0n, 1_025_000n],
      [3, '2027-01-20', 1_000_000n, 25_000n, 0n, 1_025_000n],
      [4, '2027-02-20', 500_000n, 25_000n, 0n, 525_000n],
    ]);
  });

  it('reduces the amount over the same dates with interest on the rest', () => {
    const schedule = installmentSchedule({ ...ZERO, principalMinor: 6_000_000n, tenor: 6, monthlyRateBps: 100 });
    const rows = recalculateAfterPayoff({
      remaining: schedule.slice(1),
      paidMinor: 2_500_000n,
      mode: 'reduce_amount',
      monthlyRateBps: 100,
      method: 'flat',
    });
    expect(rows.map((row) => row.dueOn)).toEqual(schedule.slice(1).map((row) => row.dueOn));
    expect(rows.map((row) => row.principalMinor)).toEqual([500_000n, 500_000n, 500_000n, 500_000n, 500_000n]);
    expect(rows.every((row) => row.interestMinor === 25_000n && row.feeMinor === 0n)).toBe(true);
  });

  it('annuity "Kurangi nominal": a new payment over the same months', () => {
    const rows = recalculateAfterPayoff({
      remaining: installmentSchedule(MORTGAGE).slice(3),
      paidMinor: 20_000_000n,
      mode: 'reduce_amount',
      monthlyRateBps: 100,
      method: 'annuity',
    });
    expect(rows).toHaveLength(9);
    expect(brief(rows.slice(0, 1))).toEqual([[4, '2027-02-25', 5_988_992n, 561_080n, 0n, 6_550_072n]]);
    expect(rows.at(-1)).toMatchObject({ dueOn: '2027-10-25', totalMinor: 6_550_068n, balanceAfterMinor: 0n });
  });

  it('annuity "Persingkat tenor": the same payment, done in August instead of October', () => {
    const rows = recalculateAfterPayoff({
      remaining: installmentSchedule(MORTGAGE).slice(3),
      paidMinor: 20_000_000n,
      mode: 'shorten_tenor',
      monthlyRateBps: 100,
      method: 'annuity',
    });
    expect(rows).toHaveLength(7);
    expect(rows[0]).toMatchObject({ number: 4, totalMinor: 8_884_879n, interestMinor: 561_080n });
    expect(rows.at(-1)).toMatchObject({
      number: 10,
      dueOn: '2027-08-25',
      principalMinor: 4_899_893n,
      totalMinor: 4_948_892n,
      balanceAfterMinor: 0n,
    });
  });

  it('shortens with the largest principal when the first installment carries the remainder', () => {
    const rows = recalculateAfterPayoff({
      remaining: installmentSchedule(ZERO),
      paidMinor: 1n,
      mode: 'shorten_tenor',
      monthlyRateBps: 0,
      method: 'flat',
    });
    expect(rows.map((row) => row.principalMinor)).toEqual([333_334n, 333_334n, 333_331n]);
  });

  it('recalculates a 0% annuity like a flat schedule', () => {
    for (const mode of RECALC_MODES) {
      const input = { remaining: kulkas, paidMinor: 2_000_000n, mode, monthlyRateBps: 0 } as const;
      expect(recalculateAfterPayoff({ ...input, method: 'annuity' })).toEqual(
        recalculateAfterPayoff({ ...input, method: 'flat' }),
      );
    }
  });

  it('is paid off when the payment covers everything left', () => {
    expect(
      recalculateAfterPayoff({
        remaining: kulkas,
        paidMinor: 3_000_000n,
        mode: 'reduce_amount',
        monthlyRateBps: 0,
        method: 'flat',
      }),
    ).toEqual([]);
  });

  it('refuses an empty schedule, a non-positive or excessive payment, and bad terms', () => {
    const base = {
      remaining: kulkas,
      paidMinor: 1n,
      mode: 'reduce_amount',
      monthlyRateBps: 0,
      method: 'flat',
    } as const;
    expectDebtError(() => recalculateAfterPayoff({ ...base, remaining: [] }), 'schedule');
    expectDebtError(() => recalculateAfterPayoff({ ...base, paidMinor: 0n }), 'payment');
    expectDebtError(() => recalculateAfterPayoff({ ...base, paidMinor: 3_000_001n }), 'payment');
    expectDebtError(() => recalculateAfterPayoff({ ...base, monthlyRateBps: -1 }), 'rate');
  });

  it('property: the new schedule repays exactly the rest on the old dates', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 1n, max: 10n ** 12n }),
        fc.integer({ min: 1, max: 36 }),
        fc.integer({ min: 0, max: 300 }),
        fc.constantFrom<InterestMethod>('flat', 'annuity'),
        fc.constantFrom('reduce_amount', 'shorten_tenor' as const),
        fc.integer({ min: 0, max: 35 }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (principalMinor, tenor, rate, method, mode, billed, share) => {
          const schedule = installmentSchedule({ ...ZERO, principalMinor, tenor, monthlyRateBps: rate, method });
          const remaining = schedule.slice(Math.min(billed, tenor - 1));
          const left = scheduleTotals(remaining).principalMinor;
          fc.pre(left > 0n);
          const paidMinor = 1n + (BigInt(Math.floor(share * 1_000_000)) * (left - 1n)) / 1_000_000n;
          const rows = recalculateAfterPayoff({ remaining, paidMinor, mode, monthlyRateBps: rate, method });
          expect(scheduleTotals(rows).principalMinor).toBe(left - paidMinor);
          expect(rows.length).toBeLessThanOrEqual(remaining.length);
          if (mode === 'reduce_amount' && rows.length > 0) {
            expect(rows).toHaveLength(remaining.length);
          }
          rows.forEach((row, index) => {
            expect(row.dueOn).toBe(remaining[index]?.dueOn);
            expect(row.number).toBe((remaining[0]?.number ?? 0) + index);
            expect(row.principalMinor).toBeGreaterThanOrEqual(0n);
          });
          expect(rows.at(-1)?.balanceAfterMinor ?? 0n).toBe(0n);
        },
      ),
    );
  });
});

describe('allocateCardPayment (FR-U4 priority)', () => {
  const due = { installments: [{ id: 'A', remainingMinor: 3_000_000n }], spendingMinor: 1_000_000n };

  it('golden qrRRV: Rp2.000.000 goes to installment A first, bill B untouched', () => {
    expect(allocateCardPayment(2_000_000n, due)).toEqual({
      installments: [{ id: 'A', paidMinor: 2_000_000n }],
      spendingMinor: 0n,
      creditMinor: 0n,
    });
  });

  it('follows the user order and treats the stored [] as the default', () => {
    expect(allocateCardPayment(2_000_000n, due, ['spending', 'installments'])).toEqual({
      installments: [{ id: 'A', paidMinor: 1_000_000n }],
      spendingMinor: 1_000_000n,
      creditMinor: 0n,
    });
    expect(allocateCardPayment(2_000_000n, due, [])).toEqual(allocateCardPayment(2_000_000n, due));
  });

  it('pays installments oldest first, then spending, the rest becomes credit balance', () => {
    const two = {
      installments: [...due.installments, { id: 'C', remainingMinor: 500_000n }],
      spendingMinor: 1_000_000n,
    };
    expect(allocateCardPayment(3_200_000n, two)).toEqual({
      installments: [
        { id: 'A', paidMinor: 3_000_000n },
        { id: 'C', paidMinor: 200_000n },
      ],
      spendingMinor: 0n,
      creditMinor: 0n,
    });
    expect(allocateCardPayment(5_000_000n, two)).toEqual({
      installments: [
        { id: 'A', paidMinor: 3_000_000n },
        { id: 'C', paidMinor: 500_000n },
      ],
      spendingMinor: 1_000_000n,
      creditMinor: 500_000n,
    });
  });

  it('skips settled installments', () => {
    const settled = { installments: [{ id: 'A', remainingMinor: 0n }], spendingMinor: 0n };
    expect(allocateCardPayment(10n, settled)).toEqual({ installments: [], spendingMinor: 0n, creditMinor: 10n });
  });

  it('refuses a non-positive payment, negative dues and a malformed priority', () => {
    expectDebtError(() => allocateCardPayment(0n, due), 'payment');
    expectDebtError(() => allocateCardPayment(1n, { ...due, spendingMinor: -1n }), 'payment');
    expectDebtError(
      () => allocateCardPayment(1n, { ...due, installments: [{ id: 'A', remainingMinor: -1n }] }),
      'payment',
    );
    expectDebtError(() => allocateCardPayment(1n, due, ['spending']), 'priority');
    expectDebtError(() => allocateCardPayment(1n, due, ['spending', 'spending']), 'priority');
    expectDebtError(() => allocateCardPayment(1n, due, ['spending', 'installments', 'spending']), 'priority');
  });

  it('property: every rupiah is allocated, nothing beyond what is owed, credit only once all is paid', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 1n, max: 10n ** 10n }),
        fc.array(fc.bigInt({ min: 0n, max: 10n ** 9n }), { maxLength: 5 }),
        fc.bigInt({ min: 0n, max: 10n ** 9n }),
        fc.boolean(),
        (amount, remaining, spendingMinor, spendingFirst) => {
          const installments = remaining.map((remainingMinor, index) => ({ id: String(index), remainingMinor }));
          const priority = spendingFirst ? (['spending', 'installments'] as const) : DEFAULT_CC_PAYMENT_PRIORITY;
          const result = allocateCardPayment(amount, { installments, spendingMinor }, priority);
          const paid = result.installments.reduce((sum, item) => sum + item.paidMinor, 0n);
          expect(paid + result.spendingMinor + result.creditMinor).toBe(amount);
          expect(result.spendingMinor).toBeLessThanOrEqual(spendingMinor);
          for (const item of result.installments) {
            expect(item.paidMinor).toBeGreaterThan(0n);
            expect(item.paidMinor).toBeLessThanOrEqual(installments[Number(item.id)]?.remainingMinor ?? 0n);
          }
          const owed = remaining.reduce((sum, value) => sum + value, spendingMinor);
          expect(result.creditMinor).toBe(amount > owed ? amount - owed : 0n);
        },
      ),
    );
  });
});

describe('debtSummary (FR-U1 KPIs)', () => {
  it('sums the unpaid principal, what is due this month or overdue, and the nearest due date', () => {
    const rows = installmentSchedule({ ...ZERO, firstDue: d('2026-10-20') });
    const scheduled = rows.map((row, index) => ({ ...row, paid: index === 0 }));
    expect(debtSummary(scheduled, d('2026-11-15'))).toEqual({
      remainingMinor: 666_666n,
      dueMinor: 333_333n,
      nextDue: '2026-11-20',
    });
    expect(
      debtSummary(
        scheduled.map((row) => ({ ...row, paid: false })),
        d('2026-11-15'),
      ),
    ).toEqual({
      remainingMinor: 1_000_000n,
      dueMinor: 666_667n,
      nextDue: '2026-10-20',
    });
  });

  it('finds the nearest due date across debts in any order', () => {
    const late = installmentSchedule({ ...ZERO, firstDue: d('2026-12-05') });
    const early = installmentSchedule({ ...ZERO, firstDue: d('2026-11-25') });
    const unpaid = [...late, ...early].map((row) => ({ ...row, paid: false }));
    expect(debtSummary(unpaid, d('2026-11-15'))).toMatchObject({ dueMinor: 333_334n, nextDue: '2026-11-25' });
  });

  it('is empty without unpaid installments', () => {
    expect(debtSummary([], d('2026-11-15'))).toEqual({ remainingMinor: 0n, dueMinor: 0n, nextDue: null });
  });
});

describe('debtImpact (FR-U5 simulation)', () => {
  const macbook = installmentSchedule({ ...ZERO, principalMinor: 18_999_000n, tenor: 12, firstDue: d('2026-11-25') });
  const october = {
    incomeMinor: 26_000_000n,
    expenseMinor: 16_500_000n,
    existingMonthlyMinor: 0n,
    netWorthMinor: 116_443_000n,
  };

  it('golden v3Igd: Rp1.583.250 = 6,1% of Rp26.000.000 (healthy), saving rate 36,5% → 30,4%, net worth −18.999.000', () => {
    expect(debtImpact({ schedule: macbook, ...october })).toEqual({
      monthlyMinor: 1_583_250n,
      ratioBps: 609,
      healthy: true,
      savingRateBeforeBps: 3654,
      savingRateAfterBps: 3045,
      headroomBps: 45,
      netWorthAfterMinor: 97_444_000n,
    });
  });

  it('counts existing installments in the ratio and flags more than 30%', () => {
    expect(debtImpact({ schedule: macbook, ...october, existingMonthlyMinor: 6_216_750n })).toMatchObject({
      ratioBps: 3000,
      healthy: true,
    });
    expect(debtImpact({ schedule: macbook, ...october, existingMonthlyMinor: 6_216_751n })).toMatchObject({
      ratioBps: 3000,
      healthy: true,
    });
    expect(debtImpact({ schedule: macbook, ...october, existingMonthlyMinor: 6_300_000n })).toMatchObject({
      ratioBps: 3032,
      healthy: false,
    });
  });

  it('goes below the saving-rate target with a negative headroom', () => {
    expect(debtImpact({ schedule: macbook, ...october, expenseMinor: 18_000_000n })).toMatchObject({
      savingRateAfterBps: 2468,
      headroomBps: -532,
    });
  });

  it('has no ratios without income', () => {
    expect(debtImpact({ schedule: macbook, ...october, incomeMinor: 0n })).toMatchObject({
      ratioBps: null,
      healthy: null,
      savingRateBeforeBps: null,
      savingRateAfterBps: null,
      headroomBps: null,
      netWorthAfterMinor: 97_444_000n,
    });
  });
});
