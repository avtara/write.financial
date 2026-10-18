// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Global request middleware (registered in `src/start.ts`): runs for every page, server route, and server
 * function request. It
 * - creates the CSP nonce and resolves the display preferences (the instance default locale comes from
 *   `instance_settings`, a signed-in user's language from `users.locale`), handing both to the app through the
 *   Start context (`getGlobalStartContext()`), together with the request's session, looked up at most once,
 * - renders inside Paraglide's async-local locale, so message functions use the request's locale,
 * - adds the security headers, keeps the `wf_locale` cookie in step with the rendered locale on pages,
 * - and writes one structured log line per request.
 */
import { createMiddleware } from '@tanstack/react-start';
import type { AuthSession } from '@wf/auth/auth';
import { isLocale, LOCALE_COOKIE_NAME, type Locale } from '@wf/i18n/locale';
import { baseLocale } from '@wf/i18n/runtime';
import { preferenceCookie, type Preferences } from '../lib/preferences.ts';
import { resolvePreferences } from './preferences.ts';
import { baseRuntime, services } from './runtime.ts';
import { createNonce, QUEUE_BOARD_PATH, securityHeaders } from './security.ts';

/** What every request handler and `getRouter()` can read from the Start context. */
export interface RequestContext {
  readonly nonce: string;
  readonly preferences: Preferences;
  /** The request's signed-in session (`null` when signed out); looked up on the first call only. */
  readonly session: () => Promise<AuthSession | null>;
  /** The request's headers (Better Auth reads the session cookie from them). */
  readonly headers: Headers;
  /** Adds a `Set-Cookie` header to this request's response. */
  readonly setCookie: (cookie: string) => void;
}

/** Liveness probe: answers from the process alone (no database, no key file). */
const PROBE_PATH = '/healthz';

/** Better Auth's session cookie, with or without the `__Secure-` prefix of https deployments. */
const SESSION_COOKIE = /(?:^|;\s*)(?:__Secure-)?wf\.session_token=/;

export const requestMiddleware = createMiddleware().server(async ({ request, next, handlerType }) => {
  const started = performance.now();
  const { config, logger, localeStorage } = baseRuntime();
  const url = new URL(request.url);
  const nonce = createNonce();
  const probe = url.pathname === PROBE_PATH;

  let session: Promise<AuthSession | null> | undefined;
  const getSession = () => (session ??= services().then(({ auth }) => auth.getSession(request.headers)));

  let instanceDefault: Locale = baseLocale;
  let userLocale: Locale | null = null;
  if (!probe) {
    instanceDefault = (await (await services()).instance.get()).defaultLocale;
    // Only pages render text; a signed-in user's saved language wins over the cookie there (FR-S8).
    if (
      handlerType === 'router' &&
      request.method === 'GET' &&
      SESSION_COOKIE.test(request.headers.get('cookie') ?? '')
    ) {
      const locale = (await getSession())?.user.locale;
      userLocale = isLocale(locale) ? locale : null;
    }
  }
  const { preferences, localeCookieStale } = resolvePreferences(request.headers, instanceDefault, userLocale);
  const cookies: string[] = [];
  const context: RequestContext = {
    nonce,
    preferences,
    session: getSession,
    headers: request.headers,
    setCookie: (cookie) => {
      cookies.push(cookie);
    },
  };

  const result = await localeStorage.run(
    { locale: preferences.locale, origin: url.origin, messageCalls: new Set() },
    () => next({ context }),
  );

  // Copy into a new Response: the handler's headers may be immutable.
  const { response } = result;
  const headers = new Headers(response.headers);
  const queueBoard = url.pathname === QUEUE_BOARD_PATH || url.pathname.startsWith(`${QUEUE_BOARD_PATH}/`);
  for (const [name, value] of securityHeaders({
    nonce,
    publicUrl: config.publicUrl,
    dev: import.meta.env.DEV,
    queueBoard,
  })) {
    headers.set(name, value);
  }
  for (const cookie of cookies) headers.append('Set-Cookie', cookie);
  if (localeCookieStale && headers.get('content-type')?.startsWith('text/html')) {
    const secure = new URL(config.publicUrl).protocol === 'https:';
    headers.append('Set-Cookie', preferenceCookie(LOCALE_COOKIE_NAME, preferences.locale, secure));
  }
  logger.info(
    {
      method: request.method,
      path: url.pathname,
      status: response.status,
      durationMs: Math.round(performance.now() - started),
    },
    'request',
  );
  return {
    ...result,
    response: new Response(response.body, { status: response.status, statusText: response.statusText, headers }),
  };
});
