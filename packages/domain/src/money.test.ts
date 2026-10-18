// SPDX-License-Identifier: AGPL-3.0-only
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { MINUS, currencyInfo, formatMoney, parseMoneyInput, type Locale, type MoneyContext } from './money.ts';

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
    [0n, 'IDR', 'id', 'delta', '+0'],
    [0n, 'IDR', 'id', 'amount', 'Rp0'],
    [69_010n, 'USD', 'id', 'amount', 'US$690,10'],
    [69_010n, 'USD', 'en', 'amount', 'US$690.10'],
    [5n, 'USD', 'en', 'table', '0.05'],
    [375_657n, 'USD', 'en', 'amount', 'US$3,756.57'],
    [1_000n, 'JPY', 'en', 'amount', 'JPY 1,000'],
  ])('%s %s %s %s → %s', (minor, currency, locale, context, expected) => {
    expect(formatMoney(minor, currency, { locale, context })).toBe(expected);
  });

  it('never uses a hyphen-minus for negatives', () => {
    expect(formatMoney(-1n, 'IDR', { locale: 'id', context: 'amount' })).not.toContain('-');
  });
});

describe('formatMoney — privacy mode', () => {
  it('masks digits and sign in every context but keeps the currency symbol for amounts', () => {
    expect(formatMoney(55_023_000n, 'IDR', { locale: 'id', context: 'amount', privacy: true })).toBe('Rp••••••');
    expect(formatMoney(-55_023_000n, 'IDR', { locale: 'en', context: 'amount', privacy: true })).toBe('Rp••••••');
    expect(formatMoney(-28_000n, 'IDR', { locale: 'id', context: 'table', privacy: true })).toBe('••••••');
    expect(formatMoney(9_500_000n, 'IDR', { locale: 'id', context: 'delta', privacy: true })).toBe('••••••');
    expect(formatMoney(-9_500_000n, 'USD', { locale: 'id', context: 'delta', privacy: true })).toBe('••••••');
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
