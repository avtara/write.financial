// SPDX-License-Identifier: AGPL-3.0-only
import { createDecipheriv } from 'node:crypto';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { DecryptionError, decrypt, decryptText, encrypt, type CipherAad } from './cipher.ts';
import { generateDek } from './envelope.ts';
import { dekBytes } from './keys.ts';

const dek = generateDek();
const aad: CipherAad = { userId: '0192f0c1-7c1e-7000-8000-000000000001', purpose: 'transactions.note' };
const nonEmpty = fc.string({ minLength: 1 });

describe('encrypt/decrypt', () => {
  it('round-trips bytes for any user and purpose', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 512 }), nonEmpty, nonEmpty, (plaintext, userId, purpose) => {
        const blob = encrypt(dek, plaintext, { userId, purpose });
        expect(blob).toHaveLength(1 + 12 + plaintext.length + 16);
        expect(blob[0]).toBe(1);
        expect(decrypt(dek, blob, { userId, purpose })).toEqual(Buffer.from(plaintext));
      }),
    );
  });

  it('round-trips text as UTF-8', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'grapheme' }), (text) => {
        const blob = encrypt(dek, text, aad);
        expect(blob).toHaveLength(1 + 12 + Buffer.byteLength(text) + 16);
        expect(decryptText(dek, blob, aad)).toBe(text);
      }),
    );
    expect(Buffer.from(decrypt(dek, encrypt(dek, 'Rp42.810.000 ✓', aad), aad)).toString('utf8')).toBe('Rp42.810.000 ✓');
  });

  it('is AES-256-GCM over format ‖ nonce ‖ ciphertext ‖ tag with the documented AAD', () => {
    const blob = encrypt(dek, 'halo', { userId: 'u1', purpose: 'p' });
    const field = (text: string) => [0, 0, 0, text.length, ...Buffer.from(text)];
    const decipher = createDecipheriv('aes-256-gcm', dekBytes(dek), blob.subarray(1, 13));
    decipher.setAuthTag(blob.subarray(-16));
    decipher.setAAD(Uint8Array.from([1, ...field('wf.data'), ...field('u1'), ...field('p')]));
    expect(Buffer.concat([decipher.update(blob.subarray(13, -16)), decipher.final()]).toString()).toBe('halo');
  });

  it('uses a fresh nonce per call', () => {
    const a = encrypt(dek, 'sama', aad);
    const b = encrypt(dek, 'sama', aad);
    expect(a.subarray(1, 13)).not.toEqual(b.subarray(1, 13));
  });

  it('rejects tampering with any byte', () => {
    const blob = encrypt(dek, 'catatan rahasia', aad);
    for (let index = 0; index < blob.length; index++) {
      const tampered = Uint8Array.from(blob);
      tampered[index] = (tampered[index] ?? 0) ^ 0x01;
      expect(() => decrypt(dek, tampered, aad)).toThrow(new DecryptionError());
    }
  });

  it('rejects truncated blobs', () => {
    const blob = encrypt(dek, 'catatan', aad);
    for (const length of [0, 1, 13, 28, blob.length - 1]) {
      expect(() => decrypt(dek, blob.subarray(0, length), aad)).toThrow(new DecryptionError());
    }
  });

  it('rejects another user, another purpose, or another DEK', () => {
    const blob = encrypt(dek, 'catatan', aad);
    expect(() => decrypt(dek, blob, { ...aad, userId: 'other-user' })).toThrow(new DecryptionError());
    expect(() => decrypt(dek, blob, { ...aad, purpose: 'receivables.note' })).toThrow(new DecryptionError());
    expect(() => decrypt(dek, blob, { userId: aad.purpose, purpose: aad.userId })).toThrow(new DecryptionError());
    expect(() => decrypt(generateDek(), blob, aad)).toThrow(new DecryptionError());
    expect(() => decryptText(dek, blob, { ...aad, purpose: 'object:u/x/y' })).toThrow(new DecryptionError());
  });

  it('requires a non-empty userId and purpose', () => {
    const error = new RangeError('aad.userId and aad.purpose must not be empty');
    expect(() => encrypt(dek, 'x', { userId: '', purpose: 'p' })).toThrow(error);
    expect(() => encrypt(dek, 'x', { userId: 'u', purpose: '' })).toThrow(error);
  });

  it('decryptText refuses plaintext that is not valid UTF-8', () => {
    const blob = encrypt(dek, Uint8Array.of(0xff, 0xfe), aad);
    expect(() => decryptText(dek, blob, aad)).toThrow(TypeError);
  });
});
