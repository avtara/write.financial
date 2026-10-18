// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `init`: the one-shot container that runs before web and worker on every `docker compose up`.
 * 1. Generates the missing secrets in `WF_SECRETS_DIR` (src/secrets.ts) and, the first time, tells the operator to
 *    back up the KEK.
 * 2. Validates the web/worker configuration, so a bad `.env` fails here instead of in a restart loop.
 * 3. Waits for PostgreSQL, creates/updates the database roles as the superuser (`POSTGRES_USER`, default `postgres`,
 *    with `POSTGRES_PASSWORD`), and applies pending migrations as `wf_migrate`.
 * 4. While the first-run setup is pending, prints the setup URL with the one-time setup token, on every run. This is
 *    the one secret init shows: the operator needs it to open the setup wizard. Once setup is done, nothing is shown.
 */
import path from 'node:path';
import { loadConfig } from '@wf/config';
import { ROLES, type RolePasswords } from '@wf/db/roles';
import { postgresUrl, requiredSetting, secretsEnv, superuserLogin, type Env } from './env.ts';
import { AUTH_SECRET, ensureSecrets, KEK, readRolePasswords, readSecret, SETUP_TOKEN } from './secrets.ts';

export interface Output {
  log(message: string): void;
  error(message: string): void;
}

export interface InitDeps {
  /** `bootstrapRoles` from `@wf/db/roles`. */
  readonly bootstrapRoles: (superuserUrl: string, passwords: RolePasswords) => Promise<void>;
  /** `migrate` from `@wf/db/migrate`. */
  readonly migrate: (migrateUrl: string) => Promise<void>;
  /** `setTimeout` from `node:timers/promises`. */
  readonly sleep: (ms: number) => Promise<unknown>;
  /** `isSetupPending` from `@wf/db/setup-status`. */
  readonly setupPending: (migrateUrl: string) => Promise<boolean>;
  readonly output: Output;
}

/** How long `init` waits for PostgreSQL to accept connections: attempts × delay = 2 minutes. */
export const DB_WAIT = { attempts: 60, delayMs: 2_000 };

/** Error codes that mean "PostgreSQL is not reachable yet" (container starting, DNS not ready, still in recovery). */
const NOT_READY: Record<string, true> = {
  ECONNREFUSED: true,
  ECONNRESET: true,
  ENOTFOUND: true,
  EAI_AGAIN: true,
  ETIMEDOUT: true,
  CONNECT_TIMEOUT: true,
  '57P03': true,
};

export function kekNotice(kekFile: string): string {
  const rule = '='.repeat(100);
  return [
    rule,
    'IMPORTANT: a new key-encryption key (KEK) was generated. Back it up NOW.',
    '',
    `It is stored in ${kekFile} in the secrets volume. Every encrypted value (2FA secrets, notes,`,
    'attachments, connected-account tokens) depends on it: if the volume is lost and you have no copy of',
    'the KEK, that data is gone for good and nobody can recover it. Copy it, and the auth secret next to it',
    '(without it, two-step sign-in fails after a restore), to two safe offline places:',
    '',
    `  docker compose cp web:${kekFile} ./write-financial-kek.backup && chmod 600 ./write-financial-kek.backup`,
    `  docker compose cp web:${path.join(path.dirname(kekFile), AUTH_SECRET)} ./write-financial-auth-secret.backup && chmod 600 ./write-financial-auth-secret.backup`,
    '',
    'Neither is part of the backups (docs/self-host/backup.md); do not store them next to the backups. This notice is',
    'shown only once.',
    rule,
  ].join('\n');
}

export function setupNotice(setupUrl: string): string {
  const rule = '='.repeat(100);
  return [
    rule,
    'First-run setup is pending. Open this URL to create the admin account and configure the instance:',
    '',
    `  ${setupUrl}`,
    '',
    'Keep it private: whoever opens it first can set up this instance. It is shown on every start until setup is',
    'complete.',
    rule,
  ].join('\n');
}

/** Runs `init` and returns the process exit code: 0 done, 1 failed. */
export async function runInit(env: Env, deps: InitDeps): Promise<number> {
  const { output } = deps;
  try {
    const dir = requiredSetting(env, 'WF_SECRETS_DIR', 'init');
    const superuser = superuserLogin(env, 'init');

    const created = await ensureSecrets(dir);
    output.log(
      created.length === 0
        ? `Secrets: using the existing ones in ${dir}.`
        : `Secrets: generated ${created.join(', ')}.`,
    );
    if (created.includes(KEK)) output.log(kekNotice(path.join(dir, KEK)));

    const config = loadConfig({ ...env, ...(await secretsEnv(env)) });

    const passwords = await readRolePasswords(dir);
    const superuserUrl = postgresUrl(env, superuser.user, superuser.password);
    for (let attempt = 1; ; attempt++) {
      try {
        await deps.bootstrapRoles(superuserUrl, passwords);
        break;
      } catch (error) {
        const notReady = error instanceof Error && 'code' in error && NOT_READY[String(error.code)] === true;
        if (attempt === DB_WAIT.attempts || !notReady) throw error;
        if (attempt === 1) output.log('Waiting for PostgreSQL…');
        await deps.sleep(DB_WAIT.delayMs);
      }
    }
    output.log(`Database roles ${Object.values(ROLES).join(', ')} are up to date.`);
    const migrateUrl = postgresUrl(env, ROLES.migrate, passwords.migrate);
    await deps.migrate(migrateUrl);
    output.log('Migrations are up to date.');
    if (await deps.setupPending(migrateUrl)) {
      const token = await readSecret(path.join(dir, SETUP_TOKEN));
      output.log(setupNotice(`${config.publicUrl.replace(/\/$/, '')}/setup?token=${encodeURIComponent(token)}`));
    }
    output.log('init is done.');
    return 0;
  } catch (error) {
    output.error(`init failed: ${String(error)}`);
    return 1;
  }
}
