// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The subset of POSIX ustar that the backup archive (src/archive.ts) uses, as streams: regular files only, mode 0600,
 * owner 0:0. Paths of up to 100 bytes go into `name`; longer ones are split at a `/` into `prefix` (≤ 155 bytes) and
 * `name`. GNU tar, bsdtar, and busybox tar read it, so an operator can inspect a decrypted archive with `tar -t`.
 *
 * A small codec instead of a tar library: writing pulls one entry at a time (backpressure all the way to the disk), and
 * reading hands out each entry's content as a stream while hashing it, which is what the restore needs.
 */
import { createHash } from 'node:crypto';

const BLOCK = 512;
const EMPTY = new Uint8Array(0);
/** Size fields hold 11 octal digits. */
export const MAX_ENTRY_SIZE = 8 ** 11 - 1;
/** End of archive: two zero blocks. */
export const TAR_END = new Uint8Array(2 * BLOCK);

/** The tar stream is malformed, truncated, or uses a feature this codec does not write. */
export class TarFormatError extends Error {
  override readonly name = 'TarFormatError';
}

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

function splitPath(path: string): [prefix: string, name: string] {
  if (encoder.encode(path).length <= 100) return ['', path];
  for (let slash = path.indexOf('/'); slash !== -1; slash = path.indexOf('/', slash + 1)) {
    const [prefix, name] = [path.slice(0, slash), path.slice(slash + 1)];
    if (encoder.encode(name).length > 100) continue;
    if (name !== '' && encoder.encode(prefix).length <= 155) return [prefix, name];
    break;
  }
  throw new TarFormatError(`Path is too long for a tar entry: ${path}`);
}

function writeOctal(header: Uint8Array, offset: number, length: number, value: number): void {
  header.set(encoder.encode(value.toString(8).padStart(length - 1, '0')), offset);
}

function checksum(header: Uint8Array): number {
  // The checksum field itself counts as eight spaces.
  let sum = 8 * 0x20;
  for (const [index, byte] of header.entries()) if (index < 148 || index >= 156) sum += byte;
  return sum;
}

/** The 512-byte header of a regular file. */
export function tarHeader(path: string, size: number, mtime: Date): Uint8Array {
  if (size > MAX_ENTRY_SIZE) throw new TarFormatError(`Entry ${path} is too large for a tar entry (${size} bytes)`);
  const [prefix, name] = splitPath(path);
  const header = new Uint8Array(BLOCK);
  header.set(encoder.encode(name), 0);
  writeOctal(header, 100, 8, 0o600);
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, size);
  writeOctal(header, 136, 12, Math.floor(mtime.getTime() / 1000));
  header[156] = 0x30; // '0': regular file
  header.set(encoder.encode('ustar\x0000'), 257);
  header.set(encoder.encode(prefix), 345);
  writeOctal(header, 148, 7, checksum(header));
  header[155] = 0x20;
  return header;
}

/** Zero bytes that pad an entry of `size` bytes to whole blocks. */
export function tarPadding(size: number): Uint8Array {
  return new Uint8Array((BLOCK - (size % BLOCK)) % BLOCK);
}

/** One regular file: header, content, padding. */
export function tarFile(path: string, content: Uint8Array, mtime: Date): Uint8Array[] {
  return [tarHeader(path, content.length, mtime), content, tarPadding(content.length)];
}

export interface TarEntry {
  readonly path: string;
  readonly size: number;
  /** The content, read once. Stopping early is fine: the rest is read (and hashed) before the next entry. */
  readonly body: AsyncIterable<Uint8Array>;
  /** SHA-256 (lowercase hex) of the whole content; reads whatever the consumer of `body` left. */
  sha256(): Promise<string>;
}

class ByteReader {
  readonly #source: AsyncIterator<Uint8Array>;
  #pending: Uint8Array = EMPTY;

  constructor(source: AsyncIterable<Uint8Array>) {
    this.#source = source[Symbol.asyncIterator]();
  }

  /** Up to `max` bytes; empty at the end of the input. */
  async read(max: number): Promise<Uint8Array> {
    while (this.#pending.length === 0) {
      const next = await this.#source.next();
      if (next.done === true) return EMPTY;
      this.#pending = next.value;
    }
    const chunk = this.#pending.subarray(0, max);
    this.#pending = this.#pending.subarray(chunk.length);
    return chunk;
  }

  async readExactly(length: number): Promise<Uint8Array> {
    const bytes = new Uint8Array(length);
    for (let filled = 0; filled < length;) {
      const chunk = await this.read(length - filled);
      if (chunk.length === 0) throw new TarFormatError('The archive is truncated');
      bytes.set(chunk, filled);
      filled += chunk.length;
    }
    return bytes;
  }
}

class Entry implements TarEntry {
  readonly path: string;
  readonly size: number;
  readonly #reader: ByteReader;
  readonly #hash = createHash('sha256');
  #remaining: number;
  #digest: string | undefined;

  constructor(reader: ByteReader, path: string, size: number) {
    this.#reader = reader;
    this.path = path;
    this.size = size;
    this.#remaining = size;
  }

  async #next(): Promise<Uint8Array | undefined> {
    if (this.#remaining === 0) return undefined;
    const chunk = await this.#reader.read(this.#remaining);
    if (chunk.length === 0) throw new TarFormatError(`The archive is truncated inside ${this.path}`);
    this.#remaining -= chunk.length;
    this.#hash.update(chunk);
    return chunk;
  }

  get body(): AsyncIterable<Uint8Array> {
    return {
      [Symbol.asyncIterator]: () => ({
        next: async (): Promise<IteratorResult<Uint8Array, undefined>> => {
          const value = await this.#next();
          return value === undefined ? { done: true, value } : { done: false, value };
        },
      }),
    };
  }

  async sha256(): Promise<string> {
    while ((await this.#next()) !== undefined);
    this.#digest ??= this.#hash.digest('hex');
    return this.#digest;
  }
}

function text(header: Uint8Array, offset: number, length: number): string {
  const field = header.subarray(offset, offset + length);
  const end = field.indexOf(0);
  return decoder.decode(end === -1 ? field : field.subarray(0, end));
}

function octal(header: Uint8Array, offset: number, length: number): number {
  const digits = text(header, offset, length).trim();
  if (!/^[0-7]{1,11}$/.test(digits)) throw new TarFormatError('Malformed number in a tar header');
  return Number.parseInt(digits, 8);
}

function parseHeader(header: Uint8Array): { path: string; size: number } {
  if (octal(header, 148, 8) !== checksum(header)) throw new TarFormatError('Tar header checksum mismatch');
  if (text(header, 257, 6) !== 'ustar' || text(header, 263, 2) !== '00') {
    throw new TarFormatError('Not a POSIX ustar header');
  }
  const name = text(header, 0, 100);
  const prefix = text(header, 345, 155);
  const path = prefix === '' ? name : `${prefix}/${name}`;
  if (header[156] !== 0x30) throw new TarFormatError(`Entry ${path} is not a regular file`);
  return { path, size: octal(header, 124, 12) };
}

/**
 * Reads a tar stream entry by entry. Each entry's content must be consumed (or skipped) before the next one is
 * requested, which `for await` does naturally. After the end-of-archive marker the input is read to its end, so a
 * decrypting source authenticates its last chunk.
 * @throws {TarFormatError} for a malformed or truncated stream.
 */
export async function* readTar(source: AsyncIterable<Uint8Array>): AsyncGenerator<TarEntry, void, undefined> {
  const reader = new ByteReader(source);
  for (;;) {
    const header = await reader.readExactly(BLOCK);
    if (header.every((byte) => byte === 0)) break;
    const { path, size } = parseHeader(header);
    const entry = new Entry(reader, path, size);
    yield entry;
    await entry.sha256();
    await reader.readExactly(tarPadding(size).length);
  }
  while ((await reader.read(BLOCK)).length > 0);
}
