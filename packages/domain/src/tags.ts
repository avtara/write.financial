// SPDX-License-Identifier: AGPL-3.0-only
/** Tags (FR-K3): lowercase slugs such as `dana-darurat`, written with or without a leading `#`. */

/** Maximum length of a tag slug. */
export const TAG_SLUG_MAX = 32;

export const TAG_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * The slug for user input ("#Dana Darurat" → `dana-darurat`): lowercased, accents stripped, every run of other
 * characters turned into one hyphen. `null` when nothing usable remains or the slug is too long.
 */
export function normalizeTagSlug(input: string): string | null {
  const slug = input
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug === '' || slug.length > TAG_SLUG_MAX ? null : slug;
}
