// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import {
  EMERGENCY_FUND_MONTHS,
  emergencyFundEstimate,
  isReachable,
  nextStep,
  ONBOARDING_STEPS,
  SPENDING_SHARE_PCT,
  stepAt,
  stepNumber,
} from './onboarding.ts';

describe('onboarding steps', () => {
  it('numbers the five design steps 1–5', () => {
    expect(ONBOARDING_STEPS).toEqual(['profile', 'period', 'accounts', 'goal', 'done']);
    expect(ONBOARDING_STEPS.map(stepNumber)).toEqual([1, 2, 3, 4, 5]);
    expect([1, 2, 3, 4, 5].map(stepAt)).toEqual(ONBOARDING_STEPS);
  });

  it('clamps an out-of-range stored number to the nearest step', () => {
    expect(stepAt(0)).toBe('profile');
    expect(stepAt(-3)).toBe('profile');
    expect(stepAt(6)).toBe('done');
    expect(stepAt(2.9)).toBe('period');
  });

  it('moves forward and stays on done', () => {
    expect(ONBOARDING_STEPS.map(nextStep)).toEqual(['period', 'accounts', 'goal', 'done', 'done']);
  });

  it('allows the resume step and the ones before it', () => {
    expect(isReachable('profile', 'accounts')).toBe(true);
    expect(isReachable('accounts', 'accounts')).toBe(true);
    expect(isReachable('goal', 'accounts')).toBe(false);
    expect(isReachable('done', 'profile')).toBe(false);
    expect(isReachable('profile', 'profile')).toBe(true);
  });
});

describe('emergencyFundEstimate', () => {
  it('gives the design figure: income 25.800.000 → 3 × 70% ≈ Rp54.000.000', () => {
    expect(EMERGENCY_FUND_MONTHS).toBe(3);
    expect(SPENDING_SHARE_PCT).toBe(70);
    // 25.800.000 × 0,7 = 18.060.000; × 3 = 54.180.000 → 54.000.000.
    expect(emergencyFundEstimate(25_800_000n)).toBe(54_000_000n);
  });

  it('rounds half up to two significant digits', () => {
    // 5.000.000 → 10.500.000 → 11.000.000 (half up).
    expect(emergencyFundEstimate(5_000_000n)).toBe(11_000_000n);
    // 10.000.000 → 21.000.000 (already two digits).
    expect(emergencyFundEstimate(10_000_000n)).toBe(21_000_000n);
    // 4.990.000 → 10.479.000 → 10.000.000 (below half).
    expect(emergencyFundEstimate(4_990_000n)).toBe(10_000_000n);
    // 47.000.000 → 98.700.000 → 99.000.000; 48.000.000 → 100.800.000 → 100.000.000 (three digits after rounding).
    expect(emergencyFundEstimate(47_000_000n)).toBe(99_000_000n);
    expect(emergencyFundEstimate(48_000_000n)).toBe(100_000_000n);
  });

  it('keeps short values as they are', () => {
    // 10 → 7 → 21; 4 → 2 → 6.
    expect(emergencyFundEstimate(10n)).toBe(21n);
    expect(emergencyFundEstimate(4n)).toBe(6n);
  });

  it('has no estimate without a positive income', () => {
    expect(emergencyFundEstimate(null)).toBeNull();
    expect(emergencyFundEstimate(0n)).toBeNull();
    expect(emergencyFundEstimate(-1n)).toBeNull();
    // 1 × 70% rounds down to nothing.
    expect(emergencyFundEstimate(1n)).toBeNull();
  });
});
