// SPDX-License-Identifier: AGPL-3.0-only
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  NegativeAmountError,
  accountBalance,
  availableBalance,
  netWorth,
  type AvailableBalanceAccount,
} from './ledger.ts';

/**
 * Seed "Avtara", 15 Okt 2026 (design Section 05 `ycP7T`, Section 00 `mSYon`).
 * Investment platforms are not counted in the available balance; Gotrade is shown
 * as US$2.778,00 at Rp16.350, i.e. Rp45.420.000 in the design.
 */
const SEED_ACCOUNTS = [
  { name: 'BCA Tahapan', includeInAvailable: true, balanceBaseMinor: 42_810_000n },
  { name: 'Bank Jago', includeInAvailable: true, balanceBaseMinor: 8_125_000n },
  { name: 'Mandiri', includeInAvailable: true, balanceBaseMinor: 3_240_000n },
  { name: 'GoPay', includeInAvailable: true, balanceBaseMinor: 412_000n },
  { name: 'OVO', includeInAvailable: true, balanceBaseMinor: 86_000n },
  { name: 'Dompet (tunai)', includeInAvailable: true, balanceBaseMinor: 350_000n },
  { name: 'Gotrade', includeInAvailable: false, balanceBaseMinor: 45_420_000n },
  { name: 'Indodax', includeInAvailable: false, balanceBaseMinor: 5_500_000n },
  { name: 'Stockbit', includeInAvailable: false, balanceBaseMinor: 4_300_000n },
  { name: 'Pluang', includeInAvailable: false, balanceBaseMinor: 3_700_000n },
  { name: 'Bibit', includeInAvailable: false, balanceBaseMinor: 2_500_000n },
] as const satisfies readonly (AvailableBalanceAccount & { name: string })[];

const SEED_INVESTMENTS = SEED_ACCOUNTS.filter((account) => !account.includeInAvailable).reduce(
  (total, account) => total + account.balanceBaseMinor,
  0n,
);

describe('accountBalance (opening + Σ confirmed postings + Σ adjustments)', () => {
  it('adds postings and adjustments to the opening balance', () => {
    expect(accountBalance(40_000_000n, [18_500_000n, -6_000_000n, -9_690_000n], [0n])).toBe(42_810_000n);
    expect(accountBalance(500_000n, [-100_000n], [-50_000n, 36_000n])).toBe(386_000n);
  });

  it('is the opening balance when nothing was posted', () => {
    expect(accountBalance(350_000n, [], [])).toBe(350_000n);
  });

  it('equals the plain sum of all inputs', () => {
    fc.assert(
      fc.property(fc.bigInt(), fc.array(fc.bigInt()), fc.array(fc.bigInt()), (opening, postings, adjustments) => {
        const expected = [...postings, ...adjustments].reduce((total, amount) => total + amount, opening);
        expect(accountBalance(opening, postings, adjustments)).toBe(expected);
      }),
    );
  });
});

describe('availableBalance', () => {
  it('golden: seed available balance is Rp55.023.000 (investment platforms excluded)', () => {
    expect(availableBalance(SEED_ACCOUNTS)).toBe(55_023_000n);
  });

  it('is zero without included accounts', () => {
    expect(availableBalance([])).toBe(0n);
    expect(availableBalance([{ includeInAvailable: false, balanceBaseMinor: 5_000n }])).toBe(0n);
  });

  it('keeps negative balances of included accounts', () => {
    expect(
      availableBalance([
        { includeInAvailable: true, balanceBaseMinor: 1_000n },
        { includeInAvailable: true, balanceBaseMinor: -300n },
      ]),
    ).toBe(700n);
  });
});

describe('netWorth (available + investments + receivables − remaining debt)', () => {
  it('golden: seed net worth is Rp116.443.000 (investments Rp61.420.000, no debt, no receivables)', () => {
    expect(SEED_INVESTMENTS).toBe(61_420_000n);
    expect(
      netWorth({
        available: availableBalance(SEED_ACCOUNTS),
        investments: SEED_INVESTMENTS,
        receivablesOutstanding: 0n,
        debtRemaining: 0n,
      }),
    ).toBe(116_443_000n);
  });

  it('Section 19: receivables Rp542.500 count toward net worth, and lending Bima Rp500.000 from BCA keeps it unchanged', () => {
    const before = {
      available: availableBalance(SEED_ACCOUNTS),
      investments: SEED_INVESTMENTS,
      receivablesOutstanding: 542_500n,
      debtRemaining: 0n,
    };
    const lent = SEED_ACCOUNTS.map((account) =>
      account.name === 'BCA Tahapan' ? { ...account, balanceBaseMinor: account.balanceBaseMinor - 500_000n } : account,
    );
    const after = { ...before, available: availableBalance(lent), receivablesOutstanding: 1_042_500n };

    expect(netWorth(before)).toBe(116_985_500n);
    expect(after.available).toBe(54_523_000n);
    expect(netWorth(after)).toBe(netWorth(before));
  });

  it('subtracts remaining debt', () => {
    expect(netWorth({ available: 1_000n, investments: 200n, receivablesOutstanding: 30n, debtRemaining: 4n })).toBe(
      1_226n,
    );
    expect(netWorth({ available: -500n, investments: 0n, receivablesOutstanding: 0n, debtRemaining: 100n })).toBe(
      -600n,
    );
  });

  it.each(['investments', 'receivablesOutstanding', 'debtRemaining'] as const)('rejects negative %s', (field) => {
    const input = { available: 0n, investments: 0n, receivablesOutstanding: 0n, debtRemaining: 0n, [field]: -1n };
    expect(() => netWorth(input)).toThrow(NegativeAmountError);
    expect(() => netWorth(input)).toThrow(`${field} must not be negative: -1`);
  });

  it('accepts zero for every non-negative component', () => {
    expect(netWorth({ available: 0n, investments: 0n, receivablesOutstanding: 0n, debtRemaining: 0n })).toBe(0n);
  });

  it('names its error', () => {
    const error = new NegativeAmountError('debtRemaining', -1n);
    expect(error).toBeInstanceOf(RangeError);
    expect(error.name).toBe('NegativeAmountError');
  });
});
