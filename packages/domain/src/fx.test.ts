// SPDX-License-Identifier: AGPL-3.0-only
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  convert,
  effectiveRate,
  findRate,
  formatRate,
  fxDifference,
  InvalidRateError,
  manualRateDeviationBps,
  MissingRateError,
  parseRate,
  rateToBase,
  type FxRate,
} from './fx.ts';

/**
 * Design "Catat Transfer" IDR → USD (03-catat-transaksi `TyPAn`, PRD §7.2): Rp3.000.000 sent, US$182,10 received,
 * "Seharusnya US$183,49 · kurs efektif Rp16.474", "Selisih dicatat otomatis −Rp22.660 · US$1,39 lebih kecil".
 * The screen shows the reference rate rounded to whole rupiah ("1 USD = Rp16.350"); the unrounded rate 16350.0275
 * reproduces every figure on it exactly (with exactly 16350 the difference would be −Rp22.665).
 */
const REFERENCE: FxRate = { base: 'USD', quote: 'IDR', rate: '16350.0275' };
const SENT = { minor: 3_000_000n, currency: 'IDR' };
const RECEIVED = { minor: 18_210n, currency: 'USD' };

describe('parseRate / formatRate', () => {
  it('scales by 10^8 and round-trips canonical strings', () => {
    expect(parseRate('16350')).toBe(1_635_000_000_000n);
    expect(parseRate('0.00006116')).toBe(6116n);
    expect(formatRate(parseRate('16350.02750000'))).toBe('16350.0275');
    expect(formatRate(parseRate('16350'))).toBe('16350');
  });

  it.each(['0', '0.000000001', '-1', '1e3', '', '1.', 'abc', '1234567890123'])('rejects %j', (rate) => {
    expect(() => parseRate(rate)).toThrow(InvalidRateError);
  });

  it('round-trips any valid rate', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 1n, max: 10n ** 20n - 1n }), (scaled) => {
        expect(parseRate(formatRate(scaled))).toBe(scaled);
      }),
    );
  });
});

describe('convert', () => {
  it('converts in both orientations of a rate, rounding half away from zero', () => {
    expect(convert({ minor: 10_000n, currency: 'USD' }, 'IDR', { base: 'USD', quote: 'IDR', rate: '16350' })).toBe(
      1_635_000n,
    );
    expect(convert(SENT, 'USD', REFERENCE)).toBe(18_349n);
    expect(convert({ minor: -18_210n, currency: 'USD' }, 'IDR', REFERENCE)).toBe(-2_977_340n);
    // 0.5 rupiah rounds away from zero in both directions.
    const half: FxRate = { base: 'USD', quote: 'IDR', rate: '0.5' };
    expect(convert({ minor: 100n, currency: 'USD' }, 'IDR', half)).toBe(1n);
    expect(convert({ minor: -100n, currency: 'USD' }, 'IDR', half)).toBe(-1n);
    expect(convert({ minor: 100n, currency: 'USD' }, 'IDR', { ...half, rate: '0.4' })).toBe(0n);
  });

  it('only rescales within one currency and rejects unrelated rates', () => {
    expect(convert({ minor: 5n, currency: 'IDR' }, 'IDR', REFERENCE)).toBe(5n);
    expect(() => convert({ minor: 5n, currency: 'SGD' }, 'IDR', REFERENCE)).toThrow(MissingRateError);
    // One side of the rate matches, the other does not.
    expect(() => convert({ minor: 5n, currency: 'USD' }, 'SGD', REFERENCE)).toThrow(MissingRateError);
    expect(() => convert({ minor: 5n, currency: 'IDR' }, 'SGD', REFERENCE)).toThrow(
      'No exchange rate between IDR and SGD',
    );
  });

  it('names its errors', () => {
    expect(new MissingRateError('IDR', 'SGD').name).toBe('MissingRateError');
    expect(new InvalidRateError('x')).toMatchObject({
      name: 'InvalidRateError',
      message: 'Exchange rate must be a positive decimal with at most 8 fraction digits: x',
    });
  });
});

describe('findRate / rateToBase', () => {
  const sgd: FxRate = { base: 'IDR', quote: 'SGD', rate: '0.00008' };

  it('finds a rate in either orientation', () => {
    expect(findRate([sgd, REFERENCE], 'IDR', 'USD')).toBe(REFERENCE);
    expect(findRate([sgd, REFERENCE], 'SGD', 'IDR')).toBe(sgd);
    expect(findRate([REFERENCE], 'SGD', 'IDR')).toBeUndefined();
    expect(findRate([REFERENCE], 'USD', 'SGD')).toBeUndefined();
    expect(findRate([REFERENCE], 'SGD', 'USD')).toBeUndefined();
  });

  it('gives the base value of one unit of the currency', () => {
    expect(rateToBase('USD', 'IDR', REFERENCE)).toBe('16350.0275');
    expect(rateToBase('SGD', 'IDR', sgd)).toBe('12500');
    expect(() => rateToBase('EUR', 'IDR', sgd)).toThrow(MissingRateError);
    expect(() => rateToBase('USD', 'SGD', REFERENCE)).toThrow(MissingRateError);
    expect(() => rateToBase('IDR', 'SGD', REFERENCE)).toThrow(MissingRateError);
  });
});

describe('effectiveRate', () => {
  it('is sent ÷ received in the reference orientation (golden Rp16.474)', () => {
    expect(effectiveRate(SENT, RECEIVED, REFERENCE)).toBe('16474.4645799');
    expect(effectiveRate({ minor: 10_000n, currency: 'USD' }, { minor: 1_618_400n, currency: 'IDR' }, REFERENCE)).toBe(
      '16184',
    );
    // Both currencies with minor units: US$100,00 → S$135,00 is 1.35.
    expect(
      effectiveRate(
        { minor: 10_000n, currency: 'USD' },
        { minor: 13_500n, currency: 'SGD' },
        { base: 'USD', quote: 'SGD' },
      ),
    ).toBe('1.35');
  });

  it('rejects other currencies and non-positive amounts', () => {
    expect(() => effectiveRate(SENT, { minor: 1n, currency: 'SGD' }, REFERENCE)).toThrow(MissingRateError);
    expect(() => effectiveRate(RECEIVED, { minor: 1n, currency: 'SGD' }, REFERENCE)).toThrow(MissingRateError);
    expect(() => effectiveRate(SENT, { minor: 0n, currency: 'USD' }, REFERENCE)).toThrow(
      'Both amounts must be positive',
    );
    expect(() => effectiveRate({ minor: 0n, currency: 'IDR' }, RECEIVED, REFERENCE)).toThrow(
      'Both amounts must be positive',
    );
  });
});

describe('manualRateDeviationBps', () => {
  it('is the signed deviation from the reference ("+0,8% dari acuan Rp16.350")', () => {
    expect(manualRateDeviationBps('16474', '16350')).toBe(76);
    expect(manualRateDeviationBps('16226', '16350')).toBe(-76);
    expect(manualRateDeviationBps('16350', '16350')).toBe(0);
  });
});

describe('fxDifference', () => {
  it('reproduces the design: US$183,49 expected, US$1,39 short, −Rp22.660', () => {
    expect(fxDifference({ sent: SENT, received: RECEIVED, reference: REFERENCE, baseCurrency: 'IDR' })).toEqual({
      expectedReceivedMinor: 18_349n,
      shortfallReceivedMinor: 139n,
      differenceBaseMinor: -22_660n,
    });
  });

  it('computes USD → IDR in the received (base) currency: −Rp16.600', () => {
    const usdToIdr = fxDifference({
      sent: { minor: 10_000n, currency: 'USD' },
      received: { minor: 1_618_400n, currency: 'IDR' },
      reference: { base: 'USD', quote: 'IDR', rate: '16350' },
      baseCurrency: 'IDR',
    });
    expect(usdToIdr).toEqual({
      expectedReceivedMinor: 1_635_000n,
      shortfallReceivedMinor: 16_600n,
      differenceBaseMinor: -16_600n,
    });
  });

  it('has no difference when the received amount matches the manual rate ("Tidak ada selisih")', () => {
    // The manual field shows "16.474"; the rate behind it is the effective rate of the two amounts.
    const manual = fxDifference({
      sent: SENT,
      received: RECEIVED,
      reference: { base: 'USD', quote: 'IDR', rate: effectiveRate(SENT, RECEIVED, REFERENCE) },
      baseCurrency: 'IDR',
    });
    expect(manual).toEqual({ expectedReceivedMinor: 18_210n, shortfallReceivedMinor: 0n, differenceBaseMinor: 0n });
  });

  it('values a gain positively', () => {
    const gain = fxDifference({
      sent: SENT,
      received: { minor: 18_400n, currency: 'USD' },
      reference: { base: 'USD', quote: 'IDR', rate: '16350' },
      baseCurrency: 'IDR',
    });
    expect(gain.differenceBaseMinor).toBe(8_400n);
  });

  it('values the difference with receivedToBase when neither leg is in the base currency', () => {
    const input = {
      sent: { minor: 10_000n, currency: 'USD' },
      received: { minor: 13_000n, currency: 'SGD' },
      reference: { base: 'USD', quote: 'SGD', rate: '1.35' },
      baseCurrency: 'IDR',
    };
    // Expected S$135,00, received S$130,00 → −S$5 × 12.500 = −Rp62.500.
    expect(
      fxDifference({ ...input, receivedToBase: { base: 'SGD', quote: 'IDR', rate: '12500' } }).differenceBaseMinor,
    ).toBe(-62_500n);
    expect(() => fxDifference(input)).toThrow(MissingRateError);
  });

  it('needs two different currencies connected by the reference', () => {
    expect(() =>
      fxDifference({ sent: SENT, received: { minor: 1n, currency: 'IDR' }, reference: REFERENCE, baseCurrency: 'IDR' }),
    ).toThrow(MissingRateError);
    expect(() =>
      fxDifference({ sent: SENT, received: { minor: 1n, currency: 'SGD' }, reference: REFERENCE, baseCurrency: 'IDR' }),
    ).toThrow(MissingRateError);
  });
});
