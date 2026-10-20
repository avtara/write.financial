// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What every route needs to decide where a visitor may go (plan §7 guards): whether the instance is set up, who is
 * signed in, and the public parts of the instance settings the sign-in pages show. Sent to the browser, so it holds
 * no secrets: no session token, no SMTP settings.
 */
import type { AuthSession } from '@wf/auth/auth';
import type { InstanceSettings, RegistrationMode } from '@wf/db/instance-settings';
import { stepAt, type OnboardingStep } from '@wf/domain/onboarding';
import { isLocale, type Locale } from '@wf/i18n/locale';

/** The signed-in user as the app shows it. */
export interface Viewer {
  readonly id: string;
  /** The current session's id (not its token): marks "this device" and lets a re-authentication end it. */
  readonly sessionId: string;
  readonly name: string;
  readonly email: string;
  readonly image: string | null;
  readonly locale: Locale;
  readonly timezone: string;
  readonly role: 'admin' | 'user';
  readonly twoFactorEnabled: boolean;
  /** FR-A4: the onboarding step to resume at; `null` once the onboarding is completed. */
  readonly onboardingStep: OnboardingStep | null;
}

/**
 * - `pending`: no admin yet; every page leads to the setup wizard (FR-OP1).
 * - `admin-created`: the wizard created the admin but its last step (instance settings) is not saved yet.
 * - `complete`: `instance_settings.setup_completed_at` is set; the wizard is closed for good.
 */
export type SetupStatus = 'pending' | 'admin-created' | 'complete';

export interface Gate {
  readonly setup: SetupStatus;
  readonly viewer: Viewer | null;
  readonly instanceName: string;
  readonly registrationMode: RegistrationMode;
  /** Whether "Lanjut dengan Google" is offered (Google sign-in is configured). */
  readonly googleEnabled: boolean;
}

export function toViewer({ user, session }: AuthSession): Viewer {
  return {
    id: user.id,
    sessionId: session.id,
    name: user.name,
    email: user.email,
    image: user.image ?? null,
    locale: isLocale(user.locale) ? user.locale : 'id',
    timezone: user.timezone ?? 'Asia/Jakarta',
    role: user.role === 'admin' ? 'admin' : 'user',
    twoFactorEnabled: user.twoFactorEnabled === true,
    onboardingStep: user.onboardingCompletedAt == null ? stepAt(user.onboardingStep ?? 1) : null,
  };
}

export interface GateDeps {
  readonly hasAdmin: () => Promise<boolean>;
  readonly instance: () => Promise<InstanceSettings>;
  readonly session: () => Promise<AuthSession | null>;
  readonly googleEnabled: boolean;
}

export async function loadGate({ hasAdmin, instance, session, googleEnabled }: GateDeps): Promise<Gate> {
  const [admin, settings, current] = await Promise.all([hasAdmin(), instance(), session()]);
  let setup: SetupStatus = 'pending';
  if (settings.setupCompletedAt !== null) setup = 'complete';
  else if (admin) setup = 'admin-created';
  return {
    setup,
    viewer: current === null ? null : toViewer(current),
    instanceName: settings.instanceName,
    registrationMode: settings.registrationMode,
    googleEnabled,
  };
}
