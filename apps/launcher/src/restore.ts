// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `restore <archive> [--force] [--identity <file>]`: replaces the database and every stored object with the contents
 * of an archive made by `backup` (src/archive.ts). The age identity (private key) comes from `--identity <file>` or
 * stdin; it is used in memory only.
 *
 * 1. Decrypts the whole archive once and checks it against its manifest, before anything is changed.
 * 2. Refuses while the app is connected to the database, when the archive needs a newer version of the app, and,
 *    without `--force`, when the database already has users.
 * 3. As the superuser: drops everything `wf_migrate` owns and re-applies the role grants (`resetAppSchema`).
 * 4. Decrypts again and streams the dump into pg_restore as `wf_migrate` (owner of every object, grants from the dump),
 *    in one transaction, and puts every object back; then deletes objects the archive does not have.
 * 5. Applies the migrations this version has on top (an archive of an older version is migrated forward).
 *
 * The KEK and the auth secret are not in the archive: the secrets volume must hold the instance's own (backup.md).
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Config } from '@wf/config';
import type { Migration, RestoreTarget } from '@wf/db/backup';
import { ROLES, type RolePasswords } from '@wf/db/roles';
import type { S3Port } from '@wf/s3';
import { BUCKETS, describeMigration, describeObjects, readArchive, type BucketKind } from './archive.ts';
import { ageIdentities, backupDir, login, s3Settings, superuser } from './backup-settings.ts';
import type { RunCommand } from './command.ts';
import { LaunchConfigError, requiredSetting, type Env } from './env.ts';
import type { Output } from './init.ts';
import { readRolePasswords } from './secrets.ts';
import { listKeys } from './storage.ts';

export const RESTORE_USAGE =
  'Usage: wf-launcher restore <archive> [--force] [--identity <file>]  (without --identity, the age identity is read from stdin)';

/** `process.stdin`. */
export interface Stdin extends AsyncIterable<Uint8Array> {
  readonly isTTY?: boolean;
}

export interface RestoreDeps {
  readonly runCommand: RunCommand;
  /** `createS3Port` from `@wf/s3`. */
  readonly createS3: (settings: Config['s3']) => S3Port;
  /** `inspectRestoreTarget` from `@wf/db/backup`. */
  readonly inspectRestoreTarget: (superuserUrl: string) => Promise<RestoreTarget>;
  /** `resetAppSchema` from `@wf/db/backup`. */
  readonly resetAppSchema: (superuserUrl: string, passwords: RolePasswords) => Promise<void>;
  /** `migrate` from `@wf/db/migrate`. */
  readonly migrate: (migrateUrl: string) => Promise<void>;
  /** `bundledMigrations()` from `@wf/db/backup`. */
  readonly migrations: readonly Migration[];
  readonly stdin: Stdin;
  readonly output: Output;
}

/** The restore would destroy data or cannot work now; the message says what to do. */
export class RestoreRefusedError extends Error {
  override readonly name = 'RestoreRefusedError';
}

interface RestoreArgs {
  readonly archive: string;
  readonly force: boolean;
  readonly identity: string | undefined;
}

function parseArgs(args: readonly string[]): RestoreArgs | undefined {
  const rest = [...args];
  let archive: string | undefined;
  let identity: string | undefined;
  let force = false;
  for (let arg = rest.shift(); arg !== undefined; arg = rest.shift()) {
    if (arg === '--force') force = true;
    else if (arg === '--identity') {
      identity = rest.shift();
      if (identity === undefined) return undefined;
    } else if (arg.startsWith('-') || archive !== undefined) return undefined;
    else archive = arg;
  }
  return archive === undefined ? undefined : { archive, force, identity };
}

async function readIdentities(file: string | undefined, stdin: Stdin): Promise<string[]> {
  if (file !== undefined) return ageIdentities(await readFile(file, 'utf8'), file);
  if (stdin.isTTY === true) {
    throw new LaunchConfigError(
      'Give the age identity (private key) on stdin, e.g. docker compose run --rm -T backup restore <archive> < ' +
        'backup.key, or with --identity <file>',
    );
  }
  const chunks: Uint8Array[] = [];
  for await (const chunk of stdin) chunks.push(chunk);
  return ageIdentities(Buffer.concat(chunks).toString('utf8'), 'stdin');
}

async function collect(body: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of body) chunks.push(chunk);
  return Buffer.concat(chunks);
}

/** Deletes the objects of `bucket` that are not in `keep`; returns how many. */
async function removeOthers(s3: S3Port, bucket: string, keep: ReadonlySet<string>): Promise<number> {
  const stale: string[] = [];
  for await (const key of listKeys(s3, bucket)) if (!keep.has(key)) stale.push(key);
  for (let start = 0; start < stale.length; start += 1000)
    await s3.deleteObjects(bucket, stale.slice(start, start + 1000));
  return stale.length;
}

/** Runs `restore` and returns the process exit code: 0 done, 1 failed or refused, 2 usage. */
export async function runRestore(args: readonly string[], env: Env, deps: RestoreDeps): Promise<number> {
  const { output } = deps;
  const parsed = parseArgs(args);
  if (parsed === undefined) {
    output.error(RESTORE_USAGE);
    return 2;
  }
  try {
    const file = path.resolve(backupDir(env), parsed.archive);
    const secretsDir = requiredSetting(env, 'WF_SECRETS_DIR', 'restore');
    const s3 = await s3Settings(env, 'restore');
    const admin = superuser(env, 'restore');
    const passwords = await readRolePasswords(secretsDir);
    const owner = login(env, ROLES.migrate, passwords.migrate);
    const identities = await readIdentities(parsed.identity, deps.stdin);

    output.log(`Verifying ${file}…`);
    const manifest = await readArchive(file, identities, () => Promise.resolve());
    const migration = describeMigration(manifest.migrations.latest, deps.migrations);
    output.log(
      `The archive is intact: made ${manifest.createdAt} by version ${manifest.appVersion}, database at migration ` +
        `${migration}, ${describeObjects(manifest.objects)}.`,
    );
    const { latest } = manifest.migrations;
    if (latest !== null && !deps.migrations.some((known) => known.when === latest)) {
      throw new RestoreRefusedError(
        `The archive's database is at migration ${migration}, which this version does not have: restore it with ` +
          `version ${manifest.appVersion} or newer (WF_VERSION in .env)`,
      );
    }

    const target = await deps.inspectRestoreTarget(admin.url);
    if (target.appSessions > 0) {
      throw new RestoreRefusedError(
        `The app still has ${target.appSessions} connection(s) to the database: stop it first with ` +
          '`docker compose stop web worker`, then run the restore again',
      );
    }
    if (target.users > 0) {
      if (!parsed.force) {
        throw new RestoreRefusedError(
          `The database is not empty (${target.users} user(s)). A restore replaces all of its data and every ` +
            'stored file; to do that, run the restore again with --force',
        );
      }
      output.log(`--force: replacing the current data (${target.users} user(s)).`);
    }

    output.log('Restoring the database and the objects…');
    await deps.resetAppSchema(admin.url, passwords);
    const storage = deps.createS3(s3);
    const restored: Record<BucketKind, Set<string>> = {
      attachments: new Set(),
      avatars: new Set(),
      reports: new Set(),
      exports: new Set(),
    };
    await readArchive(file, identities, async (entry) => {
      if (entry.type === 'database') {
        await deps.runCommand(
          'pg_restore',
          ['--no-password', '--no-owner', '--exit-on-error', '--single-transaction', `--dbname=${owner.target}`],
          { env: { PGPASSWORD: owner.password }, input: entry.body },
        );
      } else {
        await storage.putObject(s3.buckets[entry.bucket], entry.key, await collect(entry.body));
        restored[entry.bucket].add(entry.key);
      }
    });
    let removed = 0;
    for (const bucket of BUCKETS) removed += await removeOthers(storage, s3.buckets[bucket], restored[bucket]);
    output.log(`Deleted ${removed} stored object(s) that are not in the archive.`);

    await deps.migrate(owner.url);
    const { users } = await deps.inspectRestoreTarget(admin.url);
    output.log(
      `Restore is done: ${users} user(s), ${describeObjects(manifest.objects)}, migrations up to date. Start the app ` +
        'with `docker compose up -d --wait`.',
    );
    return 0;
  } catch (error) {
    output.error(`restore failed: ${String(error)}`);
    return 1;
  }
}
