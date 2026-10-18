// SPDX-License-Identifier: AGPL-3.0-only
import { inspect } from 'node:util';

/**
 * Opaque holders for key material. Internal module: it is not in the package `exports`, so code outside
 * `@wf/crypto` can hold a `Keyring` or `Dek` but never read the bytes inside. Both refuse to serialize their
 * material (`JSON.stringify`, `util.inspect`, pino), so a stray log line cannot leak a key.
 */

/** Byte length of every AES-256 key (KEK and DEK). */
export const KEY_BYTES = 32;

export interface KeyEntry {
  readonly version: number;
  readonly key: Uint8Array;
}

/** Thrown for malformed, missing, or insecure key files and keyrings. Messages never contain key material. */
export class KeyringError extends Error {
  override readonly name = 'KeyringError';
}

/** The KEK used for new wraps. */
export let activeKek: (keyring: Keyring) => Uint8Array;
/** The KEK with the given version, if the keyring still holds it. */
export let kekFor: (keyring: Keyring, version: number) => Uint8Array | undefined;

/** Versioned key-encryption keys (KEKs). The highest version is the active one used for new wraps. */
export class Keyring {
  static {
    activeKek = (keyring) => keyring.#active.key;
    kekFor = (keyring, version) => keyring.#keks.get(version);
  }

  readonly #keks = new Map<number, Uint8Array>();
  readonly #active: KeyEntry;
  /** All versions in ascending order. */
  readonly versions: readonly number[];

  constructor(entries: readonly [KeyEntry, ...KeyEntry[]]) {
    let active = entries[0];
    for (const entry of entries) {
      if (this.#keks.has(entry.version)) throw new KeyringError(`Duplicate key version v${entry.version}`);
      this.#keks.set(entry.version, entry.key);
      if (entry.version > active.version) active = entry;
    }
    this.#active = active;
    this.versions = [...this.#keks.keys()].sort((a, b) => a - b);
  }

  get activeVersion(): number {
    return this.#active.version;
  }

  toJSON(): string {
    return this[inspect.custom]();
  }

  [inspect.custom](): string {
    return `Keyring(active v${this.activeVersion}, versions ${this.versions.map((v) => `v${v}`).join(',')})`;
  }
}

/** Raw DEK bytes, for the ciphers in this package only. */
export let dekBytes: (dek: Dek) => Uint8Array;

/** A user's data-encryption key (AES-256). Opaque: only `@wf/crypto` can read the bytes. */
export class Dek {
  static {
    dekBytes = (dek) => dek.#key;
  }

  readonly #key: Uint8Array;

  constructor(key: Uint8Array) {
    this.#key = key;
  }

  toJSON(): string {
    return this[inspect.custom]();
  }

  [inspect.custom](): string {
    return 'Dek(redacted)';
  }
}
