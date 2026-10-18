// SPDX-License-Identifier: AGPL-3.0-only
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { generateIdentity, identityToRecipient } from 'age-encryption';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ageIdentities,
  ageRecipients,
  backupDir,
  login,
  retentionDays,
  s3Settings,
  superuser,
} from './backup-settings.ts';
import { LaunchConfigError } from './env.ts';
import { ensureSecrets, readSecret } from './secrets.ts';

let dir: string;
let identity: string;
let recipient: string;
let spare: string;

beforeAll(async () => {
  identity = await generateIdentity();
  recipient = await identityToRecipient(identity);
  spare = await identityToRecipient(await generateIdentity());
});

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'wf-backup-settings-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** Built at runtime so the secret scanner does not flag a fixture. */
const PASSWORD = ['pass', 'w@rd'].join('-');

describe('login and superuser', () => {
  it('gives postgres.js the password in the URL and the client tools a URL without it', () => {
    expect(login({ WF_DATABASE_HOST: 'db:5432' }, 'wf_migrate', PASSWORD)).toEqual({
      url: 'postgres://wf_migrate:pass-w%40rd@db:5432/write_financial',
      target: 'postgres://wf_migrate@db:5432/write_financial',
      password: PASSWORD,
    });
  });

  it('logs in as POSTGRES_USER (default postgres) with POSTGRES_PASSWORD', () => {
    expect(superuser({ POSTGRES_PASSWORD: PASSWORD }, 'backup').target).toBe(
      'postgres://postgres@postgres:5432/write_financial',
    );
    expect(superuser({ POSTGRES_PASSWORD: PASSWORD, POSTGRES_USER: 'admin' }, 'backup').url).toMatch(
      /^postgres:\/\/admin:/,
    );
    expect(() => superuser({ POSTGRES_PASSWORD: '' }, 'backup')).toThrow(
      new LaunchConfigError('POSTGRES_PASSWORD (the PostgreSQL superuser password from .env) is required for backup'),
    );
  });
});

describe('backupDir and retentionDays', () => {
  it('default to /backups and 30 days', () => {
    expect(backupDir({})).toBe('/backups');
    expect(backupDir({ BACKUP_DIR: '/srv/backups' })).toBe('/srv/backups');
    expect(retentionDays({ BACKUP_RETENTION_DAYS: '' })).toBe(30);
    expect(retentionDays({ BACKUP_RETENTION_DAYS: '7' })).toBe(7);
    expect(retentionDays({ BACKUP_RETENTION_DAYS: '99999' })).toBe(99999);
  });

  it.each(['0', '-1', '1.5', '30d', '100000'])('rejects a retention of %j', (days) => {
    expect(() => retentionDays({ BACKUP_RETENTION_DAYS: days })).toThrow(LaunchConfigError);
  });
});

describe('s3Settings', () => {
  it("reads the app's S3 identity from the secrets volume, with the defaults of @wf/config", async () => {
    await ensureSecrets(dir);
    const settings = await s3Settings({ WF_SECRETS_DIR: dir, S3_ENDPOINT: 'http://seaweedfs:8333' }, 'backup');
    expect(settings).toEqual({
      endpoint: 'http://seaweedfs:8333',
      region: 'us-east-1',
      accessKeyId: await readSecret(path.join(dir, 's3/access_key_id')),
      secretAccessKey: await readSecret(path.join(dir, 's3/secret_access_key')),
      buckets: { attachments: 'wf-attachments', avatars: 'wf-avatars', reports: 'wf-reports', exports: 'wf-exports' },
    });
  });

  it('takes the region and bucket names from the environment', async () => {
    await ensureSecrets(dir);
    const settings = await s3Settings(
      {
        WF_SECRETS_DIR: dir,
        S3_ENDPOINT: 'https://s3.example.com',
        S3_REGION: 'ap-southeast-3',
        S3_BUCKET_ATTACHMENTS: 'a',
        S3_BUCKET_AVATARS: 'b',
        S3_BUCKET_REPORTS: 'c',
        S3_BUCKET_EXPORTS: 'd',
      },
      'backup',
    );
    expect(settings).toMatchObject({
      region: 'ap-southeast-3',
      buckets: { attachments: 'a', avatars: 'b', reports: 'c', exports: 'd' },
    });
  });

  it('needs the secrets volume and the endpoint', async () => {
    await expect(s3Settings({ S3_ENDPOINT: 'http://seaweedfs:8333' }, 'restore')).rejects.toThrow(
      'WF_SECRETS_DIR is required for restore',
    );
    await expect(s3Settings({ WF_SECRETS_DIR: dir }, 'restore')).rejects.toThrow('S3_ENDPOINT is required for restore');
  });
});

describe('ageRecipients', () => {
  it('refuses to run without a recipient: backups are never written unencrypted', async () => {
    for (const env of [{}, { BACKUP_AGE_RECIPIENT: '' }, { BACKUP_AGE_RECIPIENT: '  ' }]) {
      await expect(ageRecipients(env)).rejects.toThrow(/^No age recipient is configured/);
    }
  });

  it('takes one recipient from BACKUP_AGE_RECIPIENT', async () => {
    expect(await ageRecipients({ BACKUP_AGE_RECIPIENT: ` ${recipient}\n` })).toEqual([recipient]);
  });

  it('takes every recipient of a recipients file', async () => {
    const file = path.join(dir, 'recipients.txt');
    await writeFile(file, `# main key (offline)\n${recipient}\n\n# spare key (safe)\n${spare}\n`);
    expect(await ageRecipients({ BACKUP_AGE_RECIPIENT_FILE: file })).toEqual([recipient, spare]);
    await writeFile(file, '# nothing yet\n');
    await expect(ageRecipients({ BACKUP_AGE_RECIPIENT_FILE: file })).rejects.toThrow(/^No age recipient/);
  });

  it('rejects both forms at once, a file it cannot read, and lines that are not recipients', async () => {
    const file = path.join(dir, 'recipients.txt');
    await expect(ageRecipients({ BACKUP_AGE_RECIPIENT: recipient, BACKUP_AGE_RECIPIENT_FILE: file })).rejects.toThrow(
      'Set either BACKUP_AGE_RECIPIENT or BACKUP_AGE_RECIPIENT_FILE, not both',
    );
    await expect(ageRecipients({ BACKUP_AGE_RECIPIENT_FILE: file })).rejects.toThrow(/ENOENT/);
    await writeFile(file, `${recipient}\nage1notarecipient\n`);
    await expect(ageRecipients({ BACKUP_AGE_RECIPIENT_FILE: file })).rejects.toThrow(
      new LaunchConfigError(`${file} line 2 is not an age recipient (age1…)`),
    );
    await expect(ageRecipients({ BACKUP_AGE_RECIPIENT: 'ssh-rsa AAAA' })).rejects.toThrow(
      new LaunchConfigError('BACKUP_AGE_RECIPIENT is not an age recipient (age1…)'),
    );
  });

  it('refuses a private key, whatever its case, without echoing it', async () => {
    for (const key of [identity, identity.toLowerCase()]) {
      const error = await ageRecipients({ BACKUP_AGE_RECIPIENT: key }).catch((reason: unknown) => reason);
      expect(error).toBeInstanceOf(LaunchConfigError);
      expect(String(error)).toContain('BACKUP_AGE_RECIPIENT holds an age identity (private key)');
      expect(String(error)).not.toContain(identity.slice(15));
    }
  });
});

describe('ageIdentities', () => {
  it('reads the identities of an age-keygen file', () => {
    const text = `# created: 2026-10-18T20:00:00+07:00\n# public key: ${recipient}\n${identity}\n`;
    expect(ageIdentities(text, 'backup.key')).toEqual([identity]);
  });

  it('rejects text without identities and lines that are not identities, without echoing them', () => {
    expect(() => ageIdentities('# only a comment\n', 'stdin')).toThrow(
      new LaunchConfigError('stdin contains no age identity (AGE-SECRET-KEY-…)'),
    );
    expect(() => ageIdentities(`${identity}\n${recipient}\n`, 'backup.key')).toThrow(
      new LaunchConfigError('backup.key line 2 is not an age identity (AGE-SECRET-KEY-…)'),
    );
  });
});
