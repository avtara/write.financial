// SPDX-License-Identifier: AGPL-3.0-only
import { DecryptionError, open, seal } from './aead.ts';
import { dekBytes, type Dek } from './keys.ts';

/**
 * Field and object encryption with a user's DEK (`_enc` columns, attachments).
 * Blob layout: `format 0x01 ‖ 12-byte nonce ‖ ciphertext ‖ 16-byte tag`, fresh random nonce per call.
 * AAD = canonical encoding of (format, userId, purpose): a ciphertext moved to another user or another column
 * or object does not decrypt.
 */

export { DecryptionError };

export interface CipherAad {
  readonly userId: string;
  /** Where the ciphertext lives, e.g. `transactions.note` or `object:u/<userId>/<uuid>`. */
  readonly purpose: string;
}

const HEADER = Uint8Array.of(1);
const CONTEXT = 'wf.data';
const UTF8 = new TextDecoder('utf-8', { fatal: true });

export function encrypt(dek: Dek, plaintext: Uint8Array | string, aad: CipherAad): Uint8Array {
  if (aad.userId === '' || aad.purpose === '') throw new RangeError('aad.userId and aad.purpose must not be empty');
  return seal(dekBytes(dek), HEADER, plaintext, [CONTEXT, aad.userId, aad.purpose]);
}

/** Throws `DecryptionError` on a wrong key, tampering, truncation, or a different `userId`/`purpose`. */
export function decrypt(dek: Dek, blob: Uint8Array, aad: CipherAad): Uint8Array {
  return open(dekBytes(dek), blob, HEADER.length, [CONTEXT, aad.userId, aad.purpose]);
}

/** `decrypt` for values encrypted from a string; throws `TypeError` if the plaintext is not valid UTF-8. */
export function decryptText(dek: Dek, blob: Uint8Array, aad: CipherAad): string {
  return UTF8.decode(decrypt(dek, blob, aad));
}
