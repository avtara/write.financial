// SPDX-License-Identifier: AGPL-3.0-only
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './config.ts';
import type { ConfigIssue, ReadFile } from './config.ts';

const SECRET = 'S3cr3t-value-that-must-never-leak-0123456789';

const BASE = {
  PUBLIC_URL: 'http://localhost:3000',
  DATABASE_URL: 'postgres://wf_app:pw@127.0.0.1:5432/write_financial',
  DATABASE_URL_WORKER: 'postgresql://wf_worker:pw@127.0.0.1:5432/write_financial',
  DATABASE_URL_AUTH: 'postgres://wf_auth:pw@127.0.0.1:5432/write_financial',
  REDIS_URL: 'redis://:pw@127.0.0.1:6379/0',
  S3_ENDPOINT: 'http://127.0.0.1:8333',
  S3_ACCESS_KEY_ID: 'access',
  S3_SECRET_ACCESS_KEY: 'secret',
  KEK_FILE: '/run/secrets/kek',
  AUTH_SECRET: SECRET,
} satisfies Record<string, string>;

const CLOUD = {
  ...BASE,
  DEPLOYMENT_MODE: 'cloud',
  PUBLIC_URL: 'https://write.financial',
  SMTP_URL: 'smtps://user:pw@smtp.example.com:465',
  MAIL_FROM: 'write.financial <no-reply@write.financial>',
  CMC_API_KEY: 'cmc-key',
};

const noFiles: ReadFile = (path) => {
  throw new Error(`unexpected read of ${path}`);
};

function issuesOf(env: Record<string, string | undefined>, readFile: ReadFile = noFiles): readonly ConfigIssue[] {
  try {
    loadConfig(env, readFile);
  } catch (error) {
    if (error instanceof ConfigError) return error.issues;
    throw error;
  }
  throw new Error('expected loadConfig to throw');
}

describe('loadConfig', () => {
  it('reads every optional setting when present', () => {
    const config = loadConfig({
      ...CLOUD,
      NODE_ENV: 'development',
      DATABASE_URL_MIGRATE: 'postgres://wf_migrate:pw@db/write_financial',
      DATABASE_URL_SUPERUSER: 'postgres://postgres:pw@db/write_financial',
      DATABASE_URL_READONLY_OPS: 'postgres://wf_readonly_ops:pw@db/write_financial',
      S3_REGION: 'ap-southeast-3',
      S3_BUCKET_ATTACHMENTS: 'a.files',
      S3_BUCKET_AVATARS: 'b-files',
      S3_BUCKET_REPORTS: 'c01',
      S3_BUCKET_EXPORTS: 'd-files',
      GOOGLE_CLIENT_ID: 'client-id',
      GOOGLE_CLIENT_SECRET: 'client-secret',
      GOOGLE_CLOUD_PROJECT: 'wf-project',
      GOOGLE_GMAIL_PUBSUB_TOPIC: 'projects/wf-project/topics/gmail-push',
      LOG_LEVEL: 'debug',
    });
    expect(config).toMatchObject({
      deploymentMode: 'cloud',
      nodeEnv: 'development',
      publicUrl: 'https://write.financial/',
      db: {
        migrateUrl: 'postgres://wf_migrate:pw@db/write_financial',
        superuserUrl: 'postgres://postgres:pw@db/write_financial',
        readonlyOpsUrl: 'postgres://wf_readonly_ops:pw@db/write_financial',
      },
      s3: {
        region: 'ap-southeast-3',
        buckets: { attachments: 'a.files', avatars: 'b-files', reports: 'c01', exports: 'd-files' },
      },
      mail: { smtpUrl: CLOUD.SMTP_URL, from: CLOUD.MAIL_FROM },
      google: {
        clientId: 'client-id',
        clientSecret: 'client-secret',
        gmail: { cloudProject: 'wf-project', pubsubTopic: 'projects/wf-project/topics/gmail-push' },
      },
      market: { cmcApiKey: 'cmc-key' },
      log: { level: 'debug' },
    });
  });

  it('configures Google sign-in without Gmail', () => {
    expect(loadConfig({ ...BASE, GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret' }).google).toEqual({
      clientId: 'id',
      clientSecret: 'secret',
      gmail: null,
    });
  });

  it('accepts a bare email address as MAIL_FROM', () => {
    expect(loadConfig({ ...BASE, SMTP_URL: 'smtp://127.0.0.1:1025', MAIL_FROM: 'dev@write.financial' }).mail).toEqual({
      smtpUrl: 'smtp://127.0.0.1:1025',
      from: 'dev@write.financial',
    });
  });

  it('treats empty values as unset', () => {
    const config = loadConfig({
      ...BASE,
      GOOGLE_CLIENT_ID: '',
      GOOGLE_CLIENT_SECRET: '',
      LOG_LEVEL: '',
      CMC_API_KEY: '',
    });
    expect(config.google).toBeNull();
    expect(config.log.level).toBe('info');
    expect(config.market.cmcApiKey).toBeNull();
  });

  it('returns a deeply frozen object', () => {
    const config = loadConfig(BASE);
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.s3)).toBe(true);
    expect(Object.isFrozen(config.s3.buckets)).toBe(true);
    expect(Reflect.set(config.s3.buckets, 'attachments', 'other')).toBe(false);
    expect(config.s3.buckets.attachments).toBe('wf-attachments');
  });

  it('lists every missing required key at once', () => {
    expect(issuesOf({}).map((i) => i.key)).toEqual([
      'PUBLIC_URL',
      'DATABASE_URL',
      'DATABASE_URL_WORKER',
      'DATABASE_URL_AUTH',
      'REDIS_URL',
      'S3_ENDPOINT',
      'S3_ACCESS_KEY_ID',
      'S3_SECRET_ACCESS_KEY',
      'KEK_FILE',
      'AUTH_SECRET',
    ]);
    expect(issuesOf({})[0]).toEqual({ key: 'PUBLIC_URL', message: 'is required' });
  });

  it.each([
    ['DEPLOYMENT_MODE', 'saas', 'must be selfhost or cloud'],
    ['NODE_ENV', 'staging', 'must be development, test, or production'],
    ['PUBLIC_URL', 'not a url', 'must be a URL with protocol http: or https:'],
    ['PUBLIC_URL', 'ftp://example.com', 'must be a URL with protocol http: or https:'],
    ['DATABASE_URL', 'mysql://db/x', 'must be a URL with protocol postgres: or postgresql:'],
    ['DATABASE_URL_MIGRATE', 'http://db', 'must be a URL with protocol postgres: or postgresql:'],
    ['DATABASE_URL_AUTH', 'mysql://db/x', 'must be a URL with protocol postgres: or postgresql:'],
    ['DATABASE_URL_SUPERUSER', 'http://db', 'must be a URL with protocol postgres: or postgresql:'],
    ['DATABASE_URL_READONLY_OPS', 'http://db', 'must be a URL with protocol postgres: or postgresql:'],
    ['REDIS_URL', 'http://cache', 'must be a URL with protocol redis: or rediss:'],
    ['S3_BUCKET_REPORTS', 'Has_Upper', 'must be a valid S3 bucket name'],
    ['S3_BUCKET_EXPORTS', 'ab', 'must be a valid S3 bucket name'],
    ['AUTH_SECRET', 'x'.repeat(31), 'must be at least 32 characters'],
    ['SETUP_TOKEN', 'x'.repeat(21), 'must be at least 22 characters'],
    ['SMTP_URL', 'http://mail', 'must be a URL with protocol smtp: or smtps:'],
    ['LOG_LEVEL', 'verbose', 'must be fatal, error, warn, info, debug, trace, or silent'],
  ])('rejects %s=%s', (key, value, message) => {
    const env: Record<string, string> = { ...BASE, [key]: value };
    if (key === 'SMTP_URL') env.MAIL_FROM = 'a@b.co';
    expect(issuesOf(env)).toEqual([{ key, message }]);
  });

  it.each(['no-reply', 'Name <not-an-address>', 'Name <a@b.co'])('rejects MAIL_FROM=%s', (from) => {
    expect(issuesOf({ ...BASE, SMTP_URL: 'smtp://mail', MAIL_FROM: from })).toEqual([
      { key: 'MAIL_FROM', message: 'must be an email address or "Name <address>"' },
    ]);
  });

  it('rejects a malformed Gmail Pub/Sub topic', () => {
    expect(
      issuesOf({
        ...BASE,
        GOOGLE_CLIENT_ID: 'id',
        GOOGLE_CLIENT_SECRET: 'secret',
        GOOGLE_CLOUD_PROJECT: 'p',
        GOOGLE_GMAIL_PUBSUB_TOPIC: 'gmail-push',
      }),
    ).toEqual([{ key: 'GOOGLE_GMAIL_PUBSUB_TOPIC', message: 'must look like projects/<project>/topics/<topic>' }]);
  });

  it('never echoes values in error messages', () => {
    const leaky = 'postgres-leak-canary';
    const message = new ConfigError(
      issuesOf({ ...BASE, AUTH_SECRET: 'short-leak-canary', DATABASE_URL: leaky, REDIS_URL: `x${leaky}` }),
    ).message;
    expect(message).toContain('AUTH_SECRET');
    expect(message).toContain('DATABASE_URL');
    expect(message).not.toContain('leak-canary');
  });

  it('formats the error with one line per issue', () => {
    const error = new ConfigError([
      { key: 'A', message: 'is required' },
      { key: 'B', message: 'is wrong' },
    ]);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('ConfigError');
    expect(error.message).toBe('Invalid configuration:\n  - A: is required\n  - B: is wrong');
  });

  describe('cross-field rules', () => {
    it('requires MAIL_FROM with SMTP_URL', () => {
      expect(issuesOf({ ...BASE, SMTP_URL: 'smtp://mail' })).toEqual([
        { key: 'MAIL_FROM', message: 'is required when SMTP_URL is set' },
      ]);
    });

    it('requires both halves of the Google OAuth client', () => {
      expect(issuesOf({ ...BASE, GOOGLE_CLIENT_SECRET: 'secret' })).toEqual([
        { key: 'GOOGLE_CLIENT_ID', message: 'is required to enable Google sign-in' },
      ]);
    });

    it('requires the OAuth client and both Gmail settings for Gmail', () => {
      expect(issuesOf({ ...BASE, GOOGLE_CLOUD_PROJECT: 'p' })).toEqual([
        { key: 'GOOGLE_CLIENT_ID', message: 'is required to enable Gmail' },
        { key: 'GOOGLE_CLIENT_SECRET', message: 'is required to enable Gmail' },
        { key: 'GOOGLE_GMAIL_PUBSUB_TOPIC', message: 'is required to enable Gmail' },
      ]);
    });

    it('requires mail, market key, and https in cloud mode', () => {
      expect(issuesOf({ ...BASE, DEPLOYMENT_MODE: 'cloud' })).toEqual([
        { key: 'PUBLIC_URL', message: 'must use https: when DEPLOYMENT_MODE is cloud' },
        { key: 'SMTP_URL', message: 'is required when DEPLOYMENT_MODE is cloud' },
        { key: 'MAIL_FROM', message: 'is required when DEPLOYMENT_MODE is cloud' },
        { key: 'CMC_API_KEY', message: 'is required when DEPLOYMENT_MODE is cloud' },
      ]);
    });

    it('reports only the missing PUBLIC_URL in cloud mode', () => {
      expect(issuesOf({ ...CLOUD, PUBLIC_URL: undefined })).toEqual([{ key: 'PUBLIC_URL', message: 'is required' }]);
    });
  });

  describe('<NAME>_FILE secrets', () => {
    const files: Record<string, string> = {
      '/run/secrets/auth': `${SECRET}\n`,
      '/run/secrets/db': `${BASE.DATABASE_URL}\r\n`,
      '/run/secrets/cmc': 'cmc-key',
      '/run/secrets/empty': '\n',
    };
    const readFile: ReadFile = (path) => {
      const content = files[path];
      if (content === undefined) throw new Error(`ENOENT: ${path}`);
      return content;
    };

    it('reads secrets from files and strips one trailing newline', () => {
      const config = loadConfig(
        {
          ...BASE,
          AUTH_SECRET: undefined,
          AUTH_SECRET_FILE: '/run/secrets/auth',
          DATABASE_URL: '',
          DATABASE_URL_FILE: '/run/secrets/db',
          CMC_API_KEY_FILE: '/run/secrets/cmc',
        },
        readFile,
      );
      expect(config.auth.secret).toBe(SECRET);
      expect(config.db.appUrl).toBe(BASE.DATABASE_URL);
      expect(config.market.cmcApiKey).toBe('cmc-key');
    });

    it('ignores _FILE for non-secret keys', () => {
      expect(loadConfig({ ...BASE, LOG_LEVEL_FILE: '/run/secrets/missing' }, readFile).log.level).toBe('info');
    });

    it('sorts file issues next to their key', () => {
      const env = { ...BASE, LOG_LEVEL: 'loud', KEK_FILE: undefined, CMC_API_KEY_FILE: '/run/secrets/missing' };
      expect(issuesOf(env, readFile).map((i) => i.key)).toEqual(['KEK_FILE', 'CMC_API_KEY_FILE', 'LOG_LEVEL']);
    });

    it('rejects setting both forms', () => {
      expect(issuesOf({ ...BASE, AUTH_SECRET_FILE: '/run/secrets/auth' }, readFile)).toEqual([
        { key: 'AUTH_SECRET', message: 'set either AUTH_SECRET or AUTH_SECRET_FILE, not both' },
      ]);
    });

    it('reports an unreadable file without its error details', () => {
      expect(issuesOf({ ...BASE, SMTP_URL_FILE: '/run/secrets/missing', MAIL_FROM: 'a@b.co' }, readFile)).toEqual([
        { key: 'SMTP_URL_FILE', message: 'cannot read the file' },
      ]);
    });

    it('counts an unreadable secret as set for cross-field rules', () => {
      expect(
        issuesOf({ ...BASE, GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET_FILE: '/run/secrets/missing' }, readFile),
      ).toEqual([{ key: 'GOOGLE_CLIENT_SECRET_FILE', message: 'cannot read the file' }]);
    });

    it('treats an empty file as unset', () => {
      expect(issuesOf({ ...BASE, AUTH_SECRET: undefined, AUTH_SECRET_FILE: '/run/secrets/empty' }, readFile)).toEqual([
        { key: 'AUTH_SECRET', message: 'is required' },
      ]);
    });

    it('reads files from disk by default', () => {
      const dir = mkdtempSync(join(tmpdir(), 'wf-config-'));
      try {
        const path = join(dir, 'auth_secret');
        writeFileSync(path, `${SECRET}\n`);
        expect(loadConfig({ ...BASE, AUTH_SECRET: undefined, AUTH_SECRET_FILE: path }).auth.secret).toBe(SECRET);
      } finally {
        rmSync(dir, { recursive: true });
      }
    });

    it('reads the setup token from SETUP_TOKEN_FILE', () => {
      const token = 't'.repeat(22);
      const files: Record<string, string> = { '/run/wf-secrets/setup-token': token };
      const config = loadConfig(
        { ...BASE, SETUP_TOKEN_FILE: '/run/wf-secrets/setup-token' },
        (path) => files[path] ?? '',
      );
      expect(config.setup).toEqual({ token });
      expect(issuesOf({ ...BASE, SETUP_TOKEN: token, SETUP_TOKEN_FILE: '/x' }, readFile)).toEqual([
        { key: 'SETUP_TOKEN', message: 'set either SETUP_TOKEN or SETUP_TOKEN_FILE, not both' },
      ]);
    });
  });
});

describe('custom AI egress configuration', () => {
  it('canonicalizes and deduplicates exact trusted API bases while preserving their paths', () => {
    const config = loadConfig({
      ...BASE,
      AI_ALLOWED_BASE_URLS: 'https://API.example:443/llm/v1/, http://127.0.0.1:11434/v1,https://api.example/llm/v1',
    });
    expect(config.ai.allowedBaseUrls).toEqual(['https://api.example/llm/v1', 'http://127.0.0.1:11434/v1']);
    expect(Object.isFrozen(config.ai.allowedBaseUrls)).toBe(true);
  });

  it('refuses credential-bearing URLs, queries, fragments and non-HTTP endpoints without echoing secrets', () => {
    for (const value of [
      `https://user:${SECRET}@api.example/v1`,
      `https://api.example/v1?key=${SECRET}`,
      'https://api.example/v1#private',
      'file:///etc/passwd',
      'https://api.example/v1,',
    ]) {
      const issues = issuesOf({ ...BASE, AI_ALLOWED_BASE_URLS: value });
      expect(issues.map((issue) => issue.key)).toEqual(['AI_ALLOWED_BASE_URLS']);
      expect(JSON.stringify(issues)).not.toContain(SECRET);
    }
  });

  it('allows explicitly trusted local HTTP on self-host but requires HTTPS for cloud credentials', () => {
    expect(loadConfig({ ...BASE, AI_ALLOWED_BASE_URLS: 'http://127.0.0.1:11434/v1' }).ai.allowedBaseUrls).toEqual([
      'http://127.0.0.1:11434/v1',
    ]);
    expect(issuesOf({ ...CLOUD, AI_ALLOWED_BASE_URLS: 'http://127.0.0.1:11434/v1' }).map((issue) => issue.key)).toEqual(
      ['AI_ALLOWED_BASE_URLS'],
    );
  });
});
