// SPDX-License-Identifier: AGPL-3.0-only
import { createDecipheriv } from 'node:crypto';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { decrypt, encrypt } from './cipher.ts';
import {
  DecryptionError,
  UnknownKeyVersionError,
  generateDek,
  needsRewrap,
  rewrapDek,
  unwrapDek,
  wrapDek,
} from './envelope.ts';
import { activeKek, dekBytes } from './keys.ts';
import { addKeyVersion, parseKeyring } from './keyring.ts';

const v1Text = `v1:${Buffer.alloc(32, 1).toString('base64')}\n`;
const v1 = parseKeyring(v1Text);
const v2Text = addKeyVersion(v1Text);
const v2 = parseKeyring(v2Text);
const v2Only = parseKeyring(v2Text.replace(v1Text, ''));
const userId = '0192f0c1-7c1e-7000-8000-000000000001';

describe('generateDek', () => {
  it('returns 32 random bytes', () => {
    const a = dekBytes(generateDek());
    const b = dekBytes(generateDek());
    expect(a).toHaveLength(32);
    expect(a).not.toEqual(b);
  });
});

describe('wrapDek/unwrapDek', () => {
  it('round-trips any DEK for any user', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), (user) => {
        const dek = generateDek();
        expect(dekBytes(unwrapDek(wrapDek(dek, v2, user), v2, user))).toEqual(dekBytes(dek));
      }),
      { numRuns: 50 },
    );
  });

  it('writes format 1, the active KEK version, and a fresh nonce into a 65-byte blob', () => {
    const dek = generateDek();
    const a = wrapDek(dek, v2, userId);
    const b = wrapDek(dek, v2, userId);
    expect(a).toHaveLength(65);
    expect([...a.subarray(0, 5)]).toEqual([1, 0, 0, 0, 2]);
    expect(a).not.toEqual(b);
    expect([...wrapDek(dek, v1, userId).subarray(0, 5)]).toEqual([1, 0, 0, 0, 1]);
  });

  it('is AES-256-GCM under the KEK with header ‖ "wf.dek" ‖ userId as AAD', () => {
    const dek = generateDek();
    const wrapped = wrapDek(dek, v2, 'u1');
    const field = (text: string) => [0, 0, 0, text.length, ...Buffer.from(text)];
    const decipher = createDecipheriv('aes-256-gcm', activeKek(v2), wrapped.subarray(5, 17));
    decipher.setAuthTag(wrapped.subarray(-16));
    decipher.setAAD(Uint8Array.from([1, 0, 0, 0, 2, ...field('wf.dek'), ...field('u1')]));
    expect(Buffer.concat([decipher.update(wrapped.subarray(17, -16)), decipher.final()])).toEqual(
      Buffer.from(dekBytes(dek)),
    );
  });

  it('encodes large KEK versions big-endian', () => {
    const keyring = parseKeyring(`v16909060:${Buffer.alloc(32, 7).toString('base64')}`);
    const wrapped = wrapDek(generateDek(), keyring, userId);
    expect([...wrapped.subarray(0, 5)]).toEqual([1, 1, 2, 3, 4]);
    expect(needsRewrap(wrapped, keyring)).toBe(false);
    expect(unwrapDek(wrapped, keyring, userId)).toBeDefined();
  });

  it('binds the wrapped DEK to the user', () => {
    const wrapped = wrapDek(generateDek(), v2, userId);
    expect(() => unwrapDek(wrapped, v2, 'someone-else')).toThrow(DecryptionError);
    expect(() => unwrapDek(wrapped, v2, '')).toThrow(DecryptionError);
  });

  it('rejects an empty userId when wrapping', () => {
    expect(() => wrapDek(generateDek(), v2, '')).toThrow(new RangeError('userId must not be empty'));
  });

  it('rejects tampering with any byte', () => {
    const wrapped = wrapDek(generateDek(), v2, userId);
    for (let index = 0; index < wrapped.length; index++) {
      const tampered = Uint8Array.from(wrapped);
      tampered[index] = (tampered[index] ?? 0) ^ 0x80;
      expect(() => unwrapDek(tampered, v2, userId)).toThrow(DecryptionError);
    }
  });

  it('rejects a wrapped DEK whose KEK version was swapped for another held version', () => {
    const wrapped = Uint8Array.from(wrapDek(generateDek(), v2, userId));
    wrapped[4] = 1;
    expect(() => unwrapDek(wrapped, v2, userId)).toThrow(new DecryptionError());
  });

  it('rejects blobs of the wrong length or format with a generic error', () => {
    const wrapped = wrapDek(generateDek(), v2, userId);
    const longer = Uint8Array.from([...wrapped, 0]);
    const otherFormat = Uint8Array.from(wrapped);
    otherFormat[0] = 2;
    for (const bad of [wrapped.subarray(0, 64), longer, otherFormat, new Uint8Array(0)]) {
      expect(() => unwrapDek(bad, v2, userId)).toThrow(new DecryptionError());
      expect(() => needsRewrap(bad, v2)).toThrow(new DecryptionError());
    }
  });

  it('reads the header of a blob that is a view into a larger buffer', () => {
    const wrapped = wrapDek(generateDek(), v1, userId);
    const padded = new Uint8Array(wrapped.length + 3);
    padded.set(wrapped, 3);
    const view = padded.subarray(3);
    expect(needsRewrap(view, v2)).toBe(true);
    expect(dekBytes(unwrapDek(view, v2, userId))).toEqual(dekBytes(unwrapDek(wrapped, v2, userId)));
  });

  it('names the missing KEK version when the keyring no longer holds it', () => {
    const wrapped = wrapDek(generateDek(), v1, userId);
    let error: unknown;
    try {
      unwrapDek(wrapped, v2Only, userId);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(UnknownKeyVersionError);
    expect(error).toBeInstanceOf(DecryptionError);
    expect(error).toMatchObject({
      name: 'UnknownKeyVersionError',
      version: 1,
      message: 'Wrapped DEK uses KEK version v1, which is not in the keyring',
    });
  });
});

describe('KEK rotation', () => {
  it('keeps old wraps readable, re-wraps to the active version, and leaves data untouched', () => {
    const dek = generateDek();
    const aad = { userId, purpose: 'transactions.note' };
    const note = encrypt(dek, 'bayar kos Oktober', aad);
    const oldWrap = wrapDek(dek, v1, userId);

    expect(needsRewrap(oldWrap, v1)).toBe(false);
    expect(needsRewrap(oldWrap, v2)).toBe(true);
    expect(dekBytes(unwrapDek(oldWrap, v2, userId))).toEqual(dekBytes(dek));

    const newWrap = rewrapDek(oldWrap, v2, userId);
    expect([...newWrap.subarray(0, 5)]).toEqual([1, 0, 0, 0, 2]);
    expect(needsRewrap(newWrap, v2)).toBe(false);

    const rotatedDek = unwrapDek(newWrap, v2Only, userId);
    expect(Buffer.from(decrypt(rotatedDek, note, aad)).toString()).toBe('bayar kos Oktober');
  });

  it('refuses to re-wrap for the wrong user', () => {
    const oldWrap = wrapDek(generateDek(), v1, userId);
    expect(() => rewrapDek(oldWrap, v2, 'someone-else')).toThrow(DecryptionError);
  });
});
