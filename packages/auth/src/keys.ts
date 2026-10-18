// SPDX-License-Identifier: AGPL-3.0-only
import { hkdfSync } from 'node:crypto';

/**
 * What a key derived from `AUTH_SECRET` is for. Each purpose gets its own key, so a hash made for one purpose
 * (e.g. an `ip_hash` in a security event) cannot be matched against another (a device fingerprint).
 */
export type KeyPurpose = 'ip_hash' | 'device' | 'lockout' | 'backup_code' | 'rate_limit';

/** A 256-bit HMAC key for `purpose`, derived from `AUTH_SECRET` with HKDF-SHA256. */
export function deriveKey(secret: string, purpose: KeyPurpose): Uint8Array {
  return new Uint8Array(hkdfSync('sha256', secret, 'write.financial', `auth:${purpose}`, 32));
}
