// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { MAX_IMAGES, MAX_SPLIT_PARTS, PAGE_SIZE } from './transaction-limits.ts';

describe('transaction limits', () => {
  it('match the design and the repositories', () => {
    expect(PAGE_SIZE).toBe(100);
    // "2/3 · maks 2 MB" beside the receipt.
    expect(MAX_IMAGES).toBe(3);
    expect(MAX_SPLIT_PARTS).toBe(10);
  });
});
