// SPDX-License-Identifier: AGPL-3.0-only
import { createDecipheriv, randomBytes } from 'node:crypto';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { DecryptionError, open, seal } from './aead.ts';

const key = randomBytes(32);
const header = Uint8Array.of(9, 8);

describe('seal/open', () => {
  it('round-trips any plaintext, header and context', () => {
    fc.assert(
      fc.property(
        fc.uint8Array({ maxLength: 4 }),
        fc.uint8Array({ maxLength: 256 }),
        fc.array(fc.string()),
        (head, plaintext, context) => {
          const blob = seal(key, head, plaintext, context);
          expect(blob.length).toBe(head.length + 12 + plaintext.length + 16);
          expect(blob.subarray(0, head.length)).toEqual(Buffer.from(head));
          expect(open(key, blob, head.length, context)).toEqual(Buffer.from(plaintext));
        },
      ),
    );
  });

  it('is standard AES-256-GCM with header ‖ length-prefixed context as AAD', () => {
    const blob = seal(key, header, Buffer.from('halo'), ['ab', 'ü']);
    const decipher = createDecipheriv('aes-256-gcm', key, blob.subarray(2, 14));
    decipher.setAuthTag(blob.subarray(-16));
    decipher.setAAD(Buffer.from([9, 8, 0, 0, 0, 2, 0x61, 0x62, 0, 0, 0, 2, 0xc3, 0xbc]));
    const plaintext = Buffer.concat([decipher.update(blob.subarray(14, -16)), decipher.final()]);
    expect(plaintext.toString()).toBe('halo');
  });

  it('uses a fresh nonce per call', () => {
    const a = seal(key, header, Buffer.from('same'), []);
    const b = seal(key, header, Buffer.from('same'), []);
    expect(a.subarray(2, 14)).not.toEqual(b.subarray(2, 14));
    expect(a).not.toEqual(b);
  });

  it('rejects a flipped bit anywhere in the blob', () => {
    const blob = seal(key, header, Buffer.from('rahasia'), ['x']);
    for (let index = 0; index < blob.length; index++) {
      const tampered = Buffer.from(blob);
      tampered[index] = (tampered[index] ?? 0) ^ 1;
      expect(() => open(key, tampered, header.length, ['x'])).toThrow(DecryptionError);
    }
  });

  it('rejects a different key or context, without ambiguity between field boundaries', () => {
    const blob = seal(key, header, Buffer.from('rahasia'), ['ab', 'c']);
    expect(() => open(randomBytes(32), blob, header.length, ['ab', 'c'])).toThrow(DecryptionError);
    expect(() => open(key, blob, header.length, ['a', 'bc'])).toThrow(DecryptionError);
    expect(() => open(key, blob, header.length, ['abc'])).toThrow(DecryptionError);
    expect(() => open(key, blob, header.length, ['ab', 'c', ''])).toThrow(DecryptionError);
    expect(() => open(key, blob, header.length, [])).toThrow(DecryptionError);
  });

  it('accepts the shortest valid blob (empty plaintext) and rejects anything shorter', () => {
    const blob = seal(key, header, new Uint8Array(0), []);
    expect(blob.length).toBe(30);
    expect(open(key, blob, header.length, [])).toEqual(Buffer.alloc(0));
    for (let length = 0; length < blob.length; length++) {
      expect(() => open(key, blob.subarray(0, length), header.length, [])).toThrow(new DecryptionError());
    }
  });

  it('rejects a truncated blob with a plausible length', () => {
    const blob = seal(key, header, Buffer.from('rahasia panjang'), []);
    expect(() => open(key, blob.subarray(0, blob.length - 1), header.length, [])).toThrow(DecryptionError);
    expect(() => open(key, blob.subarray(1), header.length, [])).toThrow(DecryptionError);
  });
});

describe('DecryptionError', () => {
  it('has a generic message by default and a name', () => {
    const error = new DecryptionError();
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('DecryptionError');
    expect(error.message).toBe('Decryption failed');
    expect(new DecryptionError('other').message).toBe('other');
  });
});
