// SPDX-License-Identifier: AGPL-3.0-only
import type { Config } from '@wf/config';
import { decrypt, encrypt } from '@wf/crypto/cipher';
import type { Dek } from '@wf/crypto/envelope';
import { sha256Hex } from '@wf/crypto/hash';
import { v7 as uuidv7 } from 'uuid';
import { MEDIA_TYPE } from './mime.ts';
import { createS3Port, type S3Port } from '@wf/s3';

/**
 * Per-user encrypted object storage (PRD §9.1, D25). Every object is encrypted with its owner's DEK before it
 * leaves the app server; storage only ever sees ciphertext. Keys are `u/{userId}/{uuidv7}` (no file names).
 *
 * Stored plaintext: `mime length (1 byte) ‖ mime (ASCII) ‖ content`, so the media type is authenticated and hidden
 * from storage too. The cipher AAD is `{ userId, purpose: "object:{bucket}/{key}" }` with the logical bucket
 * (`attachments`, not the configurable bucket name): a blob copied to another key, user, or bucket does not decrypt,
 * while renaming a bucket in `.env` keeps every object readable.
 */

export type { S3Port };
export { S3BatchDeleteError } from '@wf/s3';

/** Logical bucket; the actual name comes from `Config['s3'].buckets`. */
export type BucketKind = keyof Config['s3']['buckets'];

export interface ObjectStoreOptions {
  readonly s3: Config['s3'];
  readonly bucket: BucketKind;
  /** The owner's data encryption key, e.g. `userKeys.getOrCreateDek`. */
  readonly getDek: (userId: string) => Promise<Dek>;
  /** Defaults to the AWS SDK adapter for `s3`. */
  readonly client?: S3Port;
}

export interface StoredObject {
  /** `u/{userId}/{uuidv7}` */
  readonly key: string;
  /** Plaintext size in bytes. */
  readonly size: number;
  /** SHA-256 of the plaintext, lowercase hex (integrity and dedupe). */
  readonly sha256: string;
}

export interface ObjectContent {
  readonly bytes: Uint8Array;
  readonly mime: string;
}

export interface ObjectStore {
  /** Encrypts and stores `bytes`. `mime` must be a canonical media type (`image/webp`). */
  put(userId: string, bytes: Uint8Array, mime: string): Promise<StoredObject>;
  /**
   * Fetches and decrypts an object of `userId`. Throws `ObjectForbiddenError` (without any network call) for a key
   * that is not `u/{userId}/{uuid}`, `ObjectNotFoundError`, or `ObjectIntegrityError` when the blob does not decrypt
   * or its SHA-256 differs from `expectedSha256`.
   */
  get(userId: string, key: string, expectedSha256?: string): Promise<ObjectContent>;
  /** Deletes an object of `userId` (no-op when it does not exist); `ObjectForbiddenError` as in `get`. */
  delete(userId: string, key: string): Promise<void>;
  /** Deletes every object under `u/{userId}/` (account deletion); returns how many were deleted. */
  deletePrefix(userId: string): Promise<number>;
}

export class ObjectStoreError extends Error {
  override readonly name: string = 'ObjectStoreError';
  readonly key: string;

  constructor(message: string, key: string, options?: ErrorOptions) {
    super(message, options);
    this.key = key;
  }
}

/** The key is not a well-formed object key of the requesting user. */
export class ObjectForbiddenError extends ObjectStoreError {
  override readonly name = 'ObjectForbiddenError';

  constructor(key: string) {
    super(`Object key ${JSON.stringify(key)} does not belong to the requesting user`, key);
  }
}

export class ObjectNotFoundError extends ObjectStoreError {
  override readonly name = 'ObjectNotFoundError';

  constructor(key: string) {
    super(`Object ${key} does not exist`, key);
  }
}

/** The stored blob fails authentication (tampered, swapped, wrong key) or does not match the expected SHA-256. */
export class ObjectIntegrityError extends ObjectStoreError {
  override readonly name = 'ObjectIntegrityError';
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const USER_ID = new RegExp(`^${UUID}$`);
const OBJECT_KEY = new RegExp(`^u/(${UUID})/${UUID}$`);

function prefixOf(userId: string): string {
  if (!USER_ID.test(userId)) throw new RangeError(`userId must be a lowercase UUID, got ${JSON.stringify(userId)}`);
  return `u/${userId}/`;
}

function assertOwnedKey(userId: string, key: string): void {
  prefixOf(userId);
  if (OBJECT_KEY.exec(key)?.[1] !== userId) throw new ObjectForbiddenError(key);
}

export function createObjectStore(options: ObjectStoreOptions): ObjectStore {
  const { bucket, getDek } = options;
  const bucketName = options.s3.buckets[bucket];
  const client = options.client ?? createS3Port(options.s3);
  const aad = (userId: string, key: string) => ({ userId, purpose: `object:${bucket}/${key}` });

  return {
    async put(userId, bytes, mime) {
      const key = prefixOf(userId) + uuidv7();
      if (!MEDIA_TYPE.test(mime))
        throw new RangeError(`mime must be a canonical media type, got ${JSON.stringify(mime)}`);
      const plaintext = Buffer.concat([Uint8Array.of(mime.length), Buffer.from(mime, 'ascii'), bytes]);
      const blob = encrypt(await getDek(userId), plaintext, aad(userId, key));
      await client.putObject(bucketName, key, blob);
      return { key, size: bytes.length, sha256: sha256Hex(bytes) };
    },

    async get(userId, key, expectedSha256) {
      assertOwnedKey(userId, key);
      const blob = await client.getObject(bucketName, key);
      if (blob === null) throw new ObjectNotFoundError(key);
      let plaintext: Buffer;
      try {
        plaintext = Buffer.from(decrypt(await getDek(userId), blob, aad(userId, key)));
      } catch (error) {
        throw new ObjectIntegrityError(`Object ${key} failed decryption`, key, { cause: error });
      }
      const mimeEnd = 1 + plaintext.readUInt8(0);
      const bytes = plaintext.subarray(mimeEnd);
      if (expectedSha256 !== undefined && sha256Hex(bytes) !== expectedSha256) {
        throw new ObjectIntegrityError(`Object ${key} does not match its expected SHA-256`, key);
      }
      return { bytes, mime: plaintext.toString('ascii', 1, mimeEnd) };
    },

    async delete(userId, key) {
      assertOwnedKey(userId, key);
      await client.deleteObject(bucketName, key);
    },

    async deletePrefix(userId) {
      const prefix = prefixOf(userId);
      let deleted = 0;
      let token: string | undefined;
      do {
        const page = await client.listObjects(bucketName, prefix, token);
        if (page.keys.length > 0) await client.deleteObjects(bucketName, page.keys);
        deleted += page.keys.length;
        token = page.nextToken;
      } while (token !== undefined);
      return deleted;
    },
  };
}
