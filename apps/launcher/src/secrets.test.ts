// SPDX-License-Identifier: AGPL-3.0-only
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { KeyringError, loadKeyring } from '@wf/crypto/keyring';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AUTH_SECRET,
  dbPassword,
  ensureSecrets,
  KEK,
  readRolePasswords,
  readSecret,
  S3_ACCESS_KEY_ID,
  S3_SECRET_ACCESS_KEY,
  SecretFileError,
  SECRETS,
  VALKEY_PASSWORD,
} from './secrets.ts';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'wf-secrets-'));
});

afterEach(async () => {
  await chmod(dir, 0o700);
  await rm(dir, { recursive: true, force: true });
});

const contents = async (): Promise<Record<string, string>> =>
  Object.fromEntries(
    await Promise.all(SECRETS.map(async (name) => [name, await readFile(path.join(dir, name), 'utf8')] as const)),
  );

describe('SECRETS', () => {
  it('lists the KEK, the auth secret, the setup token, one password per database role, Valkey, and the S3 identity', () => {
    expect(SECRETS).toEqual([
      KEK,
      AUTH_SECRET,
      'setup-token',
      'postgres/wf_app',
      'postgres/wf_worker',
      'postgres/wf_migrate',
      'postgres/wf_auth',
      'postgres/wf_readonly_ops',
      VALKEY_PASSWORD,
      S3_ACCESS_KEY_ID,
      S3_SECRET_ACCESS_KEY,
    ]);
    expect(dbPassword('wf_app')).toBe('postgres/wf_app');
  });
});

describe('ensureSecrets', () => {
  it('creates every secret with mode 0600 in directories with mode 0700', async () => {
    expect(await ensureSecrets(dir)).toEqual(SECRETS);
    for (const name of SECRETS) {
      expect((await stat(path.join(dir, name))).mode & 0o777, name).toBe(0o600);
    }
    for (const sub of ['postgres', 'valkey', 's3']) {
      expect((await stat(path.join(dir, sub))).mode & 0o777, sub).toBe(0o700);
    }
  });

  it('generates a loadable KEK and distinct 256-bit base64url values for the rest', async () => {
    await ensureSecrets(dir);
    expect((await loadKeyring(path.join(dir, KEK))).activeVersion).toBe(1);
    const values = Object.entries(await contents())
      .filter(([name]) => name !== KEK)
      .map(([, value]) => value);
    for (const value of values) {
      expect(value).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(Buffer.from(value, 'base64url')).toHaveLength(32);
    }
    expect(new Set(values).size).toBe(values.length);
  });

  it('never overwrites existing secrets and only fills in missing ones', async () => {
    await ensureSecrets(dir);
    const before = await contents();
    expect(await ensureSecrets(dir)).toEqual([]);
    expect(await contents()).toEqual(before);

    await rm(path.join(dir, VALKEY_PASSWORD));
    expect(await ensureSecrets(dir)).toEqual([VALKEY_PASSWORD]);
    const after = await contents();
    expect(after[VALKEY_PASSWORD]).not.toBe(before[VALKEY_PASSWORD]);
    expect({ ...after, [VALKEY_PASSWORD]: '' }).toEqual({ ...before, [VALKEY_PASSWORD]: '' });
  });

  it('refuses an existing secret that group or other users can read, without printing it', async () => {
    await ensureSecrets(dir);
    const file = path.join(dir, AUTH_SECRET);
    const value = await readFile(file, 'utf8');
    await chmod(file, 0o640);
    const error = await ensureSecrets(dir).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(SecretFileError);
    expect(error).toHaveProperty('name', 'SecretFileError');
    expect(String(error)).toContain(`mode 640); run: chmod 600 ${file}`);
    expect(String(error)).not.toContain(value);
  });

  it('refuses an empty existing secret', async () => {
    await mkdir(path.join(dir, 's3'), { mode: 0o700 });
    await writeFile(path.join(dir, S3_ACCESS_KEY_ID), '', { mode: 0o600 });
    await expect(ensureSecrets(dir)).rejects.toThrow(
      new SecretFileError(`Secret file ${path.join(dir, S3_ACCESS_KEY_ID)} is empty; delete it and run init again`),
    );
  });

  it('checks an existing KEK like the keyring does', async () => {
    await writeFile(path.join(dir, KEK), 'not a key\n', { mode: 0o600 });
    await expect(ensureSecrets(dir)).rejects.toThrow(KeyringError);
  });

  it('passes on errors other than "already exists"', async () => {
    await chmod(dir, 0o500);
    await expect(ensureSecrets(dir)).rejects.toThrow(/EACCES/);
  });
});

describe('readSecret', () => {
  it('drops exactly one trailing newline', async () => {
    const file = path.join(dir, 'secret');
    await writeFile(file, 'value\r\n');
    expect(await readSecret(file)).toBe('value');
    await writeFile(file, 'value\n\n');
    expect(await readSecret(file)).toBe('value\n');
  });

  it('rejects a file that holds only a newline', async () => {
    const file = path.join(dir, 'secret');
    await writeFile(file, '\n');
    await expect(readSecret(file)).rejects.toThrow(SecretFileError);
  });
});

describe('readRolePasswords', () => {
  it('reads the password of every database role', async () => {
    await ensureSecrets(dir);
    const password = (role: string) => readFile(path.join(dir, 'postgres', role), 'utf8');
    expect(await readRolePasswords(dir)).toEqual({
      app: await password('wf_app'),
      worker: await password('wf_worker'),
      auth: await password('wf_auth'),
      migrate: await password('wf_migrate'),
      readonlyOps: await password('wf_readonly_ops'),
    });
  });
});
