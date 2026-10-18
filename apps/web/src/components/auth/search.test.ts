// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { optionalString, reauthFlag } from './search.ts';

describe('optionalString', () => {
  it('keeps non-empty strings only', () => {
    expect(optionalString('/settings')).toBe('/settings');
    expect(optionalString('')).toBeUndefined();
    expect(optionalString(1)).toBeUndefined();
    expect(optionalString(undefined)).toBeUndefined();
  });
});

describe('reauthFlag', () => {
  it('reads ?reauth=1 written by the server (number) or the router (string)', () => {
    expect(reauthFlag(1)).toBe('1');
    expect(reauthFlag('1')).toBe('1');
    expect(reauthFlag(0)).toBeUndefined();
    expect(reauthFlag('true')).toBeUndefined();
    expect(reauthFlag(undefined)).toBeUndefined();
  });
});
