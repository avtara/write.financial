// SPDX-License-Identifier: AGPL-3.0-only
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { wrapDek, generateDek } from '@wf/crypto/envelope';
import { parseKeyring } from '@wf/crypto/keyring';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testKeyring } from '../test/keys.ts';
import { insertUser, startPglite, PGLITE_HOOK_TIMEOUT, type PgliteServer } from '../test/pglite.ts';
import { INSTANCE_KEY_OWNER } from './user-keys.ts';
import { run, type Output } from './run.ts';

let pglite: PgliteServer;
let dir: string;
let env: Record<string, string>;
const keys = testKeyring(2);

beforeAll(async () => {
  pglite = await startPglite();
  dir = mkdtempSync(path.join(tmpdir(), 'wf-db-cli-'));
  const kekFile = path.join(dir, 'kek');
  writeFileSync(kekFile, keys.text, { mode: 0o600 });
  const host = new URL(pglite.url).host;
  const role = (user: string, password: string) => `postgres://${user}:${password}@${host}/postgres`;
  env = {
    PUBLIC_URL: 'http://localhost:3000',
    DATABASE_URL: role('wf_app', 'app-pw'),
    DATABASE_URL_WORKER: role('wf_worker', 'worker-pw'),
    DATABASE_URL_AUTH: role('wf_auth', 'auth%20pw'),
    DATABASE_URL_MIGRATE: role('wf_migrate', 'migrate-pw'),
    DATABASE_URL_SUPERUSER: pglite.url,
    REDIS_URL: 'redis://127.0.0.1:6379/0',
    S3_ENDPOINT: 'http://127.0.0.1:8333',
    S3_ACCESS_KEY_ID: 'access',
    S3_SECRET_ACCESS_KEY: 'secret',
    KEK_FILE: kekFile,
    AUTH_SECRET: randomBytes(32).toString('hex'),
  };
}, PGLITE_HOOK_TIMEOUT);

afterAll(async () => {
  await pglite.close();
  rmSync(dir, { recursive: true, force: true });
});

function capture(): Output & { logs: string[]; errors: string[] } {
  const logs: string[] = [];
  const errors: string[] = [];
  return { logs, errors, log: (m) => logs.push(m), error: (m) => errors.push(m) };
}

const without = (key: string) => Object.fromEntries(Object.entries(env).filter(([k]) => k !== key));

describe('run', () => {
  it('prints usage for an unknown command', async () => {
    const out = capture();
    expect(await run(['drop-everything'], env, out)).toBe(2);
    expect(out.errors).toEqual(['Usage: wf-db <bootstrap|migrate|rewrap-keys>']);
  });

  it('reports invalid configuration by key, without values', async () => {
    const out = capture();
    expect(await run(['migrate'], without('DATABASE_URL'), out)).toBe(1);
    expect(out.errors.join('\n')).toContain('DATABASE_URL');
    expect(out.errors.join('\n')).not.toContain(env.AUTH_SECRET);
  });

  it.each([
    ['bootstrap', 'DATABASE_URL_SUPERUSER'],
    ['bootstrap', 'DATABASE_URL_MIGRATE'],
    ['migrate', 'DATABASE_URL_MIGRATE'],
    ['rewrap-keys', 'DATABASE_URL_MIGRATE'],
  ])('%s requires %s', async (command, key) => {
    const out = capture();
    expect(await run([command], without(key), out)).toBe(1);
    expect(out.errors).toEqual([`Error: ${key} is required for ${command}`]);
  });

  it('bootstrap refuses a role URL that logs in as another user', async () => {
    const out = capture();
    const worker = env.DATABASE_URL_WORKER?.replace('wf_worker', 'postgres') ?? '';
    expect(await run(['bootstrap'], { ...env, DATABASE_URL_WORKER: worker }, out)).toBe(1);
    expect(out.errors).toEqual(['Error: DATABASE_URL_WORKER must log in as wf_worker']);
  });

  it('bootstrap creates the roles from the role URLs', async () => {
    const out = capture();
    expect(await run(['bootstrap'], env, out)).toBe(0);
    expect(out.logs).toEqual(['Roles wf_app, wf_worker, wf_migrate, wf_auth, wf_readonly_ops are up to date.']);
    const roles = await pglite.query<{ rolname: string; rolcanlogin: boolean }>(
      `SELECT rolname, rolcanlogin FROM pg_roles WHERE rolname LIKE 'wf\\_%' ORDER BY rolname`,
    );
    expect(roles).toEqual([
      { rolname: 'wf_app', rolcanlogin: true },
      { rolname: 'wf_auth', rolcanlogin: true },
      { rolname: 'wf_migrate', rolcanlogin: true },
      { rolname: 'wf_readonly_ops', rolcanlogin: false },
      { rolname: 'wf_worker', rolcanlogin: true },
    ]);
    const withOps = { ...env, DATABASE_URL_READONLY_OPS: env.DATABASE_URL?.replace('wf_app', 'wf_readonly_ops') ?? '' };
    expect(await run(['bootstrap'], withOps, capture())).toBe(0);
    expect(await pglite.query(`SELECT rolcanlogin FROM pg_roles WHERE rolname = 'wf_readonly_ops'`)).toEqual([
      { rolcanlogin: true },
    ]);
  });

  it('migrate applies the migrations', async () => {
    const out = capture();
    await pglite.pg.exec('SET ROLE wf_migrate');
    try {
      expect(await run(['migrate'], env, out)).toBe(0);
    } finally {
      await pglite.pg.exec('RESET ROLE');
    }
    expect(out.logs).toEqual(['Migrations are up to date.']);
    expect(await pglite.query(`SELECT to_regclass('public.user_keys') IS NOT NULL AS exists`)).toEqual([
      { exists: true },
    ]);
  });

  it('rewrap-keys re-wraps user and instance keys with the newest KEK', async () => {
    const v1 = parseKeyring(keys.text.split('\n')[0] ?? '');
    const userId = await insertUser(pglite, 'rotate@example.test');
    await pglite.query('INSERT INTO user_keys (user_id, dek_wrapped, kek_version) VALUES ($1, $2, 1)', [
      userId,
      wrapDek(generateDek(), v1, userId),
    ]);
    await pglite.query('UPDATE instance_settings SET instance_dek_wrapped = $1', [
      wrapDek(generateDek(), v1, INSTANCE_KEY_OWNER),
    ]);
    await pglite.pg.exec('SET ROLE wf_migrate');
    try {
      const first = capture();
      expect(await run(['rewrap-keys'], env, first)).toBe(0);
      expect(first.logs).toEqual(['Re-wrapped 1 user key(s) and the instance key with KEK v2.']);
      const second = capture();
      expect(await run(['rewrap-keys'], env, second)).toBe(0);
      expect(second.logs).toEqual(['Re-wrapped 0 user key(s) with KEK v2.']);
    } finally {
      await pglite.pg.exec('RESET ROLE');
    }
  });

  it('rewrap-keys reports a KEK file that cannot be read', async () => {
    const out = capture();
    expect(await run(['rewrap-keys'], { ...env, KEK_FILE: path.join(dir, 'missing') }, out)).toBe(1);
    expect(out.errors[0]).toMatch(/ENOENT/);
  });
});
