// SPDX-License-Identifier: AGPL-3.0-only
import { randomBytes } from 'node:crypto';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { KEY_BYTES, KeyringError, Keyring, type KeyEntry } from './keys.ts';

/**
 * KEK secret file: one key per line as `v<N>:<base64 of 32 bytes>`; blank lines and `#` comments are allowed.
 * The highest version is active. Rotation = append a new version (`addKeyVersion`), re-wrap every DEK, and only
 * then drop old lines. The file lives outside the DB and the repo, readable only by the service user.
 */

export { KeyringError };
export type { Keyring };

/** Versions are stored as uint32 in wrapped DEKs. */
const MAX_KEY_VERSION = 0xffff_ffff;
const LINE = /^v[1-9]\d{0,9}:\S+$/;

const NEW_FILE_HEADER = `# write.financial key-encryption keys (KEK). Keep this file secret (mode 0600) and back it up offline:
# without it every encrypted value is unreadable. Rotate by appending a new version; keep old versions
# until every DEK has been re-wrapped.
`;

/** Parses key file text. Errors name the line number but never echo the line, which may hold a key. */
export function parseKeyring(text: string): Keyring {
  const entries: KeyEntry[] = [];
  for (const [index, raw] of text.split('\n').entries()) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const where = `Key file line ${index + 1}`;
    if (!LINE.test(line)) throw new KeyringError(`${where}: expected "v<version>:<base64 key>"`);
    const colon = line.indexOf(':');
    const version = Number(line.slice(1, colon));
    if (version > MAX_KEY_VERSION) throw new KeyringError(`${where}: key version must be at most ${MAX_KEY_VERSION}`);
    const encoded = line.slice(colon + 1);
    const key = Buffer.from(encoded, 'base64');
    if (key.length !== KEY_BYTES || key.toString('base64') !== encoded) {
      throw new KeyringError(`${where}: key must be canonical base64 of exactly ${KEY_BYTES} bytes`);
    }
    entries.push({ version, key });
  }
  const [first, ...rest] = entries;
  if (first === undefined) throw new KeyringError('Key file contains no keys');
  return new Keyring([first, ...rest]);
}

/** Loads the KEK file, refusing files that group or other users could read or write. */
export async function loadKeyring(path: string): Promise<Keyring> {
  const { mode } = await stat(path);
  if ((mode & 0o077) !== 0) {
    throw new KeyringError(
      `Key file ${path} is accessible by group or other users (mode ${(mode & 0o777).toString(8)}); run: chmod 600 ${path}`,
    );
  }
  return parseKeyring(await readFile(path, 'utf8'));
}

/** Creates a key file with one fresh `v1` key and mode 0600. Fails if the file already exists. */
export async function createKeyFile(path: string): Promise<void> {
  await writeFile(path, `${NEW_FILE_HEADER}v1:${randomBytes(KEY_BYTES).toString('base64')}\n`, {
    mode: 0o600,
    flag: 'wx',
  });
}

/** Returns the key file text with a fresh key appended as the new highest (active) version. */
export function addKeyVersion(text: string): string {
  const { activeVersion } = parseKeyring(text);
  const separator = text.endsWith('\n') ? '' : '\n';
  const next = `${text}${separator}v${activeVersion + 1}:${randomBytes(KEY_BYTES).toString('base64')}\n`;
  parseKeyring(next);
  return next;
}
