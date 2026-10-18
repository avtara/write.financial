// SPDX-License-Identifier: AGPL-3.0-only
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { constantTimeEqual, hmacSha256Hex, sha256Hex } from './hash.ts';

describe('sha256Hex', () => {
  it('matches the FIPS 180-2 vectors for strings and bytes', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256Hex(Uint8Array.of(0x61, 0x62, 0x63))).toBe(sha256Hex('abc'));
  });
});

describe('hmacSha256Hex', () => {
  it('matches RFC 4231 test case 2', () => {
    expect(hmacSha256Hex('Jefe', 'what do ya want for nothing?')).toBe(
      '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843',
    );
    expect(hmacSha256Hex(Buffer.from('Jefe'), Buffer.from('what do ya want for nothing?'))).toBe(
      '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843',
    );
  });

  it('depends on the secret', () => {
    expect(hmacSha256Hex('a', '203.0.113.7')).not.toBe(hmacSha256Hex('b', '203.0.113.7'));
  });

  it('refuses an empty secret', () => {
    const error = new RangeError('HMAC secret must not be empty');
    expect(() => hmacSha256Hex('', 'x')).toThrow(error);
    expect(() => hmacSha256Hex(new Uint8Array(0), 'x')).toThrow(error);
    expect(hmacSha256Hex('k', '')).toHaveLength(64);
  });
});

describe('constantTimeEqual', () => {
  it('is equality of byte content', () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (a, b) => {
        expect(constantTimeEqual(a, b)).toBe(a === b);
        expect(constantTimeEqual(a, a)).toBe(true);
        expect(constantTimeEqual(Buffer.from(a), a)).toBe(true);
      }),
    );
  });

  it('handles different lengths and prefixes without throwing', () => {
    expect(constantTimeEqual('abc', 'abcd')).toBe(false);
    expect(constantTimeEqual('', 'a')).toBe(false);
    expect(constantTimeEqual(Uint8Array.of(1, 2), Uint8Array.of(1, 2))).toBe(true);
    expect(constantTimeEqual(Uint8Array.of(1, 2), Uint8Array.of(1, 3))).toBe(false);
  });
});
