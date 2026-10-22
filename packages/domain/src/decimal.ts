// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Exact decimals for investment units and prices (FR-I1 "units (high precision)"). Values travel as decimal strings
 * with at most {@link DECIMAL_DIGITS} fraction digits (`numeric(38,18)` in the database) and are computed as `bigint`s
 * scaled by 10^18, so no float ever touches a unit, a price or an amount.
 */

/** Fraction digits of a stored unit count or price (`numeric(38,18)`). */
export const DECIMAL_DIGITS = 18;
/** 10^18: the scale of a parsed decimal. */
export const DECIMAL_SCALE = 10n ** BigInt(DECIMAL_DIGITS);

const DECIMAL_PATTERN = /^(-?)(\d{1,20})(?:\.(\d{1,18}))?$/;

export class InvalidDecimalError extends RangeError {
  override readonly name = 'InvalidDecimalError';
  constructor(value: string) {
    super(`Not a decimal with at most ${DECIMAL_DIGITS} fraction digits: ${value}`);
  }
}

/** `value` scaled by 10^18 (`'1.5'` → 1.5 × 10^18); throws {@link InvalidDecimalError} for anything else. */
export function parseDecimal(value: string): bigint {
  const match = DECIMAL_PATTERN.exec(value);
  if (match === null) throw new InvalidDecimalError(value);
  const magnitude = BigInt(match[2] as string) * DECIMAL_SCALE + BigInt((match[3] ?? '').padEnd(DECIMAL_DIGITS, '0'));
  return match[1] === '-' ? -magnitude : magnitude;
}

/** Canonical string of a value scaled by 10^18, without trailing fraction zeros (`'0.0725'`, `'-1'`). */
export function formatDecimal(scaled: bigint): string {
  const abs = scaled < 0n ? -scaled : scaled;
  const whole = abs / DECIMAL_SCALE;
  const fraction = (abs % DECIMAL_SCALE).toString().padStart(DECIMAL_DIGITS, '0').replace(/0+$/, '');
  const sign = scaled < 0n ? '-' : '';
  return fraction === '' ? `${sign}${whole}` : `${sign}${whole}.${fraction}`;
}

/** `numerator ÷ denominator` (denominator > 0) rounded half away from zero. */
export function divideRound(numerator: bigint, denominator: bigint): bigint {
  const quotient = numerator / denominator;
  const twiceRemainder = 2n * (numerator % denominator);
  if (twiceRemainder >= denominator) return quotient + 1n;
  if (-twiceRemainder >= denominator) return quotient - 1n;
  return quotient;
}

/** `numerator ÷ denominator` (denominator > 0) rounded toward negative infinity. */
export function divideFloor(numerator: bigint, denominator: bigint): bigint {
  const quotient = numerator / denominator;
  return numerator % denominator < 0n ? quotient - 1n : quotient;
}

/**
 * A scaled decimal rounded half away from zero to `digits` (0–18) fraction digits, still scaled by 10^18
 * (display: SPY 1,19647849 → `1.196` at 3 digits; prices at 2).
 */
export function roundDecimal(scaled: bigint, digits: number): bigint {
  const step = 10n ** BigInt(DECIMAL_DIGITS - digits);
  return divideRound(scaled, step) * step;
}
