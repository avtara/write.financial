// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { normalizeTagSlug, TAG_SLUG_MAX, TAG_SLUG_PATTERN } from './tags.ts';

describe('normalizeTagSlug', () => {
  it.each([
    ['dana-darurat', 'dana-darurat'],
    ['#Dana Darurat', 'dana-darurat'],
    ['  Kafé__Kopi!! ', 'kafe-kopi'],
    ['--studio--arunika--', 'studio-arunika'],
    ['DCA 2026', 'dca-2026'],
  ])('%j → %j', (input, slug) => {
    expect(normalizeTagSlug(input)).toBe(slug);
    expect(slug).toMatch(TAG_SLUG_PATTERN);
  });

  it('rejects empty and over-long slugs', () => {
    expect(normalizeTagSlug('#')).toBeNull();
    expect(normalizeTagSlug('   ')).toBeNull();
    expect(normalizeTagSlug('a'.repeat(TAG_SLUG_MAX))).toBe('a'.repeat(TAG_SLUG_MAX));
    expect(normalizeTagSlug('a'.repeat(TAG_SLUG_MAX + 1))).toBeNull();
  });
});
