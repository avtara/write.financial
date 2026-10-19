// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Runs before the E2E web server starts (`playwright.config.ts` webServer command): a fresh instance every run.
 * - recreates the `wf_e2e` database, creates the roles, and applies every migration (`db:bootstrap` + `db:migrate`),
 *   with Postgres' `now()` on the run's clock (`clockOffsetMs` in `env.ts`),
 * - deletes the app's Valkey keys (lockout counters, rate limits, queues),
 * - creates the key-encryption key file if missing, and empties the Mailpit inbox.
 */
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { createKeyFile } from '@wf/crypto/keyring';
import { migrate } from '@wf/db/migrate';
import { bootstrapRoles } from '@wf/db/roles';
import { Redis } from 'ioredis';
import postgres from 'postgres';
import { clockOffsetMs, E2E_DATABASE, e2eEnv, MAILPIT_URL, STATE_DIR } from './env.ts';

const env = e2eEnv();
const required = (key: string): string => {
  const value = env[key];
  if (value === undefined) throw new Error(`${key} is missing from .env.example`);
  return value;
};
const password = (key: string) => decodeURIComponent(new URL(required(key)).password);

const superuser = new URL(required('DATABASE_URL_SUPERUSER'));
superuser.pathname = '/postgres';
const admin = postgres(superuser.href, { max: 1, onnotice: () => undefined });
try {
  await admin.unsafe(`DROP DATABASE IF EXISTS ${E2E_DATABASE} WITH (FORCE)`);
  await admin.unsafe(`CREATE DATABASE ${E2E_DATABASE}`);
} finally {
  await admin.end();
}
await bootstrapRoles(required('DATABASE_URL_SUPERUSER'), {
  app: password('DATABASE_URL'),
  worker: password('DATABASE_URL_WORKER'),
  auth: password('DATABASE_URL_AUTH'),
  migrate: password('DATABASE_URL_MIGRATE'),
  readonlyOps: password('DATABASE_URL_READONLY_OPS'),
});
// The server's `Date` runs at the E2E clock (`clock.ts`); Postgres must agree, or SQL comparisons against times the
// server computed break once the real date is a few days past E2E_NOW (invitations expire after 7 days by
// `expires_at > now()`). `public.now()` shadows `pg_catalog.now()` because the database's search_path lists
// pg_catalog explicitly after public; created before the migrations, so column defaults (`DEFAULT now()`) bind to it
// too. Functions that pin `search_path = pg_catalog, public` keep the real clock (none compare against the server).
const shifted = postgres(required('DATABASE_URL_SUPERUSER'), { max: 1, onnotice: () => undefined });
try {
  const offset = Math.round(clockOffsetMs());
  if (offset === 0) throw new Error('WF_E2E_CLOCK_OFFSET_MS is missing: run prepare.ts through playwright.config.ts');
  await shifted.unsafe(
    `CREATE FUNCTION public.now() RETURNS timestamptz LANGUAGE sql STABLE PARALLEL SAFE
       AS $$ SELECT pg_catalog.now() + interval '${offset} milliseconds' $$`,
  );
  await shifted.unsafe(`ALTER DATABASE ${E2E_DATABASE} SET search_path = "$user", public, pg_catalog`);
} finally {
  await shifted.end();
}
await migrate(required('DATABASE_URL_MIGRATE'));

const redis = new Redis(required('REDIS_URL'));
try {
  const keys = await redis.keys('wf:*');
  if (keys.length > 0) await redis.del(...keys);
} finally {
  redis.disconnect();
}

if (!existsSync(required('KEK_FILE'))) await createKeyFile(required('KEK_FILE'));
await fetch(`${MAILPIT_URL}/api/v1/messages`, { method: 'DELETE' });
rmSync(STATE_DIR, { recursive: true, force: true });
mkdirSync(STATE_DIR, { recursive: true });
console.log(`E2E instance prepared (database ${E2E_DATABASE}).`);
