// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { deriveKey } from './keys.ts';

const SECRET = ['auth', 'secret', 'for', 'tests', 'only', '0123456789'].join('-');

describe('deriveKey', () => {
  it('derives a stable 256-bit key per purpose', () => {
    const key = deriveKey(SECRET, 'ip_hash');
    expect(key).toHaveLength(32);
    expect(deriveKey(SECRET, 'ip_hash')).toEqual(key);
  });

  it('separates purposes and secrets', () => {
    const keys = (['ip_hash', 'device', 'lockout', 'backup_code', 'rate_limit'] as const).map((purpose) =>
      Buffer.from(deriveKey(SECRET, purpose)).toString('hex'),
    );
    expect(new Set(keys).size).toBe(5);
    expect(deriveKey(`${SECRET}x`, 'ip_hash')).not.toEqual(deriveKey(SECRET, 'ip_hash'));
  });
});
