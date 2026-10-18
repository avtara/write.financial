// SPDX-License-Identifier: AGPL-3.0-only
import type { ObjectPage, S3Port } from '@wf/s3';

/** In-memory `S3Port` for unit tests: the buckets must exist, as with SeaweedFS; listings come in `pageSize` pages. */
export class FakeS3 implements S3Port {
  readonly buckets = new Map<string, Map<string, Uint8Array>>();
  readonly calls: string[] = [];
  readonly #pageSize: number;

  constructor(bucketNames: readonly string[], pageSize = 1000) {
    for (const name of bucketNames) this.buckets.set(name, new Map());
    this.#pageSize = pageSize;
  }

  bucket(name: string): Map<string, Uint8Array> {
    const bucket = this.buckets.get(name);
    if (bucket === undefined) throw new Error(`NoSuchBucket: ${name}`);
    return bucket;
  }

  putObject(bucket: string, key: string, body: Uint8Array): Promise<void> {
    this.calls.push(`put ${bucket}/${key}`);
    this.bucket(bucket).set(key, body.slice());
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
    const keys = [...this.bucket(bucket).keys()].filter((key) => key.startsWith(prefix)).toSorted();
    const start = token === undefined ? 0 : Number(token);
    const end = start + this.#pageSize;
    return Promise.resolve({ keys: keys.slice(start, end), nextToken: end < keys.length ? String(end) : undefined });
  }

  deleteObjects(bucket: string, keys: readonly string[]): Promise<void> {
    this.calls.push(`deleteObjects ${bucket} ${keys.length}`);
    for (const key of keys) this.bucket(bucket).delete(key);
    return Promise.resolve();
  }
}
