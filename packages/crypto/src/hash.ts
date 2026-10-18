// SPDX-License-Identifier: AGPL-3.0-only
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/** SHA-256 of bytes (or the UTF-8 bytes of a string) as lowercase hex, e.g. attachment integrity/dedupe. */
export function sha256Hex(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** HMAC-SHA256 as lowercase hex, e.g. `ip_hash` in security events (keyed so IPs cannot be brute-forced back). */
export function hmacSha256Hex(secret: Uint8Array | string, value: Uint8Array | string): string {
  if (secret.length === 0) throw new RangeError('HMAC secret must not be empty');
  return createHmac('sha256', secret).update(value).digest('hex');
}

/** Compares in time independent of where the inputs differ and of their lengths (both are hashed first). */
export function constantTimeEqual(a: Uint8Array | string, b: Uint8Array | string): boolean {
  return timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());
}
