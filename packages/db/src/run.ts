// SPDX-License-Identifier: AGPL-3.0-only
import { loadConfig, type Config } from '@wf/config';
import { loadKeyring } from '@wf/crypto/keyring';
import { eq, sql } from 'drizzle-orm';
import { createDb } from './db.ts';
import { migrate } from './migrate.ts';
import { bootstrapRoles, ROLES, type RolePasswords } from './roles.ts';
import { users } from './schema.ts';
import { seedAutomation, seedLedger } from './seed.ts';
import { createUserKeys } from './user-keys.ts';

export interface Output {
  log(message: string): void;
  error(message: string): void;
}

const USAGE = 'Usage: wf-db <bootstrap|migrate|rewrap-keys|seed --email <user>>';

/** Thrown for a missing or inconsistent setting; the message names keys, never values. */
class CliError extends Error {}

/** The user id for `email` (case-insensitive), looked up as `wf_auth`, the only role that sees every user. */
async function userIdByEmail(authUrl: string, email: string): Promise<string> {
  const db = createDb(authUrl, { max: 1 });
  try {
    const [user] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(sql`lower(${users.email})`, email.toLowerCase()));
    if (user === undefined) throw new CliError('No user has this email address');
    return user.id;
  } finally {
    await db.$client.end();
  }
}

/**
 * `seed --email <user>`: loads the design persona into the user's empty ledger as `wf_app`, then creates what the
 * scheduled jobs would have by now (review items, notifications) as `wf_worker`.
 */
async function seed(args: readonly string[], config: Config, output: Output): Promise<void> {
  const at = args.indexOf('--email');
  const email = at === -1 ? undefined : args[at + 1];
  if (email === undefined) throw new CliError('--email is required for seed');
  const userId = await userIdByEmail(config.db.authUrl, email);
  const keyring = await loadKeyring(config.crypto.kekFile);
  const db = createDb(config.db.appUrl, { max: 1 });
  const workerDb = createDb(config.db.workerUrl, { max: 1 });
  try {
    const result = await seedLedger(db, userId, { getDek: createUserKeys(db, keyring).getOrCreateDek });
    const automation = await seedAutomation(workerDb, userId, {
      getDek: createUserKeys(workerDb, keyring).getOrCreateDek,
    });
    output.log(
      `Seeded ${result.balances.size} accounts, ${result.transactions} transactions, ${result.closedPeriods} closed ` +
        `period, a budget, ${result.goals} goals, ${result.subscriptions} subscriptions, ${result.recurrences} ` +
        `recurring transfers, ${result.receivables} receivables, and ${automation.reviewItems} review items; ` +
        `available balance ${result.availableMinor} (minor units).`,
    );
  } finally {
    await Promise.all([db.$client.end(), workerDb.$client.end()]);
  }
}

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
 * - `seed --email <user>`: loads the design persona (`DESIGN_SEED`) into that user's empty ledger (dev and E2E).
 */
export async function run(
  args: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
  output: Output,
): Promise<number> {
  const [command] = args;
  if (command !== 'bootstrap' && command !== 'migrate' && command !== 'rewrap-keys' && command !== 'seed') {
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
    } else if (command === 'seed') {
      await seed(args, config, output);
    } else {
      const keyring = await loadKeyring(config.crypto.kekFile);
      const db = createDb(required(config.db.migrateUrl, 'DATABASE_URL_MIGRATE', command), { max: 1 });
      try {
        const { users: rewrapped, instance } = await createUserKeys(db, keyring).rewrapAll();
        output.log(
          `Re-wrapped ${rewrapped} user key(s)${instance ? ' and the instance key' : ''} with KEK v${keyring.activeVersion}.`,
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
