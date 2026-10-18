// SPDX-License-Identifier: AGPL-3.0-only
import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import { Dek, KEY_BYTES, Keyring, KeyringError, activeKek, dekBytes, kekFor } from './keys.ts';

const key = (fill: number) => new Uint8Array(KEY_BYTES).fill(fill);

describe('Keyring', () => {
  it('makes the highest version active regardless of order and lists versions ascending', () => {
    const keyring = new Keyring([
      { version: 2, key: key(2) },
      { version: 10, key: key(10) },
      { version: 1, key: key(1) },
    ]);
    expect(keyring.activeVersion).toBe(10);
    expect(activeKek(keyring)).toEqual(key(10));
    expect(keyring.versions).toEqual([1, 2, 10]);
  });

  it('keeps the first entry active when it is the highest', () => {
    const keyring = new Keyring([
      { version: 3, key: key(3) },
      { version: 1, key: key(1) },
    ]);
    expect(keyring.activeVersion).toBe(3);
    expect(activeKek(keyring)).toEqual(key(3));
  });

  it('looks up any held version and nothing else', () => {
    const keyring = new Keyring([
      { version: 1, key: key(1) },
      { version: 2, key: key(2) },
    ]);
    expect(kekFor(keyring, 1)).toEqual(key(1));
    expect(kekFor(keyring, 2)).toEqual(key(2));
    expect(kekFor(keyring, 3)).toBeUndefined();
  });

  it('rejects duplicate versions', () => {
    expect(
      () =>
        new Keyring([
          { version: 1, key: key(1) },
          { version: 1, key: key(2) },
        ]),
    ).toThrow(new KeyringError('Duplicate key version v1'));
  });

  it('never serializes key material', () => {
    const keyring = new Keyring([
      { version: 1, key: key(0xab) },
      { version: 2, key: key(0xcd) },
    ]);
    expect(inspect(keyring)).toBe('Keyring(active v2, versions v1,v2)');
    expect(JSON.stringify({ keyring })).toBe('{"keyring":"Keyring(active v2, versions v1,v2)"}');
  });
});

describe('KeyringError', () => {
  it('is a named Error', () => {
    const error = new KeyringError('bad');
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('KeyringError');
    expect(error.message).toBe('bad');
  });
});

describe('Dek', () => {
  it('exposes its bytes only through dekBytes', () => {
    const bytes = key(7);
    const dek = new Dek(bytes);
    expect(dekBytes(dek)).toBe(bytes);
    expect(Object.keys(dek)).toEqual([]);
  });

  it('never serializes key material', () => {
    const dek = new Dek(key(0xab));
    expect(inspect(dek)).toBe('Dek(redacted)');
    expect(inspect({ dek })).toBe('{ dek: Dek(redacted) }');
    expect(JSON.stringify({ dek })).toBe('{"dek":"Dek(redacted)"}');
  });
});
