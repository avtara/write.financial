// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it, vi } from 'vitest';
import { hardNavigate, safeRedirect } from './navigation.ts';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('safeRedirect', () => {
  it('follows paths on this site', () => {
    expect(safeRedirect('/settings/security?x=1')).toBe('/settings/security?x=1');
    expect(safeRedirect('/')).toBe('/');
  });

  it('refuses other origins and non-paths', () => {
    for (const value of ['https://evil.example', '//evil.example', '/\\evil.example', 'settings', '', 42, undefined]) {
      expect(safeRedirect(value)).toBe('/');
    }
    expect(safeRedirect('//evil.example', '/sign-in')).toBe('/sign-in');
  });
});

describe('hardNavigate', () => {
  it('loads the page from scratch', () => {
    const assign = vi.fn();
    vi.stubGlobal('window', { location: { assign } });
    hardNavigate('/settings');
    expect(assign).toHaveBeenCalledWith('/settings');
  });
});
