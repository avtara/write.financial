// SPDX-License-Identifier: AGPL-3.0-only
/** Shared fakes for server tests: a Better Auth session and instance settings. */
import type { AuthSession } from '@wf/auth/auth';
import type { InstanceSettings } from '@wf/db/instance-settings';

export const NOW = new Date('2026-10-18T09:00:00Z');

export interface FakeSessionOptions {
  readonly role?: 'admin' | 'user';
  readonly twoFactorEnabled?: boolean;
  /** Minutes between sign-in and {@link NOW}. */
  readonly ageMinutes?: number;
  readonly locale?: string;
  /** Whether the user completed the onboarding (FR-A4); default yes, as the app shell's tests need. */
  readonly onboarded?: boolean;
}

/** A session shaped like `auth.getSession()`'s answer (only the fields the app reads are meaningful). */
export function fakeSession({
  role = 'user',
  twoFactorEnabled = true,
  ageMinutes = 1,
  locale = 'id',
  onboarded = true,
}: FakeSessionOptions = {}): AuthSession {
  const createdAt = new Date(NOW.getTime() - ageMinutes * 60_000);
  return {
    user: {
      id: '0192a6c4-0000-7000-8000-000000000001',
      name: 'Avtara K.',
      email: 'avtara@example.test',
      emailVerified: true,
      image: null,
      createdAt,
      updatedAt: createdAt,
      role,
      locale,
      timezone: 'Asia/Jakarta',
      twoFactorEnabled,
      onboardingCompletedAt: onboarded ? createdAt : null,
      onboardingStep: onboarded ? 5 : 1,
      deletionRequestedAt: null,
    },
    session: {
      id: '0192a6c4-0000-7000-8000-0000000000aa',
      token: 'session-token',
      userId: '0192a6c4-0000-7000-8000-000000000001',
      createdAt,
      updatedAt: createdAt,
      expiresAt: new Date(createdAt.getTime() + 12 * 3_600_000),
      ipAddress: null,
      userAgent: null,
    },
  };
}

export const SETTINGS: InstanceSettings = {
  instanceName: 'Keuangan Keluarga',
  publicUrl: null,
  defaultLocale: 'id',
  defaultTimezone: 'Asia/Jakarta',
  registrationMode: 'closed',
  setupCompletedAt: null,
  smtp: null,
};
