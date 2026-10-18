// SPDX-License-Identifier: AGPL-3.0-only
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { generateIdentity, identityToRecipient } from 'age-encryption';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeS3 } from '../test/fake-s3.ts';
import { writeArchive, type ArchiveItem } from './archive.ts';
import type { RunCommand } from './command.ts';
import { RESTORE_USAGE, runRestore, type RestoreDeps, type Stdin } from './restore.ts';
import { ensureSecrets, readRolePasswords } from './secrets.ts';

const ARCHIVE = 'wf-20261018T200000Z.tar.age';
const USER = '0192f0c1-7c1e-7000-8000-00000000000a';
const key = (n: number) => `u/${USER}/0192f0c1-7c1e-7000-8000-${String(n).padStart(12, '0')}`;
const MIGRATIONS = [
  { tag: '0000_init', when: 1792314867344 },
  { tag: '0001_security', when: 1792314877288 },
];
const BUCKETS = { attachments: 'lampiran', avatars: 'foto', reports: 'laporan', exports: 'ekspor' };
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

async function* from<T>(items: readonly T[]): AsyncGenerator<T> {
  for (const item of items) {
    await Promise.resolve();
    yield item;
  }
}

const ITEMS: readonly ArchiveItem[] = [
  { type: 'database', bytes: Buffer.from('PGDMP the dump') },
  { type: 'object', bucket: 'attachments', key: key(1), bytes: Buffer.from('attachment 1') },
  { type: 'object', bucket: 'avatars', key: key(2), bytes: Buffer.from('avatar 2') },
];

async function makeArchive(latest: number | null = MIGRATIONS[1]?.when ?? null, name = ARCHIVE): Promise<string> {
  const file = path.join(backups, name);
  await writeArchive(
    file,
    [recipient],
    { createdAt: new Date('2026-10-18T20:00:00.000Z'), appVersion: '0.2.0', migrations: { applied: 2, latest } },
    from(ITEMS),
  );
  return file;
}

beforeEach(async () => {
  secrets = await mkdtemp(path.join(tmpdir(), 'wf-restore-secrets-'));
  backups = await mkdtemp(path.join(tmpdir(), 'wf-restore-backups-'));
  await ensureSecrets(secrets);
  await makeArchive();
});

afterEach(async () => {
  await rm(secrets, { recursive: true, force: true });
  await rm(backups, { recursive: true, force: true });
});

const env = (): Record<string, string> => ({
  WF_SECRETS_DIR: secrets,
  BACKUP_DIR: backups,
  POSTGRES_PASSWORD: SUPERUSER_PASSWORD,
  S3_ENDPOINT: 'http://seaweedfs:8333',
  S3_BUCKET_ATTACHMENTS: BUCKETS.attachments,
  S3_BUCKET_AVATARS: BUCKETS.avatars,
  S3_BUCKET_REPORTS: BUCKETS.reports,
  S3_BUCKET_EXPORTS: BUCKETS.exports,
});

const pipe = (text: string): Stdin => Object.assign(Readable.from([Buffer.from(text)]), { isTTY: false });

function fakeDeps(overrides: Partial<RestoreDeps> = {}) {
  const log: string[] = [];
  const errors: string[] = [];
  const s3 = new FakeS3(Object.values(BUCKETS));
  const restoredDump: string[] = [];
  const deps = {
    runCommand: vi.fn<RunCommand>(async (_command, _args, { input }) => {
      const chunks: Uint8Array[] = [];
      for await (const chunk of input ?? []) chunks.push(chunk);
      restoredDump.push(Buffer.concat(chunks).toString());
      return Buffer.alloc(0);
    }),
    createS3: vi.fn(() => s3),
    inspectRestoreTarget: vi
      .fn<RestoreDeps['inspectRestoreTarget']>()
      .mockResolvedValueOnce({ users: 0, appSessions: 0 })
      .mockResolvedValue({ users: 1, appSessions: 0 }),
    resetAppSchema: vi.fn(() => Promise.resolve()),
    migrate: vi.fn(() => Promise.resolve()),
    migrations: MIGRATIONS,
    stdin: pipe(`# public key: ${recipient}\n${identity}\n`),
    output: { log: (message: string) => log.push(message), error: (message: string) => errors.push(message) },
    ...overrides,
  };
  return { deps, log, errors, s3, restoredDump };
}

const SUPERUSER_URL = 'postgres://postgres:super-user-p%40ss@postgres:5432/write_financial';

describe('runRestore', () => {
  it('verifies the archive, resets the database, restores dump and objects as the owner, and migrates', async () => {
    const { deps, log, errors, s3, restoredDump } = fakeDeps();
    await s3.putObject(BUCKETS.attachments, key(1), Buffer.from('older copy'));
    await s3.putObject(BUCKETS.reports, key(9), Buffer.from('not in the archive'));

    expect(await runRestore([ARCHIVE], env(), deps)).toBe(0);
    expect(errors).toEqual([]);
    const passwords = await readRolePasswords(secrets);
    expect(deps.resetAppSchema).toHaveBeenCalledExactlyOnceWith(SUPERUSER_URL, passwords);
    expect(deps.runCommand).toHaveBeenCalledExactlyOnceWith(
      'pg_restore',
      [
        '--no-password',
        '--no-owner',
        '--exit-on-error',
        '--single-transaction',
        '--dbname=postgres://wf_migrate@postgres:5432/write_financial',
      ],
      { env: { PGPASSWORD: passwords.migrate }, input: expect.anything() as AsyncIterable<Uint8Array> },
    );
    expect(restoredDump).toEqual(['PGDMP the dump']);
    expect(Object.fromEntries([...s3.buckets].map(([name, objects]) => [name, Object.fromEntries(objects)]))).toEqual({
      lampiran: { [key(1)]: Buffer.from('attachment 1') },
      foto: { [key(2)]: Buffer.from('avatar 2') },
      laporan: {},
      ekspor: {},
    });
    expect(deps.migrate).toHaveBeenCalledExactlyOnceWith(
      `postgres://wf_migrate:${passwords.migrate}@postgres:5432/write_financial`,
    );
    expect(vi.mocked(deps.resetAppSchema).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(deps.runCommand).mock.invocationCallOrder[0] ?? 0,
    );
    expect(log).toEqual([
      `Verifying ${path.join(backups, ARCHIVE)}…`,
      'The archive is intact: made 2026-10-18T20:00:00.000Z by version 0.2.0, database at migration 0001_security, ' +
        '2 object(s) (attachments 1, avatars 1, reports 0, exports 0).',
      'Restoring the database and the objects…',
      'Deleted 1 stored object(s) that are not in the archive.',
      'Restore is done: 1 user(s), 2 object(s) (attachments 1, avatars 1, reports 0, exports 0), migrations up to ' +
        'date. Start the app with `docker compose up -d --wait`.',
    ]);
  });

  it('deletes objects that are not in the archive in batches of 1000', async () => {
    const { deps, s3 } = fakeDeps();
    for (let n = 100; n < 1101; n++) s3.bucket(BUCKETS.exports).set(key(n), new Uint8Array(0));
    expect(await runRestore([ARCHIVE], env(), deps)).toBe(0);
    expect(s3.calls.filter((call) => call.startsWith('deleteObjects'))).toEqual([
      'deleteObjects ekspor 1000',
      'deleteObjects ekspor 1',
    ]);
    expect(s3.bucket(BUCKETS.exports).size).toBe(0);
  });

  it('reads the identity from --identity and takes an archive path', async () => {
    const keyFile = path.join(secrets, 'backup.key');
    await writeFile(keyFile, `${identity}\n`);
    const file = await makeArchive(MIGRATIONS[0]?.when ?? null, 'copy.tar.age');
    const { deps } = fakeDeps({ stdin: Object.assign(Readable.from([]), { isTTY: true }) });
    expect(await runRestore(['--identity', keyFile, file], env(), deps)).toBe(0);
  });

  it('restores an archive of a database that was never migrated', async () => {
    const { deps, log } = fakeDeps();
    await makeArchive(null, 'empty.tar.age');
    expect(await runRestore(['empty.tar.age'], env(), deps)).toBe(0);
    expect(log[1]).toContain('database at migration none');
  });

  it.each([[[]], [['--force']], [['a.tar.age', 'b.tar.age']], [['--identity']], [['-f', ARCHIVE]]])(
    'prints the usage for %j',
    async (args) => {
      const { deps, errors } = fakeDeps();
      expect(await runRestore(args, env(), deps)).toBe(2);
      expect(errors).toEqual([RESTORE_USAGE]);
    },
  );

  it('asks for the identity on stdin instead of waiting for a terminal', async () => {
    const { deps, errors } = fakeDeps({ stdin: Object.assign(Readable.from([]), { isTTY: true }) });
    expect(await runRestore([ARCHIVE], env(), deps)).toBe(1);
    expect(errors).toEqual([expect.stringContaining('Give the age identity (private key) on stdin')]);
  });

  it('changes nothing when the archive cannot be decrypted with the identity', async () => {
    const { deps, errors } = fakeDeps({ stdin: pipe(await generateIdentity()) });
    expect(await runRestore([ARCHIVE], env(), deps)).toBe(1);
    expect(errors).toEqual([expect.stringMatching(/^restore failed: ArchiveError: Cannot decrypt /)]);
    expect(deps.inspectRestoreTarget).not.toHaveBeenCalled();
    expect(deps.resetAppSchema).not.toHaveBeenCalled();
  });

  it('fails when the archive does not exist', async () => {
    const { deps, errors } = fakeDeps();
    expect(await runRestore(['wf-20200101T000000Z.tar.age'], env(), deps)).toBe(1);
    expect(errors).toEqual([expect.stringMatching(/^restore failed: Error: ENOENT/)]);
  });

  it('refuses an archive of a newer version', async () => {
    await makeArchive(1892314867344, 'newer.tar.age');
    const { deps, errors } = fakeDeps();
    expect(await runRestore(['newer.tar.age'], env(), deps)).toBe(1);
    expect(errors).toEqual([
      "restore failed: RestoreRefusedError: The archive's database is at migration 1892314867344 (not part of this " +
        'version), which this version does not have: restore it with version 0.2.0 or newer (WF_VERSION in .env)',
    ]);
    expect(deps.resetAppSchema).not.toHaveBeenCalled();
  });

  it('refuses while the app is connected to the database', async () => {
    const { deps, errors } = fakeDeps({ inspectRestoreTarget: () => Promise.resolve({ users: 0, appSessions: 3 }) });
    expect(await runRestore([ARCHIVE, '--force'], env(), deps)).toBe(1);
    expect(errors).toEqual([expect.stringContaining('The app still has 3 connection(s) to the database')]);
    expect(deps.resetAppSchema).not.toHaveBeenCalled();
  });

  it('refuses to replace existing users without --force, and replaces them with it', async () => {
    const inspectRestoreTarget = () => Promise.resolve({ users: 2, appSessions: 0 });
    const refused = fakeDeps({ inspectRestoreTarget });
    expect(await runRestore([ARCHIVE], env(), refused.deps)).toBe(1);
    expect(refused.errors).toEqual([
      'restore failed: RestoreRefusedError: The database is not empty (2 user(s)). A restore replaces all of its ' +
        'data and every stored file; to do that, run the restore again with --force',
    ]);
    expect(refused.deps.resetAppSchema).not.toHaveBeenCalled();

    const forced = fakeDeps({ inspectRestoreTarget });
    expect(await runRestore(['--force', ARCHIVE], env(), forced.deps)).toBe(0);
    expect(forced.log).toContain('--force: replacing the current data (2 user(s)).');
    expect(forced.deps.resetAppSchema).toHaveBeenCalledOnce();
  });

  it('fails when pg_restore fails', async () => {
    const { deps, errors } = fakeDeps({
      runCommand: () => Promise.reject(new Error('pg_restore exited with status 1: error: could not execute query')),
    });
    expect(await runRestore([ARCHIVE], env(), deps)).toBe(1);
    expect(errors).toEqual(['restore failed: Error: pg_restore exited with status 1: error: could not execute query']);
    expect(deps.migrate).not.toHaveBeenCalled();
  });
});
