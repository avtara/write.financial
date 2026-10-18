// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The instance's Better Auth 1.7 setup (FR-A1–A3, A5, A8–A10, FR-OP1, FR-S8, PRD §9.1 Authentication) and the
 * request helpers the web app calls. Server-only.
 *
 * Better Auth stores users, sessions, credentials, 2FA, and passkeys in the `@wf/db` tables through the Drizzle
 * adapter on the `wf_auth` role; Postgres generates the ids (`uuidv7()`). Counters for rate limiting and lockout
 * live in Valkey/Redis so they hold across processes. Every session lives in Postgres, so the device list and
 * revocation are exact.
 */
import { passkey } from '@better-auth/passkey';
import type { Config } from '@wf/config';
import { firstRow, type Database } from '@wf/db/db';
import type { InstanceSettings } from '@wf/db/instance-settings';
import { createInvitations } from '@wf/db/invitations';
import { accountsAuth, passkeys, sessions, twoFactors, users, verifications } from '@wf/db/schema';
import { createSecurityEvents } from '@wf/db/security-events';
import { isLocale, LOCALE_COOKIE_NAME, type Locale } from '@wf/i18n/locale';
import type { Mailer } from '@wf/integrations/mailer';
import { betterAuth, type Auth, type BetterAuthOptions } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError, getIP } from 'better-auth/api';
import { twoFactor } from 'better-auth/plugins/two-factor';
import { and, eq } from 'drizzle-orm';
import { createAudit, type Audit, type RequestInfo } from './audit.ts';
import { hashedBackupCodeStorage } from './backup-codes.ts';
import { createBreachedPasswordCheck, type AuthLogger, type BreachedPasswordCheck } from './breached.ts';
import { createRedisCounters, rateLimitStorage, type CounterStore, type RedisScripting } from './counters.ts';
import { describeDevice } from './device.ts';
import { createFirstAdmin, hasAdmin, type FirstAdminInput } from './first-admin.ts';
import { deriveKey } from './keys.ts';
import { signUpLocale } from './locale.ts';
import { createLockout, LOCKOUT_POLICY, type Lockout, type LockoutPolicy } from './lockout.ts';
import { hashPassword, MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, verifyPassword } from './password.ts';
import { securityPlugin, stringField, toAuditUser } from './plugin.ts';
import { createRegistrationPolicy, type RegistrationPolicy } from './registration.ts';
import { assertFreshSession, assertTwoFactorEnrolled, FRESH_SESSION_MINUTES, UnauthenticatedError } from './session.ts';
import { appUrl } from './urls.ts';

const MINUTE = 60_000;
const DAY_S = 24 * 60 * 60;
/** PRD §9.1: "remember this device" keeps the session 30 days; otherwise it ends after 12 hours. */
export const SESSION_REMEMBER_S = 30 * DAY_S;
export const SESSION_SHORT_S = 12 * 60 * 60;
/** FR-A3. */
export const RESET_LINK_MINUTES = 30;
export const RESET_COOLDOWN_MS = MINUTE;
/** FR-A8: "trust this device for 30 days". */
export const TRUST_DEVICE_S = 30 * DAY_S;
/** Web route of Settings › Security, linked from new-device emails. */
export const SECURITY_SETTINGS_PATH = 'settings/security';

/**
 * Per-IP limits (requests per window in seconds) on the endpoints worth guessing at; everything else gets
 * 100 per minute. Account lockout limits guesses per account on top of this.
 */
export const RATE_LIMITS = {
  '/sign-in/*': { window: 60, max: 10 },
  '/sign-up/*': { window: 60, max: 5 },
  '/two-factor/*': { window: 60, max: 10 },
  '/passkey/verify-authentication': { window: 60, max: 10 },
  '/request-password-reset': { window: 60, max: 3 },
  '/reset-password': { window: 60, max: 5 },
  '/change-password': { window: 60, max: 5 },
} as const;

/**
 * Better Auth endpoints the web app must not expose: the session list returns session tokens, so devices are
 * listed and revoked through the helpers below (which also record security events); email OTP as a second
 * factor is not offered.
 */
export const DISABLED_PATHS = [
  '/list-sessions',
  '/revoke-session',
  '/revoke-sessions',
  '/revoke-other-sessions',
  '/two-factor/send-otp',
  '/two-factor/verify-otp',
] as const;

export interface AuthDeps {
  readonly config: Pick<Config, 'publicUrl' | 'nodeEnv' | 'auth' | 'google'>;
  /** `createDb(config.db.authUrl)`: the `wf_auth` role. */
  readonly db: Database;
  /** An ioredis client on `config.redis.url`. */
  readonly redis: RedisScripting;
  readonly mailer: Mailer;
  /** `createInstanceSettings(db, keyring).get` (registration mode, default locale and time zone, instance name). */
  readonly settings: () => Promise<InstanceSettings>;
  readonly logger: AuthLogger;
  /** HIBP requests; defaults to the global `fetch`. */
  readonly fetch?: typeof fetch;
  readonly now?: () => Date;
  /** Defaults to FR-A2 (5 failures, 15 minutes). */
  readonly lockoutPolicy?: LockoutPolicy;
}

export interface Device {
  /** Session id; pass it to `revokeDevice`. */
  readonly id: string;
  /** `Firefox · Linux`; `null` without a user agent. */
  readonly label: string | null;
  readonly userAgent: string | null;
  readonly createdAt: Date;
  readonly expiresAt: Date;
  /** The session making this request. */
  readonly current: boolean;
}

/** The session id is not one of the user's sessions. */
export class DeviceNotFoundError extends Error {
  override readonly name = 'DeviceNotFoundError';
  readonly code = 'DEVICE_NOT_FOUND';

  constructor() {
    super('No such device session');
  }
}

/** Better Auth reads these `users` columns too; only `locale` may be sent at sign-up (FR-S8). */
const USER_FIELDS = {
  role: { type: 'string', required: false, input: false },
  locale: {
    type: 'string',
    required: false,
    input: true,
    validator: {
      input: {
        '~standard': {
          version: 1,
          vendor: 'write.financial',
          validate: (value: unknown) =>
            isLocale(value) ? { value } : { issues: [{ message: 'locale must be "id" or "en"' }] },
        },
      },
    },
  },
  timezone: { type: 'string', required: false, input: false },
  onboardingCompletedAt: { type: 'date', required: false, input: false },
  deletionRequestedAt: { type: 'date', required: false, input: false },
} as const satisfies NonNullable<NonNullable<BetterAuthOptions['user']>['additionalFields']>;

/**
 * How the client IP is found: the single address in `X-Forwarded-For`, as set by the reverse proxy (Caddy
 * replaces the header from untrusted clients). Used for rate limiting, sessions, and `ip_hash`.
 */
const IP_ADDRESS = { ipAddressHeaders: ['x-forwarded-for'] };

function requestFrom(headers: Headers | undefined): RequestInfo {
  return {
    ip: headers === undefined ? null : getIP(headers, { advanced: { ipAddress: IP_ADDRESS } }),
    userAgent: headers?.get('user-agent') ?? null,
  };
}

/** What `authOptions` wires into Better Auth, built once by `createAuth`. */
interface Parts {
  readonly deps: AuthDeps;
  readonly now: () => Date;
  readonly publicUrl: URL;
  readonly basePath: string;
  readonly lockout: Lockout;
  readonly isBreached: BreachedPasswordCheck;
  readonly registration: RegistrationPolicy;
  readonly audit: Audit;
  readonly counters: CounterStore;
}

function authOptions({ deps, now, publicUrl, basePath, lockout, isBreached, registration, audit, counters }: Parts) {
  const { config, db, logger } = deps;
  const secret = config.auth.secret;
  const emailContext = async (user: { id: string; email: string; name: string } & Record<string, unknown>) => ({
    locale: toAuditUser(user).locale,
    instanceName: (await deps.settings()).instanceName,
    recipientName: user.name,
  });

  return {
    appName: 'write.financial',
    baseURL: publicUrl.origin,
    basePath,
    secret,
    trustedOrigins: [publicUrl.origin],
    telemetry: { enabled: false },
    logger: {
      level: 'warn',
      // Called as methods: pino's level functions read `this`.
      log: (level, message, ...args) => {
        if (level === 'error') logger.error({ args }, message);
        else logger.warn({ args }, message);
      },
    },
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: {
        users,
        sessions,
        accounts_auth: accountsAuth,
        verifications,
        two_factors: twoFactors,
        passkeys,
      },
    }),
    user: { modelName: 'users', additionalFields: USER_FIELDS },
    session: {
      modelName: 'sessions',
      expiresIn: SESSION_REMEMBER_S,
      // Sessions have a fixed lifetime from sign-in: 30 days remembered, 12 hours otherwise (PRD §9.1).
      disableSessionRefresh: true,
      freshAge: FRESH_SESSION_MINUTES * 60,
    },
    account: {
      modelName: 'accounts_auth',
      encryptOAuthTokens: true,
      accountLinking: { enabled: true, trustedProviders: ['google'] },
    },
    verification: { modelName: 'verifications', storeIdentifier: 'hashed' },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: MIN_PASSWORD_LENGTH,
      maxPasswordLength: MAX_PASSWORD_LENGTH,
      password: { hash: hashPassword, verify: verifyPassword },
      autoSignIn: true,
      requireEmailVerification: false,
      resetPasswordTokenExpiresIn: RESET_LINK_MINUTES * 60,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        const credential = await db
          .select({ id: accountsAuth.id })
          .from(accountsAuth)
          .where(and(eq(accountsAuth.userId, user.id), eq(accountsAuth.providerId, 'credential')));
        await audit.notify({
          to: user.email,
          template: {
            kind: credential.length > 0 ? 'password_reset' : 'set_password',
            url,
            expiresInMinutes: RESET_LINK_MINUTES,
          },
          context: await emailContext(user),
        });
      },
      onPasswordReset: async ({ user }, request) => {
        await lockout.reset(user.email);
        await audit.record(user.id, 'password_reset', requestFrom(request?.headers));
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      expiresIn: DAY_S,
      sendVerificationEmail: async ({ user, url }) => {
        await audit.notify({
          to: user.email,
          template: { kind: 'verify_email', url },
          context: await emailContext(user),
        });
      },
    },
    socialProviders:
      config.google === null
        ? {}
        : {
            google: {
              clientId: config.google.clientId,
              clientSecret: config.google.clientSecret,
              // Sign-in only (FR-A1): identity and email, never Gmail or other Google data.
              disableDefaultScope: true,
              scope: ['openid', 'email', 'profile'],
            },
          },
    rateLimit: {
      enabled: true,
      window: 60,
      max: 100,
      customRules: RATE_LIMITS,
      customStorage: rateLimitStorage(counters, deriveKey(secret, 'rate_limit')),
    },
    advanced: {
      cookiePrefix: 'wf',
      useSecureCookies: config.nodeEnv === 'production',
      defaultCookieAttributes: { httpOnly: true, sameSite: 'lax' },
      database: { generateId: 'uuid' },
      ipAddress: IP_ADDRESS,
      // Better Auth skips the origin check under NODE_ENV=test; enforce it everywhere (CSRF, PRD §9.1).
      disableOriginCheck: false,
    },
    disabledPaths: [...DISABLED_PATHS],
    databaseHooks: {
      user: {
        create: {
          before: async (user, context) => {
            const path = context?.path;
            const admitted = await registration.admitNewUser(
              user.email,
              path === '/sign-up/email'
                ? { kind: 'email', invitationToken: stringField(context?.body, 'invitationToken') }
                : { kind: 'provider' },
            );
            if (!admitted) {
              throw new APIError('FORBIDDEN', {
                code: 'REGISTRATION_CLOSED',
                message: 'Registration on this instance is by invitation only',
              });
            }
            const settings = await deps.settings();
            const locale: Locale = signUpLocale({
              explicit: isLocale(user['locale']) ? user['locale'] : null,
              cookie: context?.getCookie(LOCALE_COOKIE_NAME) ?? null,
              acceptLanguage: context?.headers?.get('accept-language') ?? null,
              instanceDefault: settings.defaultLocale,
            });
            return { data: { ...user, locale, timezone: settings.defaultTimezone } };
          },
        },
      },
      session: {
        create: {
          before: async (session, context) => {
            // A locked account gets no session from any method (passkey, Google), not only from passwords.
            const owner = firstRow(
              await db.select({ email: users.email }).from(users).where(eq(users.id, session.userId)),
              'users',
            );
            if ((await lockout.status(owner.email)).locked) return false;
            // Better Auth gives "don't remember me" sessions one day; ours end after 12 hours. Re-created
            // sessions (2FA enrollment) keep the choice through the don't-remember cookie.
            const dontRemember = await context?.getSignedCookie(
              context.context.authCookies.dontRememberToken.name,
              context.context.secret,
            );
            const lifetimeS = (session.expiresAt.getTime() - session.createdAt.getTime()) / 1000;
            if (lifetimeS > DAY_S && typeof dontRemember !== 'string') return undefined;
            return { data: { ...session, expiresAt: new Date(session.createdAt.getTime() + SESSION_SHORT_S * 1000) } };
          },
        },
      },
    },
    plugins: [
      twoFactor({
        issuer: 'write.financial',
        schema: { twoFactor: { modelName: 'two_factors' } },
        totpOptions: { digits: 6, period: 30 },
        backupCodeOptions: {
          amount: 10,
          length: 10,
          storeBackupCodes: hashedBackupCodeStorage(deriveKey(secret, 'backup_code')),
        },
        trustDeviceMaxAge: TRUST_DEVICE_S,
        // Google-only accounts must be able to enroll (FR-A9); accounts with a password still confirm it.
        allowPasswordless: true,
        // Replaced by the shared password + 2FA lockout in `securityPlugin`.
        accountLockout: { enabled: false },
      }),
      passkey({
        rpID: publicUrl.hostname,
        rpName: 'write.financial',
        origin: publicUrl.origin,
        schema: { passkey: { modelName: 'passkeys' } },
      }),
      securityPlugin({
        lockout,
        isBreached,
        registration,
        audit,
        counters,
        backupCodeKey: deriveKey(secret, 'backup_code'),
        emailKey: deriveKey(secret, 'lockout'),
        resetCooldownMs: RESET_COOLDOWN_MS,
        now,
      }),
    ],
  } satisfies BetterAuthOptions;
}

type WfAuthOptions = ReturnType<typeof authOptions>;
type BetterAuthInstance = Auth<WfAuthOptions>;

/** The signed-in user (with the app's `users` columns) and the session. */
export type AuthSession = BetterAuthInstance['$Infer']['Session'];

export interface WfAuth {
  /** Mount at `${basePath}/*` for every method. */
  readonly handler: (request: Request) => Promise<Response>;
  /** Better Auth's server API (sign-in from server functions, etc.); hooks and policies apply. */
  readonly api: BetterAuthInstance['api'];
  /** `/api/auth` under the path of `PUBLIC_URL`. */
  readonly basePath: string;
  /** The signed-in user and session, or `null`. */
  getSession: (headers: Headers) => Promise<AuthSession | null>;
  /** @throws {UnauthenticatedError} */
  requireSession: (headers: Headers) => Promise<AuthSession>;
  /**
   * FR-A9 gate (saving API keys, Gmail, export, account deletion; every admin action).
   * @throws {UnauthenticatedError | TwoFactorRequiredError}
   */
  requireTwoFactorEnrolled: (headers: Headers) => Promise<AuthSession>;
  /**
   * FR-A9 re-authentication: the session must be at most `maxAgeMinutes` (default 15) old.
   * @throws {UnauthenticatedError | ReauthenticationRequiredError}
   */
  requireFreshSession: (headers: Headers, maxAgeMinutes?: number) => Promise<AuthSession>;
  /** FR-A5: the user's signed-in devices, newest first. */
  listDevices: (headers: Headers) => Promise<Device[]>;
  /**
   * Signs one device out (FR-A5) and records `session_revoked`.
   * @throws {DeviceNotFoundError} if `sessionId` is not one of the user's sessions.
   */
  revokeDevice: (headers: Headers, sessionId: string) => Promise<void>;
  /** Signs out every device but this one (FR-A5), records it, and returns how many were signed out. */
  revokeOtherDevices: (headers: Headers) => Promise<number>;
  /** Whether an admin exists; the setup wizard is shown only while it does not (FR-OP1). */
  hasAdmin: () => Promise<boolean>;
  /** The setup wizard's bootstrap path; see `first-admin.ts`. */
  createFirstAdmin: (input: FirstAdminInput) => Promise<{ userId: string }>;
}

export function createAuth(deps: AuthDeps): WfAuth {
  const { config, db, logger } = deps;
  const now = deps.now ?? (() => new Date());
  const secret = config.auth.secret;
  const publicUrl = new URL(config.publicUrl);
  const basePath = `${publicUrl.pathname.replace(/\/$/, '')}/api/auth`;

  const counters = createRedisCounters(deps.redis, 'wf:auth:');
  const lockout = createLockout({
    counters,
    key: deriveKey(secret, 'lockout'),
    policy: deps.lockoutPolicy ?? LOCKOUT_POLICY,
    now,
  });
  const isBreached = createBreachedPasswordCheck({
    logger,
    ...(deps.fetch === undefined ? {} : { fetch: deps.fetch }),
  });
  const registration = createRegistrationPolicy({ settings: deps.settings, invitations: createInvitations(db) });
  const audit = createAudit({
    events: createSecurityEvents(db),
    mailer: deps.mailer,
    logger,
    ipKey: deriveKey(secret, 'ip_hash'),
    deviceKey: deriveKey(secret, 'device'),
    instanceName: async () => (await deps.settings()).instanceName,
    securityUrl: appUrl(config.publicUrl, SECURITY_SETTINGS_PATH),
    now,
  });

  const auth = betterAuth(
    authOptions({ deps, now, publicUrl, basePath, lockout, isBreached, registration, audit, counters }),
  );

  const getSession = (headers: Headers) => auth.api.getSession({ headers });
  const requireSession = async (headers: Headers) => {
    const session = await getSession(headers);
    if (session === null) throw new UnauthenticatedError();
    return session;
  };
  const listSessions = (headers: Headers) => auth.api.listSessions({ headers });

  return {
    handler: auth.handler,
    api: auth.api,
    basePath,
    getSession,
    requireSession,
    requireTwoFactorEnrolled: async (headers) => {
      const session = await requireSession(headers);
      assertTwoFactorEnrolled(session);
      return session;
    },
    requireFreshSession: async (headers, maxAgeMinutes = FRESH_SESSION_MINUTES) => {
      const session = await requireSession(headers);
      assertFreshSession(session, now(), maxAgeMinutes);
      return session;
    },
    listDevices: async (headers) => {
      const { session } = await requireSession(headers);
      return (await listSessions(headers))
        .map((s) => ({
          id: s.id,
          // Better Auth stores an empty user agent when the request had none.
          label: describeDevice(s.userAgent || null),
          userAgent: s.userAgent || null,
          createdAt: s.createdAt,
          expiresAt: s.expiresAt,
          current: s.id === session.id,
        }))
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    },
    revokeDevice: async (headers, sessionId) => {
      const { user } = await requireSession(headers);
      const target = (await listSessions(headers)).find((s) => s.id === sessionId);
      if (target === undefined) throw new DeviceNotFoundError();
      await auth.api.revokeSession({ headers, body: { token: target.token } });
      await audit.record(user.id, 'session_revoked', requestFrom(headers), { sessionId });
    },
    revokeOtherDevices: async (headers) => {
      const { user, session } = await requireSession(headers);
      const others = (await listSessions(headers)).filter((s) => s.id !== session.id).length;
      await auth.api.revokeOtherSessions({ headers });
      await audit.record(user.id, 'session_revoked', requestFrom(headers), { scope: 'others', count: others });
      return others;
    },
    hasAdmin: () => hasAdmin(db),
    createFirstAdmin: (input) => createFirstAdmin({ db, hashPassword, isBreached }, input),
  };
}
