// SPDX-License-Identifier: AGPL-3.0-only
import { randomBytes } from 'node:crypto';
import { DecryptionError, open, seal } from './aead.ts';
import { Dek, KEY_BYTES, activeKek, dekBytes, kekFor, type Keyring } from './keys.ts';

/**
 * Envelope encryption (PRD §9.1): each user has a random DEK, stored only wrapped by a KEK.
 * Wrapped layout (65 bytes): `format 0x01 ‖ KEK version uint32 BE ‖ nonce ‖ encrypted DEK ‖ tag`.
 * The AAD binds the header and the user id, so a wrapped DEK copied to another user does not unwrap.
 * KEK rotation re-wraps DEKs only; data encrypted with a DEK is never touched.
 */

export { DecryptionError };
export type { Dek };

const WRAP_FORMAT = 1;
const HEADER_BYTES = 5;
const WRAPPED_BYTES = HEADER_BYTES + 12 + KEY_BYTES + 16;
const CONTEXT = 'wf.dek';

/** Thrown by `unwrapDek` when the keyring no longer holds the KEK version a DEK was wrapped with. */
export class UnknownKeyVersionError extends DecryptionError {
  override readonly name = 'UnknownKeyVersionError';
  readonly version: number;

  constructor(version: number) {
    super(`Wrapped DEK uses KEK version v${version}, which is not in the keyring`);
    this.version = version;
  }
}

/** KEK version stored in a wrapped DEK; throws `DecryptionError` if the blob is not a wrapped DEK. */
function wrappedVersion(wrapped: Uint8Array): number {
  if (wrapped.length !== WRAPPED_BYTES || wrapped[0] !== WRAP_FORMAT) throw new DecryptionError();
  return new DataView(wrapped.buffer, wrapped.byteOffset, HEADER_BYTES).getUint32(1);
}

export function generateDek(): Dek {
  return new Dek(randomBytes(KEY_BYTES));
}

/** Wraps a DEK with the active KEK, bound to `userId`. */
export function wrapDek(dek: Dek, keyring: Keyring, userId: string): Uint8Array {
  if (userId === '') throw new RangeError('userId must not be empty');
  const header = Buffer.alloc(HEADER_BYTES);
  header.writeUInt8(WRAP_FORMAT);
  header.writeUInt32BE(keyring.activeVersion, 1);
  return seal(activeKek(keyring), header, dekBytes(dek), [CONTEXT, userId]);
}

/** Unwraps with the KEK version recorded in the blob. Throws `DecryptionError` on any mismatch or tampering. */
export function unwrapDek(wrapped: Uint8Array, keyring: Keyring, userId: string): Dek {
  const version = wrappedVersion(wrapped);
  const kek = kekFor(keyring, version);
  if (kek === undefined) throw new UnknownKeyVersionError(version);
  return new Dek(open(kek, wrapped, HEADER_BYTES, [CONTEXT, userId]));
}

/** Re-wraps a DEK under the active KEK (KEK rotation); the DEK itself, and all data under it, is unchanged. */
export function rewrapDek(wrapped: Uint8Array, keyring: Keyring, userId: string): Uint8Array {
  return wrapDek(unwrapDek(wrapped, keyring, userId), keyring, userId);
}

/** True if the DEK is wrapped with an older KEK than the active one. */
export function needsRewrap(wrapped: Uint8Array, keyring: Keyring): boolean {
  return wrappedVersion(wrapped) !== keyring.activeVersion;
}
