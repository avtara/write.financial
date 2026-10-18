// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The whole auth flow against real services: PostgreSQL 18.6 with every role logging in with its own password,
 * Valkey 9.2 for rate limits and lockout, and Mailpit as the SMTP server. Requests go through `auth.handler`
 * exactly as the web app mounts it.
 */
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { createDb, type Database } from '@wf/db/db';
import { createInvitations } from '@wf/db/invitations';
import { createInstanceSettings } from '@wf/db/instance-settings';
import { migrate } from '@wf/db/migrate';
import { bootstrapRoles, ROLES, type RoleName } from '@wf/db/roles';
import { sessions } from '@wf/db/schema';
import { parseKeyring } from '@wf/crypto/keyring';
import { sha256Hex } from '@wf/crypto/hash';
import { createMailer, type Mailer } from '@wf/integrations/mailer';
import { Redis } from 'ioredis';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Browser, PASSWORD, PUBLIC_URL, SECRET, totpFrom, wrongCode } from '../test/harness.ts';
import { createAuth, type WfAuth } from './auth.ts';
import { AdminExistsError } from './first-admin.ts';

const rolePassword = (role: string) => `${role}-${Date.now().toString(36)}-pw`;
const PASSWORDS = {
  app: rolePassword('app'),
  worker: rolePassword('worker'),
  migrate: rolePassword('migrate'),
  auth: rolePassword('auth'),
  readonlyOps: rolePassword('ops'),
};
const KEYRING = parseKeyring(`v1:${Buffer.alloc(32, 7).toString('base64')}\n`);
const ADMIN = 'admin@example.test';
const LOCK_MS = 3000;

let postgresContainer: StartedPostgreSqlContainer;
let valkey: StartedTestContainer;
let mailpit: StartedTestContainer;
let authDb: Database;
let appDb: Database;
let redis: Redis;
let mailer: Mailer;
let auth: WfAuth;
let mailpitApi: string;

const urlAs = (role: RoleName, password: string) => {
  const url = new URL(postgresContainer.getConnectionUri());
  url.username = role;
  url.password = password;
  return url.href;
};

interface MailpitMessage {
  readonly ID: string;
  readonly Subject: string;
  readonly To: { Address: string }[];
}

async function mailTo(address: string, subject: string): Promise<string> {
  for (let attempt = 0; attempt < 50; attempt++) {
    const list = (await (await fetch(`${mailpitApi}/api/v1/messages`)).json()) as { messages: MailpitMessage[] };
    const found = list.messages.find((m) => m.Subject === subject && m.To.some((to) => to.Address === address));
    if (found !== undefined) {
      const message = (await (await fetch(`${mailpitApi}/api/v1/message/${found.ID}`)).json()) as { Text: string };
      return message.Text;
    }
    // Delivery to Mailpit is asynchronous; poll its API.
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`No email "${subject}" to ${address}`);
}

beforeAll(async () => {
  [postgresContainer, valkey, mailpit] = await Promise.all([
    new PostgreSqlContainer('postgres:18.6').start(),
    new GenericContainer('valkey/valkey:9.2').withExposedPorts(6379).start(),
    new GenericContainer('axllent/mailpit:v1.31.6')
      .withExposedPorts(1025, 8025)
      .withWaitStrategy(Wait.forHttp('/readyz', 8025))
      .start(),
  ]);
  await bootstrapRoles(postgresContainer.getConnectionUri(), PASSWORDS);
  await migrate(urlAs(ROLES.migrate, PASSWORDS.migrate));
  authDb = createDb(urlAs(ROLES.auth, PASSWORDS.auth));
  appDb = createDb(urlAs(ROLES.app, PASSWORDS.app));
  redis = new Redis(`redis://${valkey.getHost()}:${valkey.getMappedPort(6379)}`);
  mailer = createMailer({
    smtpUrl: `smtp://${mailpit.getHost()}:${mailpit.getMappedPort(1025)}`,
    from: 'write.financial <noreply@wf.test>',
  });
  mailpitApi = `http://${mailpit.getHost()}:${mailpit.getMappedPort(8025)}`;
  const settings = createInstanceSettings(authDb, KEYRING);
  auth = createAuth({
    config: { publicUrl: PUBLIC_URL, nodeEnv: 'test', auth: { secret: SECRET }, google: null },
    db: authDb,
    redis,
    mailer,
    settings: settings.get,
    logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
    // HIBP stays offline in CI: the check fails open (see breached.ts).
    fetch: () => Promise.reject(new TypeError('offline')),
    lockoutPolicy: { maxFailures: 5, durationMs: LOCK_MS },
  });
}, 180_000);

afterAll(async () => {
  mailer.close();
  redis.disconnect();
  await authDb.$client.end();
  await appDb.$client.end();
  await Promise.all([postgresContainer.stop(), valkey.stop(), mailpit.stop()]);
});

describe('auth against Postgres, Valkey, and Mailpit', () => {
  let adminId: string;
  let backupCodes: string[];
  let totp: ReturnType<typeof totpFrom>;

  it('creates exactly one first admin under concurrency', async () => {
    const results = await Promise.allSettled(
      ['a', 'b', 'c'].map((name) =>
        auth.createFirstAdmin({
          email: ADMIN,
          password: PASSWORD,
          name,
          locale: 'en',
        }),
      ),
    );
    const created = results.filter((r) => r.status === 'fulfilled');
    expect(created).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected').map((r): unknown => r.reason)).toEqual([
      new AdminExistsError(),
      new AdminExistsError(),
    ]);
    adminId = (created[0] as PromiseFulfilledResult<{ userId: string }>).value.userId;
    if (!(await auth.hasAdmin())) throw new Error('no admin');
  });

  it('signs in, enrolls TOTP, signs out, and then requires the second factor', async () => {
    const browser = new Browser(auth);
    expect((await browser.signIn(ADMIN)).status).toBe(200);
    const { body } = await browser.json<{ totpURI: string; backupCodes: string[] }>('/two-factor/enable', {
      password: PASSWORD,
    });
    totp = totpFrom(body.totpURI);
    backupCodes = body.backupCodes;
    expect(await browser.json('/two-factor/verify-totp', { code: totp.generate() })).toMatchObject({ status: 200 });
    expect((await browser.json('/sign-out', {})).status).toBe(200);

    expect(await browser.signIn(ADMIN)).toMatchObject({ status: 200, body: { twoFactorRedirect: true } });
    expect(await auth.getSession(browser.headers())).toBeNull();
    expect((await browser.json('/two-factor/verify-totp', { code: totp.generate() })).status).toBe(200);
    expect((await auth.requireTwoFactorEnrolled(browser.headers())).user.id).toBe(adminId);
  });

  it('locks the account after five wrong codes until the lock expires', async () => {
    const browser = new Browser(auth, '198.51.100.10');
    await browser.signIn(ADMIN);
    for (const remaining of [4, 3, 2, 1]) {
      expect((await browser.json('/two-factor/verify-totp', { code: wrongCode(totp) })).body).toMatchObject({
        remainingAttempts: remaining,
      });
    }
    expect((await browser.json('/two-factor/verify-totp', { code: wrongCode(totp) })).body).toMatchObject({
      code: 'ACCOUNT_LOCKED',
    });
    expect((await new Browser(auth, '198.51.100.11').signIn(ADMIN)).status).toBe(429);
    // The lock lives in Valkey with a real expiry; wait it out.
    await new Promise((resolve) => setTimeout(resolve, LOCK_MS + 200));
    expect((await new Browser(auth, '198.51.100.12').signIn(ADMIN)).body).toMatchObject({ twoFactorRedirect: true });
  });

  it('accepts a backup code exactly once', async () => {
    const code = backupCodes[0] ?? '';
    const first = new Browser(auth, '198.51.100.20');
    await first.signIn(ADMIN);
    expect((await first.json('/two-factor/verify-backup-code', { code })).status).toBe(200);
    const second = new Browser(auth, '198.51.100.21');
    await second.signIn(ADMIN);
    expect((await second.json('/two-factor/verify-backup-code', { code })).body).toMatchObject({
      code: 'INVALID_BACKUP_CODE',
    });
  });

  it('keeps registration closed to the uninvited and open to the invited', async () => {
    const signUp = (email: string, invitationToken?: string) =>
      new Browser(auth, '198.51.100.30').json('/sign-up/email', {
        name: 'Budi',
        email,
        password: PASSWORD,
        ...(invitationToken === undefined ? {} : { invitationToken }),
      });
    expect(await signUp('budi@example.test')).toMatchObject({ status: 403, body: { code: 'REGISTRATION_CLOSED' } });

    const token = `invite-${Date.now().toString(36)}`;
    await createInvitations(appDb).create(adminId, {
      email: 'budi@example.test',
      tokenHash: sha256Hex(token),
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    expect(await signUp('budi@example.test', token)).toMatchObject({
      status: 200,
      body: { user: { email: 'budi@example.test' } },
    });
    expect(await mailTo('budi@example.test', 'Verifikasi alamat email kamu')).toContain(
      '/api/auth/verify-email?token=',
    );
  });

  it('emails a working password-reset link', async () => {
    const browser = new Browser(auth, '198.51.100.40');
    expect((await browser.json('/request-password-reset', { email: ADMIN, redirectTo: '/forgot' })).status).toBe(200);
    const text = await mailTo(ADMIN, 'Reset your password');
    expect(text).toContain('This link is valid for 30 minutes.');
    const link = /https:\/\/uang\.example\/api\/auth\/reset-password\/\S+/.exec(text)?.[0] ?? '';
    const redirect = await auth.handler(new Request(link, { headers: { origin: 'https://uang.example' } }));
    const location = new URL(redirect.headers.get('location') ?? '', PUBLIC_URL);
    expect(location.pathname).toBe('/forgot');
    const token = location.searchParams.get('token') ?? '';
    const newPassword = `${PASSWORD}-reset`;
    expect((await browser.json('/reset-password', { token, newPassword })).status).toBe(200);
    expect((await new Browser(auth, '198.51.100.41').signIn(ADMIN, newPassword)).body).toMatchObject({
      twoFactorRedirect: true,
    });
  });

  it('keeps sessions closed to wf_app', async () => {
    await expect(appDb.select().from(sessions)).rejects.toMatchObject({ cause: { code: '42501' } });
  });
});
