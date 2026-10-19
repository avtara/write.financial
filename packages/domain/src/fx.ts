// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Exchange rates and cross-currency transfers (PRD §7.2, FR-T4). Rates are decimal strings with at most 8 fraction
 * digits (`numeric(20,8)` in the database) and are computed exactly as scaled `bigint`s; amounts are `bigint` minor
 * units. Results are rounded half away from zero to the target currency's minor unit.
 */
import { currencyInfo } from './money.ts';

/** 1 unit of `base` = `rate` units of `quote` (the orientation of `fx_rates`, e.g. USD → IDR 16350). */
export interface FxRate {
  readonly base: string;
  readonly quote: string;
  readonly rate: string;
}

export interface Money {
  readonly minor: bigint;
  readonly currency: string;
}

/** Fraction digits of a stored rate (`numeric(20,8)`). */
export const RATE_DIGITS = 8;
const RATE_SCALE = 10n ** BigInt(RATE_DIGITS);
const RATE_PATTERN = /^(\d{1,12})(?:\.(\d{1,8}))?$/;

export class InvalidRateError extends RangeError {
  override readonly name = 'InvalidRateError';
  constructor(rate: string) {
    super(`Exchange rate must be a positive decimal with at most ${RATE_DIGITS} fraction digits: ${rate}`);
  }
}

/** No rate connects the two currencies. */
export class MissingRateError extends Error {
  override readonly name = 'MissingRateError';
  constructor(from: string, to: string) {
    super(`No exchange rate between ${from} and ${to}`);
  }
}

/** A fraction `num / den` with `den > 0`. */
interface Ratio {
  readonly num: bigint;
  readonly den: bigint;
}

/** `num / den` rounded half away from zero (`den > 0`). */
function roundRatio({ num, den }: Ratio): bigint {
  const quotient = num / den;
  const twiceRemainder = 2n * (num % den);
  if (twiceRemainder >= den) return quotient + 1n;
  if (-twiceRemainder >= den) return quotient - 1n;
  return quotient;
}

/** The rate scaled by 10^8; throws {@link InvalidRateError} for anything but a positive decimal. */
export function parseRate(rate: string): bigint {
  const match = RATE_PATTERN.exec(rate);
  if (match === null) throw new InvalidRateError(rate);
  const scaled = BigInt(match[1] as string) * RATE_SCALE + BigInt((match[2] ?? '').padEnd(RATE_DIGITS, '0'));
  if (scaled === 0n) throw new InvalidRateError(rate);
  return scaled;
}

/** Canonical decimal string of a rate scaled by 10^8 (no trailing fraction zeros), e.g. `16474.4645799`. */
export function formatRate(scaled: bigint): string {
  const whole = scaled / RATE_SCALE;
  const fraction = (scaled % RATE_SCALE).toString().padStart(RATE_DIGITS, '0').replace(/0+$/, '');
  return fraction === '' ? whole.toString() : `${whole}.${fraction}`;
}

/** Scaled rate of `ratio` (units of the second per unit of the first), rounded to 8 fraction digits. */
const scaledRate = (ratio: Ratio): bigint => roundRatio({ num: ratio.num * RATE_SCALE, den: ratio.den });

const minorFactor = (currency: string): bigint => 10n ** BigInt(currencyInfo(currency).minorDigits);

/** `amount` in `to`'s minor units as an exact fraction, or `null` when `rate` does not connect the currencies. */
function convertRatio(amount: Money, to: string, rate: FxRate): Ratio | null {
  const from = amount.currency;
  const scale = { num: amount.minor * minorFactor(to), den: minorFactor(from) };
  if (from === to) return scale;
  const scaled = parseRate(rate.rate);
  if (from === rate.base && to === rate.quote) return { num: scale.num * scaled, den: scale.den * RATE_SCALE };
  if (from === rate.quote && to === rate.base) return { num: scale.num * RATE_SCALE, den: scale.den * scaled };
  return null;
}

/** `amount` converted to `to` with `rate` (either orientation), rounded to `to`'s minor unit. */
export function convert(amount: Money, to: string, rate: FxRate): bigint {
  const ratio = convertRatio(amount, to, rate);
  if (ratio === null) throw new MissingRateError(amount.currency, to);
  return roundRatio(ratio);
}

/** The first of `rates` that connects `from` and `to` in either orientation. */
export function findRate(rates: readonly FxRate[], from: string, to: string): FxRate | undefined {
  return rates.find((rate) => (rate.base === from && rate.quote === to) || (rate.base === to && rate.quote === from));
}

/** Value of one unit of `currency` in `baseCurrency` per `rate`, as a rate string (`postings.fx_rate_to_base`). */
export function rateToBase(currency: string, baseCurrency: string, rate: FxRate): string {
  if (currency === rate.base && baseCurrency === rate.quote) return formatRate(parseRate(rate.rate));
  if (currency === rate.quote && baseCurrency === rate.base) {
    return formatRate(scaledRate({ num: RATE_SCALE, den: parseRate(rate.rate) }));
  }
  throw new MissingRateError(currency, baseCurrency);
}

/**
 * Effective rate of a conversion: units of `quote` per unit of `base` implied by the two amounts (sent ÷ received
 * for IDR → USD in IDR per USD). `base`/`quote` give the orientation, normally the reference rate's.
 */
export function effectiveRate(a: Money, b: Money, orientation: Pick<FxRate, 'base' | 'quote'>): string {
  const baseLeg = a.currency === orientation.base ? a : b;
  const quoteLeg = baseLeg === a ? b : a;
  if (baseLeg.currency !== orientation.base || quoteLeg.currency !== orientation.quote) {
    throw new MissingRateError(a.currency, b.currency);
  }
  if (baseLeg.minor <= 0n || quoteLeg.minor <= 0n) throw new RangeError('Both amounts must be positive');
  return formatRate(
    scaledRate({
      num: quoteLeg.minor * minorFactor(orientation.base),
      den: baseLeg.minor * minorFactor(orientation.quote),
    }),
  );
}

/**
 * Deviation of a manual rate from the reference in basis points, rounded half away from zero
 * (16474 vs 16350 → 76 = "+0,8%").
 */
export function manualRateDeviationBps(manual: string, reference: string): number {
  const ref = parseRate(reference);
  return Number(roundRatio({ num: (parseRate(manual) - ref) * 10_000n, den: ref }));
}

export interface FxDifferenceInput {
  readonly sent: Money;
  readonly received: Money;
  /** Reference (or manual) rate between the sent and received currencies. */
  readonly reference: FxRate;
  readonly baseCurrency: string;
  /** Rate from the received currency to the base currency when neither leg is in it. */
  readonly receivedToBase?: FxRate;
}

export interface FxDifference {
  /** What should have arrived at the reference rate, in received minor units ("Seharusnya US$183,49"). */
  readonly expectedReceivedMinor: bigint;
  /** Expected − received in received minor units; positive = less arrived ("US$1,39 lebih kecil"). */
  readonly shortfallReceivedMinor: bigint;
  /** (received − sent ÷ reference) valued in the base currency; negative = loss ("−Rp22.660"), 0 = no difference. */
  readonly differenceBaseMinor: bigint;
}

/**
 * FX difference of a cross-currency transfer (PRD §7.2): (received − sent/reference) × reference, in the base
 * currency. A received amount equal to the expected one rounded to the received currency's minor unit has no
 * difference ("Tidak ada selisih").
 */
export function fxDifference(input: FxDifferenceInput): FxDifference {
  const { sent, received, reference, baseCurrency } = input;
  const expected = convertRatio(sent, received.currency, reference);
  if (expected === null || sent.currency === received.currency) {
    throw new MissingRateError(sent.currency, received.currency);
  }
  const expectedReceivedMinor = roundRatio(expected);
  const shortfallReceivedMinor = expectedReceivedMinor - received.minor;
  if (shortfallReceivedMinor === 0n) return { expectedReceivedMinor, shortfallReceivedMinor, differenceBaseMinor: 0n };

  // received − expected, exactly, in received minor units.
  const difference = { num: received.minor * expected.den - expected.num, den: expected.den };
  const toBaseRate = received.currency === baseCurrency ? reference : (input.receivedToBase ?? reference);
  const perMinor = convertRatio({ minor: 1n, currency: received.currency }, baseCurrency, toBaseRate);
  if (perMinor === null) throw new MissingRateError(received.currency, baseCurrency);
  const differenceBaseMinor = roundRatio({
    num: difference.num * perMinor.num,
    den: difference.den * perMinor.den,
  });
  return { expectedReceivedMinor, shortfallReceivedMinor, differenceBaseMinor };
}
