// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The self-host secrets volume. `init` fills it once; web and worker mount it read-only. Paths are relative to
 * `WF_SECRETS_DIR`; every secret is one file with mode 0600 inside directories with mode 0700:
 *
 *   kek                       key-encryption key (`@wf/crypto/keyring` format)
 *   auth_secret               AUTH_SECRET
 *   setup-token               SETUP_TOKEN: unlocks the first-run setup wizard; init prints it while setup is pending
 *   postgres/<role>           password of each database role (`ROLES` in `@wf/db/roles`)
 *   valkey/password           Valkey `requirepass`; the valkey container mounts only `valkey/`
 *   s3/access_key_id          SeaweedFS S3 identity of the app; the seaweedfs container mounts only `s3/`
 *   s3/secret_access_key
 *
 * The backup container mounts only `postgres/` and `s3/`: backups never see the KEK or the auth secret.
 */
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createKeyFile, loadKeyring } from '@wf/crypto/keyring';
import { ROLES, type RoleName, type RolePasswords } from '@wf/db/roles';

export const KEK = 'kek';
export const AUTH_SECRET = 'auth_secret';
export const SETUP_TOKEN = 'setup-token';
export const VALKEY_PASSWORD = 'valkey/password';
export const S3_ACCESS_KEY_ID = 's3/access_key_id';
export const S3_SECRET_ACCESS_KEY = 's3/secret_access_key';

export function dbPassword(role: RoleName): string {
  return `postgres/${role}`;
}

/** Every secret `init` ensures, in creation order. */
export const SECRETS: readonly string[] = [
  KEK,
  AUTH_SECRET,
  SETUP_TOKEN,
  ...Object.values(ROLES).map(dbPassword),
  VALKEY_PASSWORD,
  S3_ACCESS_KEY_ID,
  S3_SECRET_ACCESS_KEY,
];

/** An existing secret file is unusable. The message names the file, never its content. */
export class SecretFileError extends Error {
  override readonly name = 'SecretFileError';
}

/**
 * Creates every missing secret in `dir` and returns the names of the ones it created. Existing files are never
 * overwritten; they are checked instead (mode 0600 or stricter, not empty, the KEK parses).
 *
 * New secrets are 256 random bits as base64url: printable ASCII (a valid Postgres role password) and safe to embed in
 * URLs and in the JSON that deploy/compose/seaweedfs/start.sh writes.
 */
export async function ensureSecrets(dir: string): Promise<string[]> {
  const created: string[] = [];
  for (const name of SECRETS) {
    const file = path.join(dir, name);
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    try {
      if (name === KEK) await createKeyFile(file);
      else await writeFile(file, randomBytes(32).toString('base64url'), { mode: 0o600, flag: 'wx' });
      created.push(name);
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;
      if (name === KEK) await loadKeyring(file);
      else await checkPrivate(file);
    }
  }
  return created;
}

async function checkPrivate(file: string): Promise<void> {
  const { mode } = await stat(file);
  if ((mode & 0o077) !== 0) {
    throw new SecretFileError(
      `Secret file ${file} is accessible by group or other users (mode ${(mode & 0o777).toString(8)}); run: chmod 600 ${file}`,
    );
  }
  await readSecret(file);
}

/** Reads one secret; one trailing newline (from an editor or `echo`) is dropped, as `@wf/config` does for `_FILE`. */
export async function readSecret(file: string): Promise<string> {
  const value = (await readFile(file, 'utf8')).replace(/\r?\n$/, '');
  if (value === '') throw new SecretFileError(`Secret file ${file} is empty; delete it and run init again`);
  return value;
}

/** The password of every database role in `dir`, for `bootstrapRoles`. */
export async function readRolePasswords(dir: string): Promise<RolePasswords> {
  const password = (role: RoleName) => readSecret(path.join(dir, dbPassword(role)));
  return {
    app: await password(ROLES.app),
    worker: await password(ROLES.worker),
    auth: await password(ROLES.auth),
    migrate: await password(ROLES.migrate),
    readonlyOps: await password(ROLES.readonlyOps),
  };
}
