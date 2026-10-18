// SPDX-License-Identifier: AGPL-3.0-only
import { localeFromAcceptLanguage, matchLocale, type Locale } from '@wf/i18n/locale';

export interface SignUpLocaleSources {
  /** `locale` sent with the sign-up form (already validated). */
  readonly explicit: Locale | null;
  /** The locale cookie: the language picked with the switcher on the sign-in page. Untrusted. */
  readonly cookie: string | null;
  readonly acceptLanguage: string | null;
  /** `instance_settings.default_locale`. */
  readonly instanceDefault: Locale;
}

/**
 * The language a new account starts with (FR-S8): an explicit choice (form field or switcher cookie), else the
 * `Accept-Language` header (Indonesian when it prefers `id`, otherwise English), else the instance default when
 * the request has no `Accept-Language` at all.
 */
export function signUpLocale({ explicit, cookie, acceptLanguage, instanceDefault }: SignUpLocaleSources): Locale {
  const chosen = explicit ?? (cookie === null ? null : matchLocale(cookie));
  if (chosen !== null) return chosen;
  if (acceptLanguage === null || acceptLanguage.trim() === '') return instanceDefault;
  return localeFromAcceptLanguage(acceptLanguage) === 'id' ? 'id' : 'en';
}
