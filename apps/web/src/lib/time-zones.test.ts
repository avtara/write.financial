// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { timeZoneLabel } from './time-zones.ts';

describe('timeZoneLabel', () => {
  it('adds the short name where the locale has one, not a bare offset', () => {
    const at = new Date('2026-10-18T09:00:00Z');
    expect(timeZoneLabel('Asia/Jakarta', 'id', at)).toBe('Asia/Jakarta (WIB)');
    expect(timeZoneLabel('America/New_York', 'en', at)).toBe('America/New_York (EDT)');
    expect(timeZoneLabel('Asia/Jakarta', 'en', at)).toBe('Asia/Jakarta');
    expect(timeZoneLabel('UTC', 'en', at)).toBe('UTC');
  });
});
