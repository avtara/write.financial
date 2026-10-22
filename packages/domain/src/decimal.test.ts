// SPDX-License-Identifier: AGPL-3.0-only
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  DECIMAL_DIGITS,
  DECIMAL_SCALE,
  InvalidDecimalError,
  divideFloor,
  divideRound,
  formatDecimal,
  parseDecimal,
  roundDecimal,
} from './decimal.ts';

describe('parseDecimal / formatDecimal', () => {
  it('scales by 10^18 exactly', () => {
    expect(DECIMAL_DIGITS).toBe(18);
    expect(DECIMAL_SCALE).toBe(10n ** 18n);
    expect(parseDecimal('1.197')).toBe(1_197_000_000_000_000_000n);
    expect(parseDecimal('0.000000000000000001')).toBe(1n);
    expect(parseDecimal('-0.5')).toBe(-500_000_000_000_000_000n);
    expect(parseDecimal('690.10')).toBe(690_100_000_000_000_000_000n);
    expect(parseDecimal('12345678901234567890')).toBe(12345678901234567890n * DECIMAL_SCALE);
    expect(parseDecimal('0')).toBe(0n);
  });

  it('rejects anything that is not a plain decimal with at most 18 fraction digits', () => {
    for (const bad of [
      '',
      '1.',
      '.5',
      '1,5',
      '+1',
      '1e3',
      ' 1',
      '1 ',
      '0.0000000000000000001',
      '123456789012345678901',
      'abc',
      '--1',
    ]) {
      expect(() => parseDecimal(bad)).toThrow(InvalidDecimalError);
    }
    const error = (() => {
      try {
        parseDecimal('x');
      } catch (caught) {
        return caught as InvalidDecimalError;
      }
      return null;
    })();
    expect(error).toBeInstanceOf(RangeError);
    expect(error?.name).toBe('InvalidDecimalError');
    expect(error?.message).toBe('Not a decimal with at most 18 fraction digits: x');
  });

  it('formats canonically without trailing zeros', () => {
    expect(formatDecimal(parseDecimal('690.10'))).toBe('690.1');
    expect(formatDecimal(parseDecimal('1.000'))).toBe('1');
    expect(formatDecimal(0n)).toBe('0');
    expect(formatDecimal(-1n)).toBe('-0.000000000000000001');
    expect(formatDecimal(parseDecimal('-12.5'))).toBe('-12.5');
    expect(formatDecimal(parseDecimal('0.0725'))).toBe('0.0725');
  });

  it('property: format ∘ parse is the identity on scaled values', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: -(10n ** 37n), max: 10n ** 37n }), (scaled) => {
        expect(parseDecimal(formatDecimal(scaled))).toBe(scaled);
      }),
    );
  });
});

describe('rounding', () => {
  it('divideRound rounds half away from zero', () => {
    expect(divideRound(5n, 2n)).toBe(3n);
    expect(divideRound(-5n, 2n)).toBe(-3n);
    expect(divideRound(4n, 3n)).toBe(1n);
    expect(divideRound(-4n, 3n)).toBe(-1n);
    expect(divideRound(5n, 3n)).toBe(2n);
    expect(divideRound(-5n, 3n)).toBe(-2n);
    expect(divideRound(6n, 3n)).toBe(2n);
  });

  it('divideFloor rounds toward negative infinity', () => {
    expect(divideFloor(7n, 2n)).toBe(3n);
    expect(divideFloor(-7n, 2n)).toBe(-4n);
    expect(divideFloor(-6n, 2n)).toBe(-3n);
    expect(divideFloor(0n, 2n)).toBe(0n);
  });

  it('roundDecimal keeps the scale and rounds to the given digits', () => {
    expect(formatDecimal(roundDecimal(parseDecimal('1.19647849'), 3))).toBe('1.196');
    expect(formatDecimal(roundDecimal(parseDecimal('0.0724532'), 4))).toBe('0.0725');
    expect(formatDecimal(roundDecimal(parseDecimal('-2.5'), 0))).toBe('-3');
    expect(formatDecimal(roundDecimal(parseDecimal('582.4478'), 2))).toBe('582.45');
    expect(roundDecimal(123n, 18)).toBe(123n);
  });
});
