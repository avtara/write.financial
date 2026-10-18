// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { MEDIA_TYPE } from './mime.ts';

describe('MEDIA_TYPE', () => {
  it.each([
    'image/webp',
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/ld+json',
    'text/csv',
    `${'a'.repeat(127)}/${'b'.repeat(127)}`,
  ])('accepts %s', (value) => {
    expect(MEDIA_TYPE.test(value)).toBe(true);
  });

  it.each([
    '',
    'image',
    'image/',
    '/webp',
    'Image/WebP',
    'text/html; charset=utf-8',
    'image/svg+xml\n',
    'image/-webp',
    'image/we bp',
    'a/b/c',
    `${'a'.repeat(128)}/b`,
    `a/${'b'.repeat(128)}`,
  ])('rejects %j', (value) => {
    expect(MEDIA_TYPE.test(value)).toBe(false);
  });
});
