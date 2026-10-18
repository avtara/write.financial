// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Global request middleware (registered in `src/start.ts`): runs for every page, server route, and server
 * function request. It
 * - creates the CSP nonce and resolves the display preferences, handing both to the app through the
 *   Start context (`getGlobalStartContext()`),
 * - renders inside Paraglide's async-local locale, so message functions use the request's locale,
 * - adds the security headers, keeps the `wf_locale` cookie in step with the rendered locale on pages,
 * - and writes one structured log line per request.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { createMiddleware } from '@tanstack/react-start';
import { loadConfig, type Config } from '@wf/config';
import { LOCALE_COOKIE_NAME } from '@wf/i18n/locale';
import { baseLocale, overwriteServerAsyncLocalStorage } from '@wf/i18n/runtime';
import { pino, type Logger } from 'pino';
import { preferenceCookie, type Preferences } from '../lib/preferences.ts';
import { createLogger } from './logger.ts';
import { resolvePreferences } from './preferences.ts';
import { createNonce, securityHeaders } from './security.ts';

/** What every request handler and `getRouter()` can read from the Start context. */
export interface RequestContext {
  readonly nonce: string;
  readonly preferences: Preferences;
}

interface LocaleStore {
  locale?: Preferences['locale'];
  origin?: string;
  messageCalls?: Set<string>;
}

interface ServerRuntime {
  readonly config: Config;
  readonly logger: Logger;
  readonly localeStorage: AsyncLocalStorage<LocaleStore>;
}

let runtime: ServerRuntime | undefined;

/** Loaded on the first request, so an invalid environment fails loudly and the client bundle stays free of it. */
function serverRuntime(): ServerRuntime {
  if (runtime === undefined) {
    const config = loadConfig(process.env);
    const localeStorage = new AsyncLocalStorage<LocaleStore>();
    overwriteServerAsyncLocalStorage(localeStorage);
    runtime = { config, logger: createLogger(config.log.level, pino.destination(1)), localeStorage };
  }
  return runtime;
}

export const requestMiddleware = createMiddleware().server(async ({ request, next }) => {
  const started = performance.now();
  const { config, logger, localeStorage } = serverRuntime();
  const url = new URL(request.url);
  const nonce = createNonce();
  // The instance default becomes `instance_settings.default_locale` with the setup wizard (FR-OP1).
  const { preferences, localeCookieStale } = resolvePreferences(request.headers, baseLocale);
  const context: RequestContext = { nonce, preferences };

  const result = await localeStorage.run(
    { locale: preferences.locale, origin: url.origin, messageCalls: new Set() },
    () => next({ context }),
  );

  // Copy into a new Response: the handler's headers may be immutable.
  const { response } = result;
  const headers = new Headers(response.headers);
  for (const [name, value] of securityHeaders({ nonce, publicUrl: config.publicUrl, dev: import.meta.env.DEV })) {
    headers.set(name, value);
  }
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
