// SPDX-License-Identifier: AGPL-3.0-only
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  MINUS,
  currencyInfo,
  divideCeil,
  divideHalfUp,
  formatMoney,
  groupAmountInput,
  parseMoneyInput,
  splitByBps,
  splitEvenly,
  type Locale,
  type MoneyContext,
} from './money.ts';

describe('currencyInfo', () => {
  it('returns the design symbols for known currencies, case-insensitively', () => {
    expect(currencyInfo('idr')).toEqual({ code: 'IDR', symbol: 'Rp', minorDigits: 0 });
    expect(currencyInfo('USD')).toEqual({ code: 'USD', symbol: 'US$', minorDigits: 2 });
    expect(currencyInfo('SGD')).toEqual({ code: 'SGD', symbol: 'S$', minorDigits: 2 });
    expect(currencyInfo('EUR')).toEqual({ code: 'EUR', symbol: '€', minorDigits: 2 });
  });

  it('derives minor digits from Intl for other ISO codes', () => {
    expect(currencyInfo('JPY')).toEqual({ code: 'JPY', symbol: 'JPY ', minorDigits: 0 });
    expect(currencyInfo('KWD').minorDigits).toBe(3);
  });

  it('rejects codes that are not three letters', () => {
    expect(() => currencyInfo('RUPIAH')).toThrow(RangeError);
    expect(() => currencyInfo('USDX')).toThrow(/^Invalid currency code: USDX$/);
    expect(() => currencyInfo('XUSD')).toThrow(/^Invalid currency code: XUSD$/);
    expect(() => currencyInfo('U5D')).toThrow('Invalid currency code: U5D');
  });
});

describe('formatMoney — golden values from the design (PRD §7.1)', () => {
  it.each<[bigint, string, Locale, MoneyContext, string]>([
    [42_810_000n, 'IDR', 'id', 'table', '42.810.000'],
    [42_810_000n, 'IDR', 'en', 'table', '42,810,000'],
    [-28_000n, 'IDR', 'id', 'table', `${MINUS}28.000`],
    [55_023_000n, 'IDR', 'id', 'amount', 'Rp55.023.000'],
    [55_023_000n, 'IDR', 'en', 'amount', 'Rp55,023,000'],
    [-16_500_000n, 'IDR', 'id', 'amount', `${MINUS}Rp16.500.000`],
    [9_500_000n, 'IDR', 'id', 'delta', '+9.500.000'],
    [-2_277_000n, 'IDR', 'id', 'delta', `${MINUS}2.277.000`],
    [-2_277_000n, 'IDR', 'en', 'delta', `${MINUS}2,277,000`],
    [0n, 'IDR', 'id', 'delta', '0'],
    [0n, 'IDR', 'id', 'amount', 'Rp0'],
    [69_010n, 'USD', 'id', 'amount', 'US$690,10'],
    [69_010n, 'USD', 'en', 'amount', 'US$690.10'],
    [5n, 'USD', 'en', 'table', '0.05'],
    [375_657n, 'USD', 'en', 'amount', 'US$3,756.57'],
    [1_000n, 'JPY', 'en', 'amount', 'JPY 1,000'],
    [1_610_000n, 'IDR', 'id', 'signed', '+Rp1.610.000'],
    [-45_000n, 'IDR', 'id', 'signed', `${MINUS}Rp45.000`],
    [12_844n, 'USD', 'id', 'signed', '+US$128,44'],
    [-12_844n, 'USD', 'en', 'signed', `${MINUS}US$128.44`],
    [-1n, 'IDR', 'id', 'signed', `${MINUS}Rp1`],
    [0n, 'IDR', 'id', 'signed', 'Rp0'],
    [1_000n, 'JPY', 'en', 'signed', '+JPY 1,000'],
  ])('%s %s %s %s → %s', (minor, currency, locale, context, expected) => {
    expect(formatMoney(minor, currency, { locale, context })).toBe(expected);
  });

  it('never uses a hyphen-minus for negatives', () => {
    expect(formatMoney(-1n, 'IDR', { locale: 'id', context: 'amount' })).not.toContain('-');
  });
});

describe('formatMoney — privacy mode', () => {
  it('masks digits and sign in every context but keeps the currency symbol for amounts and signed values', () => {
    expect(formatMoney(55_023_000n, 'IDR', { locale: 'id', context: 'amount', privacy: true })).toBe('Rp••••••');
    expect(formatMoney(-55_023_000n, 'IDR', { locale: 'en', context: 'amount', privacy: true })).toBe('Rp••••••');
    expect(formatMoney(-28_000n, 'IDR', { locale: 'id', context: 'table', privacy: true })).toBe('••••••');
    expect(formatMoney(9_500_000n, 'IDR', { locale: 'id', context: 'delta', privacy: true })).toBe('••••••');
    expect(formatMoney(-9_500_000n, 'USD', { locale: 'id', context: 'delta', privacy: true })).toBe('••••••');
    expect(formatMoney(12_844n, 'USD', { locale: 'id', context: 'signed', privacy: true })).toBe('US$••••••');
    expect(formatMoney(-45_000n, 'IDR', { locale: 'id', context: 'signed', privacy: true })).toBe('Rp••••••');
  });

  it('does not leak the magnitude through the mask length', () => {
    const small = formatMoney(1n, 'IDR', { locale: 'id', context: 'amount', privacy: true });
    const large = formatMoney(999_999_999_999n, 'IDR', { locale: 'id', context: 'amount', privacy: true });
    expect(small).toBe(large);
  });
});

describe('parseMoneyInput', () => {
  it.each<[string, Locale, string, bigint]>([
    ['50000', 'id', 'IDR', 50_000n],
    ['Rp 1.234.567', 'id', 'IDR', 1_234_567n],
    ['rp1.234.567', 'id', 'IDR', 1_234_567n],
    ['IDR 5000', 'en', 'IDR', 5_000n],
    ['1.500', 'id', 'IDR', 1_500n],
    ['25rb', 'id', 'IDR', 25_000n],
    ['25 ribu', 'id', 'IDR', 25_000n],
    ['25k', 'id', 'IDR', 25_000n],
    ['1,5jt', 'id', 'IDR', 1_500_000n],
    ['1.5jt', 'id', 'IDR', 1_500_000n],
    ['2 juta', 'id', 'IDR', 2_000_000n],
    ['1,25m', 'id', 'IDR', 1_250_000_000n],
    ['3 miliar', 'id', 'IDR', 3_000_000_000n],
    ['25k', 'en', 'IDR', 25_000n],
    ['1.5m', 'en', 'IDR', 1_500_000n],
    ['1,5m', 'en', 'IDR', 1_500_000n],
    ['2mn', 'en', 'IDR', 2_000_000n],
    ['2bn', 'en', 'IDR', 2_000_000_000n],
    ['1b', 'en', 'IDR', 1_000_000_000n],
    ['1,234,567', 'en', 'IDR', 1_234_567n],
    ['US$1,234.56', 'en', 'USD', 123_456n],
    ['12,30', 'id', 'USD', 1_230n],
    ['1,2300', 'id', 'USD', 123n],
    ['0,05', 'id', 'USD', 5n],
    ['-50.000', 'id', 'IDR', -50_000n],
    [`${MINUS}50.000`, 'id', 'IDR', -50_000n],
    ['  7  ', 'en', 'IDR', 7n],
    ['25RB', 'id', 'IDR', 25_000n],
    ['RP\t2.500', 'id', 'IDR', 2_500n],
    ['S$12.50', 'en', 'SGD', 1_250n],
    ['jpy 1,000', 'en', 'JPY', 1_000n],
  ])('%s (%s, %s) → %s', (input, locale, currency, expected) => {
    expect(parseMoneyInput(input, { locale, currency })).toBe(expected);
  });

  it.each<[string, Locale, string]>([
    ['', 'id', 'IDR'],
    ['abc', 'id', 'IDR'],
    ['1x', 'id', 'IDR'],
    ['2bn', 'id', 'IDR'],
    ['2jt', 'en', 'IDR'],
    ['1.2.3', 'id', 'IDR'],
    ['1.234.567,89', 'id', 'IDR'],
    ['1.500', 'en', 'IDR'],
    ['50000!', 'id', 'IDR'],
    ['50.000.', 'id', 'IDR'],
    ['1a500', 'id', 'IDR'],
    ['1,5', 'id', 'IDR'],
    ['1,05', 'id', 'IDR'],
    ['1,2345', 'id', 'USD'],
    ['1,2,3', 'id', 'IDR'],
    ['--5', 'id', 'IDR'],
  ])('rejects %s (%s, %s)', (input, locale, currency) => {
    expect(parseMoneyInput(input, { locale, currency })).toBeNull();
  });

  it('round-trips every formatted amount and table value', () => {
    const locales: Locale[] = ['id', 'en'];
    fc.assert(
      fc.property(
        fc.bigInt({ min: -(10n ** 15n), max: 10n ** 15n }),
        fc.constantFrom('IDR', 'USD'),
        fc.constantFrom(...locales),
        fc.constantFrom<MoneyContext>('table', 'amount'),
        (minor, currency, locale, context) => {
          const text = formatMoney(minor, currency, { locale, context });
          expect(parseMoneyInput(text, { locale, currency })).toBe(minor);
        },
      ),
    );
  });
});

describe('groupAmountInput', () => {
  const idr = { locale: 'id', currency: 'IDR' } as const;
  const at = (text: string, caret = text.length, options: { locale: Locale; currency: string } = idr) =>
    groupAmountInput(text, caret, options);

  it('groups plain digits as they are typed, keeping the caret at the end', () => {
    expect(at('213123123')).toEqual({ text: '213.123.123', caret: 11 });
    expect(at('2131')).toEqual({ text: '2.131', caret: 5 });
    expect(at('213')).toEqual({ text: '213', caret: 3 });
    expect(at('2131', 4, { locale: 'en', currency: 'IDR' })).toEqual({ text: '2,131', caret: 5 });
  });

  it('regroups when a digit lands in a group or one is deleted, and drops leading zeros', () => {
    expect(at('2.1312')).toEqual({ text: '21.312', caret: 6 });
    expect(at('2.13')).toEqual({ text: '213', caret: 3 });
    expect(at('05')).toEqual({ text: '5', caret: 1 });
    expect(at('0')).toEqual({ text: '0', caret: 1 });
    expect(at('000')).toEqual({ text: '0', caret: 1 });
  });

  it('keeps the caret after the same digits in the middle of the text', () => {
    // "21|31" → "2.1|31": the two digits after the caret stay after it.
    expect(at('2131', 2)).toEqual({ text: '2.131', caret: 3 });
    // "1.|0000.000" (a digit typed into a group): still right after the "1".
    expect(at('1.0000.000', 2)).toEqual({ text: '10.000.000', caret: 1 });
    expect(at('2131', 0)).toEqual({ text: '2.131', caret: 0 });
    expect(at('05', 1)).toEqual({ text: '5', caret: 0 });
  });

  it('keeps one decimal part for currencies with decimals, up to their minor digits', () => {
    const usd = { locale: 'id', currency: 'USD' } as const;
    expect(at('1234,5', 6, usd)).toEqual({ text: '1.234,5', caret: 7 });
    expect(at('1234,', 5, usd)).toEqual({ text: '1.234,', caret: 6 });
    expect(at('1234.56', 4, { locale: 'en', currency: 'USD' })).toEqual({ text: '1,234.56', caret: 5 });
    expect(at('1234,567', 8, usd)).toBeNull();
    expect(at('1,2,3', 5, usd)).toBeNull();
    expect(at('1,5x', 4, usd)).toBeNull();
  });

  it('leaves shorthands, signs, symbols, and empty text as typed', () => {
    for (const text of ['25rb', '1,5', '1,5jt', '-5', 'Rp5', ' 25', '', ',5', '.']) {
      expect(at(text)).toBeNull();
    }
  });

  it('always produces what parseMoneyInput reads as the same digits', () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[0-9.]{1,15}$/), fc.constantFrom<Locale>('id', 'en'), (typed, locale) => {
        const text = locale === 'id' ? typed : typed.replaceAll('.', ',');
        const result = groupAmountInput(text, text.length, { locale, currency: 'IDR' });
        const digits = text.replace(/\D/g, '');
        if (digits === '') {
          expect(result).toBeNull();
          return;
        }
        expect(parseMoneyInput(result?.text ?? '', { locale, currency: 'IDR' })).toBe(BigInt(digits));
        expect(result?.caret).toBe(result?.text.length);
      }),
    );
  });
});

describe('bigint division helpers', () => {
  it('divideHalfUp rounds halves up', () => {
    expect(divideHalfUp(5n, 2n)).toBe(3n);
    expect(divideHalfUp(7n, 3n)).toBe(2n);
    expect(divideHalfUp(8n, 3n)).toBe(3n);
    expect(divideHalfUp(6n, 3n)).toBe(2n);
    expect(divideHalfUp(0n, 7n)).toBe(0n);
  });

  it('divideCeil rounds up', () => {
    expect(divideCeil(42_875_000n, 3_500_000n)).toBe(13n);
    expect(divideCeil(7_000_000n, 3_500_000n)).toBe(2n);
    expect(divideCeil(1n, 3n)).toBe(1n);
    expect(divideCeil(0n, 3n)).toBe(0n);
  });

  it('splitEvenly puts the rounding remainder in the first part (FR-U3)', () => {
    expect(splitEvenly(1_000_000n, 3)).toEqual([333_334n, 333_333n, 333_333n]);
    expect(splitEvenly(485_000n, 2)).toEqual([242_500n, 242_500n]);
    expect(splitEvenly(5n, 1)).toEqual([5n]);
    expect(splitEvenly(2n, 3)).toEqual([2n, 0n, 0n]);
  });

  it('splitEvenly parts add up and differ by less than the count', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: 10n ** 15n }), fc.integer({ min: 1, max: 600 }), (total, count) => {
        const parts = splitEvenly(total, count);
        expect(parts).toHaveLength(count);
        expect(parts.reduce((sum, part) => sum + part, 0n)).toBe(total);
        const [first, ...rest] = parts as [bigint, ...bigint[]];
        for (const part of rest) expect(part).toBe(total / BigInt(count));
        expect(first - total / BigInt(count)).toBeLessThan(BigInt(count));
      }),
    );
  });

  it('splitByBps gives the largest remainders the leftover units, ties to the earlier weight', () => {
    expect(splitByBps(13_500_000n, [6000, 4000, 0])).toEqual([8_100_000n, 5_400_000n, 0n]);
    expect(splitByBps(203_000n, [6000, 4000])).toEqual([121_800n, 81_200n]);
    expect(splitByBps(-530_000n, [6000, 4000])).toEqual([-318_000n, -212_000n]);
    // 10 × 3333/3333/3334 = 3,333 / 3,333 / 3,334: the third has the largest remainder.
    expect(splitByBps(10n, [3333, 3333, 3334])).toEqual([3n, 3n, 4n]);
    expect(splitByBps(1n, [5000, 5000])).toEqual([1n, 0n]);
    expect(splitByBps(-1n, [5000, 5000])).toEqual([-1n, 0n]);
    expect(splitByBps(2n, [2500, 2500, 5000])).toEqual([1n, 0n, 1n]);
    expect(splitByBps(3n, [3000, 3500, 3500])).toEqual([1n, 1n, 1n]);
    expect(splitByBps(0n, [10_000])).toEqual([0n]);
  });

  it('splitByBps parts add up and stay within one unit of the exact share', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: -(10n ** 15n), max: 10n ** 15n }),
        fc.array(fc.integer({ min: 0, max: 10_000 }), { minLength: 1, maxLength: 12 }),
        (total, raw) => {
          const sum = raw.reduce((a, b) => a + b, 0);
          fc.pre(sum > 0);
          // Scale the weights to Σ 10 000 with the remainder on the first one.
          const weights = raw.map((weight) => Math.floor((weight * 10_000) / sum));
          weights[0] = (weights[0] as number) + 10_000 - weights.reduce((a, b) => a + b, 0);
          const parts = splitByBps(total, weights);
          expect(parts.reduce((a, b) => a + b, 0n)).toBe(total);
          parts.forEach((part, index) => {
            const exact = total * BigInt(weights[index] as number);
            const difference = part * 10_000n - exact;
            expect(difference < 0n ? -difference : difference).toBeLessThan(10_000n);
          });
        },
      ),
    );
  });
});
