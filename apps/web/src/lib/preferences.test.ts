// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import {
  balancesHiddenFromCookie,
  isTheme,
  parseCookies,
  platformFromHeaders,
  PREFERENCE_COOKIE_MAX_AGE,
  preferenceCookie,
  privacyCookieValue,
  themeFromCookie,
} from './preferences.ts';

describe('parseCookies', () => {
  it('reads name=value pairs, trimming whitespace; later duplicates win', () => {
    const cookies = parseCookies('wf_theme=light; wf_locale=en ;wf_theme=system');
    expect(Object.fromEntries(cookies)).toEqual({ wf_theme: 'system', wf_locale: 'en' });
  });

  it('keeps "=" inside values and skips pairs without a name', () => {
    const cookies = parseCookies('token=a=b; =orphan; flag; ');
    expect(Object.fromEntries(cookies)).toEqual({ token: 'a=b' });
  });

  it('returns nothing for an empty header', () => {
    expect(parseCookies('').size).toBe(0);
  });
});

describe('theme', () => {
  it('accepts exactly the three themes', () => {
    expect(['dark', 'light', 'system'].every(isTheme)).toBe(true);
    expect(isTheme('Dark')).toBe(false);
    expect(isTheme(undefined)).toBe(false);
  });

  it('defaults to dark for a missing or unknown cookie (FR-S2)', () => {
    expect(themeFromCookie('light')).toBe('light');
    expect(themeFromCookie('system')).toBe('system');
    expect(themeFromCookie(undefined)).toBe('dark');
    expect(themeFromCookie('neon')).toBe('dark');
  });
});

describe('privacy cookie', () => {
  it('round-trips both states; anything else means visible', () => {
    expect(balancesHiddenFromCookie(privacyCookieValue(true))).toBe(true);
    expect(balancesHiddenFromCookie(privacyCookieValue(false))).toBe(false);
    expect(balancesHiddenFromCookie(undefined)).toBe(false);
    expect(balancesHiddenFromCookie('1')).toBe(false);
  });
});

describe('preferenceCookie', () => {
  it('is site-wide, lax, and lives 400 days', () => {
    expect(PREFERENCE_COOKIE_MAX_AGE).toBe(34_560_000);
    expect(preferenceCookie('wf_theme', 'light', false)).toBe('wf_theme=light; Path=/; Max-Age=34560000; SameSite=Lax');
  });

  it('adds Secure on https', () => {
    expect(preferenceCookie('wf_privacy', 'hidden', true)).toBe(
      'wf_privacy=hidden; Path=/; Max-Age=34560000; SameSite=Lax; Secure',
    );
  });
});

describe('platformFromHeaders', () => {
  const headers = (init: Record<string, string>) => new Headers(init);

  it('prefers the Sec-CH-UA-Platform client hint', () => {
    expect(platformFromHeaders(headers({ 'sec-ch-ua-platform': '"macOS"', 'user-agent': 'Windows NT 10.0' }))).toBe(
      'mac',
    );
    expect(platformFromHeaders(headers({ 'sec-ch-ua-platform': '"Windows"', 'user-agent': 'Macintosh' }))).toBe(
      'other',
    );
  });

  it('falls back to the User-Agent: Mac, iPhone, and iPad use ⌘', () => {
    expect(platformFromHeaders(headers({ 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0)' }))).toBe('mac');
    expect(platformFromHeaders(headers({ 'user-agent': 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)' }))).toBe('mac');
    expect(platformFromHeaders(headers({ 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64)' }))).toBe('other');
  });

  it('uses Ctrl when the platform is unknown', () => {
    expect(platformFromHeaders(headers({}))).toBe('other');
  });
});
