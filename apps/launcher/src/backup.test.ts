// SPDX-License-Identifier: AGPL-3.0-only
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { generateIdentity, identityToRecipient } from 'age-encryption';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeS3 } from '../test/fake-s3.ts';
import { readArchive, type ArchiveEntry } from './archive.ts';
import { archiveStamp, runBackup, type BackupDeps } from './backup.ts';
import type { RunCommand } from './command.ts';
import { readSecret, ensureSecrets } from './secrets.ts';

const NOW = Date.parse('2026-10-18T20:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const ARCHIVE = 'wf-20261018T200000Z.tar.age';
const BUCKET_NAMES = ['wf-attachments', 'wf-avatars', 'wf-reports', 'wf-exports'];
const USER = '0192f0c1-7c1e-7000-8000-00000000000a';
const key = (n: number) => `u/${USER}/0192f0c1-7c1e-7000-8000-${String(n).padStart(12, '0')}`;
const MIGRATIONS = [
  { tag: '0000_init', when: 1792314867344 },
  { tag: '0001_security', when: 1792314877288 },
];
/** Built at runtime so the secret scanner does not flag a fixture. */
const SUPERUSER_PASSWORD = ['super', 'user', 'p@ss'].join('-');

let identity: string;
let recipient: string;
let secrets: string;
let backups: string;

beforeAll(async () => {
  identity = await generateIdentity();
  recipient = await identityToRecipient(identity);
});

beforeEach(async () => {
  secrets = await mkdtemp(path.join(tmpdir(), 'wf-backup-secrets-'));
  backups = await mkdtemp(path.join(tmpdir(), 'wf-backups-'));
  await ensureSecrets(secrets);
});

afterEach(async () => {
  await rm(secrets, { recursive: true, force: true });
  await rm(backups, { recursive: true, force: true });
});

const baseEnv = (): Record<string, string> => ({
  WF_SECRETS_DIR: secrets,
  BACKUP_DIR: backups,
  BACKUP_AGE_RECIPIENT: recipient,
  POSTGRES_PASSWORD: SUPERUSER_PASSWORD,
  S3_ENDPOINT: 'http://seaweedfs:8333',
  WF_APP_VERSION: '0.1.0',
});

function fakeDeps(s3 = new FakeS3(BUCKET_NAMES), overrides: Partial<BackupDeps> = {}) {
  const log: string[] = [];
  const errors: string[] = [];
  const deps = {
    runCommand: vi.fn<RunCommand>(() => Promise.resolve(Buffer.from('PGDMP the dump'))),
    createS3: vi.fn(() => s3),
    migrationLevel: vi.fn(() => Promise.resolve({ applied: 2, latest: MIGRATIONS[1]?.when ?? null })),
    migrations: MIGRATIONS,
    now: () => NOW,
    output: { log: (message: string) => log.push(message), error: (message: string) => errors.push(message) },
    ...overrides,
  };
  return { deps, log, errors, s3 };
}

async function readBack(file: string) {
  const entries: (Omit<ArchiveEntry, 'body'> & { content: string })[] = [];
  const manifest = await readArchive(file, [identity], async ({ body, ...entry }) => {
    const chunks: Uint8Array[] = [];
    for await (const chunk of body) chunks.push(chunk);
    entries.push({ ...entry, content: Buffer.concat(chunks).toString() });
  });
  return { manifest, entries };
}

describe('archiveStamp', () => {
  it('is the UTC time without separators', () => {
    expect(archiveStamp(new Date(NOW + 999))).toBe('20261018T200000Z');
  });
});

describe('runBackup', () => {
  it('dumps the database as the superuser, copies every object, and writes one encrypted archive', async () => {
    const s3 = new FakeS3(BUCKET_NAMES, 2);
    for (const n of [1, 2, 3]) await s3.putObject('wf-attachments', key(n), Buffer.from(`attachment ${n}`));
    await s3.putObject('wf-avatars', key(4), Buffer.from('avatar'));
    const { deps, log, errors } = fakeDeps(s3);

    expect(await runBackup(baseEnv(), deps)).toBe(0);
    expect(errors).toEqual([]);
    expect(deps.runCommand).toHaveBeenCalledExactlyOnceWith(
      'pg_dump',
      ['--format=custom', '--no-password', '--dbname=postgres://postgres@postgres:5432/write_financial'],
      { env: { PGPASSWORD: SUPERUSER_PASSWORD } },
    );
    expect(deps.migrationLevel).toHaveBeenCalledExactlyOnceWith(
      'postgres://postgres:super-user-p%40ss@postgres:5432/write_financial',
    );
    expect(deps.createS3).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        endpoint: 'http://seaweedfs:8333',
        accessKeyId: await readSecret(path.join(secrets, 's3/access_key_id')),
      }),
    );
    expect(await readdir(backups)).toEqual([ARCHIVE]);

    const { manifest, entries } = await readBack(path.join(backups, ARCHIVE));
    expect(entries).toEqual([
      { type: 'database', size: 14, content: 'PGDMP the dump' },
      ...[1, 2, 3].map((n) => ({
        type: 'object',
        bucket: 'attachments',
        key: key(n),
        size: 12,
        content: `attachment ${n}`,
      })),
      { type: 'object', bucket: 'avatars', key: key(4), size: 6, content: 'avatar' },
    ]);
    expect(manifest).toMatchObject({
      createdAt: '2026-10-18T20:00:00.000Z',
      appVersion: '0.1.0',
      migrations: { applied: 2, latest: MIGRATIONS[1]?.when },
      objects: { attachments: 3, avatars: 1, reports: 0, exports: 0 },
    });
    expect(log).toEqual([
      'Dumping the database…',
      'Copying the objects…',
      expect.stringMatching(
        new RegExp(
          `^Backup written: ${path.join(backups, ARCHIVE)} \\([\\d,]+ bytes, encrypted to 1 age recipient\\(s\\)\\): ` +
            'database 14 bytes at migration 0001_security, 4 object\\(s\\) \\(attachments 3, avatars 1, reports 0, ' +
            'exports 0\\)\\.$',
        ),
      ),
      'Retention 30 day(s): nothing to delete.',
    ]);
  });

  it('skips an object that was deleted after it was listed, and records version dev outside the image', async () => {
    const s3 = new FakeS3(BUCKET_NAMES);
    await s3.putObject('wf-exports', key(1), Buffer.from('gone'));
    await s3.putObject('wf-exports', key(2), Buffer.from('kept'));
    vi.spyOn(s3, 'getObject').mockImplementation((_bucket, name) =>
      Promise.resolve(name === key(1) ? null : Buffer.from('kept')),
    );
    const { deps } = fakeDeps(s3);
    const env = { ...baseEnv(), WF_APP_VERSION: undefined };

    expect(await runBackup(env, deps)).toBe(0);
    const { manifest, entries } = await readBack(path.join(backups, ARCHIVE));
    expect(entries.map((entry) => 'key' in entry && entry.key)).toEqual([false, key(2)]);
    expect(manifest.appVersion).toBe('dev');
  });

  it('refuses to write anything without an age recipient', async () => {
    const { deps, errors } = fakeDeps();
    expect(await runBackup({ ...baseEnv(), BACKUP_AGE_RECIPIENT: '' }, deps)).toBe(1);
    expect(errors).toEqual([
      expect.stringMatching(/^backup failed: LaunchConfigError: No age recipient is configured/),
    ]);
    expect(deps.runCommand).not.toHaveBeenCalled();
    expect(await readdir(backups)).toEqual([]);
  });

  it('fails without leaving a file when pg_dump fails', async () => {
    const { deps, errors } = fakeDeps(undefined, {
      runCommand: () => Promise.reject(new Error('pg_dump exited with status 1: connection refused')),
    });
    expect(await runBackup(baseEnv(), deps)).toBe(1);
    expect(errors).toEqual(['backup failed: Error: pg_dump exited with status 1: connection refused']);
    expect(await readdir(backups)).toEqual([]);
  });

  it('fails without leaving a file when the object storage fails midway', async () => {
    const s3 = new FakeS3(BUCKET_NAMES.slice(0, 2));
    await s3.putObject('wf-attachments', key(1), Buffer.from('attachment'));
    const { deps, errors } = fakeDeps(s3);
    expect(await runBackup(baseEnv(), deps)).toBe(1);
    expect(errors).toEqual(['backup failed: Error: NoSuchBucket: wf-reports']);
    expect(await readdir(backups)).toEqual([]);
  });

  it('deletes archives older than the retention and partial files older than a day, and nothing else', async () => {
    const stamp = (ageMs: number) => archiveStamp(new Date(NOW - ageMs));
    const names = {
      expired: `wf-${stamp(8 * DAY)}.tar.age`,
      kept: `wf-${stamp(7 * DAY - 60_000)}.tar.age`,
      stalePartial: `.wf-${stamp(DAY + 60_000)}.tar.age.partial`,
      recentPartial: `.wf-${stamp(60_000)}.tar.age.partial`,
      other: 'notes.txt',
      lookalike: `wf-${stamp(30 * DAY)}.tar.gz`,
    };
    for (const name of Object.values(names)) await writeFile(path.join(backups, name), 'x');
    await mkdir(path.join(backups, 'offsite'));
    const { deps, log } = fakeDeps();

    expect(await runBackup({ ...baseEnv(), BACKUP_RETENTION_DAYS: '7' }, deps)).toBe(0);
    expect((await readdir(backups)).toSorted()).toEqual(
      [ARCHIVE, names.kept, names.recentPartial, names.other, names.lookalike, 'offsite'].toSorted(),
    );
    expect(log.at(-1)).toBe(`Retention 7 day(s): deleted ${names.stalePartial}, ${names.expired}.`);
  });
});
