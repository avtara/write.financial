// SPDX-License-Identifier: AGPL-3.0-only
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Thin AES-256-GCM layer shared by DEK wrapping and data encryption. Sealed layout:
 * `header ‖ 12-byte nonce ‖ ciphertext ‖ 16-byte tag`. The header (format/key version) and the caller's
 * context fields are authenticated as AAD, so changing either makes `open` fail.
 */

const ALGORITHM = 'aes-256-gcm';
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

/** Any failure to decrypt: wrong key, tampered or truncated data, or a different user/purpose. Deliberately vague. */
export class DecryptionError extends Error {
  override readonly name: string = 'DecryptionError';

  constructor(message = 'Decryption failed') {
    super(message);
  }
}

/** Canonical AAD: header bytes, then each field as `uint32 big-endian byte length ‖ UTF-8 bytes`. */
function encodeAad(header: Uint8Array, context: readonly string[]): Buffer {
  const parts: Uint8Array[] = [header];
  for (const field of context) {
    const bytes = Buffer.from(field);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(bytes.length);
    parts.push(length, bytes);
  }
  return Buffer.concat(parts);
}

/** Seals bytes, or the UTF-8 bytes of a string. */
export function seal(
  key: Uint8Array,
  header: Uint8Array,
  plaintext: Uint8Array | string,
  context: readonly string[],
): Buffer {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, nonce);
  cipher.setAAD(encodeAad(header, context));
  return Buffer.concat([header, nonce, cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
}

/** Opens a blob produced by `seal` whose header is the first `headerLength` bytes. */
export function open(key: Uint8Array, blob: Uint8Array, headerLength: number, context: readonly string[]): Buffer {
  const bodyStart = headerLength + NONCE_BYTES;
  const tagStart = blob.length - TAG_BYTES;
  if (tagStart < bodyStart) throw new DecryptionError();
  const decipher = createDecipheriv(ALGORITHM, key, blob.subarray(headerLength, bodyStart));
  // Always exactly TAG_BYTES: GCM accepts shorter tags, which would weaken authentication.
  decipher.setAuthTag(blob.subarray(tagStart));
  decipher.setAAD(encodeAad(blob.subarray(0, headerLength), context));
  const plaintext = decipher.update(blob.subarray(bodyStart, tagStart));
  try {
    return Buffer.concat([plaintext, decipher.final()]);
  } catch {
    throw new DecryptionError();
  }
}
