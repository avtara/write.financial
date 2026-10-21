// SPDX-License-Identifier: AGPL-3.0-only
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { netWorth } from './ledger.ts';
import { parseLocalDate } from './period.ts';
import {
  DUE_PRESETS,
  InvalidReceivableError,
  PAID_HISTORY_DAYS,
  RECEIVABLE_REMIND_DAYS_BEFORE,
  RECEIVABLE_SOURCES,
  RECEIVABLE_STATUSES,
  SPLIT_METHODS,
  dueDateFor,
  receivablesOutstanding,
  receivableState,
  receivePayment,
  splitBill,
  writeOffAmount,
  type ReceivableInput,
} from './receivables.ts';

const d = parseLocalDate;

/** Section 19 on 15 Okt: Nadia (CGV split, 242.500), Raka (cash loan 400.000, 100.000 back), Dimas and Sari paid. */
const NADIA: ReceivableInput = { principalMinor: 242_500n, paymentsMinor: [], writtenOff: false };
const RAKA: ReceivableInput = { principalMinor: 400_000n, paymentsMinor: [100_000n], writtenOff: false };
const DIMAS: ReceivableInput = { principalMinor: 150_000n, paymentsMinor: [150_000n], writtenOff: false };
const SARI: ReceivableInput = { principalMinor: 385_000n, paymentsMinor: [385_000n], writtenOff: false };

function expectReceivableError(run: () => unknown, reason: string): void {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(InvalidReceivableError);
    expect(error).toBeInstanceOf(RangeError);
    expect((error as InvalidReceivableError).reason).toBe(reason);
    expect((error as InvalidReceivableError).name).toBe('InvalidReceivableError');
    expect((error as InvalidReceivableError).message).toBe(`Invalid receivable: ${reason}`);
    return;
  }
  throw new Error('expected an InvalidReceivableError');
}

describe('receivable enums', () => {
  it('lists sources, statuses, split methods, due presets and windows', () => {
    expect(RECEIVABLE_SOURCES).toEqual(['split_bill', 'loan']);
    expect(RECEIVABLE_STATUSES).toEqual(['open', 'partial', 'settled', 'written_off']);
    expect(SPLIT_METHODS).toEqual(['equal', 'amount', 'percent', 'item']);
    expect(DUE_PRESETS).toEqual(['one_week', 'two_weeks', 'end_of_month', 'none']);
    expect(RECEIVABLE_REMIND_DAYS_BEFORE).toBe(1);
    expect(PAID_HISTORY_DAYS).toBe(90);
  });
});

describe('receivableState (FR-U7)', () => {
  it('golden: Raka 400.000 with 100.000 back → 300.000 left, 25%', () => {
    expect(receivableState(RAKA)).toEqual({
      paidMinor: 100_000n,
      remainingMinor: 300_000n,
      progressBps: 2500,
      status: 'partial',
    });
  });

  it('is open without payments and settled once paid in full', () => {
    expect(receivableState(NADIA)).toEqual({
      paidMinor: 0n,
      remainingMinor: 242_500n,
      progressBps: 0,
      status: 'open',
    });
    expect(receivableState(DIMAS)).toEqual({
      paidMinor: 150_000n,
      remainingMinor: 0n,
      progressBps: 10_000,
      status: 'settled',
    });
  });

  it('rounds progress half up', () => {
    expect(receivableState({ principalMinor: 3n, paymentsMinor: [1n], writtenOff: false }).progressBps).toBe(3333);
    expect(receivableState({ principalMinor: 3n, paymentsMinor: [2n], writtenOff: false }).progressBps).toBe(6667);
  });

  it('has nothing left once written off', () => {
    expect(receivableState({ ...RAKA, writtenOff: true })).toEqual({
      paidMinor: 100_000n,
      remainingMinor: 0n,
      progressBps: 2500,
      status: 'written_off',
    });
  });

  it('refuses a non-positive principal, non-positive payments and Σ payments > principal', () => {
    expectReceivableError(() => receivableState({ ...NADIA, principalMinor: 0n }), 'principal');
    expectReceivableError(() => receivableState({ ...NADIA, paymentsMinor: [0n] }), 'payment');
    expectReceivableError(() => receivableState({ ...NADIA, paymentsMinor: [-1n] }), 'payment');
    expectReceivableError(() => receivableState({ ...RAKA, paymentsMinor: [300_000n, 100_001n] }), 'overpaid');
  });
});

describe('receivePayment (FR-U7 "Terima pembayaran")', () => {
  it('golden Section 19: receive Raka Rp200.000 → 100.000 left (75%)', () => {
    expect(receivePayment(RAKA, 200_000n)).toEqual({
      paidMinor: 300_000n,
      remainingMinor: 100_000n,
      progressBps: 7500,
      status: 'partial',
    });
  });

  it('settles with the rest ("Lunas")', () => {
    expect(receivePayment(RAKA, 300_000n)).toMatchObject({ remainingMinor: 0n, status: 'settled' });
  });

  it('refuses more than what is left, non-positive amounts, and closed receivables', () => {
    expectReceivableError(() => receivePayment(RAKA, 300_001n), 'overpaid');
    expectReceivableError(() => receivePayment(RAKA, 0n), 'payment');
    expectReceivableError(() => receivePayment(RAKA, -1n), 'payment');
    expectReceivableError(() => receivePayment(DIMAS, 1n), 'closed');
    expectReceivableError(() => receivePayment({ ...RAKA, writtenOff: true }, 1n), 'closed');
  });

  it('property: Σ payments never exceeds the principal', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 1n, max: 10n ** 12n }),
        fc.array(fc.bigInt({ min: -10n, max: 10n ** 12n }), { maxLength: 20 }),
        (principalMinor, attempts) => {
          let receivable: ReceivableInput = { principalMinor, paymentsMinor: [], writtenOff: false };
          for (const amount of attempts) {
            const before = receivableState(receivable);
            if (amount > 0n && amount <= before.remainingMinor) {
              const after = receivePayment(receivable, amount);
              expect(after.paidMinor).toBe(before.paidMinor + amount);
              receivable = { ...receivable, paymentsMinor: [...receivable.paymentsMinor, amount] };
            } else {
              expect(() => receivePayment(receivable, amount)).toThrow(InvalidReceivableError);
            }
            const state = receivableState(receivable);
            expect(state.paidMinor).toBeLessThanOrEqual(principalMinor);
            expect(state.paidMinor + state.remainingMinor).toBe(principalMinor);
            expect(state.progressBps).toBeGreaterThanOrEqual(0);
            expect(state.progressBps).toBeLessThanOrEqual(10_000);
          }
        },
      ),
    );
  });
});

describe('writeOffAmount (FR-U7 "Hapuskan")', () => {
  it('writes off what is still open as an expense', () => {
    expect(writeOffAmount(RAKA)).toBe(300_000n);
    expect(writeOffAmount(NADIA)).toBe(242_500n);
  });

  it('refuses settled and written-off receivables', () => {
    expectReceivableError(() => writeOffAmount(DIMAS), 'closed');
    expectReceivableError(() => writeOffAmount({ ...RAKA, writtenOff: true }), 'closed');
  });
});

describe('receivablesOutstanding (net worth, not the available balance)', () => {
  it('golden Section 19: Rp542.500 → record Bima Rp500.000 → 1.042.500; receive Raka 200.000 → 842.500', () => {
    const all = [NADIA, RAKA, DIMAS, SARI];
    expect(receivablesOutstanding(all)).toBe(542_500n);
    const bima = { principalMinor: 500_000n, paymentsMinor: [], writtenOff: false };
    expect(receivablesOutstanding([...all, bima])).toBe(1_042_500n);
    expect(receivablesOutstanding([NADIA, { ...RAKA, paymentsMinor: [100_000n, 200_000n] }, DIMAS, SARI, bima])).toBe(
      842_500n,
    );
  });

  it('drops written-off receivables, which lowers net worth by what was open', () => {
    const before = receivablesOutstanding([NADIA, RAKA]);
    const after = receivablesOutstanding([NADIA, { ...RAKA, writtenOff: true }]);
    expect(before - after).toBe(writeOffAmount(RAKA));
    const worth = (receivablesMinor: bigint) =>
      netWorth({ available: 0n, investments: 0n, receivablesOutstanding: receivablesMinor, debtRemaining: 0n });
    expect(worth(before) - worth(after)).toBe(300_000n);
    expect(receivablesOutstanding([])).toBe(0n);
  });
});

describe('dueDateFor (FR-U7 due-date chips)', () => {
  it('golden IGHyP: CGV on 11 Okt, one week → 18 Okt', () => {
    expect(dueDateFor('one_week', d('2026-10-11'))).toBe('2026-10-18');
  });

  it('offers two weeks, the end of the month, or no deadline', () => {
    expect(dueDateFor('two_weeks', d('2026-10-11'))).toBe('2026-10-25');
    expect(dueDateFor('end_of_month', d('2026-10-11'))).toBe('2026-10-31');
    expect(dueDateFor('end_of_month', d('2027-02-10'))).toBe('2027-02-28');
    expect(dueDateFor('none', d('2026-10-11'))).toBeNull();
  });
});

describe('splitBill (FR-L5 "Pisah tagihan")', () => {
  it('golden IGHyP: CGV Rp485.000 "Sama rata" → 242.500 + 242.500', () => {
    expect(splitBill(485_000n, { method: 'equal', people: 2 })).toEqual([242_500n, 242_500n]);
  });

  it('equal: the rounding remainder goes to the first person', () => {
    expect(splitBill(100_001n, { method: 'equal', people: 3 })).toEqual([33_335n, 33_333n, 33_333n]);
  });

  it('amount: takes the typed shares when they match the total ("Total cocok")', () => {
    expect(splitBill(485_000n, { method: 'amount', amountsMinor: [300_000n, 185_000n] })).toEqual([300_000n, 185_000n]);
    expect(splitBill(485_000n, { method: 'amount', amountsMinor: [485_000n, 0n] })).toEqual([485_000n, 0n]);
  });

  it('percent: largest remainder keeps the sum exact, earlier people first on ties', () => {
    expect(splitBill(485_000n, { method: 'percent', bps: [6000, 4000] })).toEqual([291_000n, 194_000n]);
    expect(splitBill(100n, { method: 'percent', bps: [3333, 3333, 3334] })).toEqual([33n, 33n, 34n]);
    expect(splitBill(100n, { method: 'percent', bps: [3334, 3333, 3333] })).toEqual([34n, 33n, 33n]);
    expect(splitBill(1n, { method: 'percent', bps: [5000, 5000] })).toEqual([1n, 0n]);
    expect(splitBill(2n, { method: 'percent', bps: [3000, 3000, 4000] })).toEqual([1n, 0n, 1n]);
    // The leftover follows the largest fractional part, not the largest share.
    expect(splitBill(2n, { method: 'percent', bps: [6000, 4000] })).toEqual([1n, 1n]);
  });

  it('item: items per person, tax and service shared in proportion', () => {
    const items = [
      { amountMinor: 100_000n, people: [0] },
      { amountMinor: 50_000n, people: [1] },
      { amountMinor: 30_000n, people: [0, 1] },
    ];
    expect(splitBill(180_000n, { method: 'item', people: 2, items })).toEqual([115_000n, 65_000n]);
    expect(splitBill(198_000n, { method: 'item', people: 2, items })).toEqual([126_500n, 71_500n]);
    expect(splitBill(11n, { method: 'item', people: 3, items: [{ amountMinor: 10n, people: [0, 1, 2] }] })).toEqual([
      5n,
      3n,
      3n,
    ]);
    expect(splitBill(10n, { method: 'item', people: 3, items: [{ amountMinor: 10n, people: [2, 1] }] })).toEqual([
      0n,
      5n,
      5n,
    ]);
    const single = (person: number) => ({ amountMinor: 1n, people: [person] });
    expect(splitBill(5n, { method: 'item', people: 3, items: [single(0), single(1), single(2)] })).toEqual([
      2n,
      2n,
      1n,
    ]);
    expect(
      splitBill(100n, { method: 'item', people: 2, items: [single(0), { amountMinor: 0n, people: [1] }] }),
    ).toEqual([100n, 0n]);
  });

  it.each([
    ['a non-positive total', 0n, { method: 'equal', people: 2 }],
    ['one person', 100n, { method: 'equal', people: 1 }],
    ['a fractional head count', 100n, { method: 'equal', people: 2.5 }],
    ['amounts that do not match', 100n, { method: 'amount', amountsMinor: [50n, 49n] }],
    ['a negative amount', 100n, { method: 'amount', amountsMinor: [101n, -1n] }],
    ['a single amount', 100n, { method: 'amount', amountsMinor: [100n] }],
    ['percentages not adding to 100%', 100n, { method: 'percent', bps: [5000, 4999] }],
    ['a negative percentage', 100n, { method: 'percent', bps: [10_001, -1] }],
    ['a fractional percentage', 100n, { method: 'percent', bps: [4999.5, 5000.5] }],
    ['a single percentage', 100n, { method: 'percent', bps: [10_000] }],
    ['an item without people', 100n, { method: 'item', people: 2, items: [{ amountMinor: 100n, people: [] }] }],
    [
      'an item for an unknown person',
      100n,
      { method: 'item', people: 2, items: [{ amountMinor: 100n, people: [0, 2] }] },
    ],
    ['a negative person', 100n, { method: 'item', people: 2, items: [{ amountMinor: 100n, people: [-1] }] }],
    ['a fractional person', 100n, { method: 'item', people: 2, items: [{ amountMinor: 100n, people: [0.5] }] }],
    ['a person twice', 100n, { method: 'item', people: 2, items: [{ amountMinor: 100n, people: [0, 0] }] }],
    [
      'a negative item',
      100n,
      {
        method: 'item',
        people: 2,
        items: [
          { amountMinor: 100n, people: [0] },
          { amountMinor: -1n, people: [1] },
        ],
      },
    ],
    ['only free items', 100n, { method: 'item', people: 2, items: [{ amountMinor: 0n, people: [0] }] }],
    ['no items', 100n, { method: 'item', people: 2, items: [] }],
    ['one person for items', 100n, { method: 'item', people: 1, items: [{ amountMinor: 100n, people: [0] }] }],
  ] as const)('refuses %s', (_, total, input) => {
    expectReceivableError(() => splitBill(total, input), 'split');
  });

  it('property: every method adds up exactly to the total', () => {
    const people = fc.integer({ min: 2, max: 8 });
    fc.assert(
      fc.property(
        fc.bigInt({ min: 1n, max: 10n ** 12n }),
        people,
        fc.array(fc.integer({ min: 0, max: 1000 }), { minLength: 2, maxLength: 8 }),
        fc.array(
          fc.record({ amountMinor: fc.bigInt({ min: 0n, max: 10n ** 9n }), share: fc.integer({ min: 1, max: 255 }) }),
          { minLength: 1, maxLength: 6 },
        ),
        (total, count, weights, rawItems) => {
          const sum = (parts: readonly bigint[]) => parts.reduce((acc, part) => acc + part, 0n);
          const equal = splitBill(total, { method: 'equal', people: count });
          expect(equal).toHaveLength(count);
          expect(sum(equal)).toBe(total);

          const weightTotal = weights.reduce((acc, weight) => acc + weight, 0);
          fc.pre(weightTotal > 0);
          const bps = weights.map((weight) => Math.floor((weight * 10_000) / weightTotal));
          bps[0] = (bps[0] as number) + 10_000 - bps.reduce((acc, value) => acc + value, 0);
          const percent = splitBill(total, { method: 'percent', bps });
          expect(sum(percent)).toBe(total);
          percent.forEach((share, index) => {
            const exact = (total * BigInt(bps[index] as number)) / 10_000n;
            expect(share - exact).toBeGreaterThanOrEqual(0n);
            expect(share - exact).toBeLessThanOrEqual(1n);
          });

          const items = rawItems.map(({ amountMinor, share }) => ({
            amountMinor,
            people: Array.from({ length: count }, (_, index) => index).filter((index) => (share >> index) & 1),
          }));
          fc.pre(items.every((item) => item.people.length > 0) && sum(items.map((item) => item.amountMinor)) > 0n);
          const byItem = splitBill(total, { method: 'item', people: count, items });
          expect(byItem).toHaveLength(count);
          expect(sum(byItem)).toBe(total);
          for (const share of byItem) expect(share).toBeGreaterThanOrEqual(0n);
        },
      ),
    );
  });
});
