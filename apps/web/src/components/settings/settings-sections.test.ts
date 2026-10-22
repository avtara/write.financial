// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { canOpenSection, OPENED_OVER_PAGE, openSettings, SETTINGS_SECTIONS } from './settings-sections.ts';

describe('canOpenSection', () => {
  it('knows the sections and keeps "instance" for admins', () => {
    for (const section of SETTINGS_SECTIONS.filter((name) => name !== 'instance')) {
      expect(canOpenSection(section, { role: 'user' })).toBe(true);
    }
    expect(canOpenSection('instance', { role: 'user' })).toBe(false);
    expect(canOpenSection('instance', { role: 'admin' })).toBe(true);
    expect(canOpenSection('billing', { role: 'admin' })).toBe(false);
  });
});

describe('openSettings', () => {
  it('opens the section over the current page, keeping its search, and marks the entry', () => {
    const options = openSettings('tags');
    expect(options.to).toBe('.');
    expect(options.search({ period: '2026-10', settings: 'profile' })).toEqual({ period: '2026-10', settings: 'tags' });
    expect(options.state({ __tempKey: 'k' })).toEqual({ __tempKey: 'k', [OPENED_OVER_PAGE]: true });
  });
});
