// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Backup codes stored hashed (PRD §9.1, plan §4.1). Better Auth 1.7 keeps the list as one string produced by
 * `storeBackupCodes.encrypt` and checks a submitted code with `codes.includes(code)` on the `decrypt` result. So
 * `encrypt` replaces every plain code with its keyed hash, `decrypt` returns the hashes unchanged, and a `before`
 * hook on `/two-factor/verify-backup-code` hashes the submitted code (see `plugin.ts`). The plain codes exist only
 * in the response that shows them to the user once.
 */
import { hmacSha256Hex } from '@wf/crypto/hash';

const HASHED = /^h:[0-9a-f]{64}$/;

/** The stored form of one code; `key` is `deriveKey(AUTH_SECRET, 'backup_code')`. */
export function hashBackupCode(key: Uint8Array, code: string): string {
  return `h:${hmacSha256Hex(key, code.trim())}`;
}

/** Better Auth `backupCodeOptions.storeBackupCodes`. */
export function hashedBackupCodeStorage(key: Uint8Array): {
  encrypt: (codesJson: string) => Promise<string>;
  decrypt: (stored: string) => Promise<string>;
} {
  return {
    encrypt: (codesJson) => {
      const codes = JSON.parse(codesJson) as string[];
      // After a code is used, Better Auth re-stores the remaining list, which is already hashed.
      return Promise.resolve(
        JSON.stringify(codes.map((code) => (HASHED.test(code) ? code : hashBackupCode(key, code)))),
      );
    },
    decrypt: (stored) => Promise.resolve(stored),
  };
}
