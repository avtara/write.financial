// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from 'node:fs';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { baseLocale, cookieName, locales } from './paraglide/runtime.js';
import {
  isLocale,
  LOCALE_COOKIE_NAME,
  LOCALES,
  localeFromAcceptLanguage,
  matchLocale,
  resolveLocale,
} from './locale.ts';

describe('LOCALES', () => {
  it('lists the source locale first and agrees with the inlang project and the compiled runtime', () => {
    const settings = JSON.parse(readFileSync(new URL('../project.inlang/settings.json', import.meta.url), 'utf8')) as {
      baseLocale: string;
      locales: string[];
    };
    expect(LOCALES).toEqual(['id', 'en']);
    expect(settings).toMatchObject({ baseLocale: 'id', locales: LOCALES });
    expect(locales).toEqual(LOCALES);
    expect(baseLocale).toBe('id');
    expect(cookieName).toBe(LOCALE_COOKIE_NAME);
  });
});

describe('isLocale', () => {
  it('accepts exactly the supported locale codes', () => {
    expect(isLocale('id')).toBe(true);
    expect(isLocale('en')).toBe(true);
    for (const value of ['ID', 'id-ID', 'in', 'fr', '', null, undefined, 1]) expect(isLocale(value)).toBe(false);
  });
});

describe('matchLocale', () => {
  it.each([
    ['id', 'id'],
    ['id-ID', 'id'],
    ['in', 'id'],
    ['IN-id', 'id'],
    ['en', 'en'],
    [' en-GB ', 'en'],
    ['en_US', 'en'],
    ['fr', null],
    ['ind', null],
    ['english', null],
    ['*', null],
    ['', null],
  ])('%j → %j', (tag, expected) => {
    expect(matchLocale(tag)).toBe(expected);
  });
});

describe('localeFromAcceptLanguage', () => {
  it.each([
    ['id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7', 'id'],
    ['en-US,en;q=0.9,id;q=0.8', 'en'],
    // q-values decide, not header order.
    ['en;q=0.5, fr-FR, id;q=0.8', 'id'],
    // Equal weights keep header order.
    ['en;q=0.5, id;q=0.5', 'en'],
    ['id;q=0.5, en;q=0.5', 'id'],
    // q=0 means "not acceptable".
    ['id;q=0, en;q=0.1', 'en'],
    ['id;q=0.000', null],
    // Malformed q-values are not acceptable either.
    ['id;q=2, en;q=0.1', 'en'],
    ['id;q=1.5, en;q=0.1', 'en'],
    ['id;q=0.1234, en;q=0.1', 'en'],
    ['id;q=abc', null],
    ['id;q=, en;q=0.1', 'en'],
    // Parameters and case are tolerated.
    [' ID-id ; Q=1.0 ', 'id'],
    ['id;level=1;q=0.5, en;q=0.4', 'id'],
    ['in', 'id'],
    ['fr-FR, de', null],
    ['*', null],
    ['', null],
  ])('%j → %j', (header, expected) => {
    expect(localeFromAcceptLanguage(header)).toBe(expected);
  });
});

describe('resolveLocale', () => {
  it('prefers the user preference, then the cookie, then Accept-Language, then the instance default', () => {
    const all = { userPreference: 'en', cookie: 'id', acceptLanguage: 'id', instanceDefault: 'id' } as const;
    expect(resolveLocale(all)).toBe('en');
    expect(resolveLocale({ ...all, userPreference: null })).toBe('id');
    expect(resolveLocale({ cookie: 'en', acceptLanguage: 'id', instanceDefault: 'id' })).toBe('en');
    expect(resolveLocale({ cookie: null, acceptLanguage: 'en-GB,id;q=0.5', instanceDefault: 'id' })).toBe('en');
    expect(resolveLocale({ acceptLanguage: 'id-ID', instanceDefault: 'en' })).toBe('id');
    expect(resolveLocale({ acceptLanguage: null, instanceDefault: 'en' })).toBe('en');
    expect(resolveLocale({ instanceDefault: 'id' })).toBe('id');
  });

  it('skips empty or unsupported cookie and header values', () => {
    expect(resolveLocale({ cookie: '', acceptLanguage: '', instanceDefault: 'en' })).toBe('en');
    expect(resolveLocale({ cookie: 'fr', acceptLanguage: 'en', instanceDefault: 'id' })).toBe('en');
    expect(resolveLocale({ cookie: 'fr', acceptLanguage: 'de', instanceDefault: 'id' })).toBe('id');
  });

  it('always returns a supported locale, and the user preference whenever it is set', () => {
    const locale = fc.constantFrom(...LOCALES);
    fc.assert(
      fc.property(
        fc.option(locale),
        fc.option(fc.string()),
        fc.option(fc.string()),
        locale,
        (userPreference, cookie, acceptLanguage, instanceDefault) => {
          const resolved = resolveLocale({ userPreference, cookie, acceptLanguage, instanceDefault });
          expect(isLocale(resolved)).toBe(true);
          if (userPreference) expect(resolved).toBe(userPreference);
        },
      ),
    );
  });
});
