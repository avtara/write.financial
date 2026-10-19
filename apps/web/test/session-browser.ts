// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A cookie-keeping browser for integration tests of server functions. It talks to Better Auth through
 * `auth.handler` (as the app mounts it under `/api/auth`) and calls server functions (mocked with
 * `serverFnModule()`, see `server-fn.ts`) with the context the request middleware builds: the request's headers
 * and the real session those headers carry, looked up at most once per call.
 */
import type { AuthSession, WfAuth } from '@wf/auth/auth';
import { TOTP, URI } from 'otpauth';
import { call, requestContext } from './server-fn.ts';

export class SessionBrowser {
  readonly cookies = new Map<string, string>();
  /** The `Set-Cookie` values of the last server function call. */
  lastSetCookies: readonly string[] = [];
  readonly #auth: WfAuth;
  readonly #origin: string;
  readonly #ip: string;
  readonly #userAgent: string;

  constructor(auth: WfAuth, origin: string, ip: string, userAgent: string) {
    this.#auth = auth;
    this.#origin = origin;
    this.#ip = ip;
    this.#userAgent = userAgent;
  }

  /** Same-origin request headers with this browser's cookies. */
  headers(): Headers {
    const headers = new Headers({ origin: this.#origin, 'user-agent': this.#userAgent, 'x-forwarded-for': this.#ip });
    if (this.cookies.size > 0) {
      headers.set('cookie', [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; '));
    }
    return headers;
  }

  /** The session these cookies carry, as the request middleware resolves it. */
  session(): Promise<AuthSession | null> {
    return this.#auth.getSession(this.headers());
  }

  /** A JSON request to Better Auth (`path` below `/api/auth`); POST when there is a body. */
  // The type parameter lets each caller name the response shape it reads.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
  async request<T = Record<string, unknown>>(path: string, body?: unknown): Promise<{ status: number; body: T }> {
    const headers = this.headers();
    if (body !== undefined) headers.set('content-type', 'application/json');
    const response = await this.#auth.handler(
      new Request(`${this.#origin}${this.#auth.basePath}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );
    this.#keep(response.headers.getSetCookie());
    return { status: response.status, body: (await response.json()) as T };
  }

  /** Calls a mocked server function as this browser; the cookies it sets are kept. */
  async call<T>(fn: unknown, data?: unknown): Promise<T> {
    const headers = this.headers();
    let session: Promise<AuthSession | null> | undefined;
    const context = {
      ...requestContext(null, 'id', headers),
      session: () => (session ??= this.#auth.getSession(headers)),
    };
    const result = await call<T>(fn, { context, data });
    this.lastSetCookies = [...context.setCookies];
    this.#keep(context.setCookies);
    return result;
  }

  /** Enrolls TOTP for the signed-in user (FR-A9) and returns the generator and the backup codes. */
  async enrollTotp(password: string): Promise<{ totp: TOTP; backupCodes: string[] }> {
    const enabled = await this.request<{ totpURI: string; backupCodes: string[] }>('/two-factor/enable', { password });
    const totp = URI.parse(enabled.body.totpURI);
    if (!(totp instanceof TOTP)) throw new TypeError('Not a TOTP URI');
    const verified = await this.request('/two-factor/verify-totp', { code: totp.generate() });
    if (verified.status !== 200) throw new Error(`TOTP enrollment failed with ${String(verified.status)}`);
    return { totp, backupCodes: enabled.body.backupCodes };
  }

  /** Signs in with email and password, then with the TOTP code when the account has one. */
  async signIn(email: string, password: string, totp?: TOTP): Promise<void> {
    const first = await this.request<{ twoFactorRedirect?: boolean }>('/sign-in/email', { email, password });
    if (first.status !== 200) throw new Error(`Sign-in failed with ${String(first.status)}`);
    if (first.body.twoFactorRedirect !== true) return;
    if (totp === undefined) throw new Error('Sign-in needs a TOTP code');
    const second = await this.request('/two-factor/verify-totp', { code: totp.generate() });
    if (second.status !== 200) throw new Error(`TOTP sign-in failed with ${String(second.status)}`);
  }

  #keep(setCookies: readonly string[]): void {
    for (const cookie of setCookies) {
      const [pair = '', ...attributes] = cookie.split(';');
      const index = pair.indexOf('=');
      const name = pair.slice(0, index).trim();
      const value = pair.slice(index + 1).trim();
      if (value === '' || attributes.some((attribute) => /^\s*max-age=0\s*$/i.test(attribute))) {
        this.cookies.delete(name);
      } else {
        this.cookies.set(name, value);
      }
    }
  }
}
