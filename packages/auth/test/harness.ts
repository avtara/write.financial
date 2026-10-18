// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Unit-test harness for `createAuth`: PGlite with every migration (Better Auth runs as `wf_auth`), Redis via
 * ioredis-mock (which runs the counter Lua scripts), HIBP via msw, a recording mailer, and a cookie-keeping
 * browser that talks to `auth.handler` exactly like the web app will.
 */
import type { Config } from '@wf/config';
import type { InstanceSettings } from '@wf/db/instance-settings';
import { createInvitations } from '@wf/db/invitations';
import { startMigrated, type TestDatabase } from '@wf/db/testing';
import type { MailMessage, Mailer } from '@wf/integrations/mailer';
import RedisMock from 'ioredis-mock';
import { http, HttpResponse } from 'msw';
import { setupServer, type SetupServer } from 'msw/node';
import { TOTP, URI } from 'otpauth';
import { createHash } from 'node:crypto';
import { vi } from 'vitest';
import { createAuth, type WfAuth } from '../src/auth.ts';
import { HIBP_RANGE_URL } from '../src/breached.ts';
import type { LockoutPolicy } from '../src/lockout.ts';

export const ORIGIN = 'https://uang.example';
export const PUBLIC_URL = `${ORIGIN}/`;
/** Built at runtime so no fixture looks like a committed secret. */
export const SECRET = ['unit', 'test', 'auth', 'secret', 'not', 'for', 'production'].join('-');
export const FIREFOX = 'Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0';
export const CHROME =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36';
export const PASSWORD = ['kata', 'sandi', 'rahasia', 'xq7'].join('-');
/** HIBP reports this password as breached. */
export const BREACHED_PASSWORD = ['password', '12345'].join('');

export const BASE_SETTINGS: InstanceSettings = {
  instanceName: 'Keuangan Keluarga',
  publicUrl: PUBLIC_URL,
  defaultLocale: 'id',
  defaultTimezone: 'Asia/Makassar',
  registrationMode: 'closed',
  setupCompletedAt: null,
  smtp: null,
};

const sha1 = (text: string) => createHash('sha1').update(text).digest('hex').toUpperCase();

/** HIBP range API that knows exactly one breached password. */
export function hibpServer(): SetupServer {
  return setupServer(
    http.get(`${HIBP_RANGE_URL}:prefix`, ({ params }) => {
      const hash = sha1(BREACHED_PASSWORD);
      return HttpResponse.text(params['prefix'] === hash.slice(0, 5) ? `${hash.slice(5)}:12345` : '');
    }),
  );
}

export interface HarnessOptions {
  readonly lockoutPolicy?: LockoutPolicy;
  readonly google?: Config['google'];
  readonly nodeEnv?: Config['nodeEnv'];
  /** Leave out `now` and `fetch` to exercise the defaults. */
  readonly defaults?: boolean;
}

export interface Harness {
  readonly db: TestDatabase;
  readonly auth: WfAuth;
  readonly redis: InstanceType<typeof RedisMock>;
  readonly sent: MailMessage[];
  readonly logger: { info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
  /** Mutable instance settings returned by `deps.settings`. */
  settings: InstanceSettings;
  /** Set to make `deps.settings` fail (exercises error paths). */
  settingsError: Error | null;
  /** Fake clock for `deps.now`. */
  now: Date;
  browser: (options?: { ip?: string; userAgent?: string }) => Browser;
  /** Runs `fn` as another role, then switches back to `wf_auth`. */
  asRole: <T>(role: 'wf_app' | 'postgres', fn: () => Promise<T>) => Promise<T>;
  /** Creates an invitation as `adminId` (through `wf_app`, like the web app) and returns the token. */
  invite: (adminId: string, email: string, expiresAt?: Date) => Promise<string>;
  rebuild: (options?: HarnessOptions) => void;
}

export async function startHarness(options: HarnessOptions = {}): Promise<Harness> {
  const db = await startMigrated();
  await db.pg.exec('SET ROLE wf_auth');
  const redis = new RedisMock();
  const sent: MailMessage[] = [];
  const mailer: Mailer = {
    configured: true,
    send: (message) => {
      sent.push(message);
      return Promise.resolve();
    },
    close: () => undefined,
  };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const state = { settings: BASE_SETTINGS, settingsError: null as Error | null, now: new Date() };

  const build = (buildOptions: HarnessOptions): WfAuth =>
    createAuth({
      config: {
        publicUrl: PUBLIC_URL,
        nodeEnv: buildOptions.nodeEnv ?? 'test',
        auth: { secret: SECRET },
        google: buildOptions.google ?? null,
      },
      db: db.db,
      redis,
      mailer,
      settings: () =>
        state.settingsError === null ? Promise.resolve(state.settings) : Promise.reject(state.settingsError),
      logger,
      ...(buildOptions.defaults === true ? {} : { fetch: (...args) => fetch(...args), now: () => state.now }),
      ...(buildOptions.lockoutPolicy === undefined ? {} : { lockoutPolicy: buildOptions.lockoutPolicy }),
    });
  let auth = build(options);

  const asRole = async <T>(role: 'wf_app' | 'postgres', fn: () => Promise<T>): Promise<T> => {
    await db.pg.exec(role === 'postgres' ? 'RESET ROLE' : `SET ROLE ${role}`);
    try {
      return await fn();
    } finally {
      await db.pg.exec('SET ROLE wf_auth');
    }
  };

  return {
    db,
    redis,
    sent,
    logger,
    get auth() {
      return auth;
    },
    get settings() {
      return state.settings;
    },
    set settings(value) {
      state.settings = value;
    },
    get settingsError() {
      return state.settingsError;
    },
    set settingsError(value) {
      state.settingsError = value;
    },
    get now() {
      return state.now;
    },
    set now(value) {
      state.now = value;
    },
    browser: (browserOptions = {}) => new Browser(auth, browserOptions.ip, browserOptions.userAgent),
    asRole,
    invite: async (adminId, email, expiresAt = new Date(Date.now() + 86_400_000)) => {
      const token = `invite-${email}-${String(Math.random()).slice(2)}`;
      await asRole('wf_app', () =>
        createInvitations(db.db).create(adminId, {
          email,
          tokenHash: createHash('sha256').update(token).digest('hex'),
          expiresAt,
        }),
      );
      return token;
    },
    rebuild: (rebuildOptions = {}) => {
      auth = build(rebuildOptions);
    },
  };
}

/** Clears everything a test may have created; the instance settings go back to the defaults. */
export async function resetHarness(harness: Harness): Promise<void> {
  await harness.asRole('postgres', async () => {
    await harness.db.query('DELETE FROM users');
    await harness.db.query('DELETE FROM verifications');
  });
  await harness.redis.flushall();
  harness.sent.length = 0;
  harness.settings = BASE_SETTINGS;
  harness.settingsError = null;
  harness.now = new Date();
  harness.logger.info.mockClear();
  harness.logger.warn.mockClear();
  harness.logger.error.mockClear();
}

/** A browser: keeps cookies, sends the same-origin headers the web app's pages would. */
export class Browser {
  readonly cookies = new Map<string, string>();
  readonly #auth: WfAuth;
  readonly #ip: string;
  readonly #userAgent: string;

  constructor(auth: WfAuth, ip = '203.0.113.7', userAgent = FIREFOX) {
    this.#auth = auth;
    this.#ip = ip;
    this.#userAgent = userAgent;
  }

  headers(extra: Record<string, string> = {}): Headers {
    const headers = new Headers({
      origin: ORIGIN,
      'user-agent': this.#userAgent,
      'x-forwarded-for': this.#ip,
      ...extra,
    });
    if (this.cookies.size > 0) {
      headers.set('cookie', [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; '));
    }
    return headers;
  }

  async request(path: string, body?: unknown, init: { method?: string; headers?: Record<string, string> } = {}) {
    const method = init.method ?? (body === undefined ? 'GET' : 'POST');
    const response = await this.#auth.handler(
      new Request(`${ORIGIN}/api/auth${path}`, {
        method,
        headers: this.headers({
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          ...init.headers,
        }),
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );
    for (const cookie of response.headers.getSetCookie()) {
      const [pair = '', ...attributes] = cookie.split(';');
      const index = pair.indexOf('=');
      const name = pair.slice(0, index).trim();
      const value = pair.slice(index + 1).trim();
      const expired = attributes.some((attribute) => /^\s*max-age=0\s*$/i.test(attribute)) || value === '';
      if (expired) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
    return response;
  }

  // The type parameter lets each test name the response shape it reads.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
  async json<T = Record<string, unknown>>(
    path: string,
    body?: unknown,
    init?: { method?: string; headers?: Record<string, string> },
  ) {
    const response = await this.request(path, body, init);
    return { status: response.status, body: (await response.json()) as T, headers: response.headers };
  }

  signIn(email: string, password = PASSWORD, extra: Record<string, unknown> = {}) {
    return this.json('/sign-in/email', { email, password, ...extra });
  }
}

/** The TOTP generator behind a `otpauth://` URI from `/two-factor/enable`. */
export function totpFrom(uri: string): TOTP {
  const parsed = URI.parse(uri);
  if (!(parsed instanceof TOTP)) throw new TypeError('Not a TOTP URI');
  return parsed;
}

/** A 6-digit code that is wrong in every window Better Auth accepts. */
export function wrongCode(totp: TOTP): string {
  const valid = new Set([-30_000, 0, 30_000].map((offset) => totp.generate({ timestamp: Date.now() + offset })));
  for (let n = 0; ; n++) {
    const candidate = String(n).padStart(6, '0');
    if (!valid.has(candidate)) return candidate;
  }
}
