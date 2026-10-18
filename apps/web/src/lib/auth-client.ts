// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The browser side of Better Auth (`/api/auth/*`, mounted by `routes/api/auth/$.ts`): every sign-in, sign-up,
 * password, two-step verification, and passkey action the pages need, as plain async functions that never throw for
 * an expected refusal. Pages get them through `useAuthActions()` (`components/auth-actions.tsx`), so component tests
 * pass fakes.
 *
 * Failures carry Better Auth's error `code` (`INVALID_EMAIL_OR_PASSWORD`, `INVALID_CODE`, …) and the instance's
 * own (`ACCOUNT_LOCKED` with `lockedUntil`, `remainingAttempts` after a wrong password or code, FR-A2;
 * `REAUTHENTICATION_REQUIRED`, FR-A9). Requests without an answer become `NETWORK`, a 429 without a code
 * `RATE_LIMITED`.
 */
import { passkeyClient } from '@better-auth/passkey/client';
import type { Locale } from '@wf/i18n/locale';
import { createAuthClient } from 'better-auth/client';
import { twoFactorClient } from 'better-auth/client/plugins';

export interface AuthFailure {
  readonly status: number;
  readonly code: string;
  /** Wrong password or second factor: tries left before the 15-minute lock (FR-A2). */
  readonly remainingAttempts?: number;
  /** `ACCOUNT_LOCKED`: when sign-in opens again. */
  readonly lockedUntil?: Date;
}

export type AuthResult<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: AuthFailure };

export interface AuthActions {
  /** `twoFactor`: the account has 2FA and the browser must continue at `/2fa` (no session yet). */
  signInEmail: (input: {
    email: string;
    password: string;
    rememberMe: boolean;
  }) => Promise<AuthResult<{ twoFactor: boolean }>>;
  /** Leaves the page for Google; resolves only when that could not start. */
  signInGoogle: (callbackURL: string) => Promise<AuthResult<null>>;
  signInPasskey: () => Promise<AuthResult<null>>;
  signUpEmail: (input: {
    name: string;
    email: string;
    password: string;
    locale: Locale;
    /** From `?invitation=`; required unless registration is open. */
    invitationToken: string | null;
  }) => Promise<AuthResult<null>>;
  /** FR-A3: sends the reset link (or "set password" for Google-only accounts); the answer never says whether the
   * email exists. */
  requestPasswordReset: (email: string) => Promise<AuthResult<null>>;
  resetPassword: (input: { token: string; newPassword: string }) => Promise<AuthResult<null>>;
  /** Second step of sign-in with a 2FA code, or the first code that turns 2FA on during enrollment. */
  verifyTotp: (input: { code: string; trustDevice: boolean }) => Promise<AuthResult<null>>;
  verifyBackupCode: (input: { code: string; trustDevice: boolean }) => Promise<AuthResult<null>>;
  signOut: () => Promise<AuthResult<null>>;
  /** Starts enrollment: the authenticator URI (QR / manual key) and 10 backup codes; 2FA turns on with the first
   * correct code. `password` is required for accounts that have one. */
  enableTwoFactor: (password: string | null) => Promise<AuthResult<{ totpURI: string; backupCodes: string[] }>>;
  disableTwoFactor: (password: string | null) => Promise<AuthResult<null>>;
  generateBackupCodes: (password: string | null) => Promise<AuthResult<{ backupCodes: string[] }>>;
  addPasskey: (name: string) => Promise<AuthResult<null>>;
  deletePasskey: (id: string) => Promise<AuthResult<null>>;
  changePassword: (input: {
    currentPassword: string;
    newPassword: string;
    revokeOtherSessions: boolean;
  }) => Promise<AuthResult<null>>;
}

interface BetterFetchError {
  readonly status?: number;
  readonly code?: unknown;
  readonly remainingAttempts?: unknown;
  readonly lockedUntil?: unknown;
}

export function toFailure(error: BetterFetchError): AuthFailure {
  const status = error.status ?? 0;
  let code = typeof error.code === 'string' && error.code !== '' ? error.code : 'UNKNOWN';
  if (code === 'UNKNOWN' && status === 429) code = 'RATE_LIMITED';
  if (code === 'UNKNOWN' && status === 0) code = 'NETWORK';
  // Better Fetch revives ISO timestamps in JSON answers into `Date`s.
  const { lockedUntil } = error;
  return {
    status,
    code,
    ...(typeof error.remainingAttempts === 'number' ? { remainingAttempts: error.remainingAttempts } : {}),
    ...(lockedUntil instanceof Date || typeof lockedUntil === 'string' ? { lockedUntil: new Date(lockedUntil) } : {}),
  };
}

type Response<T> = { data: T | null; error: BetterFetchError | null } | { data: null; error: BetterFetchError };

async function settle<T, R>(request: Promise<Response<T>>, map: (data: T) => R): Promise<AuthResult<R>> {
  try {
    const { data, error } = await request;
    if (error !== null) return { ok: false, error: toFailure(error) };
    return { ok: true, value: map(data as T) };
  } catch {
    return { ok: false, error: { status: 0, code: 'NETWORK' } };
  }
}

const none = () => null;

/** `fetch` is injectable for tests; the base URL is the page's origin (the API is same-origin). */
export function createAuthActions(options: { baseURL?: string; fetch?: typeof fetch } = {}): AuthActions {
  const client = createAuthClient({
    ...(options.baseURL === undefined ? {} : { baseURL: options.baseURL }),
    ...(options.fetch === undefined ? {} : { fetchOptions: { customFetchImpl: options.fetch } }),
    plugins: [twoFactorClient(), passkeyClient()],
  });
  const post = <T>(path: string, body: Record<string, unknown>) =>
    client.$fetch<T>(path, { method: 'POST', body, throw: false }) as Promise<Response<T>>;
  const password = (value: string | null) => (value === null ? {} : { password: value });

  return {
    signInEmail: (input) =>
      settle(post<{ twoFactorRedirect?: boolean }>('/sign-in/email', input), (data) => ({
        twoFactor: data.twoFactorRedirect === true,
      })),
    signInGoogle: (callbackURL) =>
      settle(post<{ url?: string }>('/sign-in/social', { provider: 'google', callbackURL }), (data) => {
        if (data.url !== undefined) window.location.assign(data.url);
        return null;
      }),
    signInPasskey: () => settle(client.signIn.passkey() as Promise<Response<unknown>>, none),
    signUpEmail: ({ invitationToken, ...input }) =>
      settle(post('/sign-up/email', { ...input, ...(invitationToken === null ? {} : { invitationToken }) }), none),
    requestPasswordReset: (email) =>
      settle(post('/request-password-reset', { email, redirectTo: '/reset-password' }), none),
    resetPassword: (input) => settle(post('/reset-password', input), none),
    verifyTotp: (input) => settle(post('/two-factor/verify-totp', input), none),
    verifyBackupCode: (input) => settle(post('/two-factor/verify-backup-code', input), none),
    signOut: () => settle(post('/sign-out', {}), none),
    enableTwoFactor: (value) =>
      settle(post<{ totpURI: string; backupCodes: string[] }>('/two-factor/enable', password(value)), (data) => ({
        totpURI: data.totpURI,
        backupCodes: data.backupCodes,
      })),
    disableTwoFactor: (value) => settle(post('/two-factor/disable', password(value)), none),
    generateBackupCodes: (value) =>
      settle(post<{ backupCodes: string[] }>('/two-factor/generate-backup-codes', password(value)), (data) => ({
        backupCodes: data.backupCodes,
      })),
    addPasskey: (name) => settle(client.passkey.addPasskey({ name }) as Promise<Response<unknown>>, none),
    deletePasskey: (id) => settle(post('/passkey/delete-passkey', { id }), none),
    changePassword: (input) => settle(post('/change-password', input), none),
  };
}
