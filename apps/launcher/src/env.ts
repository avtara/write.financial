// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Turns the secrets volume (src/secrets.ts) into the `@wf/config` environment of web and worker. Secrets that
 * `@wf/config` reads from files get `<KEY>_FILE` paths; URLs that embed a password are composed in memory here, so no
 * second plaintext copy of a password is written anywhere.
 *
 * Settings (all optional; the defaults match deploy/compose/docker-compose.yml):
 * - `WF_SECRETS_DIR`: the secrets volume. Unset: nothing is derived and the environment is used as is.
 * - `WF_DATABASE_HOST` (`postgres:5432`), `WF_DATABASE_NAME` (`write_financial`), `WF_REDIS_HOST` (`valkey:6379`).
 */
import path from 'node:path';
import { ROLES, type RoleName } from '@wf/db/roles';
import {
  AUTH_SECRET,
  KEK,
  readSecret,
  S3_ACCESS_KEY_ID,
  S3_SECRET_ACCESS_KEY,
  VALKEY_PASSWORD,
  dbPassword,
} from './secrets.ts';

export type Env = Readonly<Record<string, string | undefined>>;

/** A launcher setting is missing or contradicts the secrets volume. The message names keys, never values. */
export class LaunchConfigError extends Error {
  override readonly name = 'LaunchConfigError';
}

/** `@wf/config` treats empty values (`KEY=` in `.env`) as unset; so does the launcher. */
export function setting(env: Env, key: string): string | undefined {
  const value = env[key];
  return value === '' ? undefined : value;
}

/** `postgres://user:password@WF_DATABASE_HOST/WF_DATABASE_NAME`, with user and password percent-encoded. */
export function postgresUrl(env: Env, user: string, password: string): string {
  const host = setting(env, 'WF_DATABASE_HOST') ?? 'postgres:5432';
  const database = setting(env, 'WF_DATABASE_NAME') ?? 'write_financial';
  return `postgres://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}/${encodeURIComponent(database)}`;
}

/** The runtime database logins every process needs (`@wf/config` requires all three). */
const DATABASE_URLS: readonly (readonly [string, RoleName])[] = [
  ['DATABASE_URL', ROLES.app],
  ['DATABASE_URL_WORKER', ROLES.worker],
  ['DATABASE_URL_AUTH', ROLES.auth],
];

/**
 * The variables derived from `WF_SECRETS_DIR` for web and worker, to be merged into their environment. The migrate,
 * operator, and superuser logins are not included: only `init` uses them.
 * @throws {LaunchConfigError} when the environment already sets one of the derived keys (or its `_FILE` form).
 * @throws {SecretFileError} when a secret file is empty.
 */
export async function secretsEnv(env: Env): Promise<Record<string, string>> {
  const dir = setting(env, 'WF_SECRETS_DIR');
  if (dir === undefined) return {};
  const owned = ['KEK_FILE', 'AUTH_SECRET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'REDIS_URL'];
  owned.push(...DATABASE_URLS.map(([key]) => key));
  const conflicts = owned.filter((key) => setting(env, key) !== undefined || setting(env, `${key}_FILE`) !== undefined);
  if (conflicts.length > 0) {
    throw new LaunchConfigError(
      `WF_SECRETS_DIR provides these settings, so unset them and their _FILE form: ${conflicts.join(', ')}`,
    );
  }

  const file = (name: string) => path.join(dir, name);
  const redisHost = setting(env, 'WF_REDIS_HOST') ?? 'valkey:6379';
  const derived: Record<string, string> = {
    KEK_FILE: file(KEK),
    AUTH_SECRET_FILE: file(AUTH_SECRET),
    S3_ACCESS_KEY_ID_FILE: file(S3_ACCESS_KEY_ID),
    S3_SECRET_ACCESS_KEY_FILE: file(S3_SECRET_ACCESS_KEY),
    REDIS_URL: `redis://:${encodeURIComponent(await readSecret(file(VALKEY_PASSWORD)))}@${redisHost}/0`,
  };
  for (const [key, role] of DATABASE_URLS) {
    derived[key] = postgresUrl(env, role, await readSecret(file(dbPassword(role))));
  }
  return derived;
}
