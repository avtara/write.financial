// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Connections and the user-scoped transaction (PRD §9.1 tenant isolation). This package is the only place that opens
 * a Postgres connection (plan §3); every other package receives a `Database` or a repository.
 */
import { sql } from 'drizzle-orm';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.ts';

export type Schema = typeof schema;
export type Database = PostgresJsDatabase<Schema> & { $client: postgres.Sql };
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

export interface DbOptions {
  /** Pool size (default 10). */
  readonly max?: number;
  /** Server-side `statement_timeout` in milliseconds (default 30 000); `0` disables it, e.g. for migrations. */
  readonly statementTimeoutMs?: number;
}

/**
 * Opens a lazily connecting pool. The role is whatever the URL logs in as (`wf_app`, `wf_worker`, `wf_auth`,
 * `wf_migrate`); close it with `db.$client.end()`.
 */
export function createDb(url: string, options: DbOptions = {}): Database {
  const client = postgres(url, {
    max: options.max ?? 10,
    connect_timeout: 10,
    idle_timeout: 20,
    max_lifetime: 30 * 60,
    onnotice: () => undefined,
    connection: {
      application_name: 'write.financial',
      statement_timeout: options.statementTimeoutMs ?? 30_000,
      idle_in_transaction_session_timeout: 60_000,
    },
  });
  return drizzle({ client, schema });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True for the canonical textual form of a UUID (any version). */
export function isUuid(value: string): boolean {
  return UUID.test(value);
}

/** The user id is not a UUID; the value is not echoed because it may come from untrusted input. */
export class InvalidUserIdError extends TypeError {
  override readonly name = 'InvalidUserIdError';

  constructor() {
    super('userId must be a UUID');
  }
}

/**
 * Runs `fn` in a transaction whose `app.user_id` is `userId` (`set_config(…, true)` = `SET LOCAL`), so Row-Level
 * Security limits every user-owned table to that user's rows. `userId` must come from the session or job, never from
 * request input. The setting ends with the transaction, so a pooled connection never carries it to the next caller.
 */
export async function withUser<T>(db: Database, userId: string, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  if (!isUuid(userId)) throw new InvalidUserIdError();
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`);
    return fn(tx);
  });
}

/** A query that must return a row returned none (e.g. RLS hid it, or the user lacks the required role). */
export class MissingRowError extends Error {
  override readonly name = 'MissingRowError';
}

/** The first row, or `MissingRowError` naming `what` when there is none. */
export function firstRow<T>(rows: readonly T[], what: string): T {
  const [row] = rows;
  if (row === undefined) throw new MissingRowError(`No ${what} row is visible`);
  return row;
}
