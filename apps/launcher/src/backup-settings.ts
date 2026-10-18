// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Settings of `backup` and `restore` (deploy/compose/docker-compose.yml, service `backup`):
 * - `BACKUP_AGE_RECIPIENT`: the age public key (`age1…`) archives are encrypted to, or `BACKUP_AGE_RECIPIENT_FILE`: an
 *   age recipients file (one per line, `#` comments), e.g. a main key and a spare. Required for `backup`: without it,
 *   nothing is written, because a backup must never exist unencrypted.
 * - `BACKUP_DIR` (`/backups`), `BACKUP_RETENTION_DAYS` (30).
 * - `POSTGRES_USER` (`postgres`), `POSTGRES_PASSWORD`: the superuser, for pg_dump and the restore preparation.
 * - `WF_SECRETS_DIR` with `postgres/` (role passwords) and `s3/` (S3 identity), `WF_DATABASE_HOST`, `WF_DATABASE_NAME`.
 * - `S3_ENDPOINT`, `S3_REGION` (`us-east-1`), `S3_BUCKET_*`: as for web and worker (the defaults of `@wf/config`).
 * - `WF_APP_VERSION`: set by the image, recorded in the manifest.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Config } from '@wf/config';
import { Decrypter, Encrypter } from 'age-encryption';
import { LaunchConfigError, postgresUrl, requiredSetting, setting, superuserLogin, type Env } from './env.ts';
import { readSecret, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY } from './secrets.ts';

/** A PostgreSQL login for postgres.js (`url`) and for the client tools (`target` + `PGPASSWORD`). */
export interface Login {
  readonly url: string;
  readonly target: string;
  readonly password: string;
}

export function login(env: Env, user: string, password: string): Login {
  return { url: postgresUrl(env, user, password), target: postgresUrl(env, user), password };
}

export function superuser(env: Env, command: string): Login {
  const { user, password } = superuserLogin(env, command);
  return login(env, user, password);
}

/** Where archives are written and looked up by name. */
export function backupDir(env: Env): string {
  return setting(env, 'BACKUP_DIR') ?? '/backups';
}

export function retentionDays(env: Env): number {
  const value = setting(env, 'BACKUP_RETENTION_DAYS') ?? '30';
  if (!/^[1-9]\d{0,4}$/.test(value)) {
    throw new LaunchConfigError('BACKUP_RETENTION_DAYS must be a whole number of days from 1 to 99999');
  }
  return Number(value);
}

/** The S3 settings of the app, with the identity from the secrets volume. */
export async function s3Settings(env: Env, command: string): Promise<Config['s3']> {
  const dir = requiredSetting(env, 'WF_SECRETS_DIR', command);
  return {
    endpoint: requiredSetting(env, 'S3_ENDPOINT', command),
    region: setting(env, 'S3_REGION') ?? 'us-east-1',
    accessKeyId: await readSecret(path.join(dir, S3_ACCESS_KEY_ID)),
    secretAccessKey: await readSecret(path.join(dir, S3_SECRET_ACCESS_KEY)),
    buckets: {
      attachments: setting(env, 'S3_BUCKET_ATTACHMENTS') ?? 'wf-attachments',
      avatars: setting(env, 'S3_BUCKET_AVATARS') ?? 'wf-avatars',
      reports: setting(env, 'S3_BUCKET_REPORTS') ?? 'wf-reports',
      exports: setting(env, 'S3_BUCKET_EXPORTS') ?? 'wf-exports',
    },
  };
}

/** Non-empty lines without `#` comments, with their line numbers. */
function keyLines(text: string): [line: number, value: string][] {
  return text
    .split('\n')
    .map((raw, index): [number, string] => [index + 1, raw.trim()])
    .filter(([, value]) => value !== '' && !value.startsWith('#'));
}

const IDENTITY_PREFIX = 'AGE-SECRET-KEY-';

/**
 * The validated age recipients of `backup`.
 * @throws {LaunchConfigError} when none is configured, both forms are set, or a line is not an age recipient
 * (a private key in particular, which must stay off the server).
 */
export async function ageRecipients(env: Env): Promise<string[]> {
  const value = setting(env, 'BACKUP_AGE_RECIPIENT');
  const file = setting(env, 'BACKUP_AGE_RECIPIENT_FILE');
  if (value !== undefined && file !== undefined) {
    throw new LaunchConfigError('Set either BACKUP_AGE_RECIPIENT or BACKUP_AGE_RECIPIENT_FILE, not both');
  }
  const source = file ?? 'BACKUP_AGE_RECIPIENT';
  let text = value ?? '';
  if (file !== undefined) text = await readFile(file, 'utf8');
  const lines = keyLines(text);
  if (lines.length === 0) {
    throw new LaunchConfigError(
      'No age recipient is configured, and backups are never written unencrypted. Set BACKUP_AGE_RECIPIENT in .env to ' +
        'the public key (age1…) of a key pair made offline with age-keygen (docs/self-host/backup.md).',
    );
  }
  const encrypter = new Encrypter();
  return lines.map(([line, recipient]) => {
    const where = file === undefined ? source : `${source} line ${line}`;
    if (recipient.toUpperCase().startsWith(IDENTITY_PREFIX)) {
      throw new LaunchConfigError(
        `${where} holds an age identity (private key). Configure its public key (age-keygen -y) instead and keep the ` +
          'private key off this server: whoever has it can read every backup.',
      );
    }
    try {
      encrypter.addRecipient(recipient);
    } catch {
      throw new LaunchConfigError(`${where} is not an age recipient (age1…)`);
    }
    return recipient;
  });
}

/**
 * The age identities (private keys) in `text`, as written by `age-keygen`: `AGE-SECRET-KEY-…` lines and `#` comments.
 * @param source where the text came from, for messages (which never echo a key).
 */
export function ageIdentities(text: string, source: string): string[] {
  const lines = keyLines(text);
  if (lines.length === 0) throw new LaunchConfigError(`${source} contains no age identity (AGE-SECRET-KEY-…)`);
  const decrypter = new Decrypter();
  return lines.map(([line, identity]) => {
    try {
      decrypter.addIdentity(identity);
    } catch {
      throw new LaunchConfigError(`${source} line ${line} is not an age identity (AGE-SECRET-KEY-…)`);
    }
    return identity;
  });
}
