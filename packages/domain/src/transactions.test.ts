// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { MissingRateError, type FxRate } from './fx.ts';
import { accountBalance } from './ledger.ts';
import {
  assertSplit,
  expensePostings,
  incomePostings,
  NonPositiveAmountError,
  SameAccountTransferError,
  SplitMismatchError,
  splitRemainder,
  toBase,
  transferPostings,
} from './transactions.ts';

const BCA = { id: 'bca', currency: 'IDR' };
const JAGO = { id: 'jago', currency: 'IDR' };
const GOTRADE = { id: 'gotrade', currency: 'USD' };
const IDR = { baseCurrency: 'IDR', rates: [] };
const USD_IDR: FxRate = { base: 'USD', quote: 'IDR', rate: '16350.0275' };

describe('expense and income postings', () => {
  it('posts −amount / +amount to the account in the base currency', () => {
    expect(expensePostings({ ...IDR, account: BCA, amountMinor: 85_000n })).toEqual([
      {
        accountId: 'bca',
        amountMinor: -85_000n,
        currency: 'IDR',
        fxRateToBase: null,
        amountBaseMinor: -85_000n,
        role: 'principal',
        categoryId: null,
      },
    ]);
    expect(incomePostings({ ...IDR, account: BCA, amountMinor: 18_500_000n })[0]).toMatchObject({
      amountMinor: 18_500_000n,
      amountBaseMinor: 18_500_000n,
    });
  });

  it('values foreign amounts in the base currency', () => {
    const [posting] = incomePostings({
      baseCurrency: 'IDR',
      rates: [{ base: 'USD', quote: 'IDR', rate: '16350' }],
      account: GOTRADE,
      amountMinor: 688n,
    });
    expect(posting).toMatchObject({ amountMinor: 688n, fxRateToBase: '16350', amountBaseMinor: 112_488n });
    expect(() => expensePostings({ ...IDR, account: GOTRADE, amountMinor: 1n })).toThrow(MissingRateError);
  });

  it('requires a positive amount (FR-T8)', () => {
    expect(() => expensePostings({ ...IDR, account: BCA, amountMinor: 0n })).toThrow(NonPositiveAmountError);
    expect(() => incomePostings({ ...IDR, account: BCA, amountMinor: -1n })).toThrow(NonPositiveAmountError);
  });
});

describe('transferPostings', () => {
  it('moves money between same-currency accounts, with the fee as a separate expense posting', () => {
    const { postings, fxDifference } = transferPostings({
      ...IDR,
      from: BCA,
      to: JAGO,
      sentMinor: 500_000n,
      receivedMinor: 500_000n,
      fee: { minor: 2_500n, categoryId: 'bank-fee' },
      fxDifferenceCategoryId: 'fx',
    });
    expect(fxDifference).toBeNull();
    expect(postings.map((p) => [p.accountId, p.role, p.amountMinor, p.categoryId])).toEqual([
      ['bca', 'principal', -500_000n, null],
      ['jago', 'principal', 500_000n, null],
      ['bca', 'fee', -2_500n, 'bank-fee'],
    ]);
  });

  it('records the design IDR → USD transfer with the FX difference to "Selisih kurs" (−Rp22.660)', () => {
    const { postings, fxDifference } = transferPostings({
      ...IDR,
      from: BCA,
      to: GOTRADE,
      sentMinor: 3_000_000n,
      receivedMinor: 18_210n,
      reference: USD_IDR,
      fxDifferenceCategoryId: 'fx',
    });
    expect(fxDifference?.differenceBaseMinor).toBe(-22_660n);
    expect(postings).toEqual([
      {
        accountId: 'bca',
        amountMinor: -3_000_000n,
        currency: 'IDR',
        fxRateToBase: null,
        amountBaseMinor: -3_000_000n,
        role: 'principal',
        categoryId: null,
      },
      {
        accountId: 'gotrade',
        amountMinor: 18_210n,
        currency: 'USD',
        fxRateToBase: '16350.0275',
        amountBaseMinor: 2_977_340n,
        role: 'principal',
        categoryId: null,
      },
      {
        accountId: 'gotrade',
        amountMinor: 0n,
        currency: 'USD',
        fxRateToBase: null,
        amountBaseMinor: -22_660n,
        role: 'fx_diff',
        categoryId: 'fx',
      },
    ]);
    // The FX difference moves no money: balances are BCA 42.810.000 → 39.810.000 and Gotrade +US$182,10.
    const amountsOf = (id: string) => postings.filter((p) => p.accountId === id).map((p) => p.amountMinor);
    expect(accountBalance(42_810_000n, amountsOf('bca'), [])).toBe(39_810_000n);
    expect(accountBalance(5_200n, amountsOf('gotrade'), [])).toBe(23_410n);
  });

  it('adds no fx_diff posting when the received amount matches the rate', () => {
    const { postings, fxDifference } = transferPostings({
      ...IDR,
      from: BCA,
      to: GOTRADE,
      sentMinor: 6_000_000n,
      receivedMinor: 36_697n,
      reference: { base: 'USD', quote: 'IDR', rate: '16350' },
      fxDifferenceCategoryId: 'fx',
    });
    expect(fxDifference?.differenceBaseMinor).toBe(0n);
    expect(postings.map((p) => p.role)).toEqual(['principal', 'principal']);
  });

  it('values the difference with a rate to the base currency when neither leg is in it', () => {
    const sgd = { id: 'dbs', currency: 'SGD' };
    const { postings } = transferPostings({
      baseCurrency: 'IDR',
      rates: [
        { base: 'SGD', quote: 'IDR', rate: '12500' },
        { base: 'USD', quote: 'IDR', rate: '16350' },
      ],
      from: GOTRADE,
      to: sgd,
      sentMinor: 10_000n,
      receivedMinor: 13_000n,
      reference: { base: 'USD', quote: 'SGD', rate: '1.35' },
      fxDifferenceCategoryId: 'fx',
    });
    expect(postings.at(-1)).toMatchObject({ role: 'fx_diff', amountBaseMinor: -62_500n });
  });

  it('validates accounts, amounts, and rates (FR-T8)', () => {
    const base = { ...IDR, from: BCA, to: JAGO, sentMinor: 1n, receivedMinor: 1n, fxDifferenceCategoryId: 'fx' };
    expect(() => transferPostings({ ...base, to: BCA })).toThrow(SameAccountTransferError);
    expect(() => transferPostings({ ...base, sentMinor: 0n })).toThrow(NonPositiveAmountError);
    expect(() => transferPostings({ ...base, receivedMinor: 0n })).toThrow(NonPositiveAmountError);
    expect(() => transferPostings({ ...base, fee: { minor: 0n, categoryId: 'f' } })).toThrow(NonPositiveAmountError);
    expect(() => transferPostings({ ...base, receivedMinor: 2n })).toThrow(RangeError);
    expect(() => transferPostings({ ...base, to: GOTRADE })).toThrow(MissingRateError);
  });
});

describe('splits (FR-L5)', () => {
  it('reports the remainder and accepts exact splits', () => {
    expect(splitRemainder(450_000n, [300_000n, 100_000n])).toBe(50_000n);
    expect(() => {
      assertSplit(450_000n, [300_000n, 150_000n]);
    }).not.toThrow();
  });

  it('rejects fewer than two parts, non-positive parts, and mismatches', () => {
    expect(() => {
      assertSplit(1n, [1n]);
    }).toThrow(RangeError);
    expect(() => {
      assertSplit(1n, [2n, -1n]);
    }).toThrow(NonPositiveAmountError);
    expect(() => {
      assertSplit(10n, [3n, 3n]);
    }).toThrow(expect.objectContaining({ remainingMinor: 4n }) as Error);
    expect(() => {
      assertSplit(10n, [3n, 3n]);
    }).toThrow(SplitMismatchError);
  });
});

describe('toBase', () => {
  it('values an amount like a posting would', () => {
    expect(toBase({ minor: 277_800n, currency: 'USD' }, { baseCurrency: 'IDR', rates: [USD_IDR] })).toBe(45_420_376n);
    expect(toBase({ minor: 5n, currency: 'IDR' }, IDR)).toBe(5n);
  });
});
