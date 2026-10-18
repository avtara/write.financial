// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The instance's security policies as a Better Auth plugin: hooks around Better Auth's own endpoints, so they
 * apply to the HTTP handler and to `auth.api.*` alike.
 *
 * - Lockout (FR-A2, `lockout.ts`): sign-in and 2FA challenges are refused while the account is locked; a wrong
 *   password or code counts a failure, and the error carries `remainingAttempts` (and `lockedUntil` once locked).
 * - Registration (FR-OP1, `registration.ts`): email sign-up needs an invitation unless registration is open.
 * - Breached passwords (PRD §9.1, `breached.ts`) on every endpoint that sets a password.
 * - Backup codes are compared as keyed hashes (`backup-codes.ts`).
 * - Password-reset emails have a per-address cooldown (FR-A3).
 * - Security history (FR-A10, `audit.ts`): sign-ins (with new-device email), sign-out, failures and lockout, 2FA
 *   enabled/disabled, backup codes regenerated, passkey added/removed, password changed.
 */
import { defineRequestState } from '@better-auth/core/context';
import { hmacSha256Hex } from '@wf/crypto/hash';
import type { JsonObject } from '@wf/db/schema';
import type { SecurityEventType } from '@wf/db/security-events';
import { isLocale } from '@wf/i18n/locale';
import type { BetterAuthOptions, BetterAuthPlugin } from 'better-auth';
import { APIError, createAuthMiddleware, getIP, getSessionFromCtx, isAPIError } from 'better-auth/api';
import type { Audit, AuditUser, RequestInfo, SignInMethod } from './audit.ts';
import { hashBackupCode } from './backup-codes.ts';
import type { BreachedPasswordCheck } from './breached.ts';
import type { CounterStore } from './counters.ts';
import type { Lockout, LockoutState } from './lockout.ts';
import { InvalidInvitationError, RegistrationClosedError, type RegistrationPolicy } from './registration.ts';

export interface SecurityPluginDeps {
  readonly lockout: Lockout;
  readonly isBreached: BreachedPasswordCheck;
  readonly registration: RegistrationPolicy;
  readonly audit: Audit;
  readonly counters: CounterStore;
  /** `deriveKey(AUTH_SECRET, 'backup_code')`. */
  readonly backupCodeKey: Uint8Array;
  /** `deriveKey(AUTH_SECRET, 'lockout')`, also used to key the reset cooldown by email. */
  readonly emailKey: Uint8Array;
  /** Minimum time between two password-reset emails to one address (FR-A3). */
  readonly resetCooldownMs: number;
  readonly now: () => Date;
}

type HookContext = Parameters<Parameters<typeof createAuthMiddleware>[0]>[0];

/** The same message Better Auth returns for a real reset request, so the cooldown reveals nothing. */
const RESET_REQUESTED = 'If this email exists in our system, check your email for the reset link';
/** Endpoints that set a new password, and the body field that carries it. */
const PASSWORD_FIELDS: Readonly<Record<string, string>> = {
  '/sign-up/email': 'password',
  '/change-password': 'newPassword',
  '/reset-password': 'newPassword',
};
const VERIFY_TOTP = '/two-factor/verify-totp';
const VERIFY_BACKUP_CODE = '/two-factor/verify-backup-code';
const SIGN_IN_PATHS: Readonly<Record<string, SignInMethod>> = {
  '/sign-in/email': 'password',
  '/passkey/verify-authentication': 'passkey',
  '/callback/:id': 'google',
  '/sign-up/email': 'sign_up',
};
/** Signed-in actions recorded after they succeed; the actor is read before the endpoint can rotate the session. */
const ACTOR_EVENTS: Readonly<Record<string, SecurityEventType>> = {
  '/sign-out': 'sign_out',
  '/change-password': 'password_changed',
  '/two-factor/disable': 'two_factor_disabled',
  '/two-factor/generate-backup-codes': 'backup_codes_regenerated',
  '/passkey/verify-registration': 'passkey_added',
  '/passkey/delete-passkey': 'passkey_removed',
};

type TwoFactorFlow =
  /** Verification while signed in: enrolling (the first TOTP code turns 2FA on) or checking a code. */
  | { readonly kind: 'session'; readonly userId: string; readonly wasEnabled: boolean }
  | { readonly kind: 'challenge'; readonly user: AuditUser };

/** What a `before` hook learned for the matching `after` hook of the same request. */
const requestState = defineRequestState<{ actor: string | null; twoFactor: TwoFactorFlow | null }>(() => ({
  actor: null,
  twoFactor: null,
}));

/** A string property of an untrusted request body (or any value), else `null`. */
export const stringField = (value: unknown, field: string): string | null => {
  if (typeof value !== 'object' || value === null || !(field in value)) return null;
  const found: unknown = Reflect.get(value, field);
  return typeof found === 'string' ? found : null;
};

/** The fields of a Better Auth user record the audit needs (Better Auth types extra columns loosely). */
export function toAuditUser(user: { id: string; email: string; name: string } & Record<string, unknown>): AuditUser {
  const { locale, timezone } = user;
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    locale: isLocale(locale) ? locale : 'id',
    timezone: typeof timezone === 'string' ? timezone : 'Asia/Jakarta',
  };
}

export function requestInfo(
  ctx: Pick<HookContext, 'request' | 'headers'> & { context: { options: BetterAuthOptions } },
): RequestInfo {
  const source = ctx.request ?? ctx.headers;
  return {
    ip: source === undefined ? null : getIP(source, ctx.context.options),
    userAgent: ctx.headers?.get('user-agent') ?? null,
  };
}

/** Non-secret details for a signed-in action's security event: which passkey was added or removed. */
export function actorEventMeta(path: string, body: unknown, returned: unknown): JsonObject {
  if (path === '/passkey/delete-passkey') return { passkeyId: stringField(body, 'id') ?? '' };
  if (path === '/passkey/verify-registration') return { name: stringField(returned, 'name') ?? '' };
  return {};
}

function lockedError(state: Extract<LockoutState, { locked: true }>, status: APIError['status'], now: Date): APIError {
  const retryAfter = Math.max(1, Math.ceil((state.lockedUntil.getTime() - now.getTime()) / 1000));
  return new APIError(
    status,
    {
      code: 'ACCOUNT_LOCKED',
      message: 'Too many failed attempts. Try again later.',
      remainingAttempts: 0,
      lockedUntil: state.lockedUntil.toISOString(),
    },
    { 'Retry-After': String(retryAfter) },
  );
}

export function securityPlugin(deps: SecurityPluginDeps): BetterAuthPlugin {
  const { lockout, audit } = deps;

  const refuseIfLocked = async (email: string) => {
    const state = await lockout.status(email);
    if (state.locked) throw lockedError(state, 'TOO_MANY_REQUESTS', deps.now());
  };

  /** Counts a wrong password or code and rethrows `original` with the remaining attempts. */
  const failed = async (
    ctx: HookContext,
    email: string,
    user: AuditUser | null,
    factor: 'password' | 'totp' | 'backup_code',
    original: APIError,
  ): Promise<never> => {
    const state = await lockout.recordFailure(email);
    if (user !== null) {
      const info = requestInfo(ctx);
      await audit.record(user.id, 'sign_in_failed', info, { factor, remainingAttempts: state.remainingAttempts });
      if (state.locked) {
        await audit.record(user.id, 'account_locked', info, { lockedUntil: state.lockedUntil.toISOString() });
      }
    }
    if (state.locked) throw lockedError(state, original.status, deps.now());
    throw new APIError(original.status, { ...original.body, remainingAttempts: state.remainingAttempts });
  };

  const signedIn = async (ctx: HookContext, user: AuditUser, method: SignInMethod) => {
    await lockout.reset(user.email);
    await audit.signIn(user, requestInfo(ctx), method);
  };

  const before = createAuthMiddleware(async (ctx) => {
    const { path } = ctx;
    const body: unknown = ctx.body;

    if (path === '/sign-up/email') {
      try {
        await deps.registration.checkEmailSignUp(
          stringField(body, 'email') ?? '',
          stringField(body, 'invitationToken'),
        );
      } catch (error) {
        if (error instanceof RegistrationClosedError || error instanceof InvalidInvitationError) {
          throw new APIError('FORBIDDEN', { code: error.code, message: error.message });
        }
        throw error;
      }
    }

    const passwordField = PASSWORD_FIELDS[path];
    const password = passwordField === undefined ? null : stringField(body, passwordField);
    if (password !== null && (await deps.isBreached(password))) {
      throw new APIError('BAD_REQUEST', {
        code: 'PASSWORD_COMPROMISED',
        message: 'This password appeared in a data breach. Choose a different one.',
      });
    }

    if (path === '/sign-in/email') await refuseIfLocked(stringField(body, 'email') ?? '');

    if (path === '/request-password-reset') {
      const email = (stringField(body, 'email') ?? '').trim().toLowerCase();
      const { count } = await deps.counters.hit(`reset:${hmacSha256Hex(deps.emailKey, email)}`, deps.resetCooldownMs);
      if (count > 1) return ctx.json({ status: true, message: RESET_REQUESTED });
    }

    if (path in ACTOR_EVENTS) (await requestState.get()).actor = (await getSessionFromCtx(ctx))?.user.id ?? null;

    if (path === VERIFY_TOTP || path === VERIFY_BACKUP_CODE) {
      const session = await getSessionFromCtx(ctx);
      if (session !== null) {
        (await requestState.get()).twoFactor = {
          kind: 'session',
          userId: session.user.id,
          wasEnabled: session.user['twoFactorEnabled'] === true,
        };
      } else {
        const cookie = ctx.context.createAuthCookie('two_factor');
        const challenge = await ctx.getSignedCookie(cookie.name, ctx.context.secret);
        const verification =
          typeof challenge === 'string' ? await ctx.context.internalAdapter.findVerificationValue(challenge) : null;
        const user = verification === null ? null : await ctx.context.internalAdapter.findUserById(verification.value);
        if (user !== null) {
          await refuseIfLocked(user.email);
          (await requestState.get()).twoFactor = { kind: 'challenge', user: toAuditUser(user) };
        }
      }
      if (path === VERIFY_BACKUP_CODE) {
        const fields = typeof body === 'object' && body !== null ? body : {};
        const code = hashBackupCode(deps.backupCodeKey, stringField(body, 'code') ?? '');
        return { context: { body: { ...fields, code } } };
      }
    }
    return undefined;
  });

  const after = createAuthMiddleware(async (ctx) => {
    const { path } = ctx;
    const body: unknown = ctx.body;
    const { returned, newSession } = ctx.context;
    const failure = isAPIError(returned) ? returned : null;

    const email = stringField(body, 'email');
    if (path === '/sign-in/email' && email !== null && failure?.body?.code === 'INVALID_EMAIL_OR_PASSWORD') {
      const found = await ctx.context.internalAdapter.findUserByEmail(email);
      await failed(ctx, email, found === null ? null : toAuditUser(found.user), 'password', failure);
    }

    const method = SIGN_IN_PATHS[path];
    if (method !== undefined && newSession !== null) await signedIn(ctx, toAuditUser(newSession.user), method);

    if (path === VERIFY_TOTP || path === VERIFY_BACKUP_CODE) {
      const flow = (await requestState.get()).twoFactor;
      const factor = path === VERIFY_TOTP ? 'totp' : 'backup_code';
      if (flow?.kind === 'challenge') {
        const code = failure?.body?.code;
        if (failure !== null && (code === 'INVALID_CODE' || code === 'INVALID_BACKUP_CODE')) {
          await failed(ctx, flow.user.email, flow.user, factor, failure);
        }
        if (newSession !== null) await signedIn(ctx, flow.user, factor);
      } else if (flow?.kind === 'session' && failure === null && path === VERIFY_TOTP && !flow.wasEnabled) {
        await audit.record(flow.userId, 'two_factor_enabled', requestInfo(ctx));
      }
    }

    const event = ACTOR_EVENTS[path];
    const userId = event === undefined ? null : (await requestState.get()).actor;
    if (event !== undefined && userId !== null && failure === null) {
      await audit.record(userId, event, requestInfo(ctx), actorEventMeta(path, body, returned));
    }
  });

  return {
    id: 'write-financial-security',
    hooks: {
      before: [{ matcher: () => true, handler: before }],
      after: [{ matcher: () => true, handler: after }],
    },
  };
}
