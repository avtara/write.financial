// SPDX-License-Identifier: AGPL-3.0-only
/** The onboarding steps' data (`getOnboarding`) for the step tests: a new user on 15 Okt 2026, overridable. */
import type { LocalDate, YearMonth } from '@wf/domain/period';
import type { OnboardingView } from '../src/server/fn/onboarding.ts';

export function onboardingView(overrides: Partial<OnboardingView> = {}): OnboardingView {
  return {
    progress: { step: 'profile', completedAt: null, baseCurrency: 'IDR' },
    profile: { name: 'Avtara K.', nickname: null, locale: 'id', timezone: 'Asia/Jakarta' },
    email: 'avtara.k@gmail.com',
    emailVerified: true,
    signIn: { google: false, password: true },
    extraCurrencies: [],
    today: '2026-10-15' as LocalDate,
    startDay: 1 as OnboardingView['startDay'],
    period: {
      id: '0192a6c4-0000-7000-8002-000000000001',
      label: '2026-10' as YearMonth,
      start: '2026-10-01' as LocalDate,
      end: '2026-10-31' as LocalDate,
      days: 31,
      kind: 'normal',
      status: 'open',
      closedAt: null,
    },
    expectedIncomeMinor: null,
    accounts: { baseCurrency: 'IDR', accounts: [], availableMinor: 0n, missingRates: [] },
    goal: null,
    ...overrides,
  };
}
