// SPDX-License-Identifier: AGPL-3.0-only
/**
 * FR-A4 onboarding (design Section 16 `vSYBL`): the five steps in order and the emergency-fund estimate of step 4
 * ("Dana Darurat · 3× pengeluaran ≈ Rp54.000.000").
 */

/** 1 Profil · 2 Periode · 3 Rekening · 4 Tujuan · 5 Selesai; the route segment of `/onboarding/$step`. */
export const ONBOARDING_STEPS = ['profile', 'period', 'accounts', 'goal', 'done'] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

/** 1–5. */
export function stepNumber(step: OnboardingStep): number {
  return ONBOARDING_STEPS.indexOf(step) + 1;
}

/** The step numbered `number` (1–5, as stored in `users.onboarding_step`); out of range clamps to the nearest step. */
export function stepAt(number: number): OnboardingStep {
  const index = Math.min(Math.max(Math.trunc(number), 1), ONBOARDING_STEPS.length) - 1;
  return ONBOARDING_STEPS[index] as OnboardingStep;
}

/** The step after `step`; `done` is the last. */
export function nextStep(step: OnboardingStep): OnboardingStep {
  return stepAt(stepNumber(step) + 1);
}

/** Whether `step` may be opened when the user is to resume at `resume` (earlier steps for "Kembali", not later ones). */
export function isReachable(step: OnboardingStep, resume: OnboardingStep): boolean {
  return stepNumber(step) <= stepNumber(resume);
}

/** Months of spending an emergency fund covers ("3× pengeluaran"). */
export const EMERGENCY_FUND_MONTHS = 3;

/**
 * Share of the income a new user is assumed to spend each month, before any expense is recorded: the design's
 * 25.800.000 income gives ≈ 18.060.000 a month and the preset's ≈ Rp54.000.000.
 */
export const SPENDING_SHARE_PCT = 70;

/** Non-negative `value` rounded half up to `digits` significant digits (54.180.000 → 54.000.000 for 2). */
function roundSignificant(value: bigint, digits: number): bigint {
  const unit = 10n ** BigInt(Math.max(value.toString().length - digits, 0));
  return ((value + unit / 2n) / unit) * unit;
}

/**
 * The "Dana Darurat" preset target: {@link EMERGENCY_FUND_MONTHS} months of the estimated spending
 * ({@link SPENDING_SHARE_PCT} of the average monthly income), rounded to two significant digits. `null` when that is
 * not positive (no income yet: the user types the target).
 */
export function emergencyFundEstimate(monthlyIncomeMinor: bigint | null): bigint | null {
  if (monthlyIncomeMinor === null) return null;
  const spending = (monthlyIncomeMinor * BigInt(SPENDING_SHARE_PCT)) / 100n;
  const estimate = roundSignificant(spending * BigInt(EMERGENCY_FUND_MONTHS), 2);
  return estimate > 0n ? estimate : null;
}
