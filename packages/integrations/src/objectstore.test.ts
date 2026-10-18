// SPDX-License-Identifier: AGPL-3.0-only
import type { Config } from '@wf/config';
import { DecryptionError } from '@wf/crypto/cipher';
import { generateDek, type Dek } from '@wf/crypto/envelope';
import { sha256Hex } from '@wf/crypto/hash';
import fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';
import {
  ObjectForbiddenError,
  ObjectIntegrityError,
  ObjectNotFoundError,
  ObjectStoreError,
  createObjectStore,
  type BucketKind,
  type ObjectStoreOptions,
  type S3Port,
} from './objectstore.ts';
import type { ObjectPage } from './s3.ts';

const ALICE = '0192f0c1-7c1e-7000-8000-00000000000a';
const BOB = '0192f0c1-7c1e-7000-8000-00000000000b';
const UUIDV7_KEY = /^u\/([0-9a-f-]{36})\/[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const s3: Config['s3'] = {
  endpoint: 'http://127.0.0.1:1',
  region: 'us-east-1',
  accessKeyId: 'unused',
  secretAccessKey: 'unused',
  buckets: { attachments: 'wf-attachments', avatars: 'wf-avatars', reports: 'wf-reports', exports: 'wf-exports' },
};

/** In-memory S3: keys sorted like S3, pages of `pageSize`, continuation token = last key of the page. */
class FakeS3 implements S3Port {
  readonly buckets = new Map<string, Map<string, Uint8Array>>();
  readonly calls: string[] = [];
  readonly pageSize: number;

  constructor(pageSize = 1000) {
    this.pageSize = pageSize;
  }

  bucket(name: string): Map<string, Uint8Array> {
    const existing = this.buckets.get(name);
    if (existing !== undefined) return existing;
    const created = new Map<string, Uint8Array>();
    this.buckets.set(name, created);
    return created;
  }

  putObject(bucket: string, key: string, body: Uint8Array): Promise<void> {
    this.calls.push(`put ${bucket}/${key}`);
    this.bucket(bucket).set(key, Uint8Array.from(body));
    return Promise.resolve();
  }

  getObject(bucket: string, key: string): Promise<Uint8Array | null> {
    this.calls.push(`get ${bucket}/${key}`);
    return Promise.resolve(this.bucket(bucket).get(key) ?? null);
  }

  deleteObject(bucket: string, key: string): Promise<void> {
    this.calls.push(`delete ${bucket}/${key}`);
    this.bucket(bucket).delete(key);
    return Promise.resolve();
  }

  listObjects(bucket: string, prefix: string, token?: string): Promise<ObjectPage> {
    this.calls.push(`list ${bucket}/${prefix} ${token ?? '-'}`);
    const keys = [...this.bucket(bucket).keys()]
      .filter((key) => key.startsWith(prefix) && (token === undefined || key > token))
      .sort();
    const page = keys.slice(0, this.pageSize);
    return Promise.resolve({ keys: page, nextToken: keys.length > page.length ? page.at(-1) : undefined });
  }

  deleteObjects(bucket: string, keys: readonly string[]): Promise<void> {
    this.calls.push(`deleteObjects ${bucket} ${keys.length}`);
    for (const key of keys) this.bucket(bucket).delete(key);
    return Promise.resolve();
  }
}

const deks = new Map<string, Dek>([
  [ALICE, generateDek()],
  [BOB, generateDek()],
]);

function setup(options: Partial<ObjectStoreOptions> & { fake?: FakeS3 } = {}) {
  const fake = options.fake ?? new FakeS3();
  const getDek = vi.fn((userId: string) => Promise.resolve(deks.get(userId) ?? generateDek()));
  const store = createObjectStore({ s3, bucket: 'attachments', getDek, client: fake, ...options });
  return { fake, getDek, store };
}

const bytes = (text: string) => new TextEncoder().encode(text);
const stored = (fake: FakeS3, key: string, bucket = 'wf-attachments') => fake.bucket(bucket).get(key);

describe('createObjectStore', () => {
  describe('put', () => {
    it('stores ciphertext under u/{userId}/{uuidv7} and returns the plaintext size and SHA-256', async () => {
      const { fake, getDek, store } = setup();
      const content = bytes('Struk Indomaret Rp42.810');
      const result = await store.put(ALICE, content, 'image/webp');

      expect(result).toEqual({ key: result.key, size: content.length, sha256: sha256Hex(content) });
      expect(UUIDV7_KEY.exec(result.key)?.[1]).toBe(ALICE);
      expect(getDek).toHaveBeenCalledWith(ALICE);
      expect(fake.calls).toEqual([`put wf-attachments/${result.key}`]);
      const blob = stored(fake, result.key);
      // format ‖ nonce ‖ (mime length ‖ mime ‖ content) ‖ tag
      expect(blob).toHaveLength(1 + 12 + 1 + 'image/webp'.length + content.length + 16);
      expect(Buffer.from(blob ?? []).includes('Indomaret')).toBe(false);
      expect(Buffer.from(blob ?? []).includes('image/webp')).toBe(false);
    });

    it('writes to the configured bucket name of the logical bucket', async () => {
      const { fake, store } = setup({
        bucket: 'avatars',
        s3: { ...s3, buckets: { ...s3.buckets, avatars: 'my-avatars' } },
      });
      const { key } = await store.put(ALICE, bytes('x'), 'image/webp');
      expect(fake.calls).toEqual([`put my-avatars/${key}`]);
    });

    it('generates a fresh, time-ordered key for every put of the same content', async () => {
      const { store } = setup();
      const keys: string[] = [];
      for (let index = 0; index < 20; index++) keys.push((await store.put(ALICE, bytes('same'), 'text/plain')).key);
      expect(new Set(keys).size).toBe(20);
      expect([...keys].sort()).toEqual(keys);
    });

    it('rejects a malformed media type before fetching the key or storing anything', async () => {
      const { fake, getDek, store } = setup();
      for (const mime of ['', 'IMAGE/PNG', 'text/html; charset=utf-8', `a/${'b'.repeat(200)}`]) {
        await expect(store.put(ALICE, bytes('x'), mime)).rejects.toThrow(RangeError);
      }
      expect(getDek).not.toHaveBeenCalled();
      expect(fake.calls).toEqual([]);
    });
  });

  describe('get', () => {
    it('round-trips any content and media type', async () => {
      const { store } = setup();
      const mime = fc.constantFrom('image/webp', 'application/pdf', `${'a'.repeat(127)}/${'b'.repeat(127)}`);
      await fc.assert(
        fc.asyncProperty(fc.uint8Array({ maxLength: 2048 }), mime, async (content, type) => {
          const { key, sha256 } = await store.put(BOB, content, type);
          const object = await store.get(BOB, key, sha256);
          expect(object.mime).toBe(type);
          expect(Buffer.from(object.bytes).equals(Buffer.from(content))).toBe(true);
        }),
        { numRuns: 50 },
      );
    });

    it('works without an expected SHA-256', async () => {
      const { store } = setup();
      const { key } = await store.put(ALICE, bytes('halo'), 'text/plain');
      const object = await store.get(ALICE, key);
      expect(Buffer.from(object.bytes).toString()).toBe('halo');
    });

    it('throws ObjectIntegrityError when the content differs from the expected SHA-256', async () => {
      const { store } = setup();
      const { key } = await store.put(ALICE, bytes('halo'), 'text/plain');
      const error = await store.get(ALICE, key, sha256Hex('other')).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(ObjectIntegrityError);
      expect(error).toBeInstanceOf(ObjectStoreError);
      expect(error).toMatchObject({
        name: 'ObjectIntegrityError',
        key,
        message: `Object ${key} does not match its expected SHA-256`,
      });
    });

    it("rejects another user's key with ObjectForbiddenError before any network call or key lookup", async () => {
      const { fake, getDek, store } = setup();
      const { key } = await store.put(ALICE, bytes('rahasia'), 'text/plain');
      fake.calls.length = 0;
      getDek.mockClear();

      const error = await store.get(BOB, key).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(ObjectForbiddenError);
      expect(error).toMatchObject({ name: 'ObjectForbiddenError', key });
      expect((error as Error).message).toBe(`Object key "${key}" does not belong to the requesting user`);
      expect(fake.calls).toEqual([]);
      expect(getDek).not.toHaveBeenCalled();
    });

    it.each([
      `u/${ALICE}/`,
      `u/${ALICE}/not-a-uuid`,
      `u/${ALICE}/0192F0C1-7C1E-7000-8000-0000000000AA`,
      `u/${ALICE}/0192f0c1-7c1e-7000-8000-0000000000aa/extra`,
      `u/${ALICE}/../${BOB}/0192f0c1-7c1e-7000-8000-0000000000aa`,
      `U/${ALICE}/0192f0c1-7c1e-7000-8000-0000000000aa`,
      `/u/${ALICE}/0192f0c1-7c1e-7000-8000-0000000000aa`,
      `u/${ALICE}/0192f0c1-7c1e-7000-8000-0000000000aa\n`,
      `wf-attachments/u/${ALICE}/0192f0c1-7c1e-7000-8000-0000000000aa`,
    ])('rejects the malformed key %j as forbidden without a network call', async (key) => {
      const { fake, store } = setup();
      await expect(store.get(ALICE, key)).rejects.toThrow(ObjectForbiddenError);
      await expect(store.delete(ALICE, key)).rejects.toThrow(ObjectForbiddenError);
      expect(fake.calls).toEqual([]);
    });

    it('throws ObjectNotFoundError for a well-formed key of the user that does not exist', async () => {
      const { store } = setup();
      const key = `u/${ALICE}/0192f0c1-7c1e-7000-8000-0000000000aa`;
      const error = await store.get(ALICE, key).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(ObjectNotFoundError);
      expect(error).toMatchObject({ name: 'ObjectNotFoundError', key, message: `Object ${key} does not exist` });
    });

    it('throws ObjectIntegrityError for a tampered blob', async () => {
      const { fake, store } = setup();
      const { key } = await store.put(ALICE, bytes('halo'), 'text/plain');
      const blob = stored(fake, key);
      if (blob === undefined) throw new Error('not stored');
      blob[20] = (blob[20] ?? 0) ^ 1;

      const error = await store.get(ALICE, key).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(ObjectIntegrityError);
      expect(error).toMatchObject({ key, message: `Object ${key} failed decryption` });
      expect((error as Error).cause).toBeInstanceOf(DecryptionError);
    });

    it('does not decrypt a blob moved to another key, user, or bucket, even under the same DEK', async () => {
      const sharedDek = generateDek();
      const fake = new FakeS3();
      const getDek = () => Promise.resolve(sharedDek);
      const attachments = createObjectStore({ s3, bucket: 'attachments', getDek, client: fake });
      const avatars = createObjectStore({ s3, bucket: 'avatars', getDek, client: fake });
      const { key } = await attachments.put(ALICE, bytes('halo'), 'text/plain');
      const blob = stored(fake, key) ?? new Uint8Array();

      const otherKey = `u/${ALICE}/0192f0c1-7c1e-7000-8000-0000000000aa`;
      const bobKey = `u/${BOB}/${key.split('/')[2] ?? ''}`;
      fake.bucket('wf-attachments').set(otherKey, blob);
      fake.bucket('wf-attachments').set(bobKey, blob);
      fake.bucket('wf-avatars').set(key, blob);

      await expect(attachments.get(ALICE, otherKey)).rejects.toThrow(ObjectIntegrityError);
      await expect(attachments.get(BOB, bobKey)).rejects.toThrow(ObjectIntegrityError);
      await expect(avatars.get(ALICE, key)).rejects.toThrow(ObjectIntegrityError);
      await expect(attachments.get(ALICE, key)).resolves.toMatchObject({ mime: 'text/plain' });
    });

    it('still decrypts after the bucket is renamed in the configuration', async () => {
      const { fake, store } = setup();
      const { key } = await store.put(ALICE, bytes('halo'), 'text/plain');
      fake.bucket('renamed').set(key, stored(fake, key) ?? new Uint8Array());
      const renamed = createObjectStore({
        s3: { ...s3, buckets: { ...s3.buckets, attachments: 'renamed' } },
        bucket: 'attachments',
        getDek: (userId) => Promise.resolve(deks.get(userId) ?? generateDek()),
        client: fake,
      });
      await expect(renamed.get(ALICE, key)).resolves.toMatchObject({ mime: 'text/plain' });
    });
  });

  describe('delete', () => {
    it("deletes the user's object and is a no-op for a missing one", async () => {
      const { fake, store } = setup();
      const { key } = await store.put(ALICE, bytes('halo'), 'text/plain');
      await store.delete(ALICE, key);
      expect(stored(fake, key)).toBeUndefined();
      await expect(store.delete(ALICE, key)).resolves.toBeUndefined();
      await expect(store.get(ALICE, key)).rejects.toThrow(ObjectNotFoundError);
    });

    it("refuses another user's key without a network call", async () => {
      const { fake, store } = setup();
      const { key } = await store.put(ALICE, bytes('halo'), 'text/plain');
      fake.calls.length = 0;
      await expect(store.delete(BOB, key)).rejects.toThrow(ObjectForbiddenError);
      expect(fake.calls).toEqual([]);
      expect(stored(fake, key)).toBeDefined();
    });
  });

  describe('deletePrefix', () => {
    it("deletes every object of the user page by page and leaves other users' objects", async () => {
      const { fake, store } = setup({ fake: new FakeS3(2) });
      for (let index = 0; index < 5; index++) await store.put(ALICE, bytes(`a${index}`), 'text/plain');
      const bobs = [await store.put(BOB, bytes('b0'), 'text/plain'), await store.put(BOB, bytes('b1'), 'text/plain')];
      fake.calls.length = 0;

      await expect(store.deletePrefix(ALICE)).resolves.toBe(5);
      expect(fake.calls.filter((call) => call.startsWith('deleteObjects'))).toEqual([
        'deleteObjects wf-attachments 2',
        'deleteObjects wf-attachments 2',
        'deleteObjects wf-attachments 1',
      ]);
      expect([...fake.bucket('wf-attachments').keys()].sort()).toEqual(bobs.map(({ key }) => key).sort());
    });

    it('returns 0 without a delete request when the user has no objects', async () => {
      const { fake, store } = setup();
      await expect(store.deletePrefix(ALICE)).resolves.toBe(0);
      expect(fake.calls).toEqual([`list wf-attachments/u/${ALICE}/ -`]);
    });
  });

  it.each(['', 'u', `${ALICE}/x`, ALICE.toUpperCase(), `${ALICE} `, '../x'])(
    'rejects the malformed userId %j with RangeError',
    async (userId) => {
      const { fake, store } = setup();
      await expect(store.put(userId, bytes('x'), 'text/plain')).rejects.toThrow(RangeError);
      await expect(store.get(userId, `u/${userId}/0192f0c1-7c1e-7000-8000-0000000000aa`)).rejects.toThrow(RangeError);
      await expect(store.delete(userId, `u/${userId}/0192f0c1-7c1e-7000-8000-0000000000aa`)).rejects.toThrow(
        RangeError,
      );
      await expect(store.deletePrefix(userId)).rejects.toThrow('userId must be a lowercase UUID');
      expect(fake.calls).toEqual([]);
    },
  );

  it('defaults to the S3 adapter and still refuses foreign keys before any network call', async () => {
    const bucket: BucketKind = 'reports';
    const store = createObjectStore({ s3, bucket, getDek: () => Promise.resolve(generateDek()) });
    await expect(store.get(BOB, `u/${ALICE}/0192f0c1-7c1e-7000-8000-0000000000aa`)).rejects.toThrow(
      ObjectForbiddenError,
    );
  });
});
