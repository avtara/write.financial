// SPDX-License-Identifier: AGPL-3.0-only
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { activeKek, kekFor } from './keys.ts';
import { KeyringError, addKeyVersion, createKeyFile, loadKeyring, parseKeyring } from './keyring.ts';

const b64 = (fill: number, length = 32) => Buffer.alloc(length, fill).toString('base64');
const line = (version: number, fill: number) => `v${version}:${b64(fill)}`;

describe('parseKeyring', () => {
  it('reads keys, skipping blank lines, comments, indentation and CRLF', () => {
    const keyring = parseKeyring(`# KEKs\r\n\r\n  ${line(2, 2)}  \r\n\t# old\n${line(1, 1)}\n\n`);
    expect(keyring.versions).toEqual([1, 2]);
    expect(keyring.activeVersion).toBe(2);
    expect(kekFor(keyring, 1)).toEqual(Buffer.alloc(32, 1));
    expect(activeKek(keyring)).toEqual(Buffer.alloc(32, 2));
  });

  it('accepts the full uint32 version range', () => {
    expect(parseKeyring(line(4_294_967_295, 0)).activeVersion).toBe(4_294_967_295);
    expect(parseKeyring(line(1_000_000_000, 0)).activeVersion).toBe(1_000_000_000);
  });

  it.each([
    ['missing version prefix', `1:${b64(1)}`],
    ['version 0', `v0:${b64(1)}`],
    ['leading zero', `v01:${b64(1)}`],
    ['non-numeric version', `vx:${b64(1)}`],
    ['missing colon', `v1${b64(1)}`],
    ['empty key', 'v1:'],
    ['whitespace inside', `v1: ${b64(1)}`],
    ['trailing text', `v1:${b64(1)} extra`],
    ['prefix before v', `xv1:${b64(1)}`],
    ['11-digit version', `v10000000000:${b64(1)}`],
  ])('rejects a malformed line (%s) by line number only', (_, bad) => {
    expect(() => parseKeyring(`# header\n${bad}\n`)).toThrow(
      new KeyringError('Key file line 2: expected "v<version>:<base64 key>"'),
    );
  });

  it('rejects versions beyond uint32', () => {
    expect(() => parseKeyring(line(4_294_967_296, 1))).toThrow(
      new KeyringError('Key file line 1: key version must be at most 4294967295'),
    );
  });

  it.each([
    ['31 bytes', `v1:${b64(1, 31)}`],
    ['33 bytes', `v1:${b64(1, 33)}`],
    ['16 bytes', `v1:${b64(1, 16)}`],
    ['non-canonical trailing bits', `v1:${'A'.repeat(42)}B=`],
    ['missing padding', `v1:${b64(1).slice(0, -1)}`],
    ['invalid characters', `v1:${b64(1).slice(0, -2)}!=`],
  ])('rejects a key that is not base64 of 32 bytes (%s)', (_, bad) => {
    let error: unknown;
    try {
      parseKeyring(`${line(1, 9)}\n${bad.replace('v1', 'v2')}`);
    } catch (caught) {
      error = caught;
    }
    expect(error).toEqual(new KeyringError('Key file line 2: key must be canonical base64 of exactly 32 bytes'));
    expect(String(error)).not.toContain(bad.slice(3));
  });

  it('rejects duplicate versions', () => {
    expect(() => parseKeyring(`${line(1, 1)}\n${line(1, 2)}`)).toThrow(new KeyringError('Duplicate key version v1'));
  });

  it.each(['', '\n\n', '# only a comment\n'])('rejects text without keys: %j', (text) => {
    expect(() => parseKeyring(text)).toThrow(new KeyringError('Key file contains no keys'));
  });
});

describe('key files', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'wf-keyring-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('createKeyFile writes one fresh v1 key with mode 0600 that loadKeyring accepts', async () => {
    const path = join(dir, 'kek');
    await createKeyFile(path);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    const text = await readFile(path, 'utf8');
    expect(text).toMatch(/^# write\.financial key-encryption keys \(KEK\)\. .*back it up offline:\n/);
    expect(text).toMatch(/\nv1:[A-Za-z0-9+/]{43}=\n$/);
    const keyring = await loadKeyring(path);
    expect(keyring.versions).toEqual([1]);
    expect(activeKek(keyring)).toHaveLength(32);
  });

  it('createKeyFile generates a different key every time', async () => {
    await createKeyFile(join(dir, 'a'));
    await createKeyFile(join(dir, 'b'));
    const a = activeKek(await loadKeyring(join(dir, 'a')));
    const b = activeKek(await loadKeyring(join(dir, 'b')));
    expect(a).not.toEqual(b);
  });

  it('createKeyFile refuses to overwrite an existing file', async () => {
    const path = join(dir, 'kek');
    await writeFile(path, 'keep me', { mode: 0o600 });
    await expect(createKeyFile(path)).rejects.toThrow(/EEXIST/);
    expect(await readFile(path, 'utf8')).toBe('keep me');
  });

  it.each([0o600, 0o400])('loadKeyring accepts owner-only mode %o', async (mode) => {
    const path = join(dir, 'kek');
    await writeFile(path, line(3, 3));
    await chmod(path, mode);
    expect((await loadKeyring(path)).activeVersion).toBe(3);
  });

  it.each([
    [0o640, '640'],
    [0o604, '604'],
    [0o620, '620'],
    [0o602, '602'],
    [0o610, '610'],
    [0o601, '601'],
    [0o644, '644'],
  ])('loadKeyring rejects mode %o', async (mode, shown) => {
    const path = join(dir, 'kek');
    await writeFile(path, line(1, 1));
    await chmod(path, mode);
    await expect(loadKeyring(path)).rejects.toThrow(
      new KeyringError(
        `Key file ${path} is accessible by group or other users (mode ${shown}); run: chmod 600 ${path}`,
      ),
    );
  });

  it('loadKeyring reports parse errors of the file content', async () => {
    const path = join(dir, 'kek');
    await writeFile(path, '# nothing\n', { mode: 0o600 });
    await expect(loadKeyring(path)).rejects.toThrow(new KeyringError('Key file contains no keys'));
  });
});

describe('addKeyVersion', () => {
  it('appends a fresh key as the new active version and keeps the old ones', () => {
    const original = `# KEKs\n${line(1, 1)}\n${line(4, 4)}\n`;
    const rotated = addKeyVersion(original);
    expect(rotated.startsWith(original)).toBe(true);
    expect(rotated.slice(original.length)).toMatch(/^v5:[A-Za-z0-9+/]{43}=\n$/);
    const keyring = parseKeyring(rotated);
    expect(keyring.versions).toEqual([1, 4, 5]);
    expect(kekFor(keyring, 4)).toEqual(Buffer.alloc(32, 4));
    expect(activeKek(keyring)).not.toEqual(Buffer.alloc(32, 4));
  });

  it('adds a line break when the text does not end with one', () => {
    const rotated = addKeyVersion(line(1, 1));
    expect(rotated).toMatch(new RegExp(`^${line(1, 1).replaceAll('+', '\\+')}\\nv2:[A-Za-z0-9+/]{43}=\\n$`));
  });

  it('generates a different key every time', () => {
    const text = line(1, 1);
    expect(addKeyVersion(text)).not.toBe(addKeyVersion(text));
  });

  it('rejects invalid input and an exhausted version range', () => {
    expect(() => addKeyVersion('')).toThrow(new KeyringError('Key file contains no keys'));
    expect(() => addKeyVersion(line(4_294_967_295, 1))).toThrow(
      new KeyringError('Key file line 2: key version must be at most 4294967295'),
    );
  });
});
