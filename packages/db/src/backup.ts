// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The database side of the self-host backup and restore (apps/launcher `backup` and `restore`). pg_dump and pg_restore
 * move the data; these functions inspect and prepare the database around them.
 *
 * Who connects as what: pg_dump runs as the superuser, because FORCE ROW LEVEL SECURITY makes even the owner
 * `wf_migrate` unable to read the tables without a matching policy (pg_dump fails with "query would be affected by
 * row-level security policy"). pg_restore runs as `wf_migrate`, so every restored object is owned by it as after a
 * migration, and the SQL inside an archive never runs with superuser rights.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createDb, firstRow } from './db.ts';
import { MIGRATIONS_FOLDER } from './migrate.ts';
import { bootstrapRoles, ROLES, type RolePasswords } from './roles.ts';

/** One migration of drizzle-kit's journal; `when` is what the migrator stores as `created_at` once it is applied. */
export interface Migration {
  readonly tag: string;
  readonly when: number;
}

/** The migrations this version of the app ships, oldest first. */
export function bundledMigrations(): readonly Migration[] {
  const journal = JSON.parse(readFileSync(path.join(MIGRATIONS_FOLDER, 'meta', '_journal.json'), 'utf8')) as {
    entries: readonly Migration[];
  };
  return journal.entries.map(({ tag, when }) => ({ tag, when }));
}

export interface MigrationLevel {
  /** How many migrations were applied. */
  readonly applied: number;
  /** `created_at` of the newest applied migration (its journal `when`); null before the first one. */
  readonly latest: number | null;
}

/** The database's migration level, as the superuser or `wf_migrate`; 0 / null when it was never migrated. */
export async function migrationLevel(url: string): Promise<MigrationLevel> {
  const db = createDb(url, { max: 1 });
  try {
    const { present } = firstRow(
      await db.$client<{ present: boolean }[]>`
        select to_regclass('drizzle.__drizzle_migrations') is not null as present`,
      'migrations table',
    );
    if (!present) return { applied: 0, latest: null };
    return firstRow(
      await db.$client<MigrationLevel[]>`
        select count(*)::int as applied, max(created_at)::float8 as latest from drizzle.__drizzle_migrations`,
      'migration level',
    );
  } finally {
    await db.$client.end();
  }
}

export interface RestoreTarget {
  /** Rows in `users` (all of them: the superuser is not subject to Row-Level Security); 0 without the table. */
  readonly users: number;
  /** Open sessions of the app's roles in this database: web, worker, or init are still running. */
  readonly appSessions: number;
}

/** What a restore would replace, as the superuser. */
export async function inspectRestoreTarget(superuserUrl: string): Promise<RestoreTarget> {
  const db = createDb(superuserUrl, { max: 1 });
  try {
    const { appSessions, hasUsers } = firstRow(
      await db.$client<{ appSessions: number; hasUsers: boolean }[]>`
        select (select count(*)::int from pg_stat_activity
                where datname = current_database()
                  and usename = any(string_to_array(${Object.values(ROLES).join(',')}, ','))) as "appSessions",
               to_regclass('public.users') is not null as "hasUsers"`,
      'restore target',
    );
    if (!hasUsers) return { users: 0, appSessions };
    const { users } = firstRow(
      await db.$client<{ users: number }[]>`select count(*)::int as users from public.users`,
      'user count',
    );
    return { users, appSessions };
  } finally {
    await db.$client.end();
  }
}

/**
 * Before a restore, as the superuser: drops everything `wf_migrate` owns in this database (the app's tables, types,
 * functions, policies, and the migrator's `drizzle` schema), then re-applies the database grants with
 * `bootstrapRoles`, because `DROP OWNED` also revokes the privileges granted to `wf_migrate`. The result is a database
 * whose roles exist but that was never migrated, which is what pg_restore as `wf_migrate` expects. The roles must
 * exist already (init created them).
 */
export async function resetAppSchema(superuserUrl: string, passwords: RolePasswords): Promise<void> {
  const db = createDb(superuserUrl, { max: 1, statementTimeoutMs: 0 });
  try {
    await db.$client.unsafe(`DROP OWNED BY ${ROLES.migrate}`);
  } finally {
    await db.$client.end();
  }
  await bootstrapRoles(superuserUrl, passwords);
}
