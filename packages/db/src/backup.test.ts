// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  insertUser,
  PGLITE_HOOK_TIMEOUT,
  startMigrated,
  startPglite,
  TEST_PASSWORDS,
  type PgliteServer,
  type TestDatabase,
} from '../test/pglite.ts';
import { bundledMigrations, inspectRestoreTarget, migrationLevel, resetAppSchema } from './backup.ts';
import { migrate, MIGRATIONS_FOLDER } from './migrate.ts';

describe('bundledMigrations', () => {
  it("lists drizzle-kit's journal: one SQL file per migration, oldest first", () => {
    const migrations = bundledMigrations();
    expect(migrations[0]?.tag).toBe('0000_init');
    for (const { tag } of migrations) {
      expect(readFileSync(path.join(MIGRATIONS_FOLDER, `${tag}.sql`), 'utf8')).not.toBe('');
    }
    const when = migrations.map((migration) => migration.when);
    expect(when).toEqual(when.toSorted((a, b) => a - b));
  });
});

describe('on a database that was never migrated', () => {
  let pglite: PgliteServer;

  beforeAll(async () => {
    pglite = await startPglite();
  }, PGLITE_HOOK_TIMEOUT);

  afterAll(async () => {
    await pglite.close();
  });

  it('reports no migrations and no users', async () => {
    expect(await migrationLevel(pglite.url)).toEqual({ applied: 0, latest: null });
    expect(await inspectRestoreTarget(pglite.url)).toEqual({ users: 0, appSessions: 0 });
  });
});

describe('on a migrated database', () => {
  let test: TestDatabase;

  beforeAll(async () => {
    test = await startMigrated();
  }, PGLITE_HOOK_TIMEOUT);

  afterAll(async () => {
    await test.close();
  });

  it('reports the applied migrations as the journal names them', async () => {
    const migrations = bundledMigrations();
    expect(await migrationLevel(test.url)).toEqual({ applied: migrations.length, latest: migrations.at(-1)?.when });
  });

  it('counts every user, past Row-Level Security', async () => {
    await insertUser(test, 'a@example.com');
    await insertUser(test, 'b@example.com');
    expect(await inspectRestoreTarget(test.url)).toEqual({ users: 2, appSessions: 0 });
  });

  it("resets to a database with the roles' grants but none of the app's objects, which migrates again", async () => {
    await resetAppSchema(test.url, TEST_PASSWORDS);
    expect(await test.query("SELECT relname FROM pg_class WHERE relnamespace = 'public'::regnamespace")).toEqual([]);
    expect(await test.query("SELECT nspname FROM pg_namespace WHERE nspname = 'drizzle'")).toEqual([]);
    expect(await migrationLevel(test.url)).toEqual({ applied: 0, latest: null });
    expect(await inspectRestoreTarget(test.url)).toEqual({ users: 0, appSessions: 0 });

    // DROP OWNED revoked CREATE on the database and on `public` from wf_migrate; resetAppSchema granted them again.
    await test.pg.exec('SET ROLE wf_migrate');
    await migrate(test.url);
    await test.pg.exec('RESET ROLE');
    expect((await migrationLevel(test.url)).applied).toBe(bundledMigrations().length);
  });
});
