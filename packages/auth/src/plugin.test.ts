// SPDX-License-Identifier: AGPL-3.0-only
import { insertUser, PGLITE_HOOK_TIMEOUT } from '@wf/db/testing';
import { http, HttpResponse } from 'msw';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BREACHED_PASSWORD,
  CHROME,
  hibpServer,
  ORIGIN,
  PASSWORD,
  resetHarness,
  SECRET,
  startHarness,
  totpFrom,
  wrongCode,
  type Browser,
  type Harness,
} from '../test/harness.ts';
import { SESSION_SHORT_S } from './auth.ts';
import { hashBackupCode } from './backup-codes.ts';
import { deriveKey } from './keys.ts';
import { actorEventMeta, requestInfo, stringField, toAuditUser } from './plugin.ts';

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

const EMAIL = 'admin@example.test';
const createAdmin = () => h.auth.createFirstAdmin({ email: EMAIL, password: PASSWORD, name: 'Sari', locale: 'id' });
const events = (userId: string) =>
  h.asRole('postgres', () =>
    h.db.query<{ type: string; meta: Record<string, unknown> }>(
      'SELECT type, meta FROM security_events WHERE user_id = $1 ORDER BY id',
      [userId],
    ),
  );
const types = async (userId: string) => (await events(userId)).map((event) => event.type);

/** Signs in and enrolls TOTP; returns the generator and the backup codes. */
async function enroll(browser: Browser) {
  await browser.signIn(EMAIL);
  const { body } = await browser.json<{ totpURI: string; backupCodes: string[] }>('/two-factor/enable', {
    password: PASSWORD,
  });
  const totp = totpFrom(body.totpURI);
  expect((await browser.json('/two-factor/verify-totp', { code: totp.generate() })).status).toBe(200);
  return { totp, backupCodes: body.backupCodes };
}

describe('lockout after wrong passwords (FR-A2)', () => {
  it('counts down, locks at the fifth failure, refuses even the right password, and records it', async () => {
    const { userId } = await createAdmin();
    const browser = h.browser();
    for (const remaining of [4, 3, 2, 1]) {
      expect(await browser.signIn(EMAIL, 'wrong-password-123')).toMatchObject({
        status: 401,
        body: { code: 'INVALID_EMAIL_OR_PASSWORD', remainingAttempts: remaining },
      });
    }
    const fifth = await browser.signIn(EMAIL, 'wrong-password-123');
    expect(fifth).toMatchObject({ status: 401, body: { code: 'ACCOUNT_LOCKED', remainingAttempts: 0 } });
    const lockedUntil = new Date(String(fifth.body['lockedUntil']));
    expect(lockedUntil.getTime() - h.now.getTime()).toBeGreaterThan(14 * 60_000);

    const refused = await browser.signIn(EMAIL);
    expect(refused).toMatchObject({ status: 429, body: { code: 'ACCOUNT_LOCKED' } });
    expect(Number(refused.headers.get('retry-after'))).toBeGreaterThan(14 * 60);
    const recorded = await events(userId);
    expect(recorded.map((event) => event.type).sort()).toEqual([
      'account_locked',
      'sign_in_failed',
      'sign_in_failed',
      'sign_in_failed',
      'sign_in_failed',
      'sign_in_failed',
    ]);
    expect(
      recorded
        .map((event) => event.meta['remainingAttempts'])
        .filter((n) => n !== undefined)
        .sort(),
    ).toEqual([0, 1, 2, 3, 4]);
  });

  it('counts unknown addresses the same way without recording anything', async () => {
    const browser = h.browser();
    expect(await browser.signIn('ghost@example.test', 'wrong-password-123')).toMatchObject({
      status: 401,
      body: { remainingAttempts: 4 },
    });
    expect(await h.asRole('postgres', () => h.db.query('SELECT id FROM security_events'))).toEqual([]);
  });

  it('unlocks after the lock time and a successful sign-in clears the count', async () => {
    h.rebuild({ lockoutPolicy: { maxFailures: 2, durationMs: 1000 } });
    await createAdmin();
    const browser = h.browser();
    await browser.signIn(EMAIL, 'wrong-password-123');
    expect((await browser.signIn(EMAIL, 'wrong-password-123')).body).toMatchObject({ code: 'ACCOUNT_LOCKED' });
    // ioredis-mock expires keys by Date.now(), so moving the system date ends the lock without waiting.
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(Date.now() + 1001);
      expect((await browser.signIn(EMAIL)).status).toBe(200);
    } finally {
      vi.useRealTimers();
    }
    expect((await browser.signIn(EMAIL, 'wrong-password-123')).body).toMatchObject({ remainingAttempts: 1 });
  });

  it('gives a locked account no session from any sign-in method', async () => {
    h.settings = { ...h.settings, registrationMode: 'open' };
    const browser = h.browser();
    for (let i = 0; i < 5; i++) await browser.signIn('new@example.test', 'wrong-password-123');
    const signUp = await browser.json('/sign-up/email', { name: 'N', email: 'new@example.test', password: PASSWORD });
    expect(signUp.status).toBe(400);
    expect(await h.auth.getSession(browser.headers())).toBeNull();
  });
});

describe('two-step verification (FR-A8)', () => {
  it('enrolls with a rotated session, hashed backup codes, and a security event', async () => {
    const { userId } = await createAdmin();
    const browser = h.browser();
    await browser.signIn(EMAIL);
    const before = browser.cookies.get('wf.session_token');
    const { body } = await browser.json<{ totpURI: string; backupCodes: string[] }>('/two-factor/enable', {
      password: PASSWORD,
    });
    expect(body.backupCodes).toHaveLength(10);
    const totp = totpFrom(body.totpURI);
    expect(totp).toMatchObject({ digits: 6, period: 30, issuer: 'write.financial' });

    // A wrong code while enrolling does not count toward the lockout and records nothing.
    expect((await browser.json('/two-factor/verify-totp', { code: wrongCode(totp) })).status).toBe(401);
    expect((await browser.json('/two-factor/verify-totp', { code: totp.generate() })).status).toBe(200);
    expect(browser.cookies.get('wf.session_token')).not.toBe(before);
    await expect(h.auth.requireTwoFactorEnrolled(browser.headers())).resolves.toBeDefined();

    const [row] = await h.asRole('postgres', () =>
      h.db.query<{ backup_codes: string; secret: string }>('SELECT backup_codes, secret FROM two_factors'),
    );
    const stored = JSON.parse(row?.backup_codes ?? '[]') as string[];
    const key = deriveKey(SECRET, 'backup_code');
    expect(stored).toEqual(body.backupCodes.map((code) => hashBackupCode(key, code)));
    expect(row?.secret).not.toContain(totp.secret.base32);

    // Checking another code while signed in is not an enrollment.
    expect((await browser.json('/two-factor/verify-totp', { code: totp.generate() })).status).toBe(200);
    expect(await types(userId)).toEqual(['sign_in', 'two_factor_enabled']);
  });

  it('keeps a not-remembered session short when enrolling rotates it', async () => {
    const { userId } = await createAdmin();
    const browser = h.browser();
    await browser.signIn(EMAIL, PASSWORD, { rememberMe: false });
    const { body } = await browser.json<{ totpURI: string }>('/two-factor/enable', { password: PASSWORD });
    await browser.json('/two-factor/verify-totp', { code: totpFrom(body.totpURI).generate() });
    const rows = await h.asRole('postgres', () =>
      h.db.query<{ created_at: Date; expires_at: Date }>(
        'SELECT created_at, expires_at FROM sessions WHERE user_id = $1',
        [userId],
      ),
    );
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(Math.round(((row?.expires_at.getTime() ?? 0) - (row?.created_at.getTime() ?? 0)) / 1000)).toBe(
      SESSION_SHORT_S,
    );
  });

  it('challenges at sign-in, locks after five wrong codes, and accepts a backup code once', async () => {
    const { userId } = await createAdmin();
    const browser = h.browser();
    const { totp, backupCodes } = await enroll(browser);
    expect((await browser.json('/sign-out', {})).status).toBe(200);
    expect(await h.auth.getSession(browser.headers())).toBeNull();

    expect(await browser.signIn(EMAIL)).toMatchObject({ status: 200, body: { twoFactorRedirect: true } });
    expect(await h.auth.getSession(browser.headers())).toBeNull();
    expect(await browser.json('/two-factor/verify-totp', { code: wrongCode(totp) })).toMatchObject({
      status: 401,
      body: { code: 'INVALID_CODE', remainingAttempts: 4 },
    });
    expect((await browser.json('/two-factor/verify-totp', { code: totp.generate() })).status).toBe(200);
    await expect(h.auth.requireSession(browser.headers())).resolves.toBeDefined();

    await browser.json('/sign-out', {});
    await browser.signIn(EMAIL);
    const code = backupCodes[0] ?? '';
    expect((await browser.json('/two-factor/verify-backup-code', { code })).status).toBe(200);
    await browser.json('/sign-out', {});
    await browser.signIn(EMAIL);
    expect(await browser.json('/two-factor/verify-backup-code', { code })).toMatchObject({
      status: 401,
      body: { code: 'INVALID_BACKUP_CODE', remainingAttempts: 4 },
    });
    for (const remaining of [3, 2, 1]) {
      expect((await browser.json('/two-factor/verify-totp', { code: wrongCode(totp) })).body).toMatchObject({
        remainingAttempts: remaining,
      });
    }
    expect(await browser.json('/two-factor/verify-totp', { code: wrongCode(totp) })).toMatchObject({
      status: 401,
      body: { code: 'ACCOUNT_LOCKED' },
    });
    // Locked: neither the next 2FA attempt nor a fresh password sign-in gets through.
    expect((await h.browser().signIn(EMAIL)).status).toBe(429);

    const all = await events(userId);
    expect(all.filter((e) => e.type === 'sign_in').map((e) => e.meta['method'])).toEqual([
      'password',
      'totp',
      'backup_code',
    ]);
    expect(all.filter((e) => e.type === 'sign_in_failed').map((e) => e.meta['factor'])).toEqual([
      'totp',
      'backup_code',
      'totp',
      'totp',
      'totp',
      'totp',
    ]);
    expect(all.filter((e) => e.type === 'sign_out')).toHaveLength(3);
    expect(all.at(-1)?.type).toBe('account_locked');
  });

  it('refuses a challenge while the account is locked', async () => {
    await createAdmin();
    const browser = h.browser();
    const { totp } = await enroll(browser);
    await browser.json('/sign-out', {});
    await browser.signIn(EMAIL);
    for (let i = 0; i < 5; i++) await h.browser().signIn(EMAIL, 'wrong-password-123');
    expect(await browser.json('/two-factor/verify-totp', { code: totp.generate() })).toMatchObject({
      status: 429,
      body: { code: 'ACCOUNT_LOCKED' },
    });
  });

  it('ignores challenges whose user or second factor disappeared mid-flight', async () => {
    const { userId } = await createAdmin();
    const browser = h.browser();
    const { totp } = await enroll(browser);
    await browser.json('/sign-out', {});
    await browser.signIn(EMAIL);
    await h.asRole('postgres', () => h.db.query('DELETE FROM two_factors'));
    expect((await browser.json('/two-factor/verify-totp', { code: totp.generate() })).body).toMatchObject({
      code: 'TOTP_NOT_ENABLED',
    });
    await h.asRole('postgres', () => h.db.query('DELETE FROM users WHERE id = $1', [userId]));
    expect((await browser.json('/two-factor/verify-totp', { code: totp.generate() })).status).toBe(401);
    expect((await h.browser().json('/two-factor/verify-backup-code', {})).status).toBe(401);
  });

  it('records regenerated backup codes and turning 2FA off', async () => {
    const { userId } = await createAdmin();
    const browser = h.browser();
    await enroll(browser);
    expect((await browser.json('/two-factor/generate-backup-codes', { password: PASSWORD })).status).toBe(200);
    expect((await browser.json('/two-factor/verify-backup-code', { code: 'aaaaa-bbbbb' })).status).toBe(401);
    expect((await browser.json('/two-factor/disable', { password: PASSWORD })).status).toBe(200);
    expect(await types(userId)).toEqual([
      'sign_in',
      'two_factor_enabled',
      'backup_codes_regenerated',
      'two_factor_disabled',
    ]);
  });
});

describe('signed-in actions', () => {
  it('records password changes, removed passkeys, and sign-out, but not failed or anonymous ones', async () => {
    const { userId } = await createAdmin();
    const browser = h.browser();
    await browser.signIn(EMAIL);
    expect(
      (await browser.json('/change-password', { currentPassword: 'wrong-password-123', newPassword: `${PASSWORD}2` }))
        .status,
    ).toBe(400);
    expect(
      await browser.json('/change-password', { currentPassword: PASSWORD, newPassword: BREACHED_PASSWORD }),
    ).toMatchObject({ status: 400, body: { code: 'PASSWORD_COMPROMISED' } });
    expect(
      (await browser.json('/change-password', { currentPassword: PASSWORD, newPassword: `${PASSWORD}2` })).status,
    ).toBe(200);

    const [passkey] = await h.asRole('postgres', () =>
      h.db.query<{ id: string }>(
        `INSERT INTO passkeys (name, public_key, user_id, credential_id, counter, device_type, backed_up)
         VALUES ('YubiKey', 'pk', $1, 'cred', 0, 'singleDevice', false) RETURNING id`,
        [userId],
      ),
    );
    expect((await browser.json('/passkey/delete-passkey', { id: passkey?.id })).status).toBe(200);
    expect((await browser.json('/sign-out', {})).status).toBe(200);
    expect((await browser.json('/sign-out', {})).status).toBe(200);

    expect(await events(userId)).toMatchObject([
      { type: 'sign_in' },
      { type: 'password_changed', meta: {} },
      { type: 'passkey_removed', meta: { passkeyId: passkey?.id } },
      { type: 'sign_out' },
    ]);
  });

  it('emails about a sign-in from a new device, not from a known one', async () => {
    await createAdmin();
    await h.browser().signIn(EMAIL);
    await h.browser({ ip: '203.0.113.200' }).signIn(EMAIL);
    expect(h.sent).toEqual([]);
    await h.browser({ userAgent: CHROME, ip: '198.51.100.9' }).signIn(EMAIL);
    expect(h.sent).toMatchObject([
      {
        to: EMAIL,
        template: { kind: 'new_device_sign_in', device: 'Chrome · macOS', url: `${ORIGIN}/settings/security` },
        context: { locale: 'id', recipientName: 'Sari', instanceName: 'Keuangan Keluarga' },
      },
    ]);
  });
});

describe('Google sign-up (FR-A1, FR-OP1)', () => {
  const unsignedJwt = (claims: Record<string, unknown>) =>
    [{ alg: 'RS256', typ: 'JWT' }, claims]
      .map((part) => Buffer.from(JSON.stringify(part)).toString('base64url'))
      .join('.') + '.signature';

  async function googleSignIn(email: string) {
    hibp.use(
      http.post('https://oauth2.googleapis.com/token', () =>
        HttpResponse.json({
          access_token: 'google-access-token',
          token_type: 'Bearer',
          expires_in: 3600,
          scope: 'openid email profile',
          id_token: unsignedJwt({ sub: `google-${email}`, email, email_verified: true, name: 'Budi Google' }),
        }),
      ),
    );
    const browser = h.browser();
    const { body } = await browser.json<{ url: string }>('/sign-in/social', { provider: 'google', callbackURL: '/' });
    const state = new URL(body.url).searchParams.get('state') ?? '';
    const response = await browser.request(`/callback/google?code=auth-code&state=${state}`);
    return { browser, location: response.headers.get('location') ?? '' };
  }

  it('needs a pending invitation for the email when registration is closed', async () => {
    h.rebuild({ google: { clientId: 'client-id', clientSecret: 'client-secret', gmail: null } });
    const { userId: adminId } = await createAdmin();
    const refused = await googleSignIn('budi@example.test');
    expect(refused.location).toContain('error=REGISTRATION_CLOSED');

    await h.invite(adminId, 'budi@example.test');
    const admitted = await googleSignIn('budi@example.test');
    expect(admitted.location).toBe('/');
    const session = await h.auth.requireSession(admitted.browser.headers());
    expect(session.user).toMatchObject({ email: 'budi@example.test', name: 'Budi Google' });
    expect((await events(session.user.id)).map((e) => e.meta['method'])).toEqual(['google']);
  });
});

describe('defaults', () => {
  it('check breached passwords with the global fetch and the system clock', async () => {
    h.rebuild({ defaults: true });
    h.settings = { ...h.settings, registrationMode: 'open' };
    expect(
      await h.browser().json('/sign-up/email', { name: 'B', email: 'b@example.test', password: BREACHED_PASSWORD }),
    ).toMatchObject({ status: 400, body: { code: 'PASSWORD_COMPROMISED' } });
    for (let i = 0; i < 5; i++) await h.browser().signIn('b@example.test', 'wrong-password-123');
    expect(Number((await h.browser().signIn('b@example.test')).headers.get('retry-after'))).toBeGreaterThan(890);
  });
});

describe('malformed requests', () => {
  it('pass through the hooks to Better Auth validation', async () => {
    const browser = h.browser();
    expect((await browser.json('/sign-up/email', { name: 'N', password: PASSWORD })).body).toMatchObject({
      code: 'REGISTRATION_CLOSED',
    });
    expect((await browser.json('/sign-in/email', { password: PASSWORD })).status).toBe(400);
    expect((await browser.json('/request-password-reset', {})).status).toBe(400);
    expect((await browser.request('/two-factor/verify-backup-code', undefined, { method: 'POST' })).status).toBe(401);
  });
});

describe('helpers', () => {
  it('toAuditUser falls back for missing locale and time zone', () => {
    expect(toAuditUser({ id: 'u', email: 'e', name: 'n', locale: 'fr', timezone: 5 })).toEqual({
      id: 'u',
      email: 'e',
      name: 'n',
      locale: 'id',
      timezone: 'Asia/Jakarta',
    });
    expect(toAuditUser({ id: 'u', email: 'e', name: 'n', locale: 'en', timezone: 'UTC' })).toMatchObject({
      locale: 'en',
      timezone: 'UTC',
    });
  });

  it('requestInfo reads the request, else the headers, else nothing', () => {
    const headers = new Headers({ 'x-forwarded-for': '198.51.100.4', 'user-agent': 'UA' });
    const options = {};
    expect(requestInfo({ request: new Request(ORIGIN, { headers }), headers, context: { options } })).toEqual({
      ip: '198.51.100.4',
      userAgent: 'UA',
    });
    expect(requestInfo({ request: undefined, headers, context: { options } })).toEqual({
      ip: '198.51.100.4',
      userAgent: 'UA',
    });
    expect(requestInfo({ request: undefined, headers: undefined, context: { options } })).toEqual({
      ip: null,
      userAgent: null,
    });
  });

  it('stringField reads only string properties of objects', () => {
    expect(stringField({ a: 'x' }, 'a')).toBe('x');
    expect(stringField({ a: 1 }, 'a')).toBeNull();
    expect(stringField({}, 'a')).toBeNull();
    expect(stringField(null, 'a')).toBeNull();
    expect(stringField('a', 'length')).toBeNull();
  });

  it('actorEventMeta names the passkey', () => {
    expect(actorEventMeta('/passkey/delete-passkey', { id: 'p1' }, null)).toEqual({ passkeyId: 'p1' });
    expect(actorEventMeta('/passkey/delete-passkey', {}, null)).toEqual({ passkeyId: '' });
    expect(actorEventMeta('/passkey/verify-registration', {}, { name: 'YubiKey' })).toEqual({ name: 'YubiKey' });
    expect(actorEventMeta('/passkey/verify-registration', {}, { name: null })).toEqual({ name: '' });
    expect(actorEventMeta('/change-password', {}, null)).toEqual({});
  });

  it('users can be inserted outside Better Auth for tests', async () => {
    await h.asRole('postgres', () => insertUser(h.db, 'plain@example.test'));
    expect(await h.auth.hasAdmin()).toBe(false);
  });
});
