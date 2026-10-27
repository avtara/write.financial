// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The words for an auth failure (`AuthFailure` from Better Auth, or a server function's `Result` code), in the
 * current locale. Wrong passwords and codes say how many tries are left before the 15-minute lock (FR-A2, design
 * `D0gWC`); a locked account says until when.
 */
import { m } from '@wf/i18n/messages';
import type { Locale } from '@wf/i18n/locale';
import type { AuthFailure } from './auth-client.ts';

/** `16.52` (id) / `16:52` (en), in the browser's time zone. */
export function clockTime(at: Date, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === 'id' ? 'id-ID' : 'en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(at);
}

const MESSAGES: Readonly<Record<string, () => string>> = {
  INVALID_EMAIL_OR_PASSWORD: m.auth_error_invalid_credentials,
  INVALID_PASSWORD: m.auth_error_invalid_password,
  INVALID_CODE: m.auth_error_invalid_code,
  INVALID_BACKUP_CODE: m.auth_error_invalid_backup_code,
  INVALID_TWO_FACTOR_COOKIE: m.auth_error_challenge_expired,
  PASSWORD_COMPROMISED: m.auth_error_password_compromised,
  PASSWORD_TOO_SHORT: m.auth_error_password_too_short,
  PASSWORD_TOO_LONG: m.auth_error_password_too_long,
  USER_ALREADY_EXISTS: m.auth_error_email_taken,
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: m.auth_error_email_taken,
  EMAIL_TAKEN: m.auth_error_email_taken,
  INVALID_EMAIL: m.auth_error_invalid_email,
  REGISTRATION_CLOSED: m.auth_error_registration_closed,
  INVALID_INVITATION: m.auth_error_invalid_invitation,
  INVALID_TOKEN: m.auth_error_invalid_link,
  TOKEN_EXPIRED: m.auth_error_invalid_link,
  REAUTHENTICATION_REQUIRED: m.auth_error_reauthenticate,
  SESSION_NOT_FRESH: m.auth_error_reauthenticate,
  SESSION_EXPIRED: m.auth_error_reauthenticate,
  UNAUTHENTICATED: m.auth_error_signed_out,
  ADMIN_TWO_FACTOR_REQUIRED: m.auth_error_admin_two_factor,
  TWO_FACTOR_REQUIRED: m.auth_error_two_factor_required,
  FORBIDDEN: m.auth_error_forbidden,
  RATE_LIMITED: m.auth_error_rate_limited,
  // Google reported the Gmail grant gone during the card's filter dry run (FR-AI4).
  GMAIL_REVOKED: m.gmail_status_revoked,
  NETWORK: m.error_network,
};

/** Whether the failure means "sign in again first" (FR-A9), so the page should open the re-authentication step. */
export function needsReauthentication(code: string): boolean {
  return code === 'REAUTHENTICATION_REQUIRED' || code === 'SESSION_NOT_FRESH' || code === 'SESSION_EXPIRED';
}

export function authErrorMessage(
  failure: Pick<AuthFailure, 'code' | 'remainingAttempts' | 'lockedUntil'>,
  locale: Locale,
): string {
  const { code, remainingAttempts, lockedUntil } = failure;
  if (code === 'ACCOUNT_LOCKED' || code === 'ACCOUNT_TEMPORARILY_LOCKED') {
    return lockedUntil === undefined
      ? m.auth_error_locked()
      : m.auth_error_locked_until({ time: clockTime(lockedUntil, locale) });
  }
  const message = Object.hasOwn(MESSAGES, code) ? MESSAGES[code] : undefined;
  const base = (message ?? m.error_unknown)();
  if (remainingAttempts === undefined) return base;
  return m.auth_error_attempts_left({ message: base, count: remainingAttempts });
}
