// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `backup`: writes one encrypted archive (src/archive.ts) of the database and every stored object to `BACKUP_DIR`,
 * then deletes archives older than `BACKUP_RETENTION_DAYS` (settings: src/backup-settings.ts).
 *
 * Consistency: pg_dump reads the whole database in one snapshot; the objects are copied right after it. An object is
 * stored before the row that references it is committed, and it is never overwritten (every upload gets a new uuidv7
 * key), so every object the dump references is already in the bucket when the copy starts. The copy may hold objects
 * uploaded after the snapshot, which nothing in the restored database references (harmless ciphertext). An object
 * deleted during the copy is missing from the archive; that is safe only because objects are deleted after the rows
 * that reference them and later than a backup takes (docs/self-host/backup.md, "Consistency").
 */
import { readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Config } from '@wf/config';
import type { Migration, MigrationLevel } from '@wf/db/backup';
import type { S3Port } from '@wf/s3';
import { BUCKETS, describeMigration, describeObjects, writeArchive, type ArchiveItem } from './archive.ts';
import { ageRecipients, backupDir, retentionDays, s3Settings, superuser } from './backup-settings.ts';
import type { RunCommand } from './command.ts';
import { setting, type Env } from './env.ts';
import type { Output } from './init.ts';
import { listKeys } from './storage.ts';

export interface BackupDeps {
  readonly runCommand: RunCommand;
  /** `createS3Port` from `@wf/s3`. */
  readonly createS3: (settings: Config['s3']) => S3Port;
  /** `migrationLevel` from `@wf/db/backup`. */
  readonly migrationLevel: (url: string) => Promise<MigrationLevel>;
  /** `bundledMigrations()` from `@wf/db/backup`. */
  readonly migrations: readonly Migration[];
  /** `Date.now`. */
  readonly now: () => number;
  readonly output: Output;
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** Archives, and the partial files of runs that were killed: `wf-20261018T200000Z.tar.age`, `.wf-….tar.age.partial`. */
const ARCHIVE_NAME = /^(?:wf-(\d{8}T\d{6}Z)\.tar\.age|\.wf-(\d{8}T\d{6}Z)\.tar\.age\.partial)$/;

/** `20261018T200000Z`: the UTC time in an archive name. */
export function archiveStamp(time: Date): string {
  return time
    .toISOString()
    .replace(/\.\d{3}Z$/, 'Z')
    .replaceAll(/[-:]/g, '');
}

async function* archiveItems(
  dump: Uint8Array,
  s3: S3Port,
  buckets: Config['s3']['buckets'],
): AsyncGenerator<ArchiveItem> {
  yield { type: 'database', bytes: dump };
  for (const bucket of BUCKETS) {
    for await (const key of listKeys(s3, buckets[bucket])) {
      const bytes = await s3.getObject(buckets[bucket], key);
      // Deleted after it was listed: it no longer exists, so there is nothing to copy.
      if (bytes !== null) yield { type: 'object', bucket, key, bytes };
    }
  }
}

/**
 * Deletes archives older than `days` and partial files older than a day (left by a run that was killed), judged by
 * the time in their names; returns the names it deleted.
 */
async function prune(dir: string, now: Date, days: number): Promise<string[]> {
  const removed: string[] = [];
  for (const name of (await readdir(dir)).toSorted()) {
    const [, archive, partial] = ARCHIVE_NAME.exec(name) ?? [];
    const stamp = archive ?? partial;
    if (stamp === undefined) continue;
    const time = Date.parse(stamp.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, '$1-$2-$3T$4:$5:$6Z'));
    if (now.getTime() - time > (archive === undefined ? 1 : days) * DAY_MS) {
      await rm(path.join(dir, name));
      removed.push(name);
    }
  }
  return removed;
}

/** Runs `backup` and returns the process exit code: 0 done, 1 failed (nothing is left behind but complete archives). */
export async function runBackup(env: Env, deps: BackupDeps): Promise<number> {
  const { output } = deps;
  try {
    const recipients = await ageRecipients(env);
    const dir = backupDir(env);
    const days = retentionDays(env);
    const s3 = await s3Settings(env, 'backup');
    const admin = superuser(env, 'backup');

    const createdAt = new Date(deps.now());
    const file = path.join(dir, `wf-${archiveStamp(createdAt)}.tar.age`);
    output.log('Dumping the database…');
    const dump = await deps.runCommand('pg_dump', ['--format=custom', '--no-password', `--dbname=${admin.target}`], {
      env: { PGPASSWORD: admin.password },
    });
    // Read after the dump: if a migration ran meanwhile, this is newer than the dump, never older, so a restore check
    // against it errs on the safe side.
    const migrations = await deps.migrationLevel(admin.url);
    output.log('Copying the objects…');
    const appVersion = setting(env, 'WF_APP_VERSION') ?? 'dev';
    const manifest = await writeArchive(
      file,
      recipients,
      { createdAt, appVersion, migrations },
      archiveItems(dump, deps.createS3(s3), s3.buckets),
    );
    const { size } = await stat(file);
    output.log(
      `Backup written: ${file} (${size.toLocaleString('en-US')} bytes, encrypted to ${recipients.length} age ` +
        `recipient(s)): database ${dump.length.toLocaleString('en-US')} bytes at migration ` +
        `${describeMigration(migrations.latest, deps.migrations)}, ${describeObjects(manifest.objects)}.`,
    );

    const removed = await prune(dir, createdAt, days);
    output.log(
      `Retention ${days} day(s): ${removed.length === 0 ? 'nothing to delete' : `deleted ${removed.join(', ')}`}.`,
    );
    return 0;
  } catch (error) {
    output.error(`backup failed: ${String(error)}`);
    return 1;
  }
}
