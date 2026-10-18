// SPDX-License-Identifier: AGPL-3.0-only
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadConfig } from '@wf/config';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LaunchConfigError, postgresUrl, secretsEnv, setting } from './env.ts';
import { ensureSecrets, SecretFileError, VALKEY_PASSWORD } from './secrets.ts';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'wf-env-'));
  await ensureSecrets(dir);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const secret = (name: string) => readFile(path.join(dir, name), 'utf8');

describe('setting', () => {
  it('treats empty values as unset', () => {
    expect(setting({ A: '' }, 'A')).toBeUndefined();
    expect(setting({}, 'A')).toBeUndefined();
    expect(setting({ A: 'x' }, 'A')).toBe('x');
  });
});

describe('postgresUrl', () => {
  it('uses the compose service and database by default and percent-encodes the parts', () => {
    expect(postgresUrl({}, 'post gres', 'p@ss:w/rd')).toBe(
      'postgres://post%20gres:p%40ss%3Aw%2Frd@postgres:5432/write_financial',
    );
    expect(postgresUrl({ WF_DATABASE_HOST: 'db.internal:6543', WF_DATABASE_NAME: 'wf prod' }, 'wf_app', 'x')).toBe(
      'postgres://wf_app:x@db.internal:6543/wf%20prod',
    );
  });
});

describe('secretsEnv', () => {
  it('derives nothing without WF_SECRETS_DIR', async () => {
    expect(await secretsEnv({ DATABASE_URL: 'postgres://u:p@h/d' })).toEqual({});
    expect(await secretsEnv({ WF_SECRETS_DIR: '' })).toEqual({});
  });

  it('points the file secrets at the volume and composes the URLs from the role passwords', async () => {
    const env = await secretsEnv({ WF_SECRETS_DIR: dir });
    expect(Object.keys(env).sort()).toEqual([
      'AUTH_SECRET_FILE',
      'DATABASE_URL',
      'DATABASE_URL_AUTH',
      'DATABASE_URL_WORKER',
      'KEK_FILE',
      'REDIS_URL',
      'S3_ACCESS_KEY_ID_FILE',
      'S3_SECRET_ACCESS_KEY_FILE',
    ]);
    expect(env).toMatchObject({
      KEK_FILE: path.join(dir, 'kek'),
      AUTH_SECRET_FILE: path.join(dir, 'auth_secret'),
      S3_ACCESS_KEY_ID_FILE: path.join(dir, 's3/access_key_id'),
      S3_SECRET_ACCESS_KEY_FILE: path.join(dir, 's3/secret_access_key'),
      REDIS_URL: `redis://:${await secret(VALKEY_PASSWORD)}@valkey:6379/0`,
      DATABASE_URL: `postgres://wf_app:${await secret('postgres/wf_app')}@postgres:5432/write_financial`,
      DATABASE_URL_WORKER: `postgres://wf_worker:${await secret('postgres/wf_worker')}@postgres:5432/write_financial`,
      DATABASE_URL_AUTH: `postgres://wf_auth:${await secret('postgres/wf_auth')}@postgres:5432/write_financial`,
    });
  });

  it('honours custom hosts and percent-encodes passwords an operator replaced', async () => {
    await writeFile(path.join(dir, VALKEY_PASSWORD), 'a/b@c\n');
    const env = await secretsEnv({ WF_SECRETS_DIR: dir, WF_REDIS_HOST: 'cache:6380', WF_DATABASE_HOST: 'db:5433' });
    expect(env.REDIS_URL).toBe('redis://:a%2Fb%40c@cache:6380/0');
    expect(env.DATABASE_URL).toMatch(/^postgres:\/\/wf_app:[^@]+@db:5433\/write_financial$/);
  });

  it('yields an environment @wf/config accepts', async () => {
    const env = { WF_SECRETS_DIR: dir, PUBLIC_URL: 'https://localhost', S3_ENDPOINT: 'http://seaweedfs:8333' };
    const config = loadConfig({ ...env, ...(await secretsEnv(env)) });
    expect(config.db.appUrl).toContain('wf_app:');
    expect(config.db.migrateUrl).toBeNull();
    expect(config.auth.secret).toBe(await secret('auth_secret'));
    expect(config.s3.accessKeyId).toBe(await secret('s3/access_key_id'));
    expect(config.crypto.kekFile).toBe(path.join(dir, 'kek'));
  });

  it('refuses settings that the secrets volume provides, naming them all', async () => {
    const env = {
      WF_SECRETS_DIR: dir,
      DATABASE_URL: 'postgres://u:p@h/d',
      AUTH_SECRET_FILE: '/x',
      KEK_FILE: '',
      REDIS_URL: '',
    };
    await expect(secretsEnv(env)).rejects.toThrow(
      new LaunchConfigError(
        'WF_SECRETS_DIR provides these settings, so unset them and their _FILE form: AUTH_SECRET, DATABASE_URL',
      ),
    );
    await expect(secretsEnv(env)).rejects.toHaveProperty('name', 'LaunchConfigError');
  });

  it('fails on an empty secret file', async () => {
    await writeFile(path.join(dir, 'postgres/wf_auth'), '');
    await expect(secretsEnv({ WF_SECRETS_DIR: dir })).rejects.toThrow(SecretFileError);
  });
});
