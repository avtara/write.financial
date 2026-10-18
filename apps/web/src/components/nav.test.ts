// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { m } from '@wf/i18n/messages';
import { NAV_GROUPS } from './nav.ts';

describe('NAV_GROUPS', () => {
  it('lists only Overview for now, under the MENU group', () => {
    expect(NAV_GROUPS.map((group) => group.label())).toEqual([m.nav_menu()]);
    expect(NAV_GROUPS.flatMap((group) => group.items.map((item) => item.to))).toEqual(['/']);
  });

  it('labels every entry in both locales and gives it a unique G-shortcut', () => {
    const items = NAV_GROUPS.flatMap((group) => group.items);
    expect(items.map((item) => item.label === m.nav_overview)).toEqual([true]);
    expect(m.nav_overview({}, { locale: 'id' })).toBe('Ringkasan');
    expect(m.nav_overview({}, { locale: 'en' })).toBe('Overview');
    const shortcuts = items.map((item) => item.shortcut.join(' '));
    expect(shortcuts).toEqual(['G R']);
    expect(new Set(shortcuts).size).toBe(shortcuts.length);
  });
});
