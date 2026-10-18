// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Database roles (plan §4.0). `bootstrapRoles` runs once per database as a superuser, before the first migration,
 * and again whenever a password changes; it is idempotent. Every role is a plain LOGIN role: no SUPERUSER, no
 * BYPASSRLS, no CREATEDB/CREATEROLE/REPLICATION. Table grants and policies live in the migrations, which run as
 * `wf_migrate` and therefore own every table.
 */
import { createHash, createHmac, pbkdf2Sync, randomBytes } from 'node:crypto';
import postgres from 'postgres';

export const ROLES = {
  /** Web app: user-owned tables through `withUser`, RLS enforced. */
  app: 'wf_app',
  /** Worker: like `app`, plus global price/rate tables (M5). */
  worker: 'wf_worker',
  /** Owner of the schema; runs migrations and KEK rotation. */
  migrate: 'wf_migrate',
  /** Auth module only: Better Auth's tables, read before a user is known. */
  auth: 'wf_auth',
  /** Operators: read-only, every statement logged. */
  readonlyOps: 'wf_readonly_ops',
} as const;

export type RoleName = (typeof ROLES)[keyof typeof ROLES];

/** One password per role; `readonlyOps: null` keeps the operators' role unable to log in. */
export interface RolePasswords {
  readonly app: string;
  readonly worker: string;
  readonly migrate: string;
  readonly auth: string;
  readonly readonlyOps: string | null;
}

/** Thrown for an unusable password. The message names the role, never the password. */
export class RolePasswordError extends Error {
  override readonly name = 'RolePasswordError';
}

/** Printable ASCII only: Postgres runs SASLprep on non-ASCII passwords, which the verifier below does not replicate. */
const PASSWORD = /^[\x20-\x7e]+$/;
const SCRAM_ITERATIONS = 4096;

/**
 * SCRAM-SHA-256 verifier (RFC 5802/7677) in Postgres' `rolpassword` format. Sending the verifier instead of the
 * password keeps the plaintext out of the server's statement log. `salt` is a parameter for known-answer tests only.
 */
export function scramVerifier(password: string, salt: Buffer = randomBytes(16)): string {
  const salted = pbkdf2Sync(password, salt, SCRAM_ITERATIONS, 32, 'sha256');
  const storedKey = createHash('sha256').update(createHmac('sha256', salted).update('Client Key').digest()).digest();
  const serverKey = createHmac('sha256', salted).update('Server Key').digest();
  return `SCRAM-SHA-256$${SCRAM_ITERATIONS}:${salt.toString('base64')}$${storedKey.toString('base64')}:${serverKey.toString('base64')}`;
}

/** Creates or updates the roles and the database-level grants. Safe to run concurrently and repeatedly. */
export async function bootstrapRoles(superuserUrl: string, passwords: RolePasswords): Promise<void> {
  const logins = (Object.keys(ROLES) as (keyof typeof ROLES)[]).map((key) => {
    const password = passwords[key];
    if (password !== null && !PASSWORD.test(password)) {
      throw new RolePasswordError(`Password for ${ROLES[key]} must be non-empty printable ASCII`);
    }
    return { role: ROLES[key], verifier: password === null ? null : scramVerifier(password) };
  });

  const client = postgres(superuserUrl, { max: 1 });
  try {
    await client.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext('wf.bootstrap-roles'))`;
      for (const { role, verifier } of logins) {
        // Role names are the constants above and verifiers are base64/`$:` only, so interpolation is safe here.
        await tx.unsafe(
          `DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${role}') THEN CREATE ROLE ${role}; END IF; END $$`,
        );
        const login = verifier === null ? 'NOLOGIN PASSWORD NULL' : `LOGIN PASSWORD '${verifier}'`;
        await tx.unsafe(
          `ALTER ROLE ${role} WITH ${login} NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT`,
        );
      }
      await tx.unsafe(`ALTER ROLE ${ROLES.readonlyOps} SET default_transaction_read_only = on`);
      await tx.unsafe(`ALTER ROLE ${ROLES.readonlyOps} SET log_statement = 'all'`);
      const roles = Object.values(ROLES).join(', ');
      // CREATE on the database lets wf_migrate create the migrator's bookkeeping schema `drizzle`; CREATE on `public`
      // lets it create the tables it then owns. The other roles get no CREATE privilege.
      await tx.unsafe(`DO $$ BEGIN
        EXECUTE format('GRANT CONNECT ON DATABASE %I TO ${roles}', current_database());
        EXECUTE format('GRANT CREATE ON DATABASE %I TO ${ROLES.migrate}', current_database());
      END $$`);
      await tx.unsafe(`GRANT CREATE ON SCHEMA public TO ${ROLES.migrate}`);
    });
  } finally {
    await client.end();
  }
}
