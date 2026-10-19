// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Tenant isolation at the API (M0 exit criterion, PRD §9.2): every web server function, called with the real
 * services (`createServices`) against PostgreSQL 18.6 and Valkey 9.2 and with real Better Auth sessions, as user B
 * sees and changes only B's data, refuses admin and setup actions, and never answers with an `_enc` field or a
 * secret. Admin A is created through the setup wizard (first admin, TOTP, instance settings with an SMTP password)
 * and invites B, who signs up with the invitation. A completeness guard fails for any server function without a
 * case in {@link MATRIX}, so new server functions cannot skip this test.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { ValkeyContainer, type StartedValkeyContainer } from '@testcontainers/valkey';
import { loadConfig } from '@wf/config';
import { createKeyFile } from '@wf/crypto/keyring';
import type { AccountsOverview } from '@wf/db/accounts';
import type { CategoryView } from '@wf/db/categories';
import type { ManualRateInput } from '@wf/db/fx-rates';
import { migrate } from '@wf/db/migrate';
import { bootstrapRoles, ROLES, type RoleName } from '@wf/db/roles';
import type { TagView } from '@wf/db/tags';
import { pino } from 'pino';
import postgres from 'postgres';
import { SMTPServer } from 'smtp-server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { requestContext } from '../../../test/server-fn.ts';
import { SessionBrowser } from '../../../test/session-browser.ts';
import type { Result } from '../access.ts';
import type { DeviceView, SecurityHistory, SecurityOverview } from '../account.ts';
import { getPreferences } from '../get-preferences.ts';
import type * as RuntimeModule from '../runtime.ts';
import { createServices, type Services } from '../runtime.ts';
import * as account from './account.ts';
import * as admin from './admin.ts';
import * as gate from './gate.ts';
import * as ledger from './ledger.ts';
import * as setup from './setup.ts';

/** `YYYY-MM-DD` as the repositories' branded date type. */
type LocalDate = ManualRateInput['asOf'];

const running = vi.hoisted(() => ({ services: null as Promise<Services> | null }));

// vi.mock factories run before imports; they load the shared helper themselves.
vi.mock('@tanstack/react-start', async () => (await import('../../../test/server-fn.ts')).serverFnModule());
// The server functions get the services this test built with the real `createServices`.
vi.mock('../runtime.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof RuntimeModule>()),
  services: () => running.services ?? Promise.reject(new Error('services not started')),
}));

/** Built at runtime so no fixture looks like a committed secret. */
const secret = (label: string) => `${label}-${randomBytes(12).toString('hex')}`;
const ROLE_PASSWORDS = {
  app: secret('app'),
  worker: secret('worker'),
  migrate: secret('migrate'),
  auth: secret('auth'),
  readonlyOps: null,
};
const ORIGIN = 'http://localhost:3000';
const AUTH_SECRET = secret('auth-secret');
const SETUP_TOKEN = secret('setup-token');
const SMTP_PASSWORD = secret('smtp');
const FIREFOX = 'Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0';
const CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36';

const A = { name: 'Avtara K.', email: 'avtara@example.test', password: secret('password-a') };
const B = { name: 'Budi Santoso', email: 'budi@example.test', password: secret('password-b') };
const INSTANCE_NAME = 'Keuangan Keluarga';

const SRC = fileURLToPath(new URL('../../', import.meta.url));
const tmp = mkdtempSync(path.join(tmpdir(), 'wf-web-isolation-'));
const KEK_FILE = path.join(tmp, 'kek');

let pg: StartedPostgreSqlContainer;
let valkey: StartedValkeyContainer;
let superuser: postgres.Sql;
let services: Services;
const smtp = new SMTPServer({
  authOptional: true,
  allowInsecureAuth: true,
  disabledCommands: ['STARTTLS'],
  onAuth: (auth, _session, callback) => {
    callback(null, { user: auth.username });
  },
  onData: (stream, session, callback) => {
    stream.resume();
    stream.on('end', () => {
      mail.push(session.envelope.rcptTo.map((rcpt) => rcpt.address).join(','));
      callback();
    });
  },
});
/** Recipients of every message the stub SMTP server accepted. */
const mail: string[] = [];
let smtpPort = 0;

/** The server functions this test imports; {@link MATRIX} must have a case for each. */
const FUNCTIONS = { ...account, ...admin, ...gate, ...ledger, ...setup, getPreferences };
type Name = keyof typeof FUNCTIONS;

type Caller = 'A' | 'B' | 'anonymous';
const browsers = {} as Record<Caller, SessionBrowser>;
let a2: SessionBrowser;
let b2: SessionBrowser;
let aId: string;
let bId: string;
/** Plaintext secrets no response may contain (stored ciphertexts and hashes are added in the final scan). */
const secrets: string[] = [AUTH_SECRET, SETUP_TOKEN, SMTP_PASSWORD, A.password, B.password];
/** Every server function response, for the final scan. */
const responses: { caller: Caller; fn: Name; value: unknown }[] = [];

/** Calls the server function `fn` as `caller` and records the response. */
async function as<T>(caller: Caller, fn: Name, data?: unknown): Promise<T> {
  const value = await browsers[caller].call<T>(FUNCTIONS[fn], data);
  responses.push({ caller, fn, value });
  return value;
}

const urlAs = (role: RoleName, password: string) => {
  const url = new URL(pg.getConnectionUri());
  url.username = role;
  url.password = password;
  return url.href;
};

const sessionIds = async (userId: string) =>
  (await superuser<{ id: string }[]>`SELECT id FROM sessions WHERE user_id = ${userId} ORDER BY id`).map((r) => r.id);
const eventIds = async (userId: string) =>
  (await superuser<{ id: string }[]>`SELECT id FROM security_events WHERE user_id = ${userId} ORDER BY id DESC`).map(
    (r) => r.id,
  );
const profileRow = async (userId: string) =>
  (await superuser`SELECT name, nickname, locale, timezone FROM users WHERE id = ${userId}`)[0];
const instanceRow = async () => (await superuser`SELECT * FROM instance_settings`)[0];
const count = async (table: string, where = 'true') =>
  Number((await superuser.unsafe<{ n: string }[]>(`SELECT count(*) AS n FROM ${table} WHERE ${where}`))[0]?.n);
const currentSessionId = async (browser: SessionBrowser) => (await browser.session())?.session.id;
/** Ids of a user's rows in the ledger tables the read functions return. */
const ledgerIds = async (userId: string) =>
  (
    await superuser<{ id: string }[]>`
      SELECT id::text FROM accounts WHERE user_id = ${userId}
      UNION ALL SELECT id::text FROM categories WHERE user_id = ${userId}
      UNION ALL SELECT id::text FROM tags WHERE user_id = ${userId}
      UNION ALL SELECT id::text FROM fx_rates WHERE user_id = ${userId}
      ORDER BY 1`
  ).map((row) => row.id);
/** JSON for the leak scan; ledger amounts are bigints. */
const toJson = (value: unknown) =>
  JSON.stringify(value, (_key, child: unknown) => (typeof child === 'bigint' ? child.toString() : child));
/** A's ledger rows, all with names B must never see. */
const A_LEDGER = { account: 'Rekening Rahasia A', category: 'Rahasia A', tag: 'rahasia-a' };

const smtpInput = (password?: string) => ({
  host: '127.0.0.1',
  port: smtpPort,
  secure: false,
  username: 'mailer',
  ...(password === undefined ? {} : { password }),
  from: 'write.financial <noreply@wf.test>',
});
const instanceInput = () => ({
  instanceName: INSTANCE_NAME,
  publicUrl: `${ORIGIN}/`,
  defaultLocale: 'en',
  defaultTimezone: 'Asia/Makassar',
  registrationMode: 'invite',
  smtp: smtpInput(SMTP_PASSWORD),
});
/** What B tries to save as instance settings. */
const hostileInstance = () => ({ ...instanceInput(), instanceName: 'Pwned', registrationMode: 'open', smtp: null });

const UNAUTHENTICATED = { ok: false, code: 'UNAUTHENTICATED' };
const FORBIDDEN = { ok: false, code: 'FORBIDDEN' };
const ok = <T>(value: T) => ({ ok: true, value });

beforeAll(async () => {
  [pg, valkey] = await Promise.all([
    new PostgreSqlContainer('postgres:18.6').start(),
    new ValkeyContainer('valkey/valkey:9.2').withPassword(secret('valkey')).start(),
  ]);
  superuser = postgres(pg.getConnectionUri(), { max: 2, onnotice: () => undefined });
  await bootstrapRoles(pg.getConnectionUri(), ROLE_PASSWORDS);
  await migrate(urlAs(ROLES.migrate, ROLE_PASSWORDS.migrate));
  await createKeyFile(KEK_FILE);
  for (const line of readFileSync(KEK_FILE, 'utf8').split('\n')) {
    const key = /^v\d+:(\S+)$/.exec(line)?.[1];
    if (key !== undefined) secrets.push(key, Buffer.from(key, 'base64').toString('hex'));
  }
  smtp.listen(0, '127.0.0.1');
  await once(smtp.server, 'listening');
  smtpPort = (smtp.server.address() as AddressInfo).port;

  const config = loadConfig({
    NODE_ENV: 'test',
    PUBLIC_URL: ORIGIN,
    DATABASE_URL: urlAs(ROLES.app, ROLE_PASSWORDS.app),
    DATABASE_URL_WORKER: urlAs(ROLES.worker, ROLE_PASSWORDS.worker),
    DATABASE_URL_AUTH: urlAs(ROLES.auth, ROLE_PASSWORDS.auth),
    REDIS_URL: valkey.getConnectionUrl(),
    S3_ENDPOINT: 'http://127.0.0.1:8333',
    S3_ACCESS_KEY_ID: 'unused',
    S3_SECRET_ACCESS_KEY: secret('s3'),
    KEK_FILE,
    AUTH_SECRET,
    SETUP_TOKEN,
    LOG_LEVEL: 'silent',
  });
  // HIBP stays offline: the breached-password check captures `fetch` when created and fails open.
  vi.stubGlobal('fetch', () => Promise.reject(new TypeError('offline')));
  running.services = createServices({
    config,
    logger: pino({ level: 'silent' }),
    localeStorage: new AsyncLocalStorage(),
  });
  services = await running.services;
  vi.unstubAllGlobals();
  const browser = (ip: string, userAgent: string) => new SessionBrowser(services.auth, ORIGIN, ip, userAgent);

  // A: the setup wizard, as the operator runs it.
  browsers.A = browser('198.51.100.1', FIREFOX);
  expect(await as('A', 'getSetup', { token: SETUP_TOKEN })).toMatchObject({ status: 'open', step: 'admin' });
  expect(
    await as('A', 'createSetupAdmin', { name: A.name, email: A.email, password: A.password, locale: 'id' }),
  ).toEqual(ok(null));
  await browsers.A.signIn(A.email, A.password);
  const enrolledA = await browsers.A.enrollTotp(A.password);
  secrets.push(enrolledA.totp.secret.base32, ...enrolledA.backupCodes);
  expect(await as('A', 'getSetup', {})).toMatchObject({ status: 'open', step: 'instance' });
  expect(await as('A', 'sendSetupTestEmail', smtpInput(SMTP_PASSWORD))).toEqual(ok(null));
  expect(await as('A', 'saveSetup', instanceInput())).toEqual(ok(null));
  aId = (await browsers.A.session())?.user.id ?? '';

  // B: invited by A, signs up with the invitation, enrolls TOTP, and signs in on a second device.
  const invited = await as<Result<{ url: string; emailed: boolean }>>('A', 'inviteUser', { email: B.email });
  expect(invited).toMatchObject({ ok: true, value: { emailed: true } });
  const invitationToken = invited.ok ? new URL(invited.value.url).searchParams.get('invitation') : null;
  browsers.B = browser('198.51.100.2', CHROME);
  expect(
    await browsers.B.request('/sign-up/email', { name: B.name, email: B.email, password: B.password, invitationToken }),
  ).toMatchObject({ status: 200, body: { user: { email: B.email } } });
  const enrolledB = await browsers.B.enrollTotp(B.password);
  secrets.push(enrolledB.totp.secret.base32, ...enrolledB.backupCodes);
  bId = (await browsers.B.session())?.user.id ?? '';
  b2 = browser('198.51.100.3', FIREFOX);
  await b2.signIn(B.email, B.password, enrolledB.totp);

  // A's second device, after B's events, so A has the newest security event.
  a2 = browser('198.51.100.4', CHROME);
  await a2.signIn(A.email, A.password, enrolledA.totp);

  // B and the signed-out visitor even hold the real setup token (as if it leaked).
  browsers.anonymous = browser('198.51.100.5', FIREFOX);
  browsers.B.cookies.set('wf_setup', encodeURIComponent(SETUP_TOKEN));
  browsers.anonymous.cookies.set('wf_setup', encodeURIComponent(SETUP_TOKEN));

  // Ledger rows of both users through the app's repositories; A's have names B must never see.
  for (const [userId, names] of [
    [aId, A_LEDGER],
    [bId, { account: 'Rekening B', category: 'Kategori B', tag: 'tag-b' }],
  ] as const) {
    await services.accounts.create(userId, {
      type: 'bank',
      providerName: 'BCA',
      displayName: names.account,
      currency: 'IDR',
      openingBalanceMinor: 1_000_000n,
      openingDate: '2026-10-01' as LocalDate,
      color: 'blue',
    });
    await services.categories.create(userId, {
      kind: 'expense',
      group: 'wants',
      name: names.category,
      icon: 'coffee',
      color: 'orange',
    });
    await services.tags.create(userId, names.tag);
  }
  await services.fxRates.upsertManual(aId, {
    base: 'USD',
    quote: 'IDR',
    rate: '16474',
    asOf: '2026-10-15' as LocalDate,
  });

  expect(await count('users', `role = 'admin'`)).toBe(1);
  expect((await sessionIds(aId)).length).toBeGreaterThanOrEqual(2);
  expect((await eventIds(aId)).length).toBeGreaterThanOrEqual(1);
  expect((await sessionIds(bId)).length).toBeGreaterThanOrEqual(2);
  // Now, while every session row still exists (revoking deletes them).
  secrets.push(...(await storedSecrets()));
});

afterAll(async () => {
  smtp.close();
  await superuser.end();
  await Promise.all([pg.stop(), valkey.stop()]);
  rmSync(tmp, { recursive: true, force: true });
});

/** Secrets as stored: TOTP secrets, backup codes, password hashes, session tokens, and encrypted or wrapped keys. */
async function storedSecrets(): Promise<string[]> {
  const rows = await superuser<{ value: string }[]>`
    SELECT secret AS value FROM two_factors
    UNION ALL SELECT backup_codes FROM two_factors
    UNION ALL SELECT password FROM accounts_auth WHERE password IS NOT NULL
    UNION ALL SELECT token FROM sessions
    UNION ALL SELECT encode(dek_wrapped, 'hex') FROM user_keys
    UNION ALL SELECT replace(encode(dek_wrapped, 'base64'), E'\n', '') FROM user_keys
    UNION ALL SELECT encode(smtp_password_enc, 'hex') FROM instance_settings WHERE smtp_password_enc IS NOT NULL
    UNION ALL SELECT replace(encode(smtp_password_enc, 'base64'), E'\n', '') FROM instance_settings
      WHERE smtp_password_enc IS NOT NULL
    UNION ALL SELECT encode(instance_dek_wrapped, 'hex') FROM instance_settings WHERE instance_dek_wrapped IS NOT NULL`;
  // Two TOTP secrets and backup-code sets, two password hashes, at least three sessions, the SMTP password, the DEK.
  expect(rows.length).toBeGreaterThanOrEqual(10);
  return rows.map((row) => row.value);
}

/** A's data B must never see or change. */
async function aSnapshot() {
  return {
    profile: await profileRow(aId),
    sessions: await sessionIds(aId),
    events: await eventIds(aId),
    signedIn: [await currentSessionId(browsers.A), await currentSessionId(a2)],
  };
}

/** The ids of A's rows; none may appear in a response to B or a signed-out visitor. */
async function aIdentifiers(): Promise<string[]> {
  return [
    aId,
    A.email,
    A.name,
    ...Object.values(A_LEDGER),
    ...(await sessionIds(aId)),
    ...(await eventIds(aId)),
    ...(await ledgerIds(aId)),
  ];
}

interface Case {
  /** The input, the same for B and the signed-out visitor. */
  readonly input?: () => unknown;
  /** The exact answer to a signed-out request. */
  readonly anonymous: () => unknown;
  /** Calls the function as B and asserts it saw or changed only B's data. */
  readonly asB: (input: unknown) => Promise<void>;
}

/** Calls `fn` as B: answered with `expected`, no cookie set, the instance, admins, invitations, and mail unchanged. */
async function refused(fn: Name, input: unknown, expected: unknown = FORBIDDEN): Promise<void> {
  const state = async () => ({
    instance: await instanceRow(),
    admins: await count('users', `role = 'admin'`),
    invitations: await count('invitations'),
    mail: mail.length,
  });
  const before = await state();
  expect(await as('B', fn, input)).toEqual(expected);
  expect(browsers.B.lastSetCookies).toEqual([]);
  expect(await state()).toEqual(before);
}

/**
 * One case per server function; the type and the guard below make a missing case fail. Cases run in this order, so
 * later ones see B's profile as `updateProfile` and `saveLocale` left it.
 */
const MATRIX: Record<Name, Case> = {
  getProfile: {
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      expect(await as('B', 'getProfile')).toEqual(
        ok({ name: B.name, nickname: null, locale: 'en', timezone: 'Asia/Makassar' }),
      );
      expect(await as('A', 'getProfile')).toEqual(ok(await profileRow(aId)));
    },
  },
  updateProfile: {
    input: () => ({ name: 'Budi S.', nickname: 'Budi', locale: 'id', timezone: 'Asia/Jakarta' }),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      const a = await aSnapshot();
      expect(await as('B', 'updateProfile', input)).toEqual(ok(input));
      expect(await profileRow(bId)).toEqual(input);
      expect(await aSnapshot()).toEqual(a);
    },
  },
  saveLocale: {
    input: () => ({ locale: 'en' }),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      const a = await aSnapshot();
      expect(await as('B', 'saveLocale', input)).toEqual(ok(null));
      expect(await profileRow(bId)).toEqual({
        name: 'Budi S.',
        nickname: 'Budi',
        locale: 'en',
        timezone: 'Asia/Jakarta',
      });
      expect(await aSnapshot()).toEqual(a);
    },
  },
  getSecurity: {
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const result = await as<Result<SecurityOverview>>('B', 'getSecurity');
      if (!result.ok) throw new Error(`getSecurity failed: ${result.code}`);
      const { devices, history, ...rest } = result.value;
      expect(rest).toEqual({ twoFactorEnabled: true, hasPassword: true, googleLinked: false, passkeys: [] });
      expect(devices.map((device) => device.id).sort()).toEqual(await sessionIds(bId));
      expect(devices.filter((device) => device.current).map((device) => device.id)).toEqual([
        await currentSessionId(browsers.B),
      ]);
      expect(history.events.map((event) => event.id)).toEqual(await eventIds(bId));
      expect(history.nextBefore).toBeNull();
      const ofA = await as<Result<SecurityOverview>>('A', 'getSecurity');
      expect(ofA.ok && ofA.value.history.events.map((event) => event.id)).toEqual(await eventIds(aId));
    },
  },
  getSecurityHistory: {
    input: () => ({ before: '0192a6c4-0000-7000-8000-000000000000' }),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const [newestOfA = ''] = await eventIds(aId);
      const olderOfB = (await eventIds(bId)).filter((id) => id < newestOfA);
      expect(olderOfB.length).toBeGreaterThan(0);
      const result = await as<Result<SecurityHistory>>('B', 'getSecurityHistory', { before: newestOfA });
      expect(result.ok && { ids: result.value.events.map((event) => event.id), next: result.value.nextBefore }).toEqual(
        { ids: olderOfB, next: null },
      );
    },
  },
  listDevices: {
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const result = await as<Result<DeviceView[]>>('B', 'listDevices');
      expect(result.ok && result.value.map((device) => device.id).sort()).toEqual(await sessionIds(bId));
      expect(result.ok && result.value.filter((device) => device.current).map((device) => device.id)).toEqual([
        await currentSessionId(browsers.B),
      ]);
    },
  },
  revokeDevice: {
    input: () => ({ id: '0192a6c4-0000-7000-8000-000000000000' }),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const a = await aSnapshot();
      const ofB = await sessionIds(bId);
      for (const id of a.sessions) {
        expect(await as('B', 'revokeDevice', { id })).toEqual({ ok: false, code: 'DEVICE_NOT_FOUND' });
      }
      expect(await aSnapshot()).toEqual(a);
      expect(a.signedIn.every((id) => typeof id === 'string')).toBe(true);
      expect(await sessionIds(bId)).toEqual(ofB);
    },
  },
  revokeOtherDevices: {
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const a = await aSnapshot();
      const current = await currentSessionId(browsers.B);
      const others = (await sessionIds(bId)).length - 1;
      expect(others).toBeGreaterThan(0);
      expect(await as('B', 'revokeOtherDevices')).toEqual(ok({ count: others }));
      expect(await sessionIds(bId)).toEqual([current]);
      expect(await b2.session()).toBeNull();
      expect(await aSnapshot()).toEqual(a);
    },
  },
  getInstance: {
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      await refused('getInstance', undefined);
      expect(await as('A', 'getInstance')).toEqual(
        ok({
          instanceName: INSTANCE_NAME,
          publicUrl: `${ORIGIN}/`,
          defaultLocale: 'en',
          defaultTimezone: 'Asia/Makassar',
          registrationMode: 'invite',
          smtp: { ...smtpInput(), hasPassword: true },
        }),
      );
    },
  },
  saveInstance: {
    input: hostileInstance,
    anonymous: () => UNAUTHENTICATED,
    asB: (input) => refused('saveInstance', input),
  },
  sendInstanceTestEmail: {
    input: () => smtpInput(),
    anonymous: () => UNAUTHENTICATED,
    asB: (input) => refused('sendInstanceTestEmail', input),
  },
  inviteUser: {
    input: () => ({ email: 'mallory@example.test' }),
    anonymous: () => UNAUTHENTICATED,
    asB: (input) => refused('inviteUser', input),
  },
  getSetup: {
    input: () => ({ token: SETUP_TOKEN }),
    anonymous: () => ({ status: 'closed' }),
    asB: (input) => refused('getSetup', input, { status: 'closed' }),
  },
  createSetupAdmin: {
    input: () => ({ name: 'Mallory', email: 'mallory@example.test', password: secret('password-m'), locale: 'en' }),
    anonymous: () => FORBIDDEN,
    asB: async (input) => {
      await refused('createSetupAdmin', input);
      expect(await count('users', `email = 'mallory@example.test'`)).toBe(0);
    },
  },
  sendSetupTestEmail: {
    input: () => smtpInput(),
    anonymous: () => FORBIDDEN,
    asB: (input) => refused('sendSetupTestEmail', input),
  },
  saveSetup: {
    input: hostileInstance,
    anonymous: () => FORBIDDEN,
    asB: (input) => refused('saveSetup', input),
  },
  getGate: {
    anonymous: () => ({
      setup: 'complete',
      viewer: null,
      instanceName: INSTANCE_NAME,
      registrationMode: 'invite',
      googleEnabled: false,
    }),
    asB: async () => {
      expect(await as('B', 'getGate')).toEqual({
        setup: 'complete',
        viewer: {
          id: bId,
          sessionId: await currentSessionId(browsers.B),
          name: 'Budi S.',
          email: B.email,
          image: null,
          locale: 'en',
          timezone: 'Asia/Jakarta',
          role: 'user',
          twoFactorEnabled: true,
        },
        instanceName: INSTANCE_NAME,
        registrationMode: 'invite',
        googleEnabled: false,
      });
    },
  },
  listAccounts: {
    input: () => ({}),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      const ofB = await as<Result<AccountsOverview>>('B', 'listAccounts', input);
      expect(ofB.ok && ofB.value.accounts.map((a) => a.displayName)).toEqual(['Rekening B']);
      expect(ofB.ok && ofB.value.availableMinor).toBe(1_000_000n);
      const ofA = await as<Result<AccountsOverview>>('A', 'listAccounts', input);
      expect(ofA.ok && ofA.value.accounts.map((a) => a.displayName)).toEqual([A_LEDGER.account]);
    },
  },
  listCategories: {
    input: () => ({}),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      const ofB = await as<Result<CategoryView[]>>('B', 'listCategories', input);
      const ids = await ledgerIds(bId);
      expect(ofB.ok && ofB.value.length).toBeGreaterThan(1);
      expect(ofB.ok && ofB.value.filter((c) => !ids.includes(c.id))).toEqual([]);
      expect(ofB.ok && ofB.value.map((c) => c.name)).toContain('Kategori B');
    },
  },
  listTags: {
    input: () => ({}),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      const ofB = await as<Result<TagView[]>>('B', 'listTags', input);
      expect(ofB.ok && ofB.value.map((t) => t.slug)).toEqual(['tag-b']);
      const ofA = await as<Result<TagView[]>>('A', 'listTags', { query: 'rahasia' });
      expect(ofA.ok && ofA.value.map((t) => t.slug)).toEqual([A_LEDGER.tag]);
    },
  },
  getReferenceRate: {
    input: () => ({ base: 'USD', quote: 'IDR' }),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      // A's manual rate is A's alone; B has none and no built-in rate exists yet.
      expect(await as('B', 'getReferenceRate', input)).toEqual(ok(null));
      expect(await as('A', 'getReferenceRate', input)).toMatchObject(ok({ rate: '16474', manual: true }));
    },
  },
  getPreferences: {
    anonymous: () => requestContext(null).preferences,
    asB: async () => {
      expect(await as('B', 'getPreferences')).toEqual(requestContext(null).preferences);
    },
  },
};

/**
 * Every server function the app defines: the exports of each source file that calls `createServerFn(`. Under
 * `serverFnModule()` a server function is its handler with an own `validator` property.
 */
async function serverFunctions(): Promise<{ id: string; fn: unknown }[]> {
  const found: { id: string; fn: unknown }[] = [];
  const files = readdirSync(SRC, { recursive: true, encoding: 'utf8' })
    .filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file) && !file.endsWith('.d.ts'))
    .sort();
  for (const file of files) {
    const calls = readFileSync(path.join(SRC, file), 'utf8').match(/\bcreateServerFn\(/g)?.length ?? 0;
    if (calls === 0) continue;
    // The module path is discovered at run time, so it cannot be a static import.
    const module = (await import(path.join(SRC, file))) as Record<string, unknown>;
    const exported = Object.entries(module).filter(
      ([, value]) => typeof value === 'function' && Object.hasOwn(value, 'validator'),
    );
    // A server function that is not exported cannot be found here; make it visible instead of skipping it.
    if (exported.length !== calls) found.push({ id: `${file}: ${String(calls)} createServerFn calls`, fn: null });
    for (const [name, fn] of exported) found.push({ id: `${file}#${name}`, fn });
  }
  return found;
}

describe('tenant isolation at the API', () => {
  it('has a case for every server function', async () => {
    const all = await serverFunctions();
    expect(all.map(({ id }) => id)).toContain('server/fn/account.ts#getProfile');
    expect(all.map(({ id }) => id)).toContain('server/get-preferences.ts#getPreferences');
    const covered = new Set<unknown>((Object.keys(MATRIX) as Name[]).map((name) => FUNCTIONS[name]));
    const missing = all.filter(({ fn }) => !covered.has(fn)).map(({ id }) => id);
    expect(missing, 'server functions without an isolation case').toEqual([]);
    expect(all).toHaveLength(covered.size);
  });

  for (const [name, entry] of Object.entries(MATRIX) as [Name, Case][]) {
    it(`${name}: B sees and changes only B's data; signed out is refused`, async () => {
      const input = entry.input?.();
      expect(await as('anonymous', name, input)).toEqual(entry.anonymous());
      await entry.asB(input);
    });
  }

  it('never answers with an `_enc` field, a secret, or (to B and signed-out visitors) any of A’s data', async () => {
    const forbidden = [...secrets, ...(await storedSecrets())];
    const ofA = await aIdentifiers();
    expect(new Set(responses.map(({ caller }) => caller))).toEqual(new Set(['A', 'B', 'anonymous']));

    const encKeys = (value: unknown, at: string): string[] => {
      if (typeof value !== 'object' || value === null) return [];
      return Object.entries(value).flatMap(([key, child]) => [
        ...(/(?:_enc|Enc)$/.test(key) ? [`${at}.${key}`] : []),
        ...encKeys(child, `${at}.${key}`),
      ]);
    };
    for (const { caller, fn, value } of responses) {
      const json = toJson(value);
      expect(encKeys(value, `${caller} ${fn}`)).toEqual([]);
      expect(forbidden.filter((text) => json.includes(text)).length, `${caller} ${fn} leaks a secret`).toBe(0);
      if (caller !== 'A')
        expect(
          ofA.filter((text) => json.includes(text)),
          `${caller} ${fn}`,
        ).toEqual([]);
    }
  });
});
