// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Display preferences that must be known before the first paint (PRD FR-S2, FR-S3, D26): locale, theme,
 * privacy mode, and the keyboard platform for shortcut hints. They live in cookies so the server renders
 * the right `<html lang>`, theme, and hidden amounts on the first response, without a flash. Until
 * accounts exist the cookies are the only store; signed-in users will sync them to `user_preferences`.
 */
import type { Locale } from '@wf/i18n/locale';
import type { Platform } from '@wf/ui/kbd-hint';

export const THEMES = ['dark', 'light', 'system'] as const;

/** `system` follows `prefers-color-scheme`; dark is the default (FR-S2). */
export type Theme = (typeof THEMES)[number];

export const THEME_COOKIE_NAME = 'wf_theme';
export const PRIVACY_COOKIE_NAME = 'wf_privacy';

/** Cookie value while balances are hidden; any other value (or none) means visible. */
const PRIVACY_HIDDEN = 'hidden';

/** 400 days, the longest lifetime browsers accept (RFC 6265bis). */
export const PREFERENCE_COOKIE_MAX_AGE = 400 * 24 * 60 * 60;

export interface Preferences {
  readonly locale: Locale;
  readonly theme: Theme;
  /** Privacy mode: amounts render as `Rp••••••` (FR-S3). */
  readonly balancesHidden: boolean;
  /** Decides `⌘` vs `Ctrl` in shortcut hints and which modifier the shortcuts listen for. */
  readonly platform: Platform;
}

export function isTheme(value: unknown): value is Theme {
  return THEMES.some((theme) => theme === value);
}

/** Parses a `Cookie` header (or `document.cookie`). Later duplicates win; malformed pairs are skipped. */
export function parseCookies(header: string): ReadonlyMap<string, string> {
  const cookies = new Map<string, string>();
  for (const pair of header.split(';')) {
    const trimmed = pair.trim();
    const separator = trimmed.indexOf('=');
    if (separator < 1) continue;
    cookies.set(trimmed.slice(0, separator).trimEnd(), trimmed.slice(separator + 1).trimStart());
  }
  return cookies;
}

export function themeFromCookie(value: string | undefined): Theme {
  return isTheme(value) ? value : 'dark';
}

export function balancesHiddenFromCookie(value: string | undefined): boolean {
  return value === PRIVACY_HIDDEN;
}

export function privacyCookieValue(balancesHidden: boolean): string {
  return balancesHidden ? PRIVACY_HIDDEN : 'visible';
}

/**
 * `Set-Cookie` / `document.cookie` value for a preference. Not `HttpOnly`: the client switches preferences
 * without a round trip. Values are fixed enums, never user text.
 */
export function preferenceCookie(name: string, value: string, secure: boolean): string {
  const attributes = [`${name}=${value}`, 'Path=/', `Max-Age=${PREFERENCE_COOKIE_MAX_AGE}`, 'SameSite=Lax'];
  if (secure) attributes.push('Secure');
  return attributes.join('; ');
}

/**
 * macOS, iOS, and iPadOS use ⌘; everything else Ctrl. Prefers the `Sec-CH-UA-Platform` client hint
 * (quoted, e.g. `"macOS"`), then the User-Agent string.
 */
export function platformFromHeaders(headers: Headers): Platform {
  const hint = headers.get('sec-ch-ua-platform');
  const source = hint ?? headers.get('user-agent') ?? '';
  return /mac|iphone|ipad|ios/i.test(source) ? 'mac' : 'other';
}
