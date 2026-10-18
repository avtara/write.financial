// SPDX-License-Identifier: AGPL-3.0-only
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { MAX_ENTRY_SIZE, readTar, TAR_END, tarFile, TarFormatError, tarHeader, tarPadding } from './tar.ts';

const MTIME = new Date('2026-10-18T20:00:00Z');
const UUID = '0192f0c1-7c1e-7000-8000-0000000000aa';

const bytes = (text: string) => new TextEncoder().encode(text);
const sha256 = (content: Uint8Array) => createHash('sha256').update(content).digest('hex');

function concat(chunks: readonly Uint8Array[]): Uint8Array {
  return Buffer.concat(chunks);
}

function archive(files: readonly (readonly [string, Uint8Array])[]): Uint8Array {
  return concat([...files.flatMap(([name, content]) => tarFile(name, content, MTIME)), TAR_END]);
}

/** The archive as a stream of `size`-byte chunks, so entries and headers straddle chunk boundaries. */
async function* chunked(data: Uint8Array, size = 7): AsyncGenerator<Uint8Array> {
  for (let offset = 0; offset < data.length; offset += size) {
    await Promise.resolve();
    yield data.subarray(offset, offset + size);
  }
}

async function readAll(data: Uint8Array, size?: number) {
  const entries: { path: string; size: number; content: string; sha256: string }[] = [];
  for await (const entry of readTar(chunked(data, size))) {
    const chunks: Uint8Array[] = [];
    for await (const chunk of entry.body) chunks.push(chunk);
    entries.push({
      path: entry.path,
      size: entry.size,
      content: Buffer.from(concat(chunks)).toString(),
      sha256: await entry.sha256(),
    });
  }
  return entries;
}

/** Re-computes the header checksum after a test changed a header field. */
function rechecksum(header: Uint8Array): Uint8Array {
  header.fill(0x20, 148, 156);
  const sum = header.reduce((total, byte) => total + byte, 0);
  header.set(bytes(`${sum.toString(8).padStart(6, '0')}\0 `), 148);
  return header;
}

const LONG_PATH = `objects/attachments/${'d'.repeat(60)}/u/${UUID}/${UUID}`;
const FILES: readonly (readonly [string, Uint8Array])[] = [
  ['db.dump', bytes('PGDMP database')],
  ['empty', new Uint8Array(0)],
  ['one-block', new Uint8Array(512).fill(0x61)],
  [`objects/attachments/u/${UUID}/${UUID}`, bytes('ciphertext')],
  ['n'.repeat(100), bytes('a name that fills the whole name field')],
  [LONG_PATH, bytes('split into prefix and name')],
  ['catatan/ringkasan-ü.json', bytes('{"utf8":"✓"}')],
];

describe('tarHeader', () => {
  it('writes a ustar header for a regular file', () => {
    const header = tarHeader('db.dump', 1234, MTIME);
    expect(header.length).toBe(512);
    const field = (offset: number, length: number) => Buffer.from(header.subarray(offset, offset + length)).toString();
    expect(field(0, 8)).toBe('db.dump\0');
    expect(field(100, 8)).toBe('0000600\0');
    expect(field(124, 12)).toBe(`${(1234).toString(8).padStart(11, '0')}\0`);
    expect(field(136, 12)).toBe(`${(MTIME.getTime() / 1000).toString(8).padStart(11, '0')}\0`);
    expect(field(156, 1)).toBe('0');
    expect(field(257, 8)).toBe('ustar\x0000');
    expect(rechecksum(header.slice())).toEqual(header);
  });

  it('splits a long path at the first slash that leaves a name of at most 100 bytes', () => {
    const header = tarHeader(LONG_PATH, 0, MTIME);
    const field = (offset: number, length: number) =>
      Buffer.from(header.subarray(offset, offset + length))
        .toString()
        .replace(/\0+$/, '');
    expect(field(345, 155)).toBe(`objects/attachments/${'d'.repeat(60)}`);
    expect(field(0, 100)).toBe(`u/${UUID}/${UUID}`);
  });

  it.each([
    ['a final segment longer than 100 bytes', `objects/${'x'.repeat(101)}`],
    ['a prefix longer than 155 bytes', `${'p'.repeat(156)}/name`],
    ['nothing after the last slash', `${'p'.repeat(101)}/`],
  ])('rejects a path with %s', (_case, name) => {
    expect(() => tarHeader(name, 0, MTIME)).toThrow(new TarFormatError(`Path is too long for a tar entry: ${name}`));
  });

  it('rejects a size that does not fit 11 octal digits', () => {
    expect(tarHeader('big', MAX_ENTRY_SIZE, MTIME)).toHaveLength(512);
    expect(() => tarHeader('big', MAX_ENTRY_SIZE + 1, MTIME)).toThrow(TarFormatError);
  });
});

describe('tarPadding', () => {
  it('pads to whole 512-byte blocks', () => {
    expect([0, 1, 511, 512, 513].map((size) => tarPadding(size).length)).toEqual([0, 511, 1, 0, 511]);
  });
});

describe('readTar', () => {
  it('reads back every entry with its content and SHA-256, whatever the chunking', async () => {
    const expected = FILES.map(([name, content]) => ({
      path: name,
      size: content.length,
      content: Buffer.from(content).toString(),
      sha256: sha256(content),
    }));
    const data = archive(FILES);
    expect(await readAll(data)).toEqual(expected);
    expect(await readAll(data, 4096)).toEqual(expected);
  });

  it('skips and still hashes the content a consumer did not read', async () => {
    const first = new Uint8Array(3000).fill(1);
    const seen: string[] = [];
    for await (const entry of readTar(
      chunked(
        archive([
          ['first', first],
          ['second', bytes('zwei')],
        ]),
        512,
      ),
    )) {
      for await (const chunk of entry.body) {
        seen.push(`${entry.path}:${chunk.length}`);
        break;
      }
      if (entry.path === 'first') expect(await entry.sha256()).toBe(sha256(first));
      expect(await entry.sha256()).toBe(await entry.sha256());
    }
    expect(seen).toEqual(['first:512', 'second:4']);
  });

  it('reads the input to its end after the end-of-archive marker', async () => {
    let pulled = 0;
    async function* source() {
      for await (const chunk of chunked(concat([archive([['a', bytes('a')]]), new Uint8Array(4096)]), 512)) {
        pulled += chunk.length;
        yield chunk;
      }
    }
    for await (const entry of readTar(source())) expect(entry.path).toBe('a');
    expect(pulled).toBe(512 * 2 + 1024 + 4096);
  });

  it('is readable by the system tar', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'wf-tar-'));
    try {
      const file = path.join(dir, 'archive.tar');
      // ASCII names only: how `tar -t` prints other bytes depends on the locale.
      const ascii = FILES.filter(([name]) => /^[\x20-\x7e]+$/.test(name));
      await writeFile(file, archive(ascii));
      const listed = execFileSync('tar', ['-tf', file], { encoding: 'utf8' }).trim().split('\n');
      expect(listed).toEqual(ascii.map(([name]) => name));
      expect(execFileSync('tar', ['-xOf', file, LONG_PATH], { encoding: 'utf8' })).toBe('split into prefix and name');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  const valid = () => archive([['file', bytes('content')]]);
  const withHeader = (change: (header: Uint8Array) => void) => {
    const data = valid();
    change(data.subarray(0, 512));
    return data;
  };

  it.each([
    ['empty', new Uint8Array(0), 'The archive is truncated'],
    ['cut inside a header', valid().subarray(0, 100), 'The archive is truncated'],
    ['cut inside the content', valid().subarray(0, 515), 'The archive is truncated inside file'],
    ['cut inside the padding', valid().subarray(0, 600), 'The archive is truncated'],
    ['cut before the end marker', valid().subarray(0, 1024), 'The archive is truncated'],
    ['with a corrupted header', withHeader((header) => header.fill(0x46, 0, 1)), 'Tar header checksum mismatch'],
    ['with a corrupted checksum field', withHeader((header) => header.fill(0x78, 148, 149)), 'Malformed number'],
    [
      'with a non-ustar header',
      withHeader((header) => rechecksum(header.fill(0x20, 257, 263))),
      'Not a POSIX ustar header',
    ],
    [
      'with another ustar version',
      withHeader((header) => rechecksum(header.fill(0x20, 263, 265))),
      'Not a POSIX ustar header',
    ],
    ['with a directory entry', withHeader((header) => rechecksum(header.fill(0x35, 156, 157))), 'not a regular file'],
    ['with a malformed size', withHeader((header) => rechecksum(header.fill(0x39, 124, 125))), 'Malformed number'],
  ])('rejects an archive %s', async (_case, data, message) => {
    const error: unknown = await readAll(data).then(
      () => undefined,
      (reason: unknown) => reason,
    );
    expect(error).toBeInstanceOf(TarFormatError);
    expect(String(error)).toContain(message);
  });
});
