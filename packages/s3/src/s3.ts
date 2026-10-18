// SPDX-License-Identifier: AGPL-3.0-only
import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type { Config } from '@wf/config';

/**
 * The few S3 operations the object store (`@wf/integrations/objectstore`) and the self-host backup need. Production
 * uses `createS3Port` (AWS SDK v3, works with SeaweedFS and any other S3 per D25); unit tests use an in-memory fake.
 * Bodies are opaque ciphertext.
 */
export interface S3Port {
  putObject(bucket: string, key: string, body: Uint8Array): Promise<void>;
  /** `null` when the object does not exist. */
  getObject(bucket: string, key: string): Promise<Uint8Array | null>;
  /** Succeeds when the object does not exist. */
  deleteObject(bucket: string, key: string): Promise<void>;
  /** One page of keys under `prefix`; `nextToken` is set while more pages follow. */
  listObjects(bucket: string, prefix: string, token?: string): Promise<ObjectPage>;
  /** Deletes up to 1000 keys (one page); throws `S3BatchDeleteError` if any of them could not be deleted. */
  deleteObjects(bucket: string, keys: readonly string[]): Promise<void>;
}

export interface ObjectPage {
  readonly keys: readonly string[];
  readonly nextToken: string | undefined;
}

/** Thrown when S3 reports per-key failures for a batch delete. */
export class S3BatchDeleteError extends Error {
  override readonly name = 'S3BatchDeleteError';
  readonly keys: readonly string[];

  constructor(keys: readonly string[]) {
    super(`S3 failed to delete ${keys.length} object(s): ${keys.join(', ')}`);
    this.keys = keys;
  }
}

/**
 * `S3Port` over `@aws-sdk/client-s3`. Path-style addressing because SeaweedFS (and most self-hosted S3) has no
 * virtual-host bucket DNS. SDK checksums only where the API requires them (DeleteObjects): bodies are AES-GCM
 * ciphertext, already authenticated end to end, and optional checksum headers are not supported by every S3.
 */
export function createS3Port(s3: Config['s3']): S3Port {
  const client = new S3Client({
    endpoint: s3.endpoint,
    region: s3.region,
    credentials: { accessKeyId: s3.accessKeyId, secretAccessKey: s3.secretAccessKey },
    forcePathStyle: true,
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });

  return {
    async putObject(bucket, key, body) {
      await client.send(
        new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: 'application/octet-stream' }),
      );
    },

    async getObject(bucket, key) {
      try {
        const { Body } = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        // The Node.js runtime always returns a stream body for GetObject; the SDK type is optional for all runtimes.
        return await (Body as NonNullable<typeof Body>).transformToByteArray();
      } catch (error) {
        if (error instanceof NoSuchKey) return null;
        throw error;
      }
    },

    async deleteObject(bucket, key) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },

    async listObjects(bucket, prefix, token) {
      const page = await client.send(
        new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token, MaxKeys: 1000 }),
      );
      const keys = (page.Contents ?? []).map((object) => object.Key).filter((key) => key !== undefined);
      return { keys, nextToken: page.NextContinuationToken };
    },

    async deleteObjects(bucket, keys) {
      const { Errors } = await client.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: { Objects: keys.map((key) => ({ Key: key })), Quiet: true },
        }),
      );
      const failed = (Errors ?? []).map((error) => String(error.Key));
      if (failed.length > 0) throw new S3BatchDeleteError(failed);
    },
  };
}
