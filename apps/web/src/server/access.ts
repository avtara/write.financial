// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Who may call a server function (FR-A9, PRD §9.1), and how expected failures reach the browser. Server functions
 * take the user from the request's session, never from their input, and answer `Result`s: an expected refusal is a
 * value with a stable `code` the page can explain; anything else is a real error (logged, generic message).
 */
import type { AuthSession } from '@wf/auth/auth';
import { assertFreshSession, assertTwoFactorEnrolled, UnauthenticatedError } from '@wf/auth/session';
import { LEDGER_ERROR_CODES } from '@wf/db/ledger-errors';

export type Result<T> =
  | { readonly ok: true; readonly value: T }
  /** `detail`: extra text for an admin (e.g. the SMTP server's answer), never secrets. */
  | { readonly ok: false; readonly code: string; readonly detail?: string };

/** The signed-in user may not do this (not an admin, or the setup wizard is closed to them). */
export class ForbiddenError extends Error {
  override readonly name = 'ForbiddenError';
  readonly code = 'FORBIDDEN';

  constructor() {
    super('Not allowed');
  }
}

/** An upload refused before storing; `detail` is the reason (`too-large`, `unsupported-type`, `too-many-pixels`, `corrupt`). */
export class UploadRejectedError extends Error {
  override readonly name = 'UploadRejectedError';
  readonly code = 'IMAGE_REJECTED';
  readonly detail: string;

  constructor(reason: string) {
    super('The upload was rejected');
    this.detail = reason;
  }
}

export interface AccessRule {
  /** Admins only. */
  readonly admin?: boolean;
  /** Two-step verification must be on (FR-A9; always for admin actions). */
  readonly twoFactor?: boolean;
  /** Signed in at most 15 minutes ago (FR-A9 re-authentication). */
  readonly fresh?: boolean;
}

/**
 * The signed-in session if it passes `rule`.
 * @throws {UnauthenticatedError | ForbiddenError | TwoFactorRequiredError | ReauthenticationRequiredError}
 */
export async function requireSession(
  session: () => Promise<AuthSession | null>,
  rule: AccessRule,
  now: Date,
): Promise<AuthSession> {
  const current = await session();
  if (current === null) throw new UnauthenticatedError();
  if (rule.admin === true && current.user.role !== 'admin') throw new ForbiddenError();
  if (rule.twoFactor === true || rule.admin === true) assertTwoFactorEnrolled(current);
  if (rule.fresh === true) assertFreshSession(current, now);
  return current;
}

export const ok = <T>(value: T): Result<T> => ({ ok: true, value });

/**
 * Codes of the typed errors (`@wf/auth`, `@wf/db`, this app) a page can explain. Other errors with a `code`
 * (Postgres `23505`, `ECONNREFUSED`, …) are not expected and stay errors.
 */
export const EXPECTED_CODES: readonly string[] = [
  ...new Set([
    'UNAUTHENTICATED',
    'TWO_FACTOR_REQUIRED',
    'REAUTHENTICATION_REQUIRED',
    'FORBIDDEN',
    'NOT_FOUND',
    'DEVICE_NOT_FOUND',
    'ADMIN_EXISTS',
    'INVALID_EMAIL',
    'INVALID_NAME',
    'PASSWORD_TOO_SHORT',
    'PASSWORD_TOO_LONG',
    'PASSWORD_COMPROMISED',
    'EMAIL_TAKEN',
    'INVITATIONS_DISABLED',
    'MAIL_NOT_CONFIGURED',
    'MAIL_FAILED',
    'INVALID_PROFILE',
    // An uploaded image the image pipeline refused (`detail`: the reason).
    'IMAGE_REJECTED',
    // A transaction already has the most attachments of that kind (FR-L4).
    'ATTACHMENT_LIMIT',
    // Ledger repositories (`LedgerError`).
    ...LEDGER_ERROR_CODES,
  ]),
];

/** Runs `action`; an error with one of the {@link EXPECTED_CODES} becomes a failed `Result`, anything else is
 * rethrown. */
export async function attempt<T>(action: () => Promise<T>): Promise<Result<T>> {
  try {
    return ok(await action());
  } catch (error) {
    if (error instanceof Error && 'code' in error && typeof error.code === 'string') {
      if (EXPECTED_CODES.includes(error.code)) {
        const detail = 'detail' in error && typeof error.detail === 'string' ? { detail: error.detail } : {};
        return { ok: false, code: error.code, ...detail };
      }
    }
    throw error;
  }
}
