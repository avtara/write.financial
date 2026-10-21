// SPDX-License-Identifier: AGPL-3.0-only
import type { LocalDate } from '@wf/domain/period';
import { describe, expect, it } from 'vitest';
import {
  CARD_AFTER_PAYMENT,
  CARD_BEFORE_PAYMENT,
  debtView,
  installment,
  KULKAS,
  KULKAS_AFTER,
  MACBOOK,
  VISA_ACCOUNT,
  visa,
} from '../../test/debt-fixtures.ts';
import {
  cardInstallmentSchedule,
  cardLabel,
  cardPaymentPlan,
  cardState,
  debtKpis,
  existingMonthlyMinor,
  paidOffBps,
  parseRateBps,
  paymentPriority,
  settledCount,
  toInstallment,
  toInstallmentInputs,
  unbilledRows,
} from './debts.ts';

const d = (value: string) => value as LocalDate;
const OCT_15 = d('2026-10-15');
const NOV_10 = d('2026-11-10');

describe('cardLabel', () => {
  it('adds the last digits when known', () => {
    expect(cardLabel('BCA Visa', VISA_ACCOUNT)).toBe('BCA Visa •• 7710');
    expect(cardLabel('BCA Visa', undefined)).toBe('BCA Visa');
  });
});

describe('paymentPriority', () => {
  it('keeps a full order of both buckets and falls back to installments first', () => {
    expect(paymentPriority(['spending', 'installments'])).toEqual(['spending', 'installments']);
    expect(paymentPriority([])).toEqual(['installments', 'spending']);
    expect(paymentPriority(['installments'])).toEqual(['installments', 'spending']);
    expect(paymentPriority(['a', 'b'])).toEqual(['installments', 'spending']);
  });
});

describe('schedule rows', () => {
  it('converts repository rows to the domain and back', () => {
    const row = installment(2, '2026-12-20', 1_000_000n, { interestMinor: 15_000n, feeMinor: 5_000n });
    const domain = toInstallment(row);
    expect(domain).toEqual({
      number: 2,
      dueOn: '2026-12-20',
      principalMinor: 1_000_000n,
      interestMinor: 15_000n,
      feeMinor: 5_000n,
      totalMinor: 1_020_000n,
      balanceAfterMinor: 0n,
    });
    expect(toInstallmentInputs([domain])).toEqual([
      { dueDate: '2026-12-20', principalMinor: 1_000_000n, interestMinor: 15_000n, feeMinor: 5_000n },
    ]);
  });

  it('leaves out billed and paid rows', () => {
    const debt = debtView({
      installments: [
        installment(1, '2026-10-20', 1_000_000n, { billed: true }),
        installment(2, '2026-11-20', 1_000_000n, { status: 'paid' }),
        installment(3, '2026-12-20', 1_000_000n),
      ],
    });
    expect(unbilledRows(debt).map((row) => row.seq)).toEqual([3]);
  });
});

describe('cardState (FR-R7)', () => {
  it('golden rHTMd: 21 Sep – 20 Okt, due 5 Nov, bill 1.250.000, 13.750.000 left (8%)', () => {
    const state = cardState(visa(), [], OCT_15);
    expect(state.cycle).toEqual({
      start: '2026-09-21',
      statementOn: '2026-10-20',
      dueOn: '2026-11-05',
      remindOn: '2026-11-02',
    });
    expect(state.status).toMatchObject({
      currentBillMinor: 1_250_000n,
      remainingLimitMinor: 13_750_000n,
      usedBps: 833,
    });
    expect(state.statementMinor).toBe(1_250_000n);
  });

  it('golden A7ttc: bill B 1.000.000 + installment 333.334 on the 20 Nov statement, 13.000.000 left', () => {
    const state = cardState(CARD_AFTER_PAYMENT, [KULKAS_AFTER, MACBOOK], NOV_10);
    expect(state.status).toMatchObject({ currentBillMinor: 1_000_000n, remainingLimitMinor: 13_000_000n });
    expect(state.statementMinor).toBe(1_333_334n);
  });

  it('has no cycle without statement or due day, and no limit counts as 0', () => {
    const state = cardState(visa({ statementDay: null, limitMinor: null }), [], OCT_15);
    expect(state.cycle).toBeNull();
    expect(state.statementMinor).toBe(1_250_000n);
    expect(cardState(visa({ dueDay: null }), [], OCT_15).cycle).toBeNull();
  });
});

describe('cardInstallmentSchedule (FR-U2)', () => {
  it('golden hNvip: 3.000.000 on 2 Nov in 3× → 1.000.000 on the 20 Nov, 20 Des, 20 Jan statements', () => {
    const rows = cardInstallmentSchedule({ statementDay: 20, dueDay: 5 }, 3_000_000n, d('2026-11-02'), {
      tenor: 3,
      monthlyRateBps: 0,
      adminFeeMinor: 0n,
    });
    expect(rows.map((row) => [row.dueOn, row.totalMinor])).toEqual([
      ['2026-11-20', 1_000_000n],
      ['2026-12-20', 1_000_000n],
      ['2027-01-20', 1_000_000n],
    ]);
  });
});

describe('cardPaymentPlan (FR-U4)', () => {
  const before = cardState(CARD_BEFORE_PAYMENT, [KULKAS], NOV_10);

  it('golden qrRRV: Rp2.000.000 pays installment A first; 333.334/333.333/333.333 and 13.000.000 left', () => {
    const plan = cardPaymentPlan({
      state: before,
      debts: [KULKAS, MACBOOK],
      amountMinor: 2_000_000n,
      priority: ['installments', 'spending'],
      mode: 'reduce_amount',
    });
    expect(plan.rows.map((row) => [row.bucket, row.debt?.id ?? null, row.beforeMinor, row.paidMinor])).toEqual([
      ['installments', 'debt-a', 3_000_000n, 2_000_000n],
      ['spending', null, 1_000_000n, 0n],
      ['credit', null, null, 0n],
    ]);
    expect(plan.before).toEqual({
      installmentsMinor: 3_000_000n,
      owedMinor: 4_000_000n,
      remainingLimitMinor: 11_000_000n,
      statementMinor: 2_000_000n,
    });
    expect(plan.after).toEqual({
      installmentsMinor: 1_000_000n,
      owedMinor: 2_000_000n,
      remainingLimitMinor: 13_000_000n,
      statementMinor: 1_333_334n,
    });
    expect(plan.partial?.restMinor).toBe(1_000_000n);
    expect(plan.partial?.reduce.map((row) => row.principalMinor)).toEqual([333_334n, 333_333n, 333_333n]);
    expect(plan.partial?.shorten.map((row) => [row.dueOn, row.principalMinor])).toEqual([['2026-11-20', 1_000_000n]]);
    expect(plan.parts).toEqual([{ bucket: 'installments', debtId: 'debt-a', amountMinor: 2_000_000n }]);
    expect(plan.recalculations).toEqual([
      {
        debtId: 'debt-a',
        mode: 'reduce_amount',
        schedule: [
          { dueDate: '2026-11-20', principalMinor: 333_334n, interestMinor: 0n, feeMinor: 0n },
          { dueDate: '2026-12-20', principalMinor: 333_333n, interestMinor: 0n, feeMinor: 0n },
          { dueDate: '2027-01-20', principalMinor: 333_333n, interestMinor: 0n, feeMinor: 0n },
        ],
      },
    ]);
  });

  it('shortens the tenor, pays spending first, and keeps an unpaid installment on the statement', () => {
    const shorter = cardPaymentPlan({
      state: before,
      debts: [KULKAS],
      amountMinor: 2_000_000n,
      priority: ['installments', 'spending'],
      mode: 'shorten_tenor',
    });
    expect(shorter.recalculations[0]?.schedule).toHaveLength(1);
    expect(shorter.after.statementMinor).toBe(2_000_000n);
    const spendingFirst = cardPaymentPlan({
      state: before,
      debts: [KULKAS],
      amountMinor: 500_000n,
      priority: ['spending', 'installments'],
      mode: 'reduce_amount',
    });
    expect(spendingFirst.parts).toEqual([{ bucket: 'spending', amountMinor: 500_000n }]);
    expect(spendingFirst.partial).toBeNull();
    expect(spendingFirst.after).toMatchObject({ statementMinor: 1_500_000n, remainingLimitMinor: 11_500_000n });
  });

  it('pays an installment off in full and keeps an overpayment as credit', () => {
    const plan = cardPaymentPlan({
      state: before,
      debts: [KULKAS, debtView({ id: 'paid-off', status: 'paid_off' })],
      amountMinor: 5_000_000n,
      priority: ['installments', 'spending'],
      mode: 'reduce_amount',
    });
    expect(plan.partial).toBeNull();
    expect(plan.recalculations).toEqual([]);
    expect(plan.parts).toEqual([
      { bucket: 'installments', debtId: 'debt-a', amountMinor: 3_000_000n },
      { bucket: 'spending', amountMinor: 1_000_000n },
      { bucket: 'credit', amountMinor: 1_000_000n },
    ]);
    expect(plan.after).toMatchObject({ owedMinor: 0n, remainingLimitMinor: 15_000_000n, statementMinor: 0n });
  });

  it('uses the bill as the statement of a card without a cycle', () => {
    const plan = cardPaymentPlan({
      state: cardState(visa({ statementDay: null }), [], OCT_15),
      debts: [],
      amountMinor: 250_000n,
      priority: ['installments', 'spending'],
      mode: 'reduce_amount',
    });
    expect(plan.after.statementMinor).toBe(1_000_000n);
    const unlimited = cardPaymentPlan({
      state: cardState(visa({ limitMinor: null }), [], OCT_15),
      debts: [],
      amountMinor: 250_000n,
      priority: ['installments', 'spending'],
      mode: 'reduce_amount',
    });
    expect(unlimited.after.remainingLimitMinor).toBe(-1_000_000n);
  });
});

describe('debtKpis (FR-U1)', () => {
  it('golden exCE7: nothing owed', () => {
    expect(debtKpis([], [cardState(visa({ balanceMinor: 0n }), [], OCT_15)], OCT_15, 'IDR')).toEqual({
      remainingMinor: 0n,
      installmentCount: 0,
      billCount: 0,
      dueMinor: 0n,
      dueCard: null,
      nearest: null,
    });
  });

  it('golden rHTMd: the card bill is the debt, due 5 Nov', () => {
    const state = cardState(visa(), [], OCT_15);
    expect(debtKpis([], [state], OCT_15, 'IDR')).toEqual({
      remainingMinor: 1_250_000n,
      installmentCount: 0,
      billCount: 1,
      dueMinor: 1_250_000n,
      dueCard: state,
      nearest: { date: '2026-11-05', name: 'BCA Visa' },
    });
  });

  it('golden A7ttc: 1 cicilan · 1 tagihan berjalan, Rp2.000.000 left, Rp1.333.334 due, nearest 5 Des', () => {
    const kpis = debtKpis([KULKAS_AFTER], [cardState(CARD_AFTER_PAYMENT, [KULKAS_AFTER], NOV_10)], NOV_10, 'IDR');
    expect(kpis).toMatchObject({
      remainingMinor: 2_000_000n,
      installmentCount: 1,
      billCount: 1,
      dueMinor: 1_333_334n,
      nearest: { date: '2026-12-05', name: 'BCA Visa' },
    });
  });

  it('adds non-card rows due by this month, skips paid rows and other currencies, names several dues none', () => {
    const late = debtView({
      ...MACBOOK,
      id: 'late',
      name: 'Pinjaman',
      remainingPrincipalMinor: 1_000_000n,
      installments: [
        installment(1, '2026-10-01', 500_000n, { status: 'paid' }),
        installment(2, '2026-10-25', 500_000n),
        installment(3, '2026-11-25', 500_000n),
      ],
    });
    const dollars = debtView({ ...MACBOOK, id: 'usd', currency: 'USD' });
    const kpis = debtKpis([late, dollars], [cardState(visa(), [], OCT_15)], OCT_15, 'IDR');
    expect(kpis).toMatchObject({
      remainingMinor: 1_000_000n + 1_250_000n,
      dueMinor: 500_000n + 1_250_000n,
      dueCard: null,
      nearest: { date: '2026-10-25', name: 'Pinjaman' },
    });
    // A card owing only installments (nothing on its statement) is not "due".
    const held = cardState(visa({ balanceMinor: -3_000_000n, installmentsHeldMinor: 3_000_000n }), [], OCT_15);
    expect(debtKpis([], [held], OCT_15, 'IDR')).toMatchObject({ dueMinor: 0n, billCount: 0, dueCard: null });
    const noCycle = cardState(visa({ statementDay: null }), [], OCT_15);
    expect(debtKpis([], [noCycle], OCT_15, 'IDR')).toMatchObject({ dueMinor: 1_250_000n, nearest: null });
  });
});

describe('progress and monthly installments', () => {
  it('golden A7ttc: 67% lunas, 0 dari 3 cicilan tertagih', () => {
    expect(paidOffBps(KULKAS_AFTER)).toBe(6666);
    expect(settledCount(KULKAS_AFTER)).toBe(0);
    expect(settledCount(debtView({ installments: [installment(1, '2026-10-20', 1n, { billed: true })] }))).toBe(1);
  });

  it('sums the next unsettled row of each active debt in the base currency', () => {
    const done = debtView({ id: 'done', installments: [installment(1, '2026-10-20', 1n, { billed: true })] });
    const closed = debtView({ id: 'closed', status: 'paid_off' });
    expect(existingMonthlyMinor([MACBOOK, KULKAS_AFTER, done, closed], 'IDR')).toBe(1_583_250n + 333_334n);
    expect(existingMonthlyMinor([MACBOOK], 'USD')).toBe(0n);
  });
});

describe('parseRateBps', () => {
  it.each([
    ['0', 0],
    ['1,75', 175],
    ['1.5', 150],
    [' 2 ', 200],
    ['100', 10_000],
  ])('reads %s as %d bps', (text, bps) => {
    expect(parseRateBps(text)).toBe(bps);
  });

  it.each(['', 'abc', '1,234', '-1', '100,01', '1000'])('refuses %s', (text) => {
    expect(parseRateBps(text)).toBeNull();
  });
});
