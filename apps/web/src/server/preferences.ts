// SPDX-License-Identifier: AGPL-3.0-only
import { LOCALE_COOKIE_NAME, resolveLocale, type Locale } from '@wf/i18n/locale';
import {
  balancesHiddenFromCookie,
  parseCookies,
  platformFromHeaders,
  PRIVACY_COOKIE_NAME,
  THEME_COOKIE_NAME,
  themeFromCookie,
  type Preferences,
} from '../lib/preferences.ts';

export interface ResolvedPreferences {
  readonly preferences: Preferences;
  /**
   * The request's `wf_locale` cookie does not hold the resolved locale. The response then sets it, because
   * the Paraglide client runtime reads the locale from that cookie and must agree with the server render.
   */
  readonly localeCookieStale: boolean;
}

/**
 * Resolves the request's display preferences. Locale order (D26, FR-S8): the signed-in user's `users.locale`
 * (`userLocale`) → `wf_locale` cookie → `Accept-Language` → `instanceDefault` (`instance_settings.default_locale`).
 */
export function resolvePreferences(
  headers: Headers,
  instanceDefault: Locale,
  userLocale: Locale | null = null,
): ResolvedPreferences {
  const cookies = parseCookies(headers.get('cookie') ?? '');
  const cookie = cookies.get(LOCALE_COOKIE_NAME);
  const locale = resolveLocale({
    userPreference: userLocale,
    cookie: cookie ?? null,
    acceptLanguage: headers.get('accept-language'),
    instanceDefault,
  });
  return {
    preferences: {
      locale,
      theme: themeFromCookie(cookies.get(THEME_COOKIE_NAME)),
      balancesHidden: balancesHiddenFromCookie(cookies.get(PRIVACY_COOKIE_NAME)),
      platform: platformFromHeaders(headers),
    },
    localeCookieStale: cookie !== locale,
  };
}
