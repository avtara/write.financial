// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { hashBackupCode, hashedBackupCodeStorage } from './backup-codes.ts';

const KEY = new Uint8Array(32).fill(9);
const CODES = ['AbCdE-12345', 'zzzzz-00000'];

describe('hashBackupCode', () => {
  it('is a keyed hash of the trimmed code', () => {
    expect(hashBackupCode(KEY, 'AbCdE-12345')).toMatch(/^h:[0-9a-f]{64}$/);
    expect(hashBackupCode(KEY, ' AbCdE-12345\n')).toBe(hashBackupCode(KEY, 'AbCdE-12345'));
    expect(hashBackupCode(KEY, 'abcde-12345')).not.toBe(hashBackupCode(KEY, 'AbCdE-12345'));
    expect(hashBackupCode(new Uint8Array(32), 'AbCdE-12345')).not.toBe(hashBackupCode(KEY, 'AbCdE-12345'));
  });
});

describe('hashedBackupCodeStorage', () => {
  it('stores only hashes, keeps already-hashed entries, and reads the list back unchanged', async () => {
    const storage = hashedBackupCodeStorage(KEY);
    const stored = await storage.encrypt(JSON.stringify(CODES));
    expect(stored).not.toContain('AbCdE');
    const hashes = JSON.parse(await storage.decrypt(stored)) as string[];
    expect(hashes).toEqual(CODES.map((code) => hashBackupCode(KEY, code)));
    // After one code is used, Better Auth re-encodes the remaining (hashed) list.
    expect(await storage.encrypt(JSON.stringify(hashes.slice(1)))).toBe(JSON.stringify(hashes.slice(1)));
  });
});
