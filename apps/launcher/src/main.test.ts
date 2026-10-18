// SPDX-License-Identifier: AGPL-3.0-only
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ENTRIES, importEntry, main, USAGE, type LaunchDeps, type LaunchProcess } from './main.ts';
import { RESTORE_USAGE } from './restore.ts';
import { ensureSecrets } from './secrets.ts';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'wf-main-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const DATA_MODULE = 'data:text/javascript,export const app = "web"';

function fakeDeps(overrides: Partial<LaunchDeps> = {}) {
  const errors: string[] = [];
  const deps = {
    importEntry: vi.fn<LaunchDeps['importEntry']>(() => Promise.resolve({})),
    fetch: vi.fn<LaunchDeps['fetch']>(() => Promise.resolve(Response.json({ status: 'ok' }))),
    bootstrapRoles: vi.fn(() => Promise.resolve()),
    migrate: vi.fn(() => Promise.resolve()),
    sleep: vi.fn(() => Promise.resolve()),
    setupPending: vi.fn(() => Promise.resolve(true)),
    runCommand: vi.fn<LaunchDeps['runCommand']>(() => Promise.resolve(Buffer.alloc(0))),
    createS3: vi.fn<LaunchDeps['createS3']>(() => {
      throw new Error('not used');
    }),
    migrationLevel: vi.fn(() => Promise.resolve({ applied: 0, latest: null })),
    inspectRestoreTarget: vi.fn(() => Promise.resolve({ users: 0, appSessions: 0 })),
    resetAppSchema: vi.fn(() => Promise.resolve()),
    migrations: [],
    stdin: Readable.from([]),
    now: () => 0,
    output: { log: vi.fn(), error: (message: string) => errors.push(message) },
    ...overrides,
  };
  return { deps, errors };
}

const proc = (env: Record<string, string | undefined> = {}): LaunchProcess => ({
  argv: ['/usr/local/bin/node', '/app/apps/launcher/src/cli.ts', 'ignored'],
  env,
});

describe('ENTRIES', () => {
  it('points at the web server build and the worker next to the launcher', () => {
    expect(fileURLToPath(ENTRIES.web)).toMatch(/\/apps\/web\/\.output\/server\/index\.mjs$/);
    expect(existsSync(fileURLToPath(ENTRIES.worker))).toBe(true);
  });
});

describe('importEntry', () => {
  it('loads a module by URL', async () => {
    expect(await importEntry(DATA_MODULE)).toHaveProperty('app', 'web');
  });
});

describe('main', () => {
  it.each([[[]], [['help']], [['healthcheck']], [['web', 'now']]])('prints the usage for %j', async (args) => {
    const { deps, errors } = fakeDeps();
    expect(await main(args, proc(), deps)).toBe(2);
    expect(errors).toEqual([USAGE]);
    expect(deps.importEntry).not.toHaveBeenCalled();
  });

  it('runs init', async () => {
    const { deps, errors } = fakeDeps();
    expect(await main(['init'], proc({ WF_SECRETS_DIR: dir, POSTGRES_PASSWORD: 'x' }), deps)).toBe(1);
    expect(errors[0]).toMatch(/^init failed: ConfigError: Invalid configuration/);
  });

  it('runs backup, which refuses to write without an age recipient', async () => {
    const { deps, errors } = fakeDeps();
    expect(await main(['backup'], proc(), deps)).toBe(1);
    expect(errors[0]).toMatch(/^backup failed: LaunchConfigError: No age recipient is configured/);
    expect(deps.runCommand).not.toHaveBeenCalled();
  });

  it('runs restore with its arguments', async () => {
    const { deps, errors } = fakeDeps();
    expect(await main(['restore'], proc(), deps)).toBe(2);
    expect(await main(['restore', 'wf-20261018T200000Z.tar.age', '--force'], proc(), deps)).toBe(1);
    expect(errors).toEqual([
      RESTORE_USAGE,
      'restore failed: LaunchConfigError: WF_SECRETS_DIR is required for restore',
    ]);
  });

  describe('web', () => {
    it('adds the derived settings to the environment and then loads the server', async () => {
      await ensureSecrets(dir);
      const target = proc({ WF_SECRETS_DIR: dir, LOG_LEVEL: 'info' });
      const { deps } = fakeDeps({
        importEntry: vi.fn(() => {
          expect(target.env.DATABASE_URL).toMatch(/^postgres:\/\/wf_app:/);
          expect(target.env.KEK_FILE).toBe(path.join(dir, 'kek'));
          return Promise.resolve({});
        }),
      });
      expect(await main(['web'], target, deps)).toBe(0);
      expect(deps.importEntry).toHaveBeenCalledExactlyOnceWith(ENTRIES.web);
      expect(target.env.LOG_LEVEL).toBe('info');
      expect(target.env.DATABASE_URL_MIGRATE).toBeUndefined();
    });

    it('leaves the environment alone without a secrets volume', async () => {
      const target = proc({ DATABASE_URL: 'postgres://wf_app:x@db/wf' });
      const { deps } = fakeDeps();
      expect(await main(['web'], target, deps)).toBe(0);
      expect(target.env).toEqual({ DATABASE_URL: 'postgres://wf_app:x@db/wf' });
    });

    it('fails when the server cannot load', async () => {
      const { deps, errors } = fakeDeps({ importEntry: () => Promise.reject(new Error('Cannot find module')) });
      expect(await main(['web'], proc(), deps)).toBe(1);
      expect(errors).toEqual(['web failed: Error: Cannot find module']);
    });

    it('fails before loading the server when the secrets volume is unusable', async () => {
      const { deps, errors } = fakeDeps();
      expect(await main(['web'], proc({ WF_SECRETS_DIR: dir }), deps)).toBe(1);
      expect(errors[0]).toMatch(/^web failed: Error: ENOENT/);
      expect(deps.importEntry).not.toHaveBeenCalled();
    });
  });

  describe('worker', () => {
    it('loads the worker with its own argv and the derived settings', async () => {
      await ensureSecrets(dir);
      const target = proc({ WF_SECRETS_DIR: dir });
      const { deps } = fakeDeps();
      expect(await main(['worker'], target, deps)).toBe(0);
      expect(target.argv).toEqual(['/usr/local/bin/node', fileURLToPath(ENTRIES.worker)]);
      expect(target.env.DATABASE_URL_WORKER).toMatch(/^postgres:\/\/wf_worker:/);
      expect(deps.importEntry).toHaveBeenCalledExactlyOnceWith(ENTRIES.worker);
    });

    it('runs the worker heartbeat check for `healthcheck worker`', async () => {
      const target = proc();
      const { deps } = fakeDeps();
      expect(await main(['healthcheck', 'worker'], target, deps)).toBe(0);
      expect(target.argv.slice(2)).toEqual(['--healthcheck']);
      expect(deps.importEntry).toHaveBeenCalledExactlyOnceWith(ENTRIES.worker);
    });
  });

  describe('healthcheck web', () => {
    it('asks the local server on PORT (default 3000) for /healthz', async () => {
      const fetch = vi.fn<LaunchDeps['fetch']>(() => Promise.resolve(Response.json({ status: 'ok' })));
      const { deps } = fakeDeps({ fetch });
      expect(await main(['healthcheck', 'web'], proc(), deps)).toBe(0);
      expect(await main(['healthcheck', 'web'], proc({ PORT: '8080' }), deps)).toBe(0);
      expect(fetch.mock.calls.map(([url]) => url)).toEqual([
        'http://127.0.0.1:3000/healthz',
        'http://127.0.0.1:8080/healthz',
      ]);
      expect(fetch.mock.calls[0]?.[1].signal).toBeInstanceOf(AbortSignal);
    });

    it.each([
      ['an error status', () => new Response('{"status":"ok"}', { status: 503 })],
      ['another status', () => Response.json({ status: 'starting' })],
      ['a body that is not an object', () => Response.json('ok')],
      ['a null body', () => Response.json(null)],
    ])('is unhealthy on %s', async (_, response) => {
      const { deps } = fakeDeps({ fetch: () => Promise.resolve(response()) });
      expect(await main(['healthcheck', 'web'], proc(), deps)).toBe(1);
    });

    it('is unhealthy when the server does not answer', async () => {
      const { deps, errors } = fakeDeps({ fetch: () => Promise.reject(new TypeError('fetch failed')) });
      expect(await main(['healthcheck', 'web'], proc(), deps)).toBe(1);
      expect(errors).toEqual(['healthcheck web failed: TypeError: fetch failed']);
    });
  });
});
