// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import {
  CARD_REMINDER_DAYS_BEFORE,
  INSTALLMENT_MAX_AGE_DAYS,
  INSTALLMENT_MIN_MINOR,
  INSTALLMENT_TENORS,
  InvalidCardError,
  cardCycle,
  cardStatus,
  installmentIneligibility,
  statementAmount,
  type InstallmentCandidate,
} from './creditcard.ts';
import { allocateCardPayment, installmentSchedule, recalculateAfterPayoff } from './debt.ts';
import { countDays, parseLocalDate } from './period.ts';

const d = parseLocalDate;

describe('card constants', () => {
  it('reminds H-3, splits from Rp500.000 into 3/6/12/24 months, up to 30 days back', () => {
    expect(CARD_REMINDER_DAYS_BEFORE).toBe(3);
    expect(INSTALLMENT_MIN_MINOR).toBe(500_000n);
    expect(INSTALLMENT_TENORS).toEqual([3, 6, 12, 24]);
    expect(INSTALLMENT_MAX_AGE_DAYS).toBe(30);
  });
});

describe('cardCycle (FR-R7)', () => {
  it('golden OEZIG: BCA Visa (cetak 20, tempo 5) on 15 Okt → 21 Sep – 20 Okt, due 5 Nov, reminder 2 Nov', () => {
    const cycle = cardCycle(d('2026-10-15'), 20, 5);
    expect(cycle).toEqual({
      start: '2026-09-21',
      statementOn: '2026-10-20',
      dueOn: '2026-11-05',
      remindOn: '2026-11-02',
    });
    // "5 hari lagi" to the statement, rHTMd "21 hari lagi" to the due date.
    expect(countDays(d('2026-10-15'), cycle.statementOn) - 1).toBe(5);
    expect(countDays(d('2026-10-15'), cycle.dueOn) - 1).toBe(21);
  });

  it('golden: the next cycle is 21 Okt – 20 Nov, due 5 Des (A7ttc on 10 Nov: "25 hari lagi")', () => {
    expect(cardCycle(d('2026-10-21'), 20, 5)).toEqual({
      start: '2026-10-21',
      statementOn: '2026-11-20',
      dueOn: '2026-12-05',
      remindOn: '2026-12-02',
    });
    expect(countDays(d('2026-11-10'), cardCycle(d('2026-11-10'), 20, 5).dueOn) - 1).toBe(25);
  });

  it('includes the statement day in its cycle', () => {
    expect(cardCycle(d('2026-10-20'), 20, 5).statementOn).toBe('2026-10-20');
  });

  it('puts the due date in the statement month when it comes later in that month', () => {
    expect(cardCycle(d('2026-10-10'), 5, 25)).toEqual({
      start: '2026-10-06',
      statementOn: '2026-11-05',
      dueOn: '2026-11-25',
      remindOn: '2026-11-22',
    });
    expect(cardCycle(d('2026-10-15'), 20, 20).dueOn).toBe('2026-11-20');
  });

  it('crosses the year', () => {
    expect(cardCycle(d('2026-12-25'), 20, 5)).toEqual({
      start: '2026-12-21',
      statementOn: '2027-01-20',
      dueOn: '2027-02-05',
      remindOn: '2027-02-02',
    });
  });

  it('clamps statement and due days to short months', () => {
    expect(cardCycle(d('2027-02-10'), 31, 15)).toEqual({
      start: '2027-02-01',
      statementOn: '2027-02-28',
      dueOn: '2027-03-15',
      remindOn: '2027-03-12',
    });
    expect(cardCycle(d('2027-03-01'), 31, 31)).toEqual({
      start: '2027-03-01',
      statementOn: '2027-03-31',
      dueOn: '2027-04-30',
      remindOn: '2027-04-27',
    });
    expect(cardCycle(d('2027-01-31'), 30, 1)).toMatchObject({ start: '2027-01-31', statementOn: '2027-02-28' });
  });

  it.each([
    [0, 5],
    [32, 5],
    [1.5, 5],
    [20, 0],
    [20, 32],
  ])('rejects statement day %s / due day %s', (statementDay, dueDay) => {
    expect(() => cardCycle(d('2026-10-15'), statementDay, dueDay)).toThrow(InvalidCardError);
    expect(() => cardCycle(d('2026-10-15'), statementDay, dueDay)).toThrow(
      `Invalid card day: ${statementDay === 20 ? dueDay : statementDay}`,
    );
  });
});

describe('cardStatus (FR-R7, PRD §7.2 remaining limit)', () => {
  const LIMIT = 15_000_000n;

  it('golden OEZIG: a new card has the whole limit', () => {
    expect(cardStatus({ limitMinor: LIMIT, balanceMinor: 0n, installmentsMinor: 0n })).toEqual({
      currentBillMinor: 0n,
      creditMinor: 0n,
      owedMinor: 0n,
      remainingLimitMinor: 15_000_000n,
      usedBps: 0,
    });
  });

  it('golden rHTMd: bill Rp1.250.000 → remaining 13.750.000, 8% of the limit', () => {
    expect(cardStatus({ limitMinor: LIMIT, balanceMinor: -1_250_000n, installmentsMinor: 0n })).toEqual({
      currentBillMinor: 1_250_000n,
      creditMinor: 0n,
      owedMinor: 1_250_000n,
      remainingLimitMinor: 13_750_000n,
      usedBps: 833,
    });
  });

  it('golden Section 18 (qrRRV → A7ttc): 11.000.000 before and 13.000.000 after the Rp2.000.000 payment', () => {
    // A: Kulkas Rp3.000.000 in 3× 0% (2 Nov); B: Superindo Rp1.000.000 (6 Nov); total card obligation Rp4.000.000.
    expect(cardStatus({ limitMinor: LIMIT, balanceMinor: -4_000_000n, installmentsMinor: 3_000_000n })).toEqual({
      currentBillMinor: 1_000_000n,
      creditMinor: 0n,
      owedMinor: 4_000_000n,
      remainingLimitMinor: 11_000_000n,
      usedBps: 2667,
    });
    const allocation = allocateCardPayment(2_000_000n, {
      installments: [{ id: 'A', remainingMinor: 3_000_000n }],
      spendingMinor: 1_000_000n,
    });
    const installmentsMinor = 3_000_000n - (allocation.installments[0]?.paidMinor ?? 0n);
    expect(cardStatus({ limitMinor: LIMIT, balanceMinor: -2_000_000n, installmentsMinor })).toEqual({
      currentBillMinor: 1_000_000n,
      creditMinor: 0n,
      owedMinor: 2_000_000n,
      remainingLimitMinor: 13_000_000n,
      usedBps: 1333,
    });
  });

  it('keeps an overpayment as credit balance without raising the limit', () => {
    expect(cardStatus({ limitMinor: LIMIT, balanceMinor: 500_000n, installmentsMinor: 0n })).toEqual({
      currentBillMinor: 0n,
      creditMinor: 500_000n,
      owedMinor: 0n,
      remainingLimitMinor: 15_000_000n,
      usedBps: 0,
    });
    expect(cardStatus({ limitMinor: LIMIT, balanceMinor: -1_000_000n, installmentsMinor: 3_000_000n })).toMatchObject({
      currentBillMinor: 0n,
      creditMinor: 2_000_000n,
      owedMinor: 3_000_000n,
      remainingLimitMinor: 12_000_000n,
    });
  });

  it('goes negative over the limit and has no usage without a limit', () => {
    expect(cardStatus({ limitMinor: LIMIT, balanceMinor: -16_000_000n, installmentsMinor: 0n })).toMatchObject({
      remainingLimitMinor: -1_000_000n,
      usedBps: 10_667,
    });
    expect(cardStatus({ limitMinor: 0n, balanceMinor: -1n, installmentsMinor: 0n }).usedBps).toBeNull();
  });

  it('rejects negative installments', () => {
    expect(() => cardStatus({ limitMinor: LIMIT, balanceMinor: 0n, installmentsMinor: -1n })).toThrow(
      new InvalidCardError('Installments must not be negative'),
    );
    expect(new InvalidCardError('x').name).toBe('InvalidCardError');
  });
});

describe('statementAmount', () => {
  it('golden A7ttc: rekening koran 20 Nov = cicilan 333.334 + B 1.000.000 = 1.333.334', () => {
    const kulkas = installmentSchedule({
      principalMinor: 3_000_000n,
      tenor: 3,
      monthlyRateBps: 0,
      adminFeeMinor: 0n,
      method: 'flat',
      firstDue: d('2026-11-20'),
    });
    const recalculated = recalculateAfterPayoff({
      remaining: kulkas,
      paidMinor: 2_000_000n,
      mode: 'reduce_amount',
      monthlyRateBps: 0,
      method: 'flat',
    });
    expect(statementAmount(1_000_000n, recalculated, d('2026-11-20'))).toBe(1_333_334n);
    expect(statementAmount(0n, recalculated, d('2026-12-20'))).toBe(333_333n);
    expect(statementAmount(450_000n, recalculated, d('2026-10-20'))).toBe(450_000n);
  });
});

describe('installmentIneligibility (FR-U2 "Ubah jadi cicilan")', () => {
  const card = { statementDay: 20, dueDay: 5 };
  const kulkas: InstallmentCandidate = {
    accountType: 'credit_card',
    type: 'expense',
    amountMinor: 3_000_000n,
    localDate: d('2026-11-02'),
  };

  it('golden hNvip: Tokopedia Kulkas Rp3.000.000 on BCA Visa can be split', () => {
    expect(installmentIneligibility(kulkas, card, d('2026-11-10'))).toBeNull();
  });

  it('needs a credit-card expense', () => {
    expect(installmentIneligibility({ ...kulkas, accountType: 'bank' }, card, d('2026-11-10'))).toBe('not_card');
    expect(installmentIneligibility({ ...kulkas, type: 'income' }, card, d('2026-11-10'))).toBe('not_expense');
  });

  it('needs at least Rp500.000 (x20Gf: Superindo Rp1.000.000 qualifies, Rp499.999 does not)', () => {
    expect(installmentIneligibility({ ...kulkas, amountMinor: 500_000n }, card, d('2026-11-10'))).toBeNull();
    expect(installmentIneligibility({ ...kulkas, amountMinor: 499_999n }, card, d('2026-11-10'))).toBe('below_minimum');
  });

  it('accepts transactions up to 30 days old', () => {
    expect(installmentIneligibility({ ...kulkas, localDate: d('2026-10-21') }, card, d('2026-11-20'))).toBeNull();
    expect(installmentIneligibility({ ...kulkas, localDate: d('2026-10-20') }, card, d('2026-11-20'))).toBe('too_old');
  });

  it('refuses transactions already printed on a statement ("selama belum tertagih")', () => {
    expect(installmentIneligibility({ ...kulkas, localDate: d('2026-10-21') }, card, d('2026-11-10'))).toBeNull();
    expect(installmentIneligibility({ ...kulkas, localDate: d('2026-10-20') }, card, d('2026-11-10'))).toBe('billed');
  });
});
