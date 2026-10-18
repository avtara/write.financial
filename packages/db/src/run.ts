// SPDX-License-Identifier: AGPL-3.0-only
import { loadConfig, type Config } from '@wf/config';
import { loadKeyring } from '@wf/crypto/keyring';
import { createDb } from './db.ts';
import { migrate } from './migrate.ts';
import { bootstrapRoles, ROLES, type RolePasswords } from './roles.ts';
import { createUserKeys } from './user-keys.ts';

export interface Output {
  log(message: string): void;
  error(message: string): void;
}

const USAGE = 'Usage: wf-db <bootstrap|migrate|rewrap-keys>';

/** Thrown for a missing or inconsistent setting; the message names keys, never values. */
class CliError extends Error {}

function required(value: string | null, key: string, command: string): string {
  if (value === null) throw new CliError(`${key} is required for ${command}`);
  return value;
}

/** The password of `url`, which must log in as `role` (the roles have fixed names, see src/roles.ts). */
function passwordFor(url: string, role: string, key: string): string {
  const parsed = new URL(url);
  if (decodeURIComponent(parsed.username) !== role) throw new CliError(`${key} must log in as ${role}`);
  return decodeURIComponent(parsed.password);
}

function rolePasswords({ db }: Config): RolePasswords {
  return {
    app: passwordFor(db.appUrl, ROLES.app, 'DATABASE_URL'),
    worker: passwordFor(db.workerUrl, ROLES.worker, 'DATABASE_URL_WORKER'),
    auth: passwordFor(db.authUrl, ROLES.auth, 'DATABASE_URL_AUTH'),
    migrate: passwordFor(
      required(db.migrateUrl, 'DATABASE_URL_MIGRATE', 'bootstrap'),
      ROLES.migrate,
      'DATABASE_URL_MIGRATE',
    ),
    readonlyOps:
      db.readonlyOpsUrl === null
        ? null
        : passwordFor(db.readonlyOpsUrl, ROLES.readonlyOps, 'DATABASE_URL_READONLY_OPS'),
  };
}

/**
 * Runs one database command with the configuration from `env` and returns the process exit code:
 * - `bootstrap`: creates/updates the roles as `DATABASE_URL_SUPERUSER`, with the passwords of the role URLs.
 * - `migrate`: applies pending migrations as `DATABASE_URL_MIGRATE`.
 * - `rewrap-keys`: after a new KEK version was added to `KEK_FILE`, re-wraps every DEK with it.
 */
export async function run(
  args: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
  output: Output,
): Promise<number> {
  const [command] = args;
  if (command !== 'bootstrap' && command !== 'migrate' && command !== 'rewrap-keys') {
    output.error(USAGE);
    return 2;
  }
  try {
    const config = loadConfig(env);
    if (command === 'bootstrap') {
      await bootstrapRoles(required(config.db.superuserUrl, 'DATABASE_URL_SUPERUSER', command), rolePasswords(config));
      output.log(`Roles ${Object.values(ROLES).join(', ')} are up to date.`);
    } else if (command === 'migrate') {
      await migrate(required(config.db.migrateUrl, 'DATABASE_URL_MIGRATE', command));
      output.log('Migrations are up to date.');
    } else {
      const keyring = await loadKeyring(config.crypto.kekFile);
      const db = createDb(required(config.db.migrateUrl, 'DATABASE_URL_MIGRATE', command), { max: 1 });
      try {
        const { users, instance } = await createUserKeys(db, keyring).rewrapAll();
        output.log(
          `Re-wrapped ${users} user key(s)${instance ? ' and the instance key' : ''} with KEK v${keyring.activeVersion}.`,
        );
      } finally {
        await db.$client.end();
      }
    }
    return 0;
  } catch (error) {
    output.error(String(error));
    return 1;
  }
}
