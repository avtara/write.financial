// SPDX-License-Identifier: AGPL-3.0-only
import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Decrypter, Encrypter, generateIdentity, identityToRecipient } from 'age-encryption';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ArchiveError,
  BUCKETS,
  describeMigration,
  describeObjects,
  partialPath,
  readArchive,
  writeArchive,
  type ArchiveEntry,
  type ArchiveItem,
} from './archive.ts';
import { readTar, TAR_END, tarFile } from './tar.ts';

const USER = '0192f0c1-7c1e-7000-8000-00000000000a';
const key = (n: number) => `u/${USER}/0192f0c1-7c1e-7000-8000-${String(n).padStart(12, '0')}`;
const HEADER = {
  createdAt: new Date('2026-10-18T20:00:00.000Z'),
  appVersion: '0.1.0',
  migrations: { applied: 4, latest: 1792320431580 },
};
const bytes = (text: string) => new TextEncoder().encode(text);
const sha256 = (content: Uint8Array) => createHash('sha256').update(content).digest('hex');

let identity: string;
let recipient: string;
let dir: string;
let file: string;

beforeAll(async () => {
  identity = await generateIdentity();
  recipient = await identityToRecipient(identity);
});

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'wf-archive-'));
  file = path.join(dir, 'wf-20261018T200000Z.tar.age');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function* from<T>(items: readonly T[]): AsyncGenerator<T> {
  for (const item of items) {
    await Promise.resolve();
    yield item;
  }
}

/** Larger than age's 64 KiB chunks, so entries span several decrypted chunks. */
const big = new Uint8Array(300 * 1024).map((_, index) => index % 251);
const ITEMS: readonly ArchiveItem[] = [
  { type: 'database', bytes: bytes('PGDMP the dump') },
  { type: 'object', bucket: 'attachments', key: key(1), bytes: bytes('ciphertext 1') },
  { type: 'object', bucket: 'attachments', key: key(2), bytes: big },
  { type: 'object', bucket: 'exports', key: key(3), bytes: new Uint8Array(0) },
];

/** Reads `file` with the test identity and returns what `onEntry` saw, with the SHA-256 of each content. */
async function readBack(target = file) {
  const seen: { entry: Omit<ArchiveEntry, 'body'>; sha256: string }[] = [];
  const manifest = await readArchive(target, [identity], async ({ body, ...entry }) => {
    const chunks: Uint8Array[] = [];
    for await (const chunk of body) chunks.push(chunk);
    seen.push({ entry, sha256: sha256(Buffer.concat(chunks)) });
  });
  return { manifest, seen };
}

/** The decrypted tar entries of `file`, as [path, content]. */
async function tarEntries(target = file): Promise<[string, Uint8Array][]> {
  const decrypter = new Decrypter();
  decrypter.addIdentity(identity);
  const plaintext = await decrypter.decrypt(new Uint8Array(await readFile(target)));
  const entries: [string, Uint8Array][] = [];
  for await (const entry of readTar(from([plaintext]))) {
    const chunks: Uint8Array[] = [];
    for await (const chunk of entry.body) chunks.push(chunk);
    entries.push([entry.path, Buffer.concat(chunks)]);
  }
  return entries;
}

/** Encrypts a hand-made tar of `entries` to `file`, as someone holding the public key could. */
async function forge(entries: readonly (readonly [string, Uint8Array])[]): Promise<void> {
  const encrypter = new Encrypter();
  encrypter.addRecipient(recipient);
  const tar = Buffer.concat([...entries.flatMap(([name, content]) => tarFile(name, content, new Date())), TAR_END]);
  await writeFile(file, await encrypter.encrypt(tar));
}

const json = (value: unknown) => bytes(JSON.stringify(value));

describe('writeArchive and readArchive', () => {
  it('round-trip the dump and the objects in order, with a manifest of sizes and SHA-256', async () => {
    const written = await writeArchive(file, [recipient], HEADER, from(ITEMS));
    const expected = {
      format: 1,
      createdAt: '2026-10-18T20:00:00.000Z',
      appVersion: '0.1.0',
      migrations: { applied: 4, latest: 1792320431580 },
      objects: { attachments: 2, avatars: 0, reports: 0, exports: 1 },
      entries: [
        { path: 'db.dump', size: 14, sha256: sha256(bytes('PGDMP the dump')) },
        { path: `objects/attachments/${key(1)}`, size: 12, sha256: sha256(bytes('ciphertext 1')) },
        { path: `objects/attachments/${key(2)}`, size: big.length, sha256: sha256(big) },
        { path: `objects/exports/${key(3)}`, size: 0, sha256: sha256(new Uint8Array(0)) },
      ],
    };
    expect(written).toEqual(expected);

    const { manifest, seen } = await readBack();
    expect(manifest).toEqual(expected);
    expect(seen).toEqual([
      { entry: { type: 'database', size: 14 }, sha256: sha256(bytes('PGDMP the dump')) },
      {
        entry: { type: 'object', bucket: 'attachments', key: key(1), size: 12 },
        sha256: sha256(bytes('ciphertext 1')),
      },
      { entry: { type: 'object', bucket: 'attachments', key: key(2), size: big.length }, sha256: sha256(big) },
      { entry: { type: 'object', bucket: 'exports', key: key(3), size: 0 }, sha256: sha256(new Uint8Array(0)) },
    ]);
  });

  it('writes an age file with mode 0600 that holds no plaintext, and leaves no partial file', async () => {
    const marker = bytes('rahasia-penanda-12345');
    await writeArchive(file, [recipient], HEADER, from([{ type: 'database', bytes: marker }]));
    const archive = await readFile(file);
    expect(archive.subarray(0, 22).toString()).toBe('age-encryption.org/v1\n');
    expect(archive.includes(Buffer.from(marker))).toBe(false);
    expect(archive.includes('manifest.json')).toBe(false);
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect(await readdir(dir)).toEqual([path.basename(file)]);
    expect((await tarEntries()).map(([name]) => name)).toEqual(['db.dump', 'manifest.json']);
  });

  it('encrypts to every recipient', async () => {
    const spare = await generateIdentity();
    await writeArchive(file, [recipient, await identityToRecipient(spare)], HEADER, from(ITEMS));
    await expect(readArchive(file, [spare], () => Promise.resolve())).resolves.toMatchObject({ format: 1 });
  });

  it('deletes the partial file when an item fails, and writes nothing under the final name', async () => {
    async function* failing(): AsyncGenerator<ArchiveItem> {
      await Promise.resolve();
      yield { type: 'database', bytes: bytes('PGDMP') };
      throw new Error('S3 ListObjectsV2: connect ECONNREFUSED');
    }
    await expect(writeArchive(file, [recipient], HEADER, failing())).rejects.toThrow('ECONNREFUSED');
    expect(await readdir(dir)).toEqual([]);
  });

  it('refuses to share a partial file with another run', async () => {
    await writeFile(partialPath(file), 'another backup is writing');
    await expect(writeArchive(file, [recipient], HEADER, from(ITEMS))).rejects.toThrow(/EEXIST/);
    expect(await readFile(partialPath(file), 'utf8')).toBe('another backup is writing');
  });

  it('cannot be read with another identity', async () => {
    await writeArchive(file, [recipient], HEADER, from(ITEMS));
    const error = await readArchive(file, [await generateIdentity()], () => Promise.resolve()).catch(
      (reason: unknown) => reason,
    );
    expect(error).toBeInstanceOf(ArchiveError);
    expect(String(error)).toContain(`Cannot decrypt ${file}`);
  });

  it.each([
    ['a flipped ciphertext byte', (data: Buffer) => data.with(data.length - 100, (data.at(-100) ?? 0) ^ 1)],
    ['a truncated ciphertext', (data: Buffer) => data.subarray(0, data.length - 70_000)],
  ])('fails on %s', async (_case, corrupt) => {
    await writeArchive(file, [recipient], HEADER, from(ITEMS));
    await writeFile(file, corrupt(await readFile(file)));
    await expect(readBack()).rejects.toThrow();
  });
});

describe('readArchive on archives that do not match their manifest', () => {
  type Entry = readonly [string, Uint8Array];
  let valid: Entry[];
  let manifest: { entries: object[]; objects: object } & Record<string, unknown>;

  beforeEach(async () => {
    await writeArchive(file, [recipient], HEADER, from(ITEMS));
    valid = await tarEntries();
    manifest = JSON.parse(Buffer.from(valid.at(-1)?.[1] ?? '').toString()) as typeof manifest;
  });

  const nth = (index: number): Entry => valid.at(index) ?? ['missing', new Uint8Array(0)];
  /** Everything but the manifest. */
  const content = () => valid.slice(0, -1);
  const withManifest = (changes: object): Entry[] => [
    ...content(),
    ['manifest.json', json({ ...manifest, ...changes })],
  ];

  const cases: [string, () => Entry[], string][] = [
    ['has no manifest', () => content(), 'The archive has no manifest.json'],
    [
      'has an entry after the manifest',
      () => [...valid, nth(0)],
      'Unexpected archive entry db.dump after the manifest',
    ],
    ['has an unexpected entry', () => [['notes.txt', bytes('x')], ...valid], 'Unexpected archive entry notes.txt'],
    [
      'has an unknown bucket',
      () => [['objects/other/k', bytes('x')], ...valid],
      'Unexpected archive entry objects/other/k',
    ],
    ['has two dumps', () => [nth(0), ...valid], 'The archive has more than one db.dump'],
    ['has a manifest that is not JSON', () => [...content(), ['manifest.json', bytes('{')]], 'not valid JSON'],
    [
      'has a manifest of another format',
      () => withManifest({ format: 2 }),
      'The manifest is not one this version can read',
    ],
    [
      'has no dump',
      () => [...content().slice(1), ['manifest.json', json({ ...manifest, entries: manifest.entries.slice(1) })]],
      'The archive has no db.dump',
    ],
    [
      'has a changed object',
      () => valid.map(([name, data], index): Entry => [name, index === 1 ? bytes('ciphertext 2') : data]),
      'does not match its manifest',
    ],
    ['lacks an object the manifest lists', () => [...content().slice(0, -1), nth(-1)], 'does not match its manifest'],
    [
      'has object counts that differ from its entries',
      () => withManifest({ objects: { ...manifest.objects, avatars: 1 } }),
      'does not match its manifest',
    ],
  ];

  it.each(cases)('fails when the archive %s', async (_case, entries, message) => {
    await forge(entries());
    const error = await readBack().catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(ArchiveError);
    expect(String(error)).toContain(message);
  });

  it('accepts the same entries re-encrypted, and every logical bucket', async () => {
    await forge(valid);
    await expect(readBack()).resolves.toMatchObject({ manifest: { format: 1 } });
    expect(BUCKETS).toEqual(['attachments', 'avatars', 'reports', 'exports']);
  });
});

describe('describeMigration', () => {
  const migrations = [
    { tag: '0000_init', when: 1 },
    { tag: '0001_security', when: 2 },
  ];

  it('names the migration by its tag', () => {
    expect(describeMigration(null, migrations)).toBe('none');
    expect(describeMigration(2, migrations)).toBe('0001_security');
    expect(describeMigration(3, migrations)).toBe('3 (not part of this version)');
  });
});

describe('describeObjects', () => {
  it('sums and lists the objects per bucket', () => {
    expect(describeObjects({ attachments: 2, avatars: 1, reports: 0, exports: 0 })).toBe(
      '3 object(s) (attachments 2, avatars 1, reports 0, exports 0)',
    );
  });
});
