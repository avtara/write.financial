// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Supported locales and locale resolution (PRD D26, FR-S8).
 *
 * The locale is never part of the URL. It is resolved from, in order: the signed-in user's preference,
 * the locale cookie, the `Accept-Language` header, and finally the instance default.
 */

/** `id` is the source locale (the design is in Bahasa Indonesia); `en` is translated alongside. */
export const LOCALES = ['id', 'en'] as const;

export type Locale = (typeof LOCALES)[number];

/** Cookie holding the visitor's chosen locale. The Paraglide runtime reads and writes the same cookie. */
export const LOCALE_COOKIE_NAME = 'wf_locale';

export function isLocale(value: unknown): value is Locale {
  return LOCALES.some((locale) => locale === value);
}

/**
 * Maps a BCP 47 language tag to a supported locale by its primary language subtag:
 * `id`, `id-ID`, and the legacy `in` map to `id`; `en` and every `en-*` map to `en`.
 */
export function matchLocale(tag: string): Locale | null {
  const language = tag.trim().toLowerCase().split(/[-_]/, 1)[0];
  if (language === 'id' || language === 'in') return 'id';
  if (language === 'en') return 'en';
  return null;
}

/**
 * Returns the best supported locale from an `Accept-Language` header, honouring q-values
 * (RFC 9110 §12.5.4). Ranges with `q=0`, malformed q-values, and the `*` wildcard are skipped;
 * equal weights keep header order. Returns `null` when nothing matches.
 */
export function localeFromAcceptLanguage(header: string): Locale | null {
  const ranges = header
    .split(',')
    .map((part, index) => {
      const [tag = '', ...params] = part.split(';');
      const qParam = params.map((param) => param.trim().toLowerCase()).find((param) => param.startsWith('q='));
      // RFC 9110 qvalue: 0–1 with at most three decimals; anything malformed counts as not acceptable.
      const qValue = qParam?.slice(2) ?? '1';
      const q = /^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/.test(qValue) ? Number(qValue) : 0;
      return { locale: matchLocale(tag), q, index };
    })
    .filter((range): range is { locale: Locale; q: number; index: number } => range.locale !== null && range.q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index);
  return ranges[0]?.locale ?? null;
}

export interface LocaleSources {
  /** The signed-in user's saved preference (`user_preferences.locale`), if any. */
  userPreference?: Locale | null;
  /** Raw value of the {@link LOCALE_COOKIE_NAME} cookie, if present. Untrusted. */
  cookie?: string | null;
  /** Raw `Accept-Language` request header, if present. Untrusted. */
  acceptLanguage?: string | null;
  /** `instance_settings.default_locale`, chosen in the setup wizard. */
  instanceDefault: Locale;
}

/** Resolves the active locale: user preference → cookie → `Accept-Language` → instance default. */
export function resolveLocale(sources: LocaleSources): Locale {
  const { userPreference, cookie, acceptLanguage, instanceDefault } = sources;
  if (userPreference) return userPreference;
  const fromCookie = cookie ? matchLocale(cookie) : null;
  if (fromCookie) return fromCookie;
  const fromHeader = acceptLanguage ? localeFromAcceptLanguage(acceptLanguage) : null;
  return fromHeader ?? instanceDefault;
}
