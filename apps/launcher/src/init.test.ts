// SPDX-License-Identifier: AGPL-3.0-only
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { RolePasswords } from '@wf/db/roles';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DB_WAIT, kekNotice, runInit, setupNotice, type InitDeps } from './init.ts';
import { SECRETS } from './secrets.ts';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'wf-init-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** Built at runtime so the secret scanner does not flag a fixture. */
const SUPERUSER_PASSWORD = ['super', 'user', 'p@ss'].join('-');

const baseEnv = () => ({
  WF_SECRETS_DIR: dir,
  POSTGRES_PASSWORD: SUPERUSER_PASSWORD,
  PUBLIC_URL: 'https://localhost',
  S3_ENDPOINT: 'http://seaweedfs:8333',
});

function fakeDeps(bootstrapRoles: InitDeps['bootstrapRoles'] = () => Promise.resolve()) {
  const log: string[] = [];
  const errors: string[] = [];
  const deps = {
    bootstrapRoles: vi.fn(bootstrapRoles),
    migrate: vi.fn<InitDeps['migrate']>(() => Promise.resolve()),
    sleep: vi.fn(() => Promise.resolve()),
    setupPending: vi.fn<InitDeps['setupPending']>(() => Promise.resolve(true)),
    output: { log: (message: string) => log.push(message), error: (message: string) => errors.push(message) },
  };
  return { deps, log, errors };
}

const secret = (name: string) => readFile(path.join(dir, name), 'utf8');

function codeError(code: string): Error {
  return Object.assign(new Error(`connect ${code}`), { code });
}

describe('runInit', () => {
  it('generates the secrets, shows the KEK notice once, bootstraps the roles, migrates, and shows the setup URL', async () => {
    const { deps, log, errors } = fakeDeps();
    expect(await runInit(baseEnv(), deps)).toBe(0);
    expect(errors).toEqual([]);
    expect(log).toEqual([
      `Secrets: generated ${SECRETS.join(', ')}.`,
      kekNotice(path.join(dir, 'kek')),
      'Database roles wf_app, wf_worker, wf_migrate, wf_auth, wf_readonly_ops are up to date.',
      'Migrations are up to date.',
      setupNotice(`https://localhost/setup?token=${await secret('setup-token')}`),
      'init is done.',
    ]);
    const passwords: RolePasswords = {
      app: await secret('postgres/wf_app'),
      worker: await secret('postgres/wf_worker'),
      auth: await secret('postgres/wf_auth'),
      migrate: await secret('postgres/wf_migrate'),
      readonlyOps: await secret('postgres/wf_readonly_ops'),
    };
    expect(deps.bootstrapRoles).toHaveBeenCalledExactlyOnceWith(
      'postgres://postgres:super-user-p%40ss@postgres:5432/write_financial',
      passwords,
    );
    expect(deps.migrate).toHaveBeenCalledExactlyOnceWith(
      `postgres://wf_migrate:${passwords.migrate}@postgres:5432/write_financial`,
    );
    expect(deps.setupPending).toHaveBeenCalledExactlyOnceWith(deps.migrate.mock.calls[0]?.[0]);
    expect(deps.sleep).not.toHaveBeenCalled();

    const output = log.join('\n');
    for (const name of SECRETS.filter((secretName) => secretName !== 'setup-token')) {
      const value = await secret(name);
      expect(output, name).not.toContain(name === 'kek' ? (value.split('v1:')[1] ?? '') : value);
    }
  });

  it('shows the setup URL on every start while setup is pending, and never once it is complete', async () => {
    await runInit(baseEnv(), fakeDeps().deps);
    const token = await secret('setup-token');
    const pending = fakeDeps();
    expect(await runInit({ ...baseEnv(), PUBLIC_URL: 'https://example.test/finance/' }, pending.deps)).toBe(0);
    expect(pending.log).toContain(setupNotice(`https://example.test/finance/setup?token=${token}`));

    const done = fakeDeps();
    done.deps.setupPending.mockResolvedValueOnce(false);
    expect(await runInit(baseEnv(), done.deps)).toBe(0);
    expect(done.log.join('\n')).not.toContain('setup');
    expect(done.log.join('\n')).not.toContain(token);
    expect(done.log.at(-1)).toBe('init is done.');
  });

  it('reuses the secrets on the next start without the KEK notice', async () => {
    await runInit(baseEnv(), fakeDeps().deps);
    const { deps, log } = fakeDeps();
    expect(await runInit({ ...baseEnv(), POSTGRES_USER: 'admin' }, deps)).toBe(0);
    expect(log[0]).toBe(`Secrets: using the existing ones in ${dir}.`);
    expect(log.join('\n')).not.toContain('KEK');
    expect(await secret('setup-token')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(deps.bootstrapRoles.mock.calls[0]?.[0]).toMatch(/^postgres:\/\/admin:/);
  });

  it('requires WF_SECRETS_DIR and POSTGRES_PASSWORD', async () => {
    const { deps, errors } = fakeDeps();
    expect(await runInit({ ...baseEnv(), WF_SECRETS_DIR: '' }, deps)).toBe(1);
    expect(await runInit({ ...baseEnv(), POSTGRES_PASSWORD: undefined }, deps)).toBe(1);
    expect(errors).toEqual([
      'init failed: LaunchConfigError: WF_SECRETS_DIR is required for init',
      'init failed: LaunchConfigError: POSTGRES_PASSWORD (the PostgreSQL superuser password from .env) is required for init',
    ]);
    expect(deps.bootstrapRoles).not.toHaveBeenCalled();
  });

  it('validates the web/worker configuration before touching the database', async () => {
    const { deps, errors } = fakeDeps();
    expect(await runInit({ ...baseEnv(), PUBLIC_URL: 'ftp://x' }, deps)).toBe(1);
    expect(errors[0]).toMatch(/^init failed: ConfigError: Invalid configuration:\n {2}- PUBLIC_URL: must be a URL/);
    expect(deps.bootstrapRoles).not.toHaveBeenCalled();
  });

  it('waits while PostgreSQL is not reachable yet', async () => {
    const failures = [codeError('ECONNREFUSED'), codeError('57P03'), codeError('ENOTFOUND')];
    const { deps, log } = fakeDeps(() => {
      const failure = failures.shift();
      return failure === undefined ? Promise.resolve() : Promise.reject(failure);
    });
    expect(await runInit(baseEnv(), deps)).toBe(0);
    expect(deps.bootstrapRoles).toHaveBeenCalledTimes(4);
    expect(deps.sleep.mock.calls).toEqual([[DB_WAIT.delayMs], [DB_WAIT.delayMs], [DB_WAIT.delayMs]]);
    expect(log.filter((line) => line === 'Waiting for PostgreSQL…')).toHaveLength(1);
    expect(deps.migrate).toHaveBeenCalledOnce();
  });

  it(`gives up after ${DB_WAIT.attempts} attempts (${(DB_WAIT.attempts * DB_WAIT.delayMs) / 1000} s)`, async () => {
    const { deps, errors } = fakeDeps(() => Promise.reject(codeError('ECONNREFUSED')));
    expect(await runInit(baseEnv(), deps)).toBe(1);
    expect(deps.bootstrapRoles).toHaveBeenCalledTimes(DB_WAIT.attempts);
    expect(deps.sleep).toHaveBeenCalledTimes(DB_WAIT.attempts - 1);
    expect(errors).toEqual(['init failed: Error: connect ECONNREFUSED']);
    expect(deps.migrate).not.toHaveBeenCalled();
  });

  it.each([
    ['an error without a code', new Error('Password for wf_app must be non-empty printable ASCII')],
    ['a wrong superuser password', codeError('28P01')],
  ])('fails at once on %s', async (_, failure) => {
    const { deps, errors } = fakeDeps(() => Promise.reject(failure));
    expect(await runInit(baseEnv(), deps)).toBe(1);
    expect(deps.sleep).not.toHaveBeenCalled();
    expect(errors).toEqual([`init failed: ${String(failure)}`]);
  });

  it('fails when migrating fails', async () => {
    const { deps, errors } = fakeDeps();
    deps.migrate.mockRejectedValueOnce(new Error('migration 0003 failed'));
    expect(await runInit(baseEnv(), deps)).toBe(1);
    expect(errors).toEqual(['init failed: Error: migration 0003 failed']);
  });
});

describe('kekNotice', () => {
  it('names the file and the backup command and warns that losing the KEK loses the data', () => {
    const notice = kekNotice('/run/wf-secrets/kek');
    expect(notice).toContain('IMPORTANT: a new key-encryption key (KEK) was generated. Back it up NOW.');
    expect(notice).toContain('docker compose cp web:/run/wf-secrets/kek ./write-financial-kek.backup');
    expect(notice).toContain('docker compose cp web:/run/wf-secrets/auth_secret ./write-financial-auth-secret.backup');
    expect(notice).toContain('Neither is part of the backups');
    expect(notice).toContain('that data is gone for good');
    expect(notice.split('\n')[0]).toMatch(/^=+$/);
  });
});
