// SPDX-License-Identifier: AGPL-3.0-only
import { insertUser, PGLITE_HOOK_TIMEOUT } from '@wf/db/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BREACHED_PASSWORD,
  CHROME,
  hibpServer,
  ORIGIN,
  PASSWORD,
  resetHarness,
  startHarness,
  type Harness,
} from '../test/harness.ts';
import { DeviceNotFoundError, DISABLED_PATHS, RATE_LIMITS, SESSION_REMEMBER_S, SESSION_SHORT_S } from './auth.ts';
import { AdminExistsError } from './first-admin.ts';
import { ReauthenticationRequiredError, TwoFactorRequiredError, UnauthenticatedError } from './session.ts';

// Whole sign-in flows through Argon2id and PGlite; under a parallel test run they need more than the default 5 s.
vi.setConfig({ testTimeout: 30_000 });

const hibp = hibpServer();
let h: Harness;

beforeAll(async () => {
  hibp.listen({ onUnhandledFrame: 'error' });
  h = await startHarness();
}, PGLITE_HOOK_TIMEOUT);

afterAll(async () => {
  hibp.close();
  await h.db.close();
});

beforeEach(async () => {
  await resetHarness(h);
  h.rebuild();
});

const ADMIN = { email: 'admin@example.test', password: PASSWORD, name: 'Sari', locale: 'en' } as const;
const events = (userId: string) =>
  h.asRole('postgres', () =>
    h.db.query<{ type: string; meta: Record<string, unknown>; ip_hash: string | null }>(
      'SELECT type, meta, ip_hash FROM security_events WHERE user_id = $1 ORDER BY id',
      [userId],
    ),
  );
const sessionRows = (userId: string) =>
  h.asRole('postgres', () =>
    h.db.query<{ id: string; created_at: Date; expires_at: Date }>(
      'SELECT id, created_at, expires_at FROM sessions WHERE user_id = $1 ORDER BY created_at',
      [userId],
    ),
  );
const lifetimeS = (row: { created_at: Date; expires_at: Date } | undefined) =>
  Math.round(((row?.expires_at.getTime() ?? 0) - (row?.created_at.getTime() ?? 0)) / 1000);

describe('first admin (FR-OP1)', () => {
  it('is created once, signs in with Argon2id, and must still enroll 2FA', async () => {
    expect(await h.auth.hasAdmin()).toBe(false);
    const { userId } = await h.auth.createFirstAdmin(ADMIN);
    expect(await h.auth.hasAdmin()).toBe(true);
    await expect(h.auth.createFirstAdmin({ ...ADMIN, email: 'x@example.test' })).rejects.toBeInstanceOf(
      AdminExistsError,
    );

    const browser = h.browser();
    const { status, body } = await browser.signIn(ADMIN.email);
    expect(status).toBe(200);
    expect(body).toMatchObject({ user: { id: userId, role: 'admin', locale: 'en', twoFactorEnabled: false } });

    const session = await h.auth.requireSession(browser.headers());
    expect(session.user).toMatchObject({ id: userId, role: 'admin' });
    await expect(h.auth.requireTwoFactorEnrolled(browser.headers())).rejects.toBeInstanceOf(TwoFactorRequiredError);
    expect(await events(userId)).toMatchObject([
      {
        type: 'sign_in',
        meta: { method: 'password', newDevice: false },
        ip_hash: expect.stringMatching(/^[0-9a-f]{64}$/) as unknown,
      },
    ]);
  });

  it('refuses a breached password', async () => {
    await expect(h.auth.createFirstAdmin({ ...ADMIN, password: BREACHED_PASSWORD })).rejects.toMatchObject({
      code: 'PASSWORD_COMPROMISED',
    });
  });
});

describe('sessions (PRD §9.1)', () => {
  it('last 30 days when remembered and 12 hours otherwise, with httpOnly SameSite=Lax cookies', async () => {
    const { userId } = await h.auth.createFirstAdmin(ADMIN);
    const remembered = await h.browser().request('/sign-in/email', { email: ADMIN.email, password: PASSWORD });
    const cookie = remembered.headers.getSetCookie().find((c) => c.startsWith('wf.session_token=')) ?? '';
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(new RegExp(`Max-Age=${SESSION_REMEMBER_S}`));
    await h.browser().signIn(ADMIN.email, PASSWORD, { rememberMe: false });
    const [long, short] = await sessionRows(userId);
    expect(lifetimeS(long)).toBe(SESSION_REMEMBER_S);
    expect(lifetimeS(short)).toBe(SESSION_SHORT_S);
  });

  it('rotate: every sign-in gets a new session token', async () => {
    await h.auth.createFirstAdmin(ADMIN);
    const browser = h.browser();
    await browser.signIn(ADMIN.email);
    const first = browser.cookies.get('wf.session_token');
    await browser.signIn(ADMIN.email);
    expect(browser.cookies.get('wf.session_token')).not.toBe(first);
  });

  it('use Secure cookies in production', async () => {
    h.rebuild({ nodeEnv: 'production' });
    await h.auth.createFirstAdmin(ADMIN);
    const response = await h.browser().request('/sign-in/email', { email: ADMIN.email, password: PASSWORD });
    const cookie = response.headers.getSetCookie().find((c) => c.includes('wf.session_token=')) ?? '';
    expect(cookie).toMatch(/^__Secure-wf\.session_token=/);
    expect(cookie).toMatch(/; Secure/i);
  });

  it('refuse requests from another origin (CSRF)', async () => {
    await h.auth.createFirstAdmin(ADMIN);
    const browser = h.browser();
    await browser.signIn(ADMIN.email);
    const response = await browser.request('/sign-out', {}, { headers: { origin: 'https://evil.example' } });
    expect(response.status).toBe(403);
    expect(await h.auth.getSession(browser.headers())).not.toBeNull();
  });
});

describe('request helpers', () => {
  it('reject requests without a session', async () => {
    const headers = new Headers({ origin: ORIGIN });
    expect(await h.auth.getSession(headers)).toBeNull();
    await expect(h.auth.requireSession(headers)).rejects.toBeInstanceOf(UnauthenticatedError);
    await expect(h.auth.requireTwoFactorEnrolled(headers)).rejects.toBeInstanceOf(UnauthenticatedError);
    await expect(h.auth.requireFreshSession(headers)).rejects.toBeInstanceOf(UnauthenticatedError);
  });

  it('require a session at most 15 minutes old for sensitive actions (FR-A9)', async () => {
    await h.auth.createFirstAdmin(ADMIN);
    const browser = h.browser();
    await browser.signIn(ADMIN.email);
    const { session } = await h.auth.requireSession(browser.headers());
    h.now = new Date(session.createdAt.getTime() + 15 * 60_000);
    await expect(h.auth.requireFreshSession(browser.headers())).resolves.toMatchObject({ session: { id: session.id } });
    h.now = new Date(session.createdAt.getTime() + 15 * 60_000 + 1);
    await expect(h.auth.requireFreshSession(browser.headers())).rejects.toBeInstanceOf(ReauthenticationRequiredError);
    await expect(h.auth.requireFreshSession(browser.headers(), 30)).resolves.toBeDefined();
  });

  it('list devices without tokens, revoke one, and revoke all others, recording each (FR-A5)', async () => {
    const { userId } = await h.auth.createFirstAdmin(ADMIN);
    const laptop = h.browser();
    const phone = h.browser({ userAgent: CHROME, ip: '198.51.100.20' });
    const tablet = h.browser({ ip: '198.51.100.21' });
    for (const browser of [laptop, phone, tablet]) await browser.signIn(ADMIN.email);

    const devices = await h.auth.listDevices(laptop.headers());
    expect(devices).toHaveLength(3);
    expect(devices.filter((device) => device.current)).toHaveLength(1);
    expect(devices.map((device) => device.label)).toContain('Chrome · macOS');
    expect(JSON.stringify(devices)).not.toContain(laptop.cookies.get('wf.session_token')?.split('.')[0]);
    expect(devices[0]?.createdAt.getTime()).toBeGreaterThanOrEqual(devices[2]?.createdAt.getTime() ?? Infinity);

    const phoneId = (await h.auth.requireSession(phone.headers())).session.id;
    await h.auth.revokeDevice(laptop.headers(), phoneId);
    expect(await h.auth.getSession(phone.headers())).toBeNull();
    await expect(h.auth.revokeDevice(laptop.headers(), phoneId)).rejects.toBeInstanceOf(DeviceNotFoundError);

    // A session created without request headers has no user agent.
    await h.auth.api.signInEmail({ body: { email: ADMIN.email, password: PASSWORD } });
    expect((await h.auth.listDevices(laptop.headers())).filter((d) => d.userAgent === null)).toMatchObject([
      { label: null },
    ]);
    expect(await h.auth.revokeOtherDevices(laptop.headers())).toBe(2);
    expect(await h.auth.getSession(tablet.headers())).toBeNull();
    expect(await h.auth.getSession(laptop.headers())).not.toBeNull();
    expect((await events(userId)).filter((e) => e.type === 'session_revoked').map((e) => e.meta)).toEqual([
      { sessionId: phoneId },
      { scope: 'others', count: 2 },
    ]);
  });

  it('do not expose the session list and revocation endpoints over HTTP', async () => {
    await h.auth.createFirstAdmin(ADMIN);
    const browser = h.browser();
    await browser.signIn(ADMIN.email);
    expect(DISABLED_PATHS).toContain('/list-sessions');
    expect((await browser.request('/list-sessions')).status).toBe(404);
    expect((await browser.request('/revoke-other-sessions', {})).status).toBe(404);
  });

  it('expose the base path under PUBLIC_URL', () => {
    expect(h.auth.basePath).toBe('/api/auth');
  });
});

describe('registration (FR-OP1)', () => {
  const signUp = (body: Record<string, unknown>, headers: Record<string, string> = {}) =>
    h.browser().json(
      '/sign-up/email',
      { name: 'Budi', email: 'budi@example.test', password: PASSWORD, ...body },
      {
        headers,
      },
    );

  it.each(['closed', 'invite'] as const)(
    '%s: refuses sign-up without an invitation, even for a known email',
    async (mode) => {
      h.settings = { ...h.settings, registrationMode: mode };
      await h.auth.createFirstAdmin(ADMIN);
      expect(await signUp({})).toMatchObject({ status: 403, body: { code: 'REGISTRATION_CLOSED' } });
      expect(await signUp({ email: ADMIN.email })).toMatchObject({
        status: 403,
        body: { code: 'REGISTRATION_CLOSED' },
      });
      expect(await signUp({ invitationToken: 'made-up' })).toMatchObject({
        status: 403,
        body: { code: 'INVALID_INVITATION' },
      });
    },
  );

  it('accepts an invited sign-up once, with the language from Accept-Language and the instance time zone', async () => {
    const { userId: adminId } = await h.auth.createFirstAdmin(ADMIN);
    const token = await h.invite(adminId, 'budi@example.test');
    const { status, body } = await signUp({ invitationToken: token }, { 'accept-language': 'id-ID,id;q=0.9' });
    expect(status).toBe(200);
    expect(body).toMatchObject({
      user: { email: 'budi@example.test', locale: 'id', timezone: 'Asia/Makassar', role: 'user' },
    });
    const again = await signUp({ invitationToken: token, email: 'budi2@example.test' });
    expect(again).toMatchObject({ status: 403, body: { code: 'INVALID_INVITATION' } });
    expect(h.sent.map((m) => m.template.kind)).toEqual(['verify_email']);
    expect(h.sent[0]).toMatchObject({ to: 'budi@example.test', context: { locale: 'id', recipientName: 'Budi' } });
  });

  it('refuses a stale invitation between the check and the account creation', async () => {
    const { userId: adminId } = await h.auth.createFirstAdmin(ADMIN);
    const token = await h.invite(adminId, 'budi@example.test');
    // Another request uses the invitation after this one's check: the claim in the user hook must fail.
    await h.asRole('postgres', () =>
      h.db.query("UPDATE invitations SET used_at = now() WHERE email = 'budi@example.test'"),
    );
    expect(await signUp({ invitationToken: token })).toMatchObject({
      status: 403,
      body: { code: 'INVALID_INVITATION' },
    });
  });

  it('lets anyone sign up when open, honouring an explicit language and a role in the body is ignored', async () => {
    h.settings = { ...h.settings, registrationMode: 'open' };
    const { status, body } = await signUp({ locale: 'en' }, { 'accept-language': 'id' });
    expect(status).toBe(200);
    expect(body).toMatchObject({ user: { locale: 'en' } });
    expect(await signUp({ email: 'c@example.test', role: 'admin' })).toMatchObject({ status: 400 });
    expect(await signUp({ email: 'd@example.test', locale: 'fr' })).toMatchObject({ status: 400 });
  });

  it('takes the language from the switcher cookie, then the instance default', async () => {
    h.settings = { ...h.settings, registrationMode: 'open', defaultLocale: 'en' };
    expect(await signUp({}, { cookie: 'wf_locale=id' })).toMatchObject({ body: { user: { locale: 'id' } } });
    expect(await signUp({ email: 'x@example.test' })).toMatchObject({ body: { user: { locale: 'en' } } });
  });

  it('refuses short and breached passwords', async () => {
    h.settings = { ...h.settings, registrationMode: 'open' };
    expect(await signUp({ password: 'short1234' })).toMatchObject({
      status: 400,
      body: { code: 'PASSWORD_TOO_SHORT' },
    });
    expect(await signUp({ password: BREACHED_PASSWORD })).toMatchObject({
      status: 400,
      body: { code: 'PASSWORD_COMPROMISED' },
    });
  });

  it('fails closed (500) when the instance settings cannot be read', async () => {
    h.settingsError = new Error('database down');
    const response = await h
      .browser()
      .request('/sign-up/email', { name: 'B', email: 'b@example.test', password: PASSWORD });
    expect(response.status).toBe(500);
    expect(h.logger.error).toHaveBeenCalled();
    // Called as a method, so pino's `this` is the logger.
    expect(h.logger.error.mock.contexts[0]).toBe(h.logger);
  });
});

describe('password reset (FR-A3)', () => {
  it('emails a 30-minute link once per minute per address and records the reset', async () => {
    const { userId } = await h.auth.createFirstAdmin(ADMIN);
    const browser = h.browser();
    await browser.signIn(ADMIN.email);
    const request = () => h.browser().json('/request-password-reset', { email: ADMIN.email, redirectTo: '/forgot' });
    expect(await request()).toMatchObject({ status: 200, body: { status: true } });
    expect(await request()).toMatchObject({ status: 200, body: { status: true } });
    expect(h.sent).toHaveLength(1);
    const [mail] = h.sent;
    expect(mail).toMatchObject({
      to: ADMIN.email,
      template: { kind: 'password_reset', expiresInMinutes: 30 },
      context: { locale: 'en', instanceName: 'Keuangan Keluarga', recipientName: 'Sari' },
    });
    const url = new URL(mail?.template.kind === 'password_reset' ? mail.template.url : '');
    const token = url.pathname.split('/').at(-1) ?? '';
    const stored = await h.asRole('postgres', () =>
      h.db.query<{ expires_at: Date; identifier: string }>('SELECT expires_at, identifier FROM verifications'),
    );
    expect(stored).toHaveLength(1);
    expect(stored[0]?.identifier).not.toContain(token);

    expect(await h.browser().json('/reset-password', { token, newPassword: BREACHED_PASSWORD })).toMatchObject({
      status: 400,
      body: { code: 'PASSWORD_COMPROMISED' },
    });
    const newPassword = `${PASSWORD}-new`;
    expect(await h.browser().json('/reset-password', { token, newPassword })).toMatchObject({ status: 200 });
    expect(await h.auth.getSession(browser.headers())).toBeNull();
    expect((await h.browser().signIn(ADMIN.email, newPassword)).status).toBe(200);
    expect((await events(userId)).map((e) => e.type)).toContain('password_reset');

    // Through the server API without a request, the event has no IP or user agent.
    await h.browser().json('/request-password-reset', { email: 'other@example.test' });
    await h.redis.flushall();
    await h.browser().json('/request-password-reset', { email: ADMIN.email });
    const second = h.sent.at(-1);
    const secondToken = new URL(second?.template.kind === 'password_reset' ? second.template.url : '').pathname
      .split('/')
      .at(-1);
    await h.auth.api.resetPassword({ body: { token: secondToken ?? '', newPassword: `${PASSWORD}-again` } });
    const resets = (await events(userId)).filter((e) => e.type === 'password_reset');
    expect(resets.at(-1)?.ip_hash).toBeNull();
  });

  it('answers the same for an unknown address and sends nothing', async () => {
    expect(await h.browser().json('/request-password-reset', { email: 'nobody@example.test' })).toMatchObject({
      status: 200,
    });
    expect(h.sent).toEqual([]);
    expect(h.logger.warn).toHaveBeenCalled();
    expect(h.logger.warn.mock.contexts[0]).toBe(h.logger);
  });

  it('sends a set-password link to an account without a password (Google only)', async () => {
    await h.asRole('postgres', () => insertUser(h.db, 'google@example.test'));
    await h.browser().json('/request-password-reset', { email: 'google@example.test' });
    expect(h.sent).toMatchObject([
      {
        to: 'google@example.test',
        template: { kind: 'set_password', expiresInMinutes: 30 },
        context: { locale: 'id' },
      },
    ]);
  });
});

describe('rate limiting (PRD §9.1)', () => {
  it('limits sign-in attempts per IP across Redis-backed counters', async () => {
    const browser = h.browser({ ip: '192.0.2.50' });
    const { max } = RATE_LIMITS['/sign-in/*'];
    for (let i = 0; i < max; i++) {
      expect((await browser.signIn(`nobody${i}@example.test`)).status).toBe(401);
    }
    const limited = await browser.request('/sign-in/email', { email: 'x@example.test', password: PASSWORD });
    expect(limited.status).toBe(429);
    expect((await h.browser({ ip: '192.0.2.51' }).signIn('x@example.test')).status).toBe(401);
  });
});

describe('Google sign-in (FR-A1)', () => {
  it('is offered only when configured, asking for identity and email only', async () => {
    const without = await h.browser().json('/sign-in/social', { provider: 'google', callbackURL: '/' });
    expect(without.status).toBe(404);
    h.rebuild({ google: { clientId: 'client-id', clientSecret: 'client-secret', gmail: null } });
    const { status, body } = await h.browser().json<{ url: string }>('/sign-in/social', {
      provider: 'google',
      callbackURL: '/',
    });
    expect(status).toBe(200);
    const url = new URL(body.url);
    expect(url.origin).toBe('https://accounts.google.com');
    expect(url.searchParams.get('scope')).toBe('openid email profile');
    expect(url.searchParams.get('redirect_uri')).toBe(`${ORIGIN}/api/auth/callback/google`);
  });
});
