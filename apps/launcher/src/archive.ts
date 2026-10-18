// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The backup archive `wf-<UTC time>.tar.age`: a tar stream (src/tar.ts) encrypted with age to the operator's
 * recipients. Its entries, in this order:
 *
 *   db.dump                  pg_dump custom format of the whole database
 *   objects/<bucket>/<key>   every object of the four buckets byte for byte (each is already ciphertext, PRD §9.1);
 *                            <bucket> is the logical name (attachments, avatars, reports, exports)
 *   manifest.json            format version, time, app version, migration level, object counts, and the size and
 *                            SHA-256 of every entry above
 *
 * Decrypted with the operator's identity it is a plain tar file: `age -d -i backup.key wf-….tar.age | tar -t`.
 * The checksums detect corruption, not forgery: anyone who has the public key can make an archive, so only restore
 * archives from storage that only you can write to.
 */
import { createHash } from 'node:crypto';
import { open, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { Config } from '@wf/config';
import type { Migration, MigrationLevel } from '@wf/db/backup';
import { Decrypter, Encrypter } from 'age-encryption';
import * as z from 'zod';
import { readTar, TAR_END, tarFile, type TarEntry } from './tar.ts';

/** Logical bucket, as in `@wf/integrations/objectstore`. */
export type BucketKind = keyof Config['s3']['buckets'];

const BUCKET_KINDS = { attachments: true, avatars: true, reports: true, exports: true } satisfies Record<
  BucketKind,
  true
>;
/** The logical buckets, in archive order. */
export const BUCKETS = Object.keys(BUCKET_KINDS) as [BucketKind, ...BucketKind[]];

function isBucket(name: string): name is BucketKind {
  return Object.hasOwn(BUCKET_KINDS, name);
}

export const DUMP_ENTRY = 'db.dump';
export const MANIFEST_ENTRY = 'manifest.json';
const OBJECT_ENTRY = /^objects\/([a-z]+)\/(.+)$/s;

/** What goes into an archive (content in memory). */
export type ArchiveItem =
  | { readonly type: 'database'; readonly bytes: Uint8Array }
  | { readonly type: 'object'; readonly bucket: BucketKind; readonly key: string; readonly bytes: Uint8Array };

/** What comes out of an archive: the content as a stream, read once. */
export type ArchiveEntry =
  | { readonly type: 'database'; readonly size: number; readonly body: AsyncIterable<Uint8Array> }
  | {
      readonly type: 'object';
      readonly bucket: BucketKind;
      readonly key: string;
      readonly size: number;
      readonly body: AsyncIterable<Uint8Array>;
    };

const count = z.number().int().nonnegative();
const manifestSchema = z.object({
  format: z.literal(1),
  createdAt: z.iso.datetime(),
  appVersion: z.string(),
  migrations: z.object({ applied: count, latest: z.number().int().nullable() }),
  objects: z.record(z.enum(BUCKETS), count),
  entries: z.array(z.object({ path: z.string(), size: count, sha256: z.string().regex(/^[0-9a-f]{64}$/) })),
});

export type Manifest = z.infer<typeof manifestSchema>;
type EntryDigest = Manifest['entries'][number];

/** The parts of the manifest the caller knows before writing. */
export interface ArchiveHeader {
  readonly createdAt: Date;
  readonly appVersion: string;
  readonly migrations: MigrationLevel;
}

/** The archive cannot be decrypted, is malformed, or does not match its manifest. */
export class ArchiveError extends Error {
  override readonly name = 'ArchiveError';
}

/** The tag of the newest applied migration (`0003_auth_security_events`), for messages; `none` before the first. */
export function describeMigration(latest: number | null, bundled: readonly Migration[]): string {
  if (latest === null) return 'none';
  return bundled.find((migration) => migration.when === latest)?.tag ?? `${latest} (not part of this version)`;
}

/** `3 object(s) (attachments 2, avatars 1, reports 0, exports 0)`. */
export function describeObjects(objects: Manifest['objects']): string {
  const total = BUCKETS.reduce((sum, bucket) => sum + objects[bucket], 0);
  return `${total} object(s) (${BUCKETS.map((bucket) => `${bucket} ${objects[bucket]}`).join(', ')})`;
}

/** What an archive holds so far, while it is written or read. */
class Contents {
  readonly entries: EntryDigest[] = [];
  readonly objects = { attachments: 0, avatars: 0, reports: 0, exports: 0 } satisfies Record<BucketKind, number>;
  database = false;

  add(
    item: { readonly type: 'database' } | { readonly type: 'object'; readonly bucket: BucketKind },
    digest: EntryDigest,
  ) {
    if (item.type === 'database') this.database = true;
    else this.objects[item.bucket] += 1;
    this.entries.push(digest);
  }

  manifest(header: ArchiveHeader): Manifest {
    return {
      format: 1,
      createdAt: header.createdAt.toISOString(),
      appVersion: header.appVersion,
      migrations: { applied: header.migrations.applied, latest: header.migrations.latest },
      objects: { ...this.objects },
      entries: [...this.entries],
    };
  }
}

async function* tarStream(
  header: ArchiveHeader,
  items: AsyncIterable<ArchiveItem>,
  contents: Contents,
): AsyncGenerator<Uint8Array> {
  for await (const item of items) {
    const name = item.type === 'database' ? DUMP_ENTRY : `objects/${item.bucket}/${item.key}`;
    const sha256 = createHash('sha256').update(item.bytes).digest('hex');
    contents.add(item, { path: name, size: item.bytes.length, sha256 });
    yield* tarFile(name, item.bytes, header.createdAt);
  }
  const manifest = new TextEncoder().encode(`${JSON.stringify(contents.manifest(header), null, 2)}\n`);
  yield* tarFile(MANIFEST_ENTRY, manifest, header.createdAt);
  yield TAR_END;
}

/** `.<name>.partial` next to `file`: where `writeArchive` writes until the archive is complete. */
export function partialPath(file: string): string {
  return path.join(path.dirname(file), `.${path.basename(file)}.partial`);
}

/**
 * Writes `items` and the manifest as an age-encrypted tar to `file`. Items are pulled one at a time as the encrypted
 * bytes reach the disk. The data goes to `partialPath(file)` (mode 0600, must not exist), which is synced and renamed
 * to `file` only when complete; on any failure it is deleted, so `file` never holds a partial archive.
 * @param recipients age recipients (`age1…`), validated beforehand.
 */
export async function writeArchive(
  file: string,
  recipients: readonly string[],
  header: ArchiveHeader,
  items: AsyncIterable<ArchiveItem>,
): Promise<Manifest> {
  const encrypter = new Encrypter();
  for (const recipient of recipients) encrypter.addRecipient(recipient);
  const temp = partialPath(file);
  const handle = await open(temp, 'wx', 0o600);
  const contents = new Contents();
  try {
    const ciphertext = await encrypter.encrypt(ReadableStream.from(tarStream(header, items, contents)));
    for await (const chunk of ciphertext) await handle.write(chunk);
    await handle.sync();
  } catch (error) {
    try {
      await handle.close();
    } finally {
      await rm(temp, { force: true });
    }
    throw error;
  }
  await handle.close();
  await rename(temp, file);
  return contents.manifest(header);
}

function archiveEntry(entry: TarEntry): ArchiveEntry {
  const { size, body } = entry;
  if (entry.path === DUMP_ENTRY) return { type: 'database', size, body };
  const [, bucket = '', key = ''] = OBJECT_ENTRY.exec(entry.path) ?? [];
  if (!isBucket(bucket)) throw new ArchiveError(`Unexpected archive entry ${entry.path}`);
  return { type: 'object', bucket, key, size, body };
}

async function readManifest(entry: TarEntry): Promise<Manifest> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of entry.body) chunks.push(chunk);
  let json: unknown;
  try {
    json = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (error) {
    throw new ArchiveError('The manifest is not valid JSON', { cause: error });
  }
  const parsed = manifestSchema.safeParse(json);
  if (!parsed.success) {
    throw new ArchiveError(`The manifest is not one this version can read: ${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}

/**
 * Decrypts `file` with `identities` and hands every entry except the manifest to `onEntry`, in archive order, as it
 * streams by. Then checks the archive against its manifest: same entries in the same order, same sizes and SHA-256,
 * exactly one database dump, matching object counts.
 * @returns the manifest, once everything was read and matched it.
 * @throws {ArchiveError} when the archive cannot be decrypted with the identities or does not match its manifest.
 */
export async function readArchive(
  file: string,
  identities: readonly string[],
  onEntry: (entry: ArchiveEntry) => Promise<void>,
): Promise<Manifest> {
  const decrypter = new Decrypter();
  for (const identity of identities) decrypter.addIdentity(identity);
  const handle = await open(file);
  try {
    let plaintext: AsyncIterable<Uint8Array>;
    try {
      plaintext = await decrypter.decrypt(Readable.toWeb(handle.createReadStream()) as ReadableStream<Uint8Array>);
    } catch (error) {
      throw new ArchiveError(
        `Cannot decrypt ${file} (${String(error)}): use the age identity whose public key the backup was made for`,
        { cause: error },
      );
    }

    const contents = new Contents();
    let manifest: Manifest | undefined;
    for await (const entry of readTar(plaintext)) {
      if (manifest !== undefined) throw new ArchiveError(`Unexpected archive entry ${entry.path} after the manifest`);
      if (entry.path === MANIFEST_ENTRY) {
        manifest = await readManifest(entry);
        continue;
      }
      const item = archiveEntry(entry);
      if (item.type === 'database' && contents.database) {
        throw new ArchiveError(`The archive has more than one ${DUMP_ENTRY}`);
      }
      await onEntry(item);
      contents.add(item, { path: entry.path, size: entry.size, sha256: await entry.sha256() });
    }

    if (manifest === undefined) throw new ArchiveError(`The archive has no ${MANIFEST_ENTRY}`);
    if (!contents.database) throw new ArchiveError(`The archive has no ${DUMP_ENTRY}`);
    const entriesMatch = JSON.stringify(contents.entries) === JSON.stringify(manifest.entries);
    if (!entriesMatch || BUCKETS.some((bucket) => contents.objects[bucket] !== manifest.objects[bucket])) {
      throw new ArchiveError('The archive does not match its manifest (entries, sizes, SHA-256, or object counts)');
    }
    return manifest;
  } finally {
    await handle.close();
  }
}
