// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { resolvePreferences } from './preferences.ts';

const resolve = (init: Record<string, string>, instanceDefault: 'id' | 'en' = 'id') =>
  resolvePreferences(new Headers(init), instanceDefault);

describe('resolvePreferences', () => {
  it('uses the instance default and the dark, visible defaults for a first visit', () => {
    expect(resolve({})).toEqual({
      preferences: { locale: 'id', theme: 'dark', balancesHidden: false, platform: 'other' },
      localeCookieStale: true,
    });
    expect(resolve({}, 'en').preferences.locale).toBe('en');
  });

  it('takes the locale from Accept-Language when there is no cookie', () => {
    expect(resolve({ 'accept-language': 'en-GB,en;q=0.9' }).preferences.locale).toBe('en');
  });

  it('prefers the wf_locale cookie over Accept-Language and keeps a matching cookie', () => {
    const resolved = resolve({ cookie: 'wf_locale=id', 'accept-language': 'en' });
    expect(resolved.preferences.locale).toBe('id');
    expect(resolved.localeCookieStale).toBe(false);
  });

  it('marks an unusable cookie as stale so the response can replace it', () => {
    const resolved = resolve({ cookie: 'wf_locale=fr', 'accept-language': 'en' });
    expect(resolved.preferences.locale).toBe('en');
    expect(resolved.localeCookieStale).toBe(true);
  });

  it('puts the signed-in user’s language first and refreshes a cookie that disagrees', () => {
    const resolved = resolvePreferences(new Headers({ cookie: 'wf_locale=id', 'accept-language': 'id' }), 'id', 'en');
    expect(resolved.preferences.locale).toBe('en');
    expect(resolved.localeCookieStale).toBe(true);
  });

  it('reads theme, privacy mode, and platform', () => {
    const { preferences } = resolve({
      cookie: 'wf_theme=system; wf_privacy=hidden',
      'user-agent': 'Mozilla/5.0 (Macintosh)',
    });
    expect(preferences).toMatchObject({ theme: 'system', balancesHidden: true, platform: 'mac' });
  });
});
