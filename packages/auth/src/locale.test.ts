// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { signUpLocale } from './locale.ts';

const base = { explicit: null, cookie: null, acceptLanguage: null, instanceDefault: 'id' } as const;

describe('signUpLocale (FR-S8)', () => {
  it('uses an explicit choice first: the form field, then the switcher cookie', () => {
    expect(signUpLocale({ ...base, explicit: 'en', cookie: 'id', acceptLanguage: 'id' })).toBe('en');
    expect(signUpLocale({ ...base, cookie: 'en-US', acceptLanguage: 'id' })).toBe('en');
  });

  it('ignores a cookie that is not a supported locale', () => {
    expect(signUpLocale({ ...base, cookie: 'fr', acceptLanguage: 'en' })).toBe('en');
  });

  it('picks Indonesian when Accept-Language prefers it, English otherwise', () => {
    expect(signUpLocale({ ...base, acceptLanguage: 'id-ID,id;q=0.9,en;q=0.8' })).toBe('id');
    expect(signUpLocale({ ...base, acceptLanguage: 'en-GB,en;q=0.9,id;q=0.5' })).toBe('en');
    expect(signUpLocale({ ...base, acceptLanguage: 'fr-FR,de;q=0.8' })).toBe('en');
  });

  it('falls back to the instance default without Accept-Language', () => {
    expect(signUpLocale({ ...base, instanceDefault: 'en' })).toBe('en');
    expect(signUpLocale({ ...base, acceptLanguage: ' ' })).toBe('id');
  });
});
