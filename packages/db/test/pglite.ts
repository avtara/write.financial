// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Unit-test database: PGlite (PostgreSQL 18 compiled to WASM, in process) behind `pglite-socket`, so the code under
 * test talks to it through postgres.js exactly as in production. Limits: one connection at a time (pools must use
 * `max: 1` or run one query at a time), startup parameters are ignored, and there is no password authentication, so
 * every connection is the `postgres` superuser. Tests switch roles with `SET ROLE`, which applies to the single
 * session that all connections share.
 */
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { expect } from 'vitest';
import { createDb, type Database } from '../src/db.ts';
import { migrate } from '../src/migrate.ts';
import { bootstrapRoles, type RoleName } from '../src/roles.ts';

export interface PgliteServer {
  readonly pg: PGlite;
  /** Superuser URL of the socket server. */
  readonly url: string;
  /** Superuser query (tests set rows up and inspect them with it). */
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
  close(): Promise<void>;
}

export interface TestDatabase extends PgliteServer {
  /** Drizzle over postgres.js (`max: 1`) on {@link PgliteServer.url}. */
  readonly db: Database;
  /** Runs `fn` with `SET ROLE role`, restoring the superuser afterwards. */
  as<T>(role: RoleName, fn: () => Promise<T>): Promise<T>;
}

/** `beforeAll` timeout for suites that start PGlite: WASM start-up is slow when every test file starts one at once. */
export const PGLITE_HOOK_TIMEOUT = 60_000;

export const TEST_PASSWORDS = {
  app: 'test-app',
  worker: 'test-worker',
  migrate: 'test-migrate',
  auth: 'test-auth',
  readonlyOps: 'test-readonly-ops',
} as const;

/** Matcher for a Drizzle query error whose Postgres cause matches `pattern`. */
export function pgError(pattern: RegExp): { cause: { message: string } } {
  return { cause: { message: expect.stringMatching(pattern) as string } };
}

/** An empty database (no roles, no tables). */
export async function startPglite(): Promise<PgliteServer> {
  // pg_trgm is a contrib extension in PGlite; the ledger migration creates it (trigram search indexes).
  const pg = await PGlite.create({ extensions: { pg_trgm } });
  const server = new PGLiteSocketServer({ db: pg, host: '127.0.0.1', port: 0 });
  await server.start();
  return {
    pg,
    url: `postgres://postgres@${server.getServerConn()}/postgres`,
    query: async <T>(text: string, params?: unknown[]) => (await pg.query<T>(text, params)).rows,
    close: async () => {
      await server.stop();
      await pg.close();
    },
  };
}

/** A database with the roles bootstrapped and every migration applied. */
export async function startMigrated(): Promise<TestDatabase> {
  const base = await startPglite();
  await bootstrapRoles(base.url, TEST_PASSWORDS);
  // As in production, wf_migrate runs the migrations and so owns every table (FORCE RLS then applies to it too).
  await base.pg.exec('SET ROLE wf_migrate');
  await migrate(base.url);
  await base.pg.exec('RESET ROLE');
  const db = createDb(base.url, { max: 1 });
  return {
    ...base,
    db,
    as: async (role, fn) => {
      await base.pg.exec(`SET ROLE ${role}`);
      try {
        return await fn();
      } finally {
        await base.pg.exec('RESET ROLE');
      }
    },
    close: async () => {
      await db.$client.end();
      await base.close();
    },
  };
}

/** Inserts a user as the superuser and returns its id. */
export async function insertUser(test: Pick<PgliteServer, 'query'>, email: string, role = 'user'): Promise<string> {
  const [row] = await test.query<{ id: string }>(
    `INSERT INTO users (name, email, role) VALUES ($1, $1, $2::user_role) RETURNING id`,
    [email, role],
  );
  if (row === undefined) throw new Error('INSERT … RETURNING returned no row');
  return row.id;
}
