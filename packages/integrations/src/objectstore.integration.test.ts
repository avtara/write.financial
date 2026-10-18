// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CopyObjectCommand, GetObjectCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import type { Config } from '@wf/config';
import { generateDek, type Dek } from '@wf/crypto/envelope';
import sharp from 'sharp';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ObjectForbiddenError,
  ObjectIntegrityError,
  ObjectNotFoundError,
  createObjectStore,
  type ObjectStore,
} from './objectstore.ts';
import { createS3Port, type S3Port } from './s3.ts';

/** Same image, entrypoint, and S3 identities as the dev stack (`deploy/dev/compose.yaml`). */
const SEAWEEDFS = fileURLToPath(new URL('../../../deploy/dev/seaweedfs/', import.meta.url));
const ALICE = '0192f0c1-7c1e-7000-8000-00000000000a';
const BOB = '0192f0c1-7c1e-7000-8000-00000000000b';
const SECRET_TEXT = 'Gaji Oktober Rp42.810.000 rekening BCA 1234567890';

interface S3Identities {
  identities: { credentials: { accessKey: string; secretKey: string }[] }[];
}

let container: StartedTestContainer;
let s3: Config['s3'];
let raw: S3Client;
let store: ObjectStore;
const calls: string[] = [];

beforeAll(async () => {
  container = await new GenericContainer('chrislusf/seaweedfs:4.48')
    .withEntrypoint(['/bin/sh', '/init/start.sh'])
    .withCopyFilesToContainer([
      { source: `${SEAWEEDFS}start.sh`, target: '/init/start.sh' },
      { source: `${SEAWEEDFS}s3.json`, target: '/etc/seaweedfs/s3.json' },
    ])
    .withExposedPorts(8333)
    .withWaitStrategy(Wait.forSuccessfulCommand('test -f /tmp/wf-buckets-ready'))
    .withStartupTimeout(120_000)
    .start();

  const identities = JSON.parse(readFileSync(`${SEAWEEDFS}s3.json`, 'utf8')) as S3Identities;
  const credentials = identities.identities[0]?.credentials[0];
  if (credentials === undefined) throw new Error('deploy/dev/seaweedfs/s3.json has no credentials');
  s3 = {
    endpoint: `http://${container.getHost()}:${container.getMappedPort(8333)}`,
    region: 'us-east-1',
    accessKeyId: credentials.accessKey,
    secretAccessKey: credentials.secretKey,
    buckets: { attachments: 'wf-attachments', avatars: 'wf-avatars', reports: 'wf-reports', exports: 'wf-exports' },
  };
  raw = new S3Client({
    endpoint: s3.endpoint,
    region: s3.region,
    credentials: { accessKeyId: s3.accessKeyId, secretAccessKey: s3.secretAccessKey },
    forcePathStyle: true,
  });

  // Records every call that reaches SeaweedFS, to prove rejected keys never leave the process.
  const port = createS3Port(s3);
  const counting: S3Port = {
    putObject: (...args) => (calls.push('putObject'), port.putObject(...args)),
    getObject: (...args) => (calls.push('getObject'), port.getObject(...args)),
    deleteObject: (...args) => (calls.push('deleteObject'), port.deleteObject(...args)),
    listObjects: (...args) => (calls.push('listObjects'), port.listObjects(...args)),
    deleteObjects: (...args) => (calls.push('deleteObjects'), port.deleteObjects(...args)),
  };
  const deks = new Map<string, Dek>([
    [ALICE, generateDek()],
    [BOB, generateDek()],
  ]);
  store = createObjectStore({
    s3,
    bucket: 'attachments',
    getDek: (userId) => Promise.resolve(deks.get(userId) ?? generateDek()),
    client: counting,
  });
});

afterAll(async () => {
  raw.destroy();
  await container.stop();
});

async function rawObject(key: string): Promise<{ bytes: Uint8Array; contentType: string | undefined }> {
  const { Body, ContentType } = await raw.send(new GetObjectCommand({ Bucket: 'wf-attachments', Key: key }));
  return { bytes: await (Body as NonNullable<typeof Body>).transformToByteArray(), contentType: ContentType };
}

async function rawKeys(prefix: string): Promise<string[]> {
  const { Contents } = await raw.send(new ListObjectsV2Command({ Bucket: 'wf-attachments', Prefix: prefix }));
  return (Contents ?? []).map((object) => object.Key ?? '');
}

describe('object store on SeaweedFS', () => {
  it('stores only ciphertext and round-trips through get', async () => {
    const jpeg = await sharp({ create: { width: 16, height: 16, channels: 3, background: '#c00' } })
      .jpeg()
      .toBuffer();
    const png = await sharp({ create: { width: 16, height: 16, channels: 3, background: '#0c0' } })
      .png()
      .toBuffer();
    const objects = [
      { content: jpeg, mime: 'image/jpeg' },
      { content: png, mime: 'image/png' },
      { content: Buffer.from(SECRET_TEXT), mime: 'text/plain' },
    ];

    for (const { content, mime } of objects) {
      const put = await store.put(ALICE, content, mime);
      const stored = await rawObject(put.key);
      const blob = Buffer.from(stored.bytes);

      expect(stored.contentType).toBe('application/octet-stream');
      expect(blob.length).toBe(1 + 12 + 1 + mime.length + content.length + 16);
      expect(blob.includes(Buffer.from([0xff, 0xd8, 0xff]))).toBe(false);
      expect(blob.includes(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBe(false);
      expect(blob.includes('IHDR')).toBe(false);
      expect(blob.includes('Rp42.810.000')).toBe(false);
      expect(blob.includes(mime)).toBe(false);

      const object = await store.get(ALICE, put.key, put.sha256);
      expect(object.mime).toBe(mime);
      expect(Buffer.from(object.bytes).equals(content)).toBe(true);
    }
  });

  it("refuses user B's get on user A's key without any network call", async () => {
    const { key } = await store.put(ALICE, Buffer.from(SECRET_TEXT), 'text/plain');
    calls.length = 0;
    await expect(store.get(BOB, key)).rejects.toThrow(ObjectForbiddenError);
    await expect(store.delete(BOB, key)).rejects.toThrow(ObjectForbiddenError);
    expect(calls).toEqual([]);
    await expect(store.get(ALICE, key)).resolves.toMatchObject({ mime: 'text/plain' });
  });

  it("returns NotFound for a guessed key under B's own prefix", async () => {
    await expect(store.get(BOB, `u/${BOB}/${uuidv7()}`)).rejects.toThrow(ObjectNotFoundError);
  });

  it("does not decrypt A's ciphertext copied into B's prefix", async () => {
    const { key } = await store.put(ALICE, Buffer.from(SECRET_TEXT), 'text/plain');
    const stolen = `u/${BOB}/${uuidv7()}`;
    await raw.send(
      new CopyObjectCommand({ Bucket: 'wf-attachments', Key: stolen, CopySource: `wf-attachments/${key}` }),
    );
    await expect(store.get(BOB, stolen)).rejects.toThrow(ObjectIntegrityError);
  });

  it('deletes one object', async () => {
    const { key } = await store.put(BOB, Buffer.from('hapus'), 'text/plain');
    await store.delete(BOB, key);
    await expect(store.get(BOB, key)).rejects.toThrow(ObjectNotFoundError);
    await expect(store.delete(BOB, key)).resolves.toBeUndefined();
  });

  it("deletePrefix removes every object of the user and nothing of others'", async () => {
    for (let index = 0; index < 3; index++) await store.put(ALICE, Buffer.from(`a${index}`), 'text/plain');
    const bob = await store.put(BOB, Buffer.from('tetap'), 'text/plain');
    const aliceKeys = await rawKeys(`u/${ALICE}/`);
    expect(aliceKeys.length).toBeGreaterThanOrEqual(3);

    await expect(store.deletePrefix(ALICE)).resolves.toBe(aliceKeys.length);
    expect(await rawKeys(`u/${ALICE}/`)).toEqual([]);
    expect(await rawKeys(`u/${BOB}/`)).toContain(bob.key);
    await expect(store.deletePrefix(ALICE)).resolves.toBe(0);
  });
});
