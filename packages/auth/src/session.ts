// SPDX-License-Identifier: AGPL-3.0-only
/** Gates for server functions (FR-A9): who may run a sensitive action, independent of Better Auth's types. */

/** FR-A9: sensitive actions need a session that is at most this old, otherwise the user signs in again. */
export const FRESH_SESSION_MINUTES = 15;

/** No valid session: the user must sign in. */
export class UnauthenticatedError extends Error {
  override readonly name = 'UnauthenticatedError';
  readonly code = 'UNAUTHENTICATED';

  constructor() {
    super('Sign in to continue');
  }
}

/** The action needs two-step verification and the user has not enrolled (FR-A9; mandatory for admins). */
export class TwoFactorRequiredError extends Error {
  override readonly name = 'TwoFactorRequiredError';
  readonly code = 'TWO_FACTOR_REQUIRED';

  constructor() {
    super('Turn on two-step verification to continue');
  }
}

/** The session is older than the action allows; the user must sign in again (FR-A9). */
export class ReauthenticationRequiredError extends Error {
  override readonly name = 'ReauthenticationRequiredError';
  readonly code = 'REAUTHENTICATION_REQUIRED';

  constructor() {
    super('Sign in again to continue');
  }
}

export interface GuardedSession {
  readonly session: { readonly createdAt: Date };
  readonly user: { readonly twoFactorEnabled?: boolean | null | undefined };
}

/** @throws {TwoFactorRequiredError} unless the user has enrolled a second factor. */
export function assertTwoFactorEnrolled(session: GuardedSession): void {
  if (session.user.twoFactorEnabled !== true) throw new TwoFactorRequiredError();
}

/**
 * @throws {ReauthenticationRequiredError} if the session was created more than `maxAgeMinutes` before `now`.
 * Sessions are created at sign-in (and re-created when 2FA is enabled), never extended, so this is the time
 * since the user last proved who they are.
 */
export function assertFreshSession(session: GuardedSession, now: Date, maxAgeMinutes = FRESH_SESSION_MINUTES): void {
  if (now.getTime() - session.session.createdAt.getTime() > maxAgeMinutes * 60_000) {
    throw new ReauthenticationRequiredError();
  }
}
